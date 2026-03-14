#include "BoardDetectorAndroid.h"

#include "bulltrack_v2/Preprocessing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <numeric>
#include <optional>
#include <set>
#include <stdexcept>
#include <tuple>
#include <utility>

namespace bulltrack {
namespace {

using LineSegment = cv::Vec4i;
using ComponentStats = std::pair<int, cv::Mat>;

constexpr int kAndroidRedRegionMinArea = 100;
constexpr double kAndroidRedRegionMinLongShortRatio = 2.3;

struct RedRadiusCorrectionResult {
    std::optional<double> corrected_radius;
    cv::Mat red_only_mask;
    cv::Mat red_only_blurred;
    std::vector<cv::Mat> selected_component_masks;
    cv::Mat inner_removed_binary;
    cv::Mat perpendicular_rotated_boxes_debug;
    cv::Mat perpendicular_components_binary;
    cv::Mat area_grouped_debug;
    std::string reason;
};

std::vector<LineSegment> DetectLineSegments(const cv::Mat& edges_connected, const CircleDetectionConfig& config) {
    std::vector<cv::Vec4i> lines;
    cv::HoughLinesP(
        edges_connected,
        lines,
        config.line_rho,
        config.line_theta,
        config.line_threshold,
        config.line_min_length,
        config.line_max_gap);
    return lines;
}

std::vector<LineSegment> FilterLineSegmentsForIntersections(
    const std::vector<LineSegment>& line_segments,
    double min_length) {
    std::vector<LineSegment> filtered;
    for (const auto& segment : line_segments) {
        if (cv::norm(cv::Point(segment[2], segment[3]) - cv::Point(segment[0], segment[1])) >= min_length) {
            filtered.push_back(segment);
        }
    }
    return filtered;
}

std::optional<cv::Point2d> LineIntersection(const LineSegment& line1, const LineSegment& line2, double eps = 1e-6) {
    const double x1 = line1[0];
    const double y1 = line1[1];
    const double x2 = line1[2];
    const double y2 = line1[3];
    const double x3 = line2[0];
    const double y3 = line2[1];
    const double x4 = line2[2];
    const double y4 = line2[3];

    const double denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (std::abs(denominator) < eps) {
        return std::nullopt;
    }

    const double det1 = x1 * y2 - y1 * x2;
    const double det2 = x3 * y4 - y3 * x4;
    const double px = (det1 * (x3 - x4) - (x1 - x2) * det2) / denominator;
    const double py = (det1 * (y3 - y4) - (y1 - y2) * det2) / denominator;
    return cv::Point2d(px, py);
}

std::vector<cv::Point> ComputeLineIntersections(const std::vector<LineSegment>& line_segments, const cv::Size& image_size) {
    std::vector<cv::Point> intersections;
    std::set<std::pair<int, int>> seen;
    for (size_t i = 0; i < line_segments.size(); ++i) {
        for (size_t j = i + 1; j < line_segments.size(); ++j) {
            auto point = LineIntersection(line_segments[i], line_segments[j]);
            if (!point.has_value()) {
                continue;
            }
            const int px = static_cast<int>(std::lround(point->x));
            const int py = static_cast<int>(std::lround(point->y));
            if (px < 0 || px >= image_size.width || py < 0 || py >= image_size.height) {
                continue;
            }
            if (seen.insert({px, py}).second) {
                intersections.emplace_back(px, py);
            }
        }
    }
    return intersections;
}

std::tuple<std::optional<cv::Point>, std::optional<double>, cv::Mat> EstimateDensityCenter(
    const std::vector<cv::Point>& intersections,
    const cv::Size& image_size) {
    if (intersections.empty()) {
        return {std::nullopt, std::nullopt, cv::Mat()};
    }

    constexpr int downsample = 4;
    const int heat_h = std::max(1, image_size.height / downsample);
    const int heat_w = std::max(1, image_size.width / downsample);
    cv::Mat heatmap = cv::Mat::zeros(heat_h, heat_w, CV_32F);

    for (const auto& p : intersections) {
        const int y = std::min(heat_h - 1, p.y / downsample);
        const int x = std::min(heat_w - 1, p.x / downsample);
        heatmap.at<float>(y, x) += 1.0f;
    }

    cv::GaussianBlur(heatmap, heatmap, cv::Size(0, 0), 1.2, 1.2);
    double max_heat = 0.0;
    cv::minMaxLoc(heatmap, nullptr, &max_heat);
    if (max_heat <= 0.0) {
        return {std::nullopt, std::nullopt, heatmap};
    }

    cv::Mat density_mask = heatmap >= (max_heat * 0.35);
    density_mask.convertTo(density_mask, CV_8U);
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(density_mask, labels, stats, centroids, 8, CV_32S);
    if (num_labels <= 1) {
        return {std::nullopt, std::nullopt, heatmap};
    }

    int best_label = -1;
    double best_weight = -1.0;
    for (int label = 1; label < num_labels; ++label) {
        cv::Mat component_mask = labels == label;
        cv::Mat component_mask_f;
        component_mask.convertTo(component_mask_f, CV_32F, 1.0 / 255.0);
        double weight_sum = cv::sum(heatmap.mul(component_mask_f))[0];
        if (weight_sum > best_weight) {
            best_weight = weight_sum;
            best_label = label;
        }
    }

    std::vector<cv::Point2f> points;
    double total_weight = 0.0;
    double sum_x = 0.0;
    double sum_y = 0.0;
    for (int y = 0; y < labels.rows; ++y) {
        for (int x = 0; x < labels.cols; ++x) {
            if (labels.at<int>(y, x) != best_label) {
                continue;
            }
            const float weight = heatmap.at<float>(y, x);
            points.emplace_back(static_cast<float>(x), static_cast<float>(y));
            total_weight += weight;
            sum_x += x * weight;
            sum_y += y * weight;
        }
    }
    if (total_weight <= 1e-6 || points.empty()) {
        return {std::nullopt, std::nullopt, heatmap};
    }

    const int cx = std::clamp(static_cast<int>(std::lround((sum_x / total_weight + 0.5) * downsample)), 0, image_size.width - 1);
    const int cy = std::clamp(static_cast<int>(std::lround((sum_y / total_weight + 0.5) * downsample)), 0, image_size.height - 1);
    cv::Point2f center_f;
    float radius_f = 0.0f;
    cv::minEnclosingCircle(points, center_f, radius_f);
    return {cv::Point(cx, cy), std::max(1.0, static_cast<double>(radius_f) * downsample), heatmap};
}

std::vector<LineSegment> FilterLinesNearCenter(
    const std::vector<LineSegment>& line_segments,
    const std::optional<cv::Point>& density_center,
    const std::optional<double>& density_region_radius) {
    if (!density_center.has_value() || !density_region_radius.has_value()) {
        return line_segments;
    }

    std::vector<LineSegment> filtered;
    for (const auto& segment : line_segments) {
        const double x1 = segment[0];
        const double y1 = segment[1];
        const double x2 = segment[2];
        const double y2 = segment[3];
        const double denominator = std::hypot(y2 - y1, x2 - x1);
        if (denominator <= 1e-6) {
            continue;
        }
        const double distance = std::abs((y2 - y1) * density_center->x - (x2 - x1) * density_center->y + x2 * y1 - y2 * x1) / denominator;
        if (distance < density_region_radius.value()) {
            filtered.push_back(segment);
        }
    }
    return filtered;
}

std::vector<LineSegment> FilterLinesBySlope(const std::vector<LineSegment>& line_segments, double max_abs_slope) {
    std::vector<LineSegment> filtered;
    for (const auto& segment : line_segments) {
        const double dx = static_cast<double>(segment[2] - segment[0]);
        if (std::abs(dx) < 1e-6) {
            continue;
        }
        const double slope = static_cast<double>(segment[3] - segment[1]) / dx;
        if (std::abs(slope) <= max_abs_slope) {
            filtered.push_back(segment);
        }
    }
    return filtered;
}

std::pair<std::optional<double>, std::optional<std::pair<int, int>>> EstimateRadiusFromLines(
    const std::vector<LineSegment>& line_segments,
    const cv::Point& center,
    const cv::Size& image_size) {
    std::vector<double> endpoint_distances;
    for (const auto& segment : line_segments) {
        endpoint_distances.push_back(cv::norm(cv::Point(segment[0], segment[1]) - center));
        endpoint_distances.push_back(cv::norm(cv::Point(segment[2], segment[3]) - center));
    }
    std::sort(endpoint_distances.begin(), endpoint_distances.end(), std::greater<double>());
    if (endpoint_distances.size() < 2) {
        return {std::nullopt, std::nullopt};
    }

    std::vector<double> diffs;
    for (size_t i = 0; i + 1 < endpoint_distances.size(); ++i) {
        diffs.push_back(endpoint_distances[i] - endpoint_distances[i + 1]);
    }
    const double diff_boundary = static_cast<double>(std::max(image_size.width, image_size.height)) / 110.0;

    std::vector<std::pair<int, int>> intervals;
    int start_idx = 0;
    for (size_t i = 0; i < diffs.size(); ++i) {
        if (diffs[i] > diff_boundary) {
            const int end_idx = static_cast<int>(i + 1);
            intervals.emplace_back(start_idx, end_idx);
            start_idx = end_idx;
        }
    }
    intervals.emplace_back(start_idx, static_cast<int>(endpoint_distances.size()));

    for (const auto& interval : intervals) {
        if ((interval.second - interval.first) > 10) {
            const int sample_start = std::min(interval.first + 4, interval.second - 1);
            const int sample_end = std::min(interval.first + 15, interval.second);
            double sum = 0.0;
            for (int i = sample_start; i < sample_end; ++i) {
                sum += endpoint_distances[i];
            }
            const double radius = sum / std::max(1, sample_end - sample_start);
            return {radius, interval};
        }
    }
    return {std::nullopt, std::nullopt};
}

std::vector<ComponentStats> ExtractComponentsWithMinArea(const cv::Mat& binary_img, int min_area) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    std::vector<ComponentStats> components;
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area < min_area) {
            continue;
        }
        cv::Mat mask = labels == label;
        mask.convertTo(mask, CV_8U);
        components.emplace_back(area, mask);
    }
    std::sort(components.begin(), components.end(), [](const auto& lhs, const auto& rhs) {
        return lhs.first > rhs.first;
    });
    return components;
}

