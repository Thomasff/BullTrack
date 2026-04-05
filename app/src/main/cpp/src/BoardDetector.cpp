#include "BoardDetectorAndroid.h"

#include "bulltrack_v2/Preprocessing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <numeric>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace bulltrack {
namespace {

constexpr double kAndroidRedRegionMinLongShortRatio = 2.3;
constexpr double kInnerRemoveRadiusScale = 0.85;
constexpr double kLongEdgeKeepScale = 0.5;
constexpr int kExpectedDoubleRegionCount = 10;

cv::Mat PrepareBoardMeasurementBaseImage(const cv::Mat& image_bgr) {
    if (image_bgr.empty()) {
        return cv::Mat();
    }

    cv::Mat level1;
    cv::pyrDown(image_bgr, level1);
    cv::Mat level2;
    cv::pyrDown(level1, level2);
    cv::GaussianBlur(level2, level2, cv::Size(5, 5), 0);

    cv::Mat up1;
    cv::pyrUp(level2, up1, level1.size());
    cv::Mat up2;
    cv::pyrUp(up1, up2, image_bgr.size());
    if (up2.size() != image_bgr.size()) {
        cv::resize(up2, up2, image_bgr.size(), 0.0, 0.0, cv::INTER_LINEAR);
    }
    return up2;
}

struct ComponentCandidate {
    int area = 0;
    cv::Mat mask;
    cv::RotatedRect rect;
    double center_distance = 0.0;
    double angle_from_top_clockwise = 0.0;
};

struct RedRadiusCorrectionResult {
    std::optional<double> corrected_radius;
    AdaptiveRedLabModel red_lab_model;
    cv::Mat red_only_mask;
    cv::Mat red_only_blurred;
    std::vector<cv::Mat> selected_component_masks;
    cv::Mat inner_removed_binary;
    cv::Mat perpendicular_rotated_boxes_debug;
    cv::Mat perpendicular_components_binary;
    cv::Mat area_grouped_debug;
    cv::Mat perspective_corrected_preview_debug;
    std::array<cv::Point2f, 4> correction_points_src{};
    std::array<cv::Point2f, 4> correction_points_dst{};
    cv::Mat point_rectification_h;
    std::string reason;
};

std::vector<ComponentCandidate> ExtractComponentCandidates(
    const cv::Mat& binary_img,
    int min_area,
    const cv::Point2f& rough_center) {
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    std::vector<ComponentCandidate> components;
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area < min_area) {
            continue;
        }
        cv::Mat mask = labels == label;
        mask.convertTo(mask, CV_8U);
        std::vector<cv::Point> points;
        cv::findNonZero(mask, points);
        if (points.empty()) {
            continue;
        }
        const cv::RotatedRect rect = cv::minAreaRect(points);
        const double dx = static_cast<double>(rect.center.x) - static_cast<double>(rough_center.x);
        const double dy = static_cast<double>(rect.center.y) - static_cast<double>(rough_center.y);
        double angle = std::atan2(dx, -dy);
        if (angle < 0.0) {
            angle += 2.0 * CV_PI;
        }
        components.push_back(ComponentCandidate{
            area,
            mask,
            rect,
            std::hypot(dx, dy),
            angle
        });
    }
    return components;
}

bool HasMinRotatedRectLongShortRatio(
    const cv::RotatedRect& rect,
    double min_ratio) {
    const double width = std::max(1.0f, rect.size.width);
    const double height = std::max(1.0f, rect.size.height);
    const double long_edge = std::max(width, height);
    const double short_edge = std::min(width, height);
    if (short_edge <= 1e-6) {
        return false;
    }
    return (long_edge / short_edge) >= min_ratio;
}

double GetRotatedRectLongEdge(const cv::RotatedRect& rect) {
    return std::max(
        static_cast<double>(rect.size.width),
        static_cast<double>(rect.size.height));
}

bool IsComponentPerpendicularToCenterVector(
    const cv::RotatedRect& rect,
    const cv::Point2f& rough_center,
    double min_angle_deg,
    double max_angle_deg) {
    const cv::Point2d vector_to_component(
        static_cast<double>(rect.center.x) - static_cast<double>(rough_center.x),
        static_cast<double>(rect.center.y) - static_cast<double>(rough_center.y));
    const double vector_norm = std::hypot(vector_to_component.x, vector_to_component.y);
    if (vector_norm <= 1e-6) {
        return false;
    }

    std::array<cv::Point2f, 4> box_points{};
    rect.points(box_points.data());
    cv::Point2d longest_edge(0.0, 0.0);
    double longest_edge_norm = 0.0;
    for (int i = 0; i < 4; ++i) {
        const cv::Point2d edge(
            static_cast<double>(box_points[(i + 1) % 4].x - box_points[i].x),
            static_cast<double>(box_points[(i + 1) % 4].y - box_points[i].y));
        const double edge_norm = std::hypot(edge.x, edge.y);
        if (edge_norm > longest_edge_norm) {
            longest_edge_norm = edge_norm;
            longest_edge = edge;
        }
    }
    if (longest_edge_norm <= 1e-6) {
        return false;
    }

    const double dot = longest_edge.x * vector_to_component.x + longest_edge.y * vector_to_component.y;
    const double cosine = std::clamp(dot / (longest_edge_norm * vector_norm), -1.0, 1.0);
    const double angle_deg = std::acos(cosine) * 180.0 / CV_PI;
    return angle_deg >= min_angle_deg && angle_deg <= max_angle_deg;
}

cv::Point2f SelectFarthestLongEdgeMidpoint(const cv::RotatedRect& rect, const cv::Point2f& rough_center) {
    std::array<cv::Point2f, 4> box_points{};
    rect.points(box_points.data());

    double max_edge_length = 0.0;
    std::array<double, 4> edge_lengths{};
    for (int i = 0; i < 4; ++i) {
        edge_lengths[i] = cv::norm(box_points[(i + 1) % 4] - box_points[i]);
        max_edge_length = std::max(max_edge_length, edge_lengths[i]);
    }

    std::optional<cv::Point2f> best_midpoint;
    double best_distance = -1.0;
    for (int i = 0; i < 4; ++i) {
        if (std::abs(edge_lengths[i] - max_edge_length) > 1e-3) {
            continue;
        }
        const cv::Point2f midpoint = (box_points[i] + box_points[(i + 1) % 4]) * 0.5f;
        const double distance = cv::norm(midpoint - rough_center);
        if (distance > best_distance) {
            best_distance = distance;
            best_midpoint = midpoint;
        }
    }
    if (!best_midpoint.has_value()) {
        throw std::runtime_error("无法从双倍区旋转框提取纠正点");
    }
    return best_midpoint.value();
}

std::array<cv::Point2f, 4> BuildCorrectionDestinationPoints() {
    const std::array<double, 4> kAnglesDeg = {54.0, -54.0, -126.0, 126.0};
    std::array<cv::Point2f, 4> dst_points{};
    for (size_t i = 0; i < kAnglesDeg.size(); ++i) {
        const double angle_rad = kAnglesDeg[i] * CV_PI / 180.0;
        dst_points[i] = cv::Point2f(
            static_cast<float>(std::cos(angle_rad)),
            static_cast<float>(std::sin(angle_rad)));
    }
    return dst_points;
}

#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawRotatedBoxesDebugImage(
    const cv::Mat& base_binary_img,
    const std::vector<ComponentCandidate>& components,
    const cv::Point2f& rough_center,
    const std::optional<std::array<cv::Point2f, 4>>& correction_points = std::nullopt) {
    cv::Mat debug_img;
    cv::cvtColor(base_binary_img, debug_img, cv::COLOR_GRAY2BGR);
    for (size_t i = 0; i < components.size(); ++i) {
        std::array<cv::Point2f, 4> box_points{};
        components[i].rect.points(box_points.data());
        std::vector<cv::Point> contour;
        contour.reserve(4);
        for (const auto& point : box_points) {
            contour.emplace_back(
                static_cast<int>(std::lround(point.x)),
                static_cast<int>(std::lround(point.y)));
        }
        cv::polylines(debug_img, contour, true, cv::Scalar(0, 255, 255), 2);
        cv::putText(
            debug_img,
            std::to_string(static_cast<int>(i + 1)),
            cv::Point(
                std::max(0, static_cast<int>(std::lround(components[i].rect.center.x)) - 10),
                std::max(16, static_cast<int>(std::lround(components[i].rect.center.y)) - 6)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.5,
            cv::Scalar(0, 255, 255),
            1);
    }
    cv::circle(
        debug_img,
        cv::Point(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y))),
        6,
        cv::Scalar(0, 0, 255),
        -1);
    if (correction_points.has_value()) {
        for (size_t i = 0; i < correction_points->size(); ++i) {
            const cv::Point point(
                static_cast<int>(std::lround((*correction_points)[i].x)),
                static_cast<int>(std::lround((*correction_points)[i].y)));
            cv::circle(debug_img, point, 8, cv::Scalar(255, 0, 255), -1);
            cv::putText(
                debug_img,
                "P" + std::to_string(static_cast<int>(i + 1)),
                point + cv::Point(6, -6),
                cv::FONT_HERSHEY_SIMPLEX,
                0.5,
                cv::Scalar(255, 0, 255),
                1);
        }
    }
    return debug_img;
}