bool IsComponentPerpendicularToCenterVector(
    const cv::Mat& component_mask,
    int cx,
    int cy,
    double min_angle_deg,
    double max_angle_deg) {
    std::vector<cv::Point> points;
    cv::findNonZero(component_mask, points);
    if (points.empty()) {
        return false;
    }

    const cv::RotatedRect rect = cv::minAreaRect(points);
    const cv::Point2d vector_to_component(
        static_cast<double>(rect.center.x) - static_cast<double>(cx),
        static_cast<double>(rect.center.y) - static_cast<double>(cy));
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

bool HasMinRotatedRectLongShortRatio(
    const cv::Mat& component_mask,
    double min_ratio) {
    std::vector<cv::Point> points;
    cv::findNonZero(component_mask, points);
    if (points.empty()) {
        return false;
    }

    const cv::RotatedRect rect = cv::minAreaRect(points);
    const double width = std::max(1.0f, rect.size.width);
    const double height = std::max(1.0f, rect.size.height);
    const double long_edge = std::max(width, height);
    const double short_edge = std::min(width, height);
    if (short_edge <= 1e-6) {
        return false;
    }
    return (long_edge / short_edge) >= min_ratio;
}

std::vector<std::pair<int, int>> BuildIntervalsFromDescSortedValues(const std::vector<int>& values) {
    if (values.empty()) {
        return {};
    }
    if (values.size() < 2) {
        return {{0, static_cast<int>(values.size())}};
    }

    std::vector<int> diffs;
    for (size_t i = 0; i + 1 < values.size(); ++i) {
        diffs.push_back(values[i] - values[i + 1]);
    }
    const double diff_mean = std::accumulate(diffs.begin(), diffs.end(), 0.0) / static_cast<double>(diffs.size());
    const double threshold = diff_mean * 2.0;

    std::vector<std::pair<int, int>> intervals;
    int start_idx = 0;
    for (size_t i = 0; i < diffs.size(); ++i) {
        if (diffs[i] > threshold) {
            const int end_idx = static_cast<int>(i + 1);
            intervals.emplace_back(start_idx, end_idx);
            start_idx = end_idx;
        }
    }
    intervals.emplace_back(start_idx, static_cast<int>(values.size()));
    return intervals;
}

#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawGroupedComponentBoundaries(
    const cv::Mat& base_binary_img,
    const std::vector<ComponentStats>& components,
    const std::vector<std::pair<int, int>>& intervals) {
    cv::Mat debug_img;
    cv::cvtColor(base_binary_img, debug_img, cv::COLOR_GRAY2BGR);
    if (components.empty() || intervals.empty()) {
        return debug_img;
    }

    static const std::array<cv::Scalar, 8> kGroupColors = {
        cv::Scalar(0, 255, 255),
        cv::Scalar(255, 0, 0),
        cv::Scalar(0, 255, 0),
        cv::Scalar(255, 0, 255),
        cv::Scalar(0, 165, 255),
        cv::Scalar(255, 255, 0),
        cv::Scalar(180, 105, 255),
        cv::Scalar(128, 255, 128)
    };

    for (size_t interval_index = 0; interval_index < intervals.size(); ++interval_index) {
        const auto [start_idx, end_idx] = intervals[interval_index];
        const cv::Scalar color = kGroupColors[interval_index % kGroupColors.size()];
        for (int component_index = start_idx; component_index < end_idx; ++component_index) {
            if (component_index < 0 || component_index >= static_cast<int>(components.size())) {
                continue;
            }
            std::vector<std::vector<cv::Point>> contours;
            cv::findContours(components[component_index].second, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
            if (contours.empty()) {
                continue;
            }
            cv::drawContours(debug_img, contours, -1, color, 2);

            std::vector<cv::Point> merged_points;
            for (const auto& contour : contours) {
                merged_points.insert(merged_points.end(), contour.begin(), contour.end());
            }
            if (merged_points.empty()) {
                continue;
            }
            cv::Rect bbox = cv::boundingRect(merged_points);
            const std::string label = "G" + std::to_string(static_cast<int>(interval_index + 1));
            cv::putText(
                debug_img,
                label,
                cv::Point(bbox.x, std::max(16, bbox.y - 4)),
                cv::FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                1);
        }
    }
    return debug_img;
}

cv::Mat DrawRotatedBoxesDebugImage(
    const cv::Mat& base_binary_img,
    const std::vector<ComponentStats>& components) {
    cv::Mat debug_img;
    cv::cvtColor(base_binary_img, debug_img, cv::COLOR_GRAY2BGR);
    for (size_t i = 0; i < components.size(); ++i) {
        std::vector<cv::Point> points;
        cv::findNonZero(components[i].second, points);
        if (points.empty()) {
            continue;
        }
        const cv::RotatedRect rect = cv::minAreaRect(points);
        std::array<cv::Point2f, 4> box_points{};
        rect.points(box_points.data());
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
            "R" + std::to_string(static_cast<int>(i + 1)),
            cv::Point(
                std::max(0, static_cast<int>(std::lround(rect.center.x)) - 10),
                std::max(16, static_cast<int>(std::lround(rect.center.y)) - 6)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.45,
            cv::Scalar(0, 255, 255),
            1);
    }
    return debug_img;
}

#endif

std::optional<double> ComputeFarthestBoundaryDistance(const cv::Mat& component_mask, int cx, int cy) {
    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(component_mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_NONE);
    if (contours.empty()) {
        return std::nullopt;
    }

    double farthest_distance = 0.0;
    for (const auto& contour : contours) {
        for (const auto& point : contour) {
            farthest_distance = std::max(farthest_distance, std::hypot(point.x - cx, point.y - cy));
        }
    }
    if (farthest_distance <= 0.0) {
        return std::nullopt;
    }
    return farthest_distance;
}

std::optional<double> ComputeComponentCenterDistance(const cv::Mat& component_mask, int cx, int cy) {
    std::vector<cv::Point> points;
    cv::findNonZero(component_mask, points);
    if (points.empty()) {
        return std::nullopt;
    }
    const cv::RotatedRect rect = cv::minAreaRect(points);
    const double dx = static_cast<double>(rect.center.x) - static_cast<double>(cx);
    const double dy = static_cast<double>(rect.center.y) - static_cast<double>(cy);
    return std::hypot(dx, dy);
}

RedRadiusCorrectionResult EstimateCorrectedRadiusFromRedRegions(
    const cv::Mat& img_before,
    int cx,
    int cy,
    int initial_radius,
    int blur_kernel,
    const CircleDetectionConfig& circle_config) {
    cv::Mat red_only_mask = ExtractRedOnlyMask(img_before);
    cv::Mat red_binary_pre = red_only_mask.clone();
    const int inner_remove_radius = std::max(1, static_cast<int>(std::lround(static_cast<double>(initial_radius) * 0.75)));
    cv::circle(red_binary_pre, cv::Point(cx, cy), inner_remove_radius, cv::Scalar(0), -1);
    cv::Mat inner_removed_binary = red_binary_pre.clone();
    int open_kernel = EnsureOddKernel(circle_config.red_region_open_kernel);
    int open_iterations = std::max(0, circle_config.red_region_open_iterations);
    if (open_iterations > 0) {
        cv::Mat open_kernel_mat = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(open_kernel, open_kernel));
        cv::morphologyEx(red_binary_pre, red_binary_pre, cv::MORPH_OPEN, open_kernel_mat, cv::Point(-1, -1), open_iterations);
    }

    auto pre_components = ExtractComponentsWithMinArea(red_binary_pre, kAndroidRedRegionMinArea);
    if (pre_components.empty()) {
        return {std::nullopt, red_only_mask, red_binary_pre, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), "无足够大的红色区域"};
    }

    cv::Mat red_area_filtered = cv::Mat::zeros(red_only_mask.size(), CV_8U);
    for (const auto& [area, mask] : pre_components) {
        (void)area;
        cv::bitwise_or(red_area_filtered, mask, red_area_filtered);
    }

    cv::Mat red_only_blurred = red_area_filtered.clone();
    blur_kernel = EnsureOddKernel(blur_kernel);
    if (blur_kernel > 1) {
        for (int i = 0; i < 3; ++i) {
            cv::GaussianBlur(red_only_blurred, red_only_blurred, cv::Size(blur_kernel, blur_kernel), 0);
        }
    }

    cv::Mat red_binary;
    cv::threshold(red_only_blurred, red_binary, 64, 255, cv::THRESH_BINARY);
    int dilate_kernel = EnsureOddKernel(circle_config.red_region_dilate_kernel);
    int dilate_iterations = std::max(0, circle_config.red_region_dilate_iterations);
    if (dilate_iterations > 0) {
        cv::Mat dilate_kernel_mat = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(dilate_kernel, dilate_kernel));
        cv::dilate(red_binary, red_binary, dilate_kernel_mat, cv::Point(-1, -1), dilate_iterations);
    }

    auto components = ExtractComponentsWithMinArea(red_binary, 1);
    if (components.empty()) {
        return {std::nullopt, red_only_mask, red_only_blurred, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), "无可用红色区域"};
    }

    std::vector<ComponentStats> elongated_components;
    for (const auto& component : components) {
        if (HasMinRotatedRectLongShortRatio(
                component.second,
                kAndroidRedRegionMinLongShortRatio)) {
            elongated_components.push_back(component);
        }
    }
    if (elongated_components.empty()) {
        return {std::nullopt, red_only_mask, red_only_blurred, {}, inner_removed_binary, cv::Mat(), cv::Mat(), cv::Mat(), "长宽比筛选后无可用红色区域"};
    }

    std::vector<ComponentStats> perpendicular_components;
    for (const auto& component : elongated_components) {
        if (IsComponentPerpendicularToCenterVector(
                component.second,
                cx,
                cy,
                circle_config.red_region_perpendicular_min_angle_deg,
                circle_config.red_region_perpendicular_max_angle_deg)) {
            perpendicular_components.push_back(component);
        }
    }
    cv::Mat perpendicular_components_binary;
    cv::Mat perpendicular_rotated_boxes_debug;