cv::Mat DrawAreaFilteredDebugImage(
    const cv::Size& image_size,
    const std::vector<ComponentCandidate>& rough_candidates,
    const std::vector<ComponentCandidate>& precise_candidates,
    double rough_long_edge_mean) {
    cv::Mat debug_img = cv::Mat::zeros(image_size, CV_8UC3);
    for (const auto& candidate : rough_candidates) {
        std::array<cv::Point2f, 4> box_points{};
        candidate.rect.points(box_points.data());
        std::vector<cv::Point> contour;
        contour.reserve(4);
        for (const auto& point : box_points) {
            contour.emplace_back(
                static_cast<int>(std::lround(point.x)),
                static_cast<int>(std::lround(point.y)));
        }
        cv::polylines(debug_img, contour, true, cv::Scalar(0, 165, 255), 2);
    }
    for (const auto& candidate : precise_candidates) {
        std::array<cv::Point2f, 4> box_points{};
        candidate.rect.points(box_points.data());
        std::vector<cv::Point> contour;
        contour.reserve(4);
        for (const auto& point : box_points) {
            contour.emplace_back(
                static_cast<int>(std::lround(point.x)),
                static_cast<int>(std::lround(point.y)));
        }
        cv::polylines(debug_img, contour, true, cv::Scalar(0, 255, 0), 2);
    }
    cv::putText(
        debug_img,
        "L=" + cv::format("%.1f", rough_long_edge_mean),
        cv::Point(12, 28),
        cv::FONT_HERSHEY_SIMPLEX,
        0.7,
        cv::Scalar(255, 255, 255),
        2);
    cv::putText(
        debug_img,
        "orange=rough10 green=long-edge precise10",
        cv::Point(12, 56),
        cv::FONT_HERSHEY_SIMPLEX,
        0.55,
        cv::Scalar(255, 255, 255),
        1);
    return debug_img;
}