#if BT_ENABLE_DEBUG_IMAGES
    perpendicular_components_binary = cv::Mat::zeros(red_binary.size(), CV_8U);
    for (const auto& [area, mask] : perpendicular_components) {
        (void)area;
        cv::bitwise_or(perpendicular_components_binary, mask, perpendicular_components_binary);
    }
    perpendicular_rotated_boxes_debug =
        DrawRotatedBoxesDebugImage(perpendicular_components_binary, perpendicular_components);
#endif
    if (perpendicular_components.empty()) {
        return {std::nullopt, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, cv::Mat(), "垂直方向筛选后无可用红色区域"};
    }
    components = std::move(perpendicular_components);

    std::vector<int> areas;
    for (const auto& [area, mask] : components) {
        (void)mask;
        areas.push_back(area);
    }
    auto intervals = BuildIntervalsFromDescSortedValues(areas);
    cv::Mat area_grouped_debug;
#if BT_ENABLE_DEBUG_IMAGES
    area_grouped_debug = DrawGroupedComponentBoundaries(perpendicular_components_binary, components, intervals);
#endif
    std::optional<std::pair<int, int>> selected_interval;
    for (const auto& interval : intervals) {
        if ((interval.second - interval.first) > 5) {
            selected_interval = interval;
            break;
        }
    }
    if (!selected_interval.has_value()) {
        return {std::nullopt, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, area_grouped_debug, "未找到长度大于5的面积区间"};
    }

    std::vector<ComponentStats> selected_components(components.begin() + selected_interval->first, components.begin() + selected_interval->second);
    std::vector<std::pair<double, cv::Mat>> components_with_center_distance;
    components_with_center_distance.reserve(selected_components.size());
    for (const auto& [area, mask] : selected_components) {
        (void)area;
        auto center_distance = ComputeComponentCenterDistance(mask, cx, cy);
        if (!center_distance.has_value()) {
            continue;
        }
        components_with_center_distance.emplace_back(center_distance.value(), mask);
    }
    if (components_with_center_distance.size() < 5) {
        return {std::nullopt, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, area_grouped_debug, "目标区间中的红色区域不足5个"};
    }
    std::stable_sort(components_with_center_distance.begin(), components_with_center_distance.end(), [](const auto& lhs, const auto& rhs) {
        return lhs.first < rhs.first;
    });

    std::vector<cv::Mat> top_three_masks;
    std::vector<double> distances;
    for (size_t i = 2; i < 5; ++i) {
        top_three_masks.push_back(components_with_center_distance[i].second);
        auto farthest_distance = ComputeFarthestBoundaryDistance(components_with_center_distance[i].second, cx, cy);
        if (!farthest_distance.has_value()) {
            return {std::nullopt, red_only_mask, red_only_blurred, top_three_masks, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, area_grouped_debug, "存在无法提取边界的红色区域"};
        }
        distances.push_back(farthest_distance.value());
    }

    const double corrected_radius = std::accumulate(distances.begin(), distances.end(), 0.0) / static_cast<double>(distances.size());
    return {corrected_radius, red_only_mask, red_only_blurred, top_three_masks, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, area_grouped_debug, "红色区域半径纠正成功"};
}

#if BT_ENABLE_DEBUG_IMAGES
void DrawDebugImages(
    const cv::Mat& img_before,
    const cv::Mat& edge_input_gray,
    const cv::Mat& edges,
    const cv::Mat& edges_connected,
    const RedRadiusCorrectionResult& red_radius_result,
    const std::vector<LineSegment>& line_segments,
    const std::vector<LineSegment>& filtered_line_segments,
    const std::vector<cv::Point>& intersections,
    const cv::Mat& heatmap,
    const std::optional<cv::Point>& density_center,
    const std::optional<double>& density_region_radius,
    const std::vector<LineSegment>& slope_filtered_segments,
    const cv::Point& center_for_radius,
    const std::optional<double>& radius_from_lines,
    const std::optional<std::pair<int, int>>& interval_selected,
    const BoardCircle& final_circle) {
    EnsureDirectory(DebugImagesPath());
    cv::imwrite(DebugImagesPath() + "/debug_00_edge_input_gray.jpg", edge_input_gray);
    cv::imwrite(DebugImagesPath() + "/debug_00_edge_map.jpg", edges);
    cv::imwrite(DebugImagesPath() + "/debug_00_edge_map_connected.jpg", edges_connected);
    cv::imwrite(DebugImagesPath() + "/debug_00_red_only_mask.jpg", red_radius_result.red_only_mask);
    cv::imwrite(DebugImagesPath() + "/debug_00_red_only_blurred.jpg", red_radius_result.red_only_blurred);

    cv::Mat red_components_debug;
    cv::cvtColor(red_radius_result.red_only_mask, red_components_debug, cv::COLOR_GRAY2BGR);
    for (size_t i = 0; i < red_radius_result.selected_component_masks.size(); ++i) {
        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(red_radius_result.selected_component_masks[i], contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
        cv::drawContours(red_components_debug, contours, -1, cv::Scalar(0, 255, 255), 2);
        cv::Rect bbox = cv::boundingRect(red_radius_result.selected_component_masks[i]);
        cv::putText(red_components_debug, "R" + std::to_string(i + 1), cv::Point(bbox.x, bbox.y - 5), cv::FONT_HERSHEY_SIMPLEX, 0.5, cv::Scalar(0, 255, 255), 1);
    }
    cv::imwrite(DebugImagesPath() + "/debug_00_red_radius_components.jpg", red_components_debug);

    cv::Mat line_debug_img;
    cv::cvtColor(edges_connected, line_debug_img, cv::COLOR_GRAY2BGR);
    for (const auto& s : line_segments) {
        cv::line(line_debug_img, {s[0], s[1]}, {s[2], s[3]}, cv::Scalar(0, 0, 255), 2);
    }
    cv::imwrite(DebugImagesPath() + "/debug_00_hough_lines.jpg", line_debug_img);

    cv::Mat intersection_debug_img = line_debug_img.clone();
    for (const auto& p : intersections) {
        cv::circle(intersection_debug_img, p, 2, cv::Scalar(0, 255, 255), -1);
    }
    cv::imwrite(DebugImagesPath() + "/debug_00_hough_line_intersections.jpg", intersection_debug_img);

    cv::Mat center_filter_debug_img;
    cv::cvtColor(edges_connected, center_filter_debug_img, cv::COLOR_GRAY2BGR);
    for (const auto& s : slope_filtered_segments) {
        cv::line(center_filter_debug_img, {s[0], s[1]}, {s[2], s[3]}, cv::Scalar(0, 255, 0), 2);
    }
    if (density_center.has_value() && density_region_radius.has_value()) {
        cv::circle(center_filter_debug_img, density_center.value(), static_cast<int>(std::lround(density_region_radius.value())), cv::Scalar(255, 255, 0), 2);
        cv::circle(center_filter_debug_img, density_center.value(), 5, cv::Scalar(0, 0, 255), -1);
    }
    if (radius_from_lines.has_value()) {
        cv::circle(center_filter_debug_img, center_for_radius, static_cast<int>(std::lround(radius_from_lines.value())), cv::Scalar(255, 0, 255), 2);
    }
    cv::imwrite(DebugImagesPath() + "/debug_00_hough_lines_center_filtered.jpg", center_filter_debug_img);

    if (!heatmap.empty()) {
        cv::Mat heatmap_norm;
        cv::normalize(heatmap, heatmap_norm, 0, 255, cv::NORM_MINMAX, CV_8U);
        cv::Mat heatmap_color;
        cv::applyColorMap(heatmap_norm, heatmap_color, cv::COLORMAP_JET);
        cv::resize(heatmap_color, heatmap_color, img_before.size(), 0.0, 0.0, cv::INTER_NEAREST);
        if (density_center.has_value()) {
            cv::circle(heatmap_color, density_center.value(), 8, cv::Scalar(255, 255, 255), -1);
        }
        cv::imwrite(DebugImagesPath() + "/debug_00_density_heatmap.jpg", heatmap_color);
    }

    cv::Mat final_center_debug = img_before.clone();
    cv::circle(final_center_debug, {final_circle.cx, final_circle.cy}, 8, cv::Scalar(0, 0, 255), -1);
    cv::circle(final_center_debug, {final_circle.cx, final_circle.cy}, final_circle.radius, cv::Scalar(0, 255, 0), 2);
    cv::imwrite(DebugImagesPath() + "/debug_00_final_center_radius.jpg", final_center_debug);
}
#endif

}  // namespace

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    auto [edge_input_gray, edges, edges_connected] = ExtractEdgesWithConnectionRepair(
        img_before,
        edge_config.preprocess_blur_kernel,
        edge_config.canny_low,
        edge_config.canny_high,
        edge_config.close_kernel,
        edge_config.close_iterations,
        edge_config.dilate_iterations);

    auto line_segments = DetectLineSegments(edges_connected, circle_config);
    auto filtered_line_segments = FilterLineSegmentsForIntersections(line_segments, circle_config.line_intersection_min_length);
    auto intersections = ComputeLineIntersections(filtered_line_segments, edges_connected.size());
    auto [density_center, density_region_radius, heatmap] = EstimateDensityCenter(intersections, edges_connected.size());
    if (!density_center.has_value()) {
        throw std::runtime_error("直线中心估计失败");
    }

    auto center_filtered_segments = FilterLinesNearCenter(line_segments, density_center, density_region_radius);
    auto slope_filtered_segments = FilterLinesBySlope(center_filtered_segments, circle_config.max_abs_slope);
    const cv::Point center_for_radius = density_center.value();
    auto [radius_from_lines, interval_selected] = EstimateRadiusFromLines(slope_filtered_segments, center_for_radius, edges_connected.size());
    if (!radius_from_lines.has_value()) {
        throw std::runtime_error("直线半径估计失败");
    }
    const int initial_radius_for_red = static_cast<int>(std::lround(radius_from_lines.value()));
    auto red_radius_result = EstimateCorrectedRadiusFromRedRegions(
        img_before,
        density_center->x,
        density_center->y,
        initial_radius_for_red,
        edge_config.preprocess_blur_kernel,
        circle_config);

    int final_radius = initial_radius_for_red;
    if (red_radius_result.corrected_radius.has_value()) {
        final_radius = static_cast<int>(std::lround(red_radius_result.corrected_radius.value()));
    }

    BoardCircle final_circle{density_center->x, density_center->y, final_radius};