cv::Mat DrawFinalCenterRadiusDebugImage(
    const cv::Mat& image_bgr,
    const BoardCircle& final_circle,
    const std::vector<cv::Mat>& selected_masks,
    const std::array<cv::Point2f, 4>& correction_points_src) {
    cv::Mat debug_image = image_bgr.clone();
    cv::circle(debug_image, cv::Point(final_circle.cx, final_circle.cy), final_circle.radius, cv::Scalar(0, 255, 255), 3);
    cv::circle(debug_image, cv::Point(final_circle.cx, final_circle.cy), 8, cv::Scalar(0, 0, 255), -1);

    for (size_t i = 0; i < selected_masks.size(); ++i) {
        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(selected_masks[i], contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
        if (contours.empty()) {
            continue;
        }
        cv::drawContours(debug_image, contours, -1, cv::Scalar(0, 255, 0), 2);
    }

    for (size_t i = 0; i < correction_points_src.size(); ++i) {
        const cv::Point point(
            static_cast<int>(std::lround(correction_points_src[i].x)),
            static_cast<int>(std::lround(correction_points_src[i].y)));
        cv::circle(debug_image, point, 8, cv::Scalar(255, 0, 255), -1);
        cv::putText(
            debug_image,
            "P" + std::to_string(static_cast<int>(i + 1)),
            point + cv::Point(6, -6),
            cv::FONT_HERSHEY_SIMPLEX,
            0.55,
            cv::Scalar(255, 0, 255),
            2);
    }
    return debug_image;
}
#endif

RedRadiusCorrectionResult EstimateCorrectedRadiusFromRedRegions(
    const cv::Mat& img_before,
    const cv::Point2f& rough_center,
    float rough_radius,
    int blur_kernel,
    const CircleDetectionConfig& circle_config) {
    (void)blur_kernel;
    cv::Mat measurement_base_bgr = PrepareBoardMeasurementBaseImage(img_before);
    AdaptiveRedLabModel red_lab_model = EstimateAdaptiveRedLabModel(measurement_base_bgr);
    cv::Mat red_only_mask = ExtractRedOnlyMask(measurement_base_bgr, red_lab_model);
    cv::Mat red_binary_pre = red_only_mask.clone();
    const int inner_remove_radius = std::max(1, static_cast<int>(std::lround(static_cast<double>(rough_radius) * kInnerRemoveRadiusScale)));
    cv::circle(
        red_binary_pre,
        cv::Point(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y))),
        inner_remove_radius,
        cv::Scalar(0),
        -1);
    cv::Mat inner_removed_binary = red_binary_pre.clone();
    cv::Mat red_only_blurred = red_binary_pre.clone();
    auto components = ExtractComponentCandidates(red_binary_pre, circle_config.red_region_min_area, rough_center);
    if (components.empty()) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "无可用红色区域"};
    }

    std::vector<ComponentCandidate> elongated_components;
    for (const auto& component : components) {
        if (HasMinRotatedRectLongShortRatio(component.rect, kAndroidRedRegionMinLongShortRatio)) {
            elongated_components.push_back(component);
        }
    }
    if (elongated_components.empty()) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "长宽比筛选后无可用红色区域"};
    }

    std::vector<ComponentCandidate> perpendicular_components;
    for (const auto& component : elongated_components) {
        if (IsComponentPerpendicularToCenterVector(
                component.rect,
                rough_center,
                circle_config.red_region_perpendicular_min_angle_deg,
                circle_config.red_region_perpendicular_max_angle_deg)) {
            perpendicular_components.push_back(component);
        }
    }
    cv::Mat perpendicular_components_binary;
    cv::Mat perpendicular_rotated_boxes_debug;
#if BT_ENABLE_DEBUG_IMAGES
    perpendicular_components_binary = cv::Mat::zeros(red_binary_pre.size(), CV_8U);
    for (const auto& component : perpendicular_components) {
        cv::bitwise_or(perpendicular_components_binary, component.mask, perpendicular_components_binary);
    }
    const cv::Mat& rotated_debug_base =
        perpendicular_components.empty() ? red_binary_pre : perpendicular_components_binary;
    perpendicular_rotated_boxes_debug = DrawRotatedBoxesDebugImage(
        rotated_debug_base,
        perpendicular_components,
        rough_center);