#if BT_ENABLE_DEBUG_IMAGES
    if (debug) {
        DrawDebugImages(
            img_before,
            edge_input_gray,
            edges,
            edges_connected,
            red_radius_result,
            line_segments,
            filtered_line_segments,
            intersections,
            heatmap,
            density_center,
            density_region_radius,
            slope_filtered_segments,
            center_for_radius,
            radius_from_lines,
            interval_selected,
            final_circle);
    }
#endif

    std::cout << "密度估计圆心: (" << density_center->x << ", " << density_center->y << ")\n";
    if (density_region_radius.has_value()) {
        std::cout << "靶心连通域最小包围圆半径 r1: " << density_region_radius.value() << "\n";
    }
    std::cout << "线段端点分组估计半径: " << radius_from_lines.value() << "\n";
    std::cout << "红色区域半径纠正: " << red_radius_result.reason << "\n";
    if (red_radius_result.corrected_radius.has_value()) {
        std::cout << "红色区域纠正半径: " << red_radius_result.corrected_radius.value() << "\n";
    }
    std::cout << "最终真实靶盘半径: " << final_circle.radius << "\n";

    BoardCircleDetectionResult detection_result;
    detection_result.circle = final_circle;
#if BT_ENABLE_DEBUG_IMAGES
    detection_result.red_radius_inner_removed_binary = red_radius_result.inner_removed_binary;
    detection_result.red_radius_perpendicular_rotated_boxes_debug = red_radius_result.perpendicular_rotated_boxes_debug;
    detection_result.red_radius_perpendicular_components_binary = red_radius_result.perpendicular_components_binary;
    detection_result.red_radius_area_grouped_debug = red_radius_result.area_grouped_debug;
#endif
    if (red_radius_result.corrected_radius.has_value() &&
        red_radius_result.selected_component_masks.size() == 3) {
        detection_result.red_radius_correction_succeeded = true;
#if BT_ENABLE_DEBUG_IMAGES
        detection_result.red_radius_selected_component_masks = red_radius_result.selected_component_masks;
#endif
    }
    return detection_result;
}

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug) {
    return DetectBoardCircleDetailed(img_before, edge_config, circle_config, debug).circle;
}

}  // namespace bulltrack