#endif
    if (perpendicular_components.size() < kExpectedDoubleRegionCount) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "垂直方向筛选后双倍区不足10个"};
    }

    std::sort(perpendicular_components.begin(), perpendicular_components.end(), [](const ComponentCandidate& lhs, const ComponentCandidate& rhs) {
        return lhs.center_distance < rhs.center_distance;
    });

    std::vector<ComponentCandidate> rough_candidates(
        perpendicular_components.begin(),
        perpendicular_components.begin() + kExpectedDoubleRegionCount);
    const double rough_long_edge_mean =
        std::accumulate(
            rough_candidates.begin(),
            rough_candidates.end(),
            0.0,
            [](double sum, const ComponentCandidate& component) {
                return sum + GetRotatedRectLongEdge(component.rect);
            }) / static_cast<double>(rough_candidates.size());

    std::vector<ComponentCandidate> precise_candidates;
    if (perpendicular_components.size() == kExpectedDoubleRegionCount) {
        precise_candidates = rough_candidates;
    } else {
        std::vector<ComponentCandidate> long_edge_filtered_candidates;
        for (const auto& component : perpendicular_components) {
            if (GetRotatedRectLongEdge(component.rect) > (rough_long_edge_mean * kLongEdgeKeepScale)) {
                long_edge_filtered_candidates.push_back(component);
            }
        }
        if (long_edge_filtered_candidates.size() < kExpectedDoubleRegionCount) {
            cv::Mat area_grouped_debug;
#if BT_ENABLE_DEBUG_IMAGES
            area_grouped_debug = DrawAreaFilteredDebugImage(
                red_binary_pre.size(),
                rough_candidates,
                long_edge_filtered_candidates,
                rough_long_edge_mean);
#endif
            return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, area_grouped_debug, cv::Mat(), {}, {}, cv::Mat(), "长边筛选后双倍区不足10个"};
        }
        std::sort(long_edge_filtered_candidates.begin(), long_edge_filtered_candidates.end(), [](const ComponentCandidate& lhs, const ComponentCandidate& rhs) {
            return lhs.center_distance < rhs.center_distance;
        });
        precise_candidates.assign(
            long_edge_filtered_candidates.begin(),
            long_edge_filtered_candidates.begin() + kExpectedDoubleRegionCount);
    }

    std::sort(precise_candidates.begin(), precise_candidates.end(), [](const ComponentCandidate& lhs, const ComponentCandidate& rhs) {
        return lhs.angle_from_top_clockwise < rhs.angle_from_top_clockwise;
    });

    const std::array<int, 4> kSelectedIndices = {1, 4, 6, 9};
    std::array<cv::Point2f, 4> correction_points_src{};
    for (size_t i = 0; i < kSelectedIndices.size(); ++i) {
        correction_points_src[i] = SelectFarthestLongEdgeMidpoint(
            precise_candidates[kSelectedIndices[i]].rect,
            rough_center);
    }
    const std::array<cv::Point2f, 4> correction_points_dst = BuildCorrectionDestinationPoints();
    const float rectified_radius = cv::norm(correction_points_dst[0]);
    const std::vector<cv::Point2f> correction_points_src_vec(
        correction_points_src.begin(),
        correction_points_src.end());
    const std::vector<cv::Point2f> correction_points_dst_vec(
        correction_points_dst.begin(),
        correction_points_dst.end());
    cv::Mat point_rectification_h = cv::getPerspectiveTransform(
        correction_points_src_vec,
        correction_points_dst_vec);
    if (point_rectification_h.empty()) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "无法计算透视矫正矩阵"};
    }

    std::vector<cv::Mat> selected_masks;
    selected_masks.reserve(precise_candidates.size());
    for (const auto& component : precise_candidates) {
        selected_masks.push_back(component.mask);
    }
    const double corrected_radius = static_cast<double>(rectified_radius);

    cv::Mat area_grouped_debug;
    cv::Mat perspective_corrected_preview_debug;
#if BT_ENABLE_DEBUG_IMAGES
    perpendicular_rotated_boxes_debug = DrawRotatedBoxesDebugImage(
        perpendicular_components_binary.empty() ? red_binary_pre : perpendicular_components_binary,
        precise_candidates,
        rough_center,
        correction_points_src);
    area_grouped_debug = DrawAreaFilteredDebugImage(
        red_binary_pre.size(),
        rough_candidates,
        precise_candidates,
        rough_long_edge_mean);

    std::array<cv::Point2f, 4> preview_dst{};
    for (size_t i = 0; i < correction_points_dst.size(); ++i) {
        preview_dst[i] = cv::Point2f(
            rough_center.x + correction_points_dst[i].x * rough_radius,
            rough_center.y - correction_points_dst[i].y * rough_radius);
    }
    const int preview_radius = static_cast<int>(std::lround(cv::norm(preview_dst[0] - rough_center)));
    const std::vector<cv::Point2f> preview_dst_vec(preview_dst.begin(), preview_dst.end());
    cv::Mat preview_h = cv::getPerspectiveTransform(correction_points_src_vec, preview_dst_vec);
    perspective_corrected_preview_debug = img_before.clone();
    cv::warpPerspective(
        img_before,
        perspective_corrected_preview_debug,
        preview_h,
        img_before.size(),
        cv::INTER_LINEAR,
        cv::BORDER_CONSTANT);
    cv::circle(
        perspective_corrected_preview_debug,
        cv::Point(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y))),
        preview_radius,
        cv::Scalar(0, 255, 255),
        3);
    cv::circle(
        perspective_corrected_preview_debug,
        cv::Point(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y))),
        8,
        cv::Scalar(0, 0, 255),
        -1);
    for (size_t i = 0; i < preview_dst.size(); ++i) {
        const cv::Point point(
            static_cast<int>(std::lround(preview_dst[i].x)),
            static_cast<int>(std::lround(preview_dst[i].y)));
        cv::circle(perspective_corrected_preview_debug, point, 8, cv::Scalar(255, 0, 255), -1);
        cv::putText(
            perspective_corrected_preview_debug,
            "P" + std::to_string(static_cast<int>(i + 1)),
            point + cv::Point(6, -6),
            cv::FONT_HERSHEY_SIMPLEX,
            0.55,
            cv::Scalar(255, 0, 255),
            2);
    }
#endif

    return {
        corrected_radius,
        red_lab_model,
        red_only_mask,
        red_only_blurred,
        selected_masks,
        inner_removed_binary,
        perpendicular_rotated_boxes_debug,
        perpendicular_components_binary,
        area_grouped_debug,
        perspective_corrected_preview_debug,
        correction_points_src,
        correction_points_dst,
        point_rectification_h,
        "透视双倍区纠正成功"
    };
}

}  // namespace

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const cv::Rect& board_box,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    (void)debug;
    const cv::Point2f rough_center(
        static_cast<float>(board_box.width) * 0.5f,
        static_cast<float>(board_box.height) * 0.5f);
    const float rough_radius = static_cast<float>(board_box.width) * 0.5f;

    auto red_radius_result = EstimateCorrectedRadiusFromRedRegions(
        img_before,
        rough_center,
        rough_radius,
        edge_config.preprocess_blur_kernel,
        circle_config);

    BoardCircleDetectionResult detection_result;
    detection_result.rough_center = rough_center;
    detection_result.rough_radius = rough_radius;
    detection_result.adaptive_red_l = red_radius_result.red_lab_model.l;
    detection_result.adaptive_red_a = red_radius_result.red_lab_model.a;
    detection_result.adaptive_red_b = red_radius_result.red_lab_model.b;
    detection_result.adaptive_red_sample_count = red_radius_result.red_lab_model.sample_count;
    detection_result.adaptive_red_measurement_base_bgr = PrepareBoardMeasurementBaseImage(img_before);
    detection_result.adaptive_red_sample_rect = red_radius_result.red_lab_model.sample_rect;
    detection_result.adaptive_red_sample_points = red_radius_result.red_lab_model.sample_points;
    detection_result.red_radius_selected_component_masks = red_radius_result.selected_component_masks;
    detection_result.red_radius_inner_removed_binary = red_radius_result.inner_removed_binary;
    detection_result.red_radius_perpendicular_rotated_boxes_debug = red_radius_result.perpendicular_rotated_boxes_debug;
    detection_result.red_radius_perpendicular_components_binary = red_radius_result.perpendicular_components_binary;
    detection_result.red_radius_area_grouped_debug = red_radius_result.area_grouped_debug;
    detection_result.perspective_corrected_preview_debug = red_radius_result.perspective_corrected_preview_debug;
    detection_result.correction_points_src = red_radius_result.correction_points_src;
    detection_result.correction_points_dst = red_radius_result.correction_points_dst;
    detection_result.point_rectification_h = red_radius_result.point_rectification_h.clone();
    if (!red_radius_result.corrected_radius.has_value()) {
        detection_result.success = false;
        detection_result.error_message = red_radius_result.reason;
        detection_result.circle = BoardCircle{
            static_cast<int>(std::lround(rough_center.x)),
            static_cast<int>(std::lround(rough_center.y)),
            static_cast<int>(std::lround(rough_radius))
        };
        return detection_result;
    }
    detection_result.rectified_radius = static_cast<float>(red_radius_result.corrected_radius.value());

    BoardCircle final_circle{
        static_cast<int>(std::lround(rough_center.x)),
        static_cast<int>(std::lround(rough_center.y)),
        static_cast<int>(std::lround(rough_radius))
    };

    detection_result.circle = final_circle;
    detection_result.perspective_correction_succeeded = !red_radius_result.point_rectification_h.empty();
    return detection_result;
}

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    return DetectBoardCircleDetailed(
        img_before,
        cv::Rect(0, 0, img_before.cols, img_before.rows),
        edge_config,
        circle_config,
        debug);
}

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const cv::Rect& board_box,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    BoardCircleDetectionResult result = DetectBoardCircleDetailed(img_before, board_box, edge_config, circle_config, debug);
    if (!result.success) {
        throw std::runtime_error(result.error_message);
    }
    return result.circle;
}

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    BoardCircleDetectionResult result = DetectBoardCircleDetailed(img_before, edge_config, circle_config, debug);
    if (!result.success) {
        throw std::runtime_error(result.error_message);
    }
    return result.circle;
}

}  // namespace bulltrack
