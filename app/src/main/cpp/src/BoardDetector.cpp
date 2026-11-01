#include "BoardDetectorAndroid.h"

#include "bulltrack_v2/Preprocessing.h"

#include <android/log.h>

#include <algorithm>
#include <array>
#include <chrono>
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
// A piece shorter than this share of the median bed is noise; halves of a cut bed stay.
constexpr double kFragmentLongEdgeScale = 0.35;
constexpr int kExpectedDoubleRegionCount = 10;
// Seats that must be filled to fit the board; a dart or its shadow may hide one or two beds.
constexpr int kMinDoubleSeatCount = 8;
// A bed further than this from its seat angle is not a double bed.
constexpr double kMaxSeatAngleDeviationRad = 14.0 * CV_PI / 180.0;
// Outer edge points within this share of the fitted ring radius count as on the ring.
constexpr double kEllipseInlierTolerance = 0.2;
// Largest allowed gap between a bed and its seat after the fit, in board radii (0.04 is about
// 7 mm). First value; the real residual is logged and shown in the debug preview.
constexpr double kMaxSeatResidual = 0.04;

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
    std::vector<cv::Point2f> correction_points_src;
    std::vector<cv::Point2f> correction_points_dst;
    cv::Mat point_rectification_h;
    std::string reason;
    double seat_fit_max_residual = 0.0;
    int seat_count = 0;
    std::optional<MeasuredRingEdges> measured_ring_edges;
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
        // Work inside the component's bounding box instead of comparing the whole label image
        // per component; the full-size mask is only kept for debug images.
        const cv::Rect bbox(
            stats.at<int>(label, cv::CC_STAT_LEFT),
            stats.at<int>(label, cv::CC_STAT_TOP),
            stats.at<int>(label, cv::CC_STAT_WIDTH),
            stats.at<int>(label, cv::CC_STAT_HEIGHT));
        const cv::Mat roi_mask = labels(bbox) == label;
        std::vector<cv::Point> points;
        cv::findNonZero(roi_mask, points);
        if (points.empty()) {
            continue;
        }
        for (cv::Point& point : points) {
            point += bbox.tl();
        }
        cv::Mat mask;
        if (DebugImagesActive()) {
            mask = cv::Mat::zeros(binary_img.size(), CV_8U);
            roi_mask.copyTo(mask(bbox));
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

// A ring bed runs along the board's outline, so its long edge is checked against the normal of
// the board ellipse at the bed (half axes from the board box): seen at an angle the outline is a
// narrow ellipse, whose diagonal beds lean up to about 20 degrees off the line to the centre.
// For a round board the normal is that line. The normal (dx / a^2, dy / b^2) is scaled by a * b
// here to stay in pixels.
bool IsComponentPerpendicularToCenterVector(
    const cv::RotatedRect& rect,
    const cv::Point2f& rough_center,
    const cv::Size2d& ellipse_half_axes,
    double min_angle_deg,
    double max_angle_deg) {
    const double axis_ratio = ellipse_half_axes.height / ellipse_half_axes.width;
    const cv::Point2d vector_to_component(
        (static_cast<double>(rect.center.x) - static_cast<double>(rough_center.x)) * axis_ratio,
        (static_cast<double>(rect.center.y) - static_cast<double>(rough_center.y)) / axis_ratio);
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

// Midpoint of the long edge farther from (or nearer to) the centre. On a ring bed the far long
// edge touches the outer arc at its middle; the near one is the chord through the inner arc's ends.
cv::Point2f SelectLongEdgeMidpoint(const cv::RotatedRect& rect, const cv::Point2f& rough_center, bool farthest) {
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
        const double distance = farthest ? cv::norm(midpoint - rough_center) : -cv::norm(midpoint - rough_center);
        if (distance > best_distance || !best_midpoint.has_value()) {
            best_distance = distance;
            best_midpoint = midpoint;
        }
    }
    if (!best_midpoint.has_value()) {
        throw std::runtime_error("无法从双倍区旋转框提取纠正点");
    }
    return best_midpoint.value();
}

cv::Point2f SelectFarthestLongEdgeMidpoint(const cv::RotatedRect& rect, const cv::Point2f& rough_center) {
    return SelectLongEdgeMidpoint(rect, rough_center, true);
}

// Point on the unit circle (y up) for double seat k, counted clockwise from the 20 at the top.
cv::Point2f SeatDestinationPoint(int seat) {
    const double angle_rad = (90.0 - 36.0 * seat) * CV_PI / 180.0;
    return cv::Point2f(
        static_cast<float>(std::cos(angle_rad)),
        static_cast<float>(std::sin(angle_rad)));
}

double WrapAngle(double angle) {
    angle = std::fmod(angle + CV_PI, 2.0 * CV_PI);
    if (angle < 0.0) {
        angle += 2.0 * CV_PI;
    }
    return angle - CV_PI;
}

struct DoubleSeatFit {
    cv::Mat homography;
    std::vector<cv::RotatedRect> seat_rects;
    std::vector<cv::Point2f> src_points;
    std::vector<cv::Point2f> dst_points;
    std::vector<std::vector<size_t>> seat_members;
    double max_residual = 0.0;
};

// Groups candidate beds into the 10 red double seats from their clockwise angle (0 = top) and
// fits the homography from every filled seat. Pieces of one bed cut apart by a dart shaft land
// in the same seat and are merged; a blob far from any seat is dropped instead of shifting the
// numbering of the others.
std::optional<DoubleSeatFit> FitSeatsFromAngles(
    const std::vector<ComponentCandidate>& pool,
    const std::vector<double>& angles,
    const std::vector<bool>& usable,
    const cv::Point2f& center,
    double seat_offset) {
    std::array<std::vector<size_t>, kExpectedDoubleRegionCount> seats;
    const double seat_step = 2.0 * CV_PI / kExpectedDoubleRegionCount;
    for (size_t i = 0; i < pool.size(); ++i) {
        if (!usable[i]) {
            continue;
        }
        const double relative = angles[i] - seat_offset;
        const long seat_index = std::lround(relative / seat_step);
        const double deviation = WrapAngle(relative - static_cast<double>(seat_index) * seat_step);
        if (std::abs(deviation) > kMaxSeatAngleDeviationRad) {
            continue;
        }
        const int seat = static_cast<int>(((seat_index % kExpectedDoubleRegionCount) + kExpectedDoubleRegionCount) % kExpectedDoubleRegionCount);
        seats[seat].push_back(i);
    }

    DoubleSeatFit fit;
    for (int seat = 0; seat < kExpectedDoubleRegionCount; ++seat) {
        if (seats[seat].empty()) {
            continue;
        }
        std::vector<cv::Point2f> corners;
        for (size_t member : seats[seat]) {
            std::array<cv::Point2f, 4> box_points{};
            pool[member].rect.points(box_points.data());
            corners.insert(corners.end(), box_points.begin(), box_points.end());
        }
        const cv::RotatedRect merged = seats[seat].size() == 1 ? pool[seats[seat].front()].rect : cv::minAreaRect(corners);
        fit.seat_rects.push_back(merged);
        fit.src_points.push_back(SelectFarthestLongEdgeMidpoint(merged, center));
        fit.dst_points.push_back(SeatDestinationPoint(seat));
        fit.seat_members.push_back(seats[seat]);
    }
    if (static_cast<int>(fit.src_points.size()) < kMinDoubleSeatCount) {
        return std::nullopt;
    }
    fit.homography = cv::findHomography(fit.src_points, fit.dst_points, 0);
    if (fit.homography.empty()) {
        return std::nullopt;
    }
    std::vector<cv::Point2f> projected;
    cv::perspectiveTransform(fit.src_points, projected, fit.homography);
    for (size_t i = 0; i < projected.size(); ++i) {
        fit.max_residual = std::max(fit.max_residual, static_cast<double>(cv::norm(projected[i] - fit.dst_points[i])));
    }
    return fit;
}

// Rough pass: the double ring images as an ellipse, so fit one through the beds' outer edge
// points, squash it back to a circle and read each bed's angle there. Precise pass: with the
// rough homography, read the angles in the rectified board instead and fit again.
std::optional<DoubleSeatFit> FitDoubleSeats(
    const std::vector<ComponentCandidate>& pool,
    const cv::Point2f& rough_center) {
    std::vector<cv::Point2f> outer_points;
    outer_points.reserve(pool.size());
    for (const auto& component : pool) {
        outer_points.push_back(SelectFarthestLongEdgeMidpoint(component.rect, rough_center));
    }
    if (outer_points.size() < 5) {
        return std::nullopt;
    }

    const auto normalize_to_ellipse = [](const cv::RotatedRect& ellipse, const cv::Point2f& point) {
        const double theta = ellipse.angle * CV_PI / 180.0;
        const double dx = point.x - ellipse.center.x;
        const double dy = point.y - ellipse.center.y;
        const double u = (dx * std::cos(theta) + dy * std::sin(theta)) / std::max(1e-6, ellipse.size.width * 0.5);
        const double v = (-dx * std::sin(theta) + dy * std::cos(theta)) / std::max(1e-6, ellipse.size.height * 0.5);
        // Rotate back so "up" in the image stays "up" on the squashed circle.
        return cv::Point2d(u * std::cos(theta) - v * std::sin(theta), u * std::sin(theta) + v * std::cos(theta));
    };

    cv::RotatedRect ellipse = cv::fitEllipse(outer_points);
    std::vector<cv::Point2f> inliers;
    for (const auto& point : outer_points) {
        const cv::Point2d normalized = normalize_to_ellipse(ellipse, point);
        if (std::abs(std::hypot(normalized.x, normalized.y) - 1.0) < kEllipseInlierTolerance) {
            inliers.push_back(point);
        }
    }
    if (inliers.size() >= 5 && inliers.size() < outer_points.size()) {
        ellipse = cv::fitEllipse(inliers);
    }

    std::vector<double> angles(pool.size(), 0.0);
    std::vector<bool> usable(pool.size(), false);
    double sum_sin = 0.0;
    double sum_cos = 0.0;
    for (size_t i = 0; i < pool.size(); ++i) {
        const cv::Point2d normalized = normalize_to_ellipse(ellipse, outer_points[i]);
        if (std::abs(std::hypot(normalized.x, normalized.y) - 1.0) >= kEllipseInlierTolerance) {
            continue;
        }
        angles[i] = std::atan2(normalized.x, -normalized.y);
        usable[i] = true;
        sum_sin += std::sin(angles[i] * kExpectedDoubleRegionCount);
        sum_cos += std::cos(angles[i] * kExpectedDoubleRegionCount);
    }
    // Every red double sits at a multiple of 36 degrees from the 20, so the common offset of all
    // beds (a circular mean modulo 36 degrees) is the board's rotation; seat 0 is the one nearest
    // the top, whichever side of it the 20 happens to be.
    const double seat_offset = std::atan2(sum_sin, sum_cos) / kExpectedDoubleRegionCount;
    std::optional<DoubleSeatFit> rough_fit = FitSeatsFromAngles(pool, angles, usable, ellipse.center, seat_offset);
    if (!rough_fit.has_value()) {
        return std::nullopt;
    }

    std::vector<cv::Point2f> rectified;
    cv::perspectiveTransform(outer_points, rectified, rough_fit->homography);
    cv::Point2f board_center = ellipse.center;
    std::vector<cv::Point2f> center_projection;
    cv::perspectiveTransform(std::vector<cv::Point2f>{cv::Point2f(0.0f, 0.0f)}, center_projection, rough_fit->homography.inv());
    if (!center_projection.empty()) {
        board_center = center_projection.front();
    }
    for (size_t i = 0; i < pool.size(); ++i) {
        const double radius = std::hypot(rectified[i].x, rectified[i].y);
        usable[i] = std::abs(radius - 1.0) < kEllipseInlierTolerance;
        // Rectified coordinates have y up, so the clockwise angle from the top is atan2(x, y).
        angles[i] = std::atan2(rectified[i].x, rectified[i].y);
    }
    std::optional<DoubleSeatFit> precise_fit = FitSeatsFromAngles(pool, angles, usable, board_center, 0.0);
    return precise_fit.has_value() ? precise_fit : rough_fit;
}
#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawRotatedBoxesDebugImage(
    const cv::Mat& base_binary_img,
    const std::vector<ComponentCandidate>& components,
    const cv::Point2f& rough_center,
    const std::optional<std::vector<cv::Point2f>>& correction_points = std::nullopt) {
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

// Ring edges of this board from the red beds, measured after the seat fit so the double search
// is untouched. A few rays through the middle of each red bed (clear of its wires) sample the
// redness R - max(G, B) from the rectified board back in the image; black, white, cream and the
// other bed colour all read about 0, so per radius the rays' median is a profile that is high on
// the bed only. An edge is where the profile falls to half its peak: blur widens the ramp around
// that point but does not move it, unlike a fixed red threshold, which kept only the middle of
// the beds and read the rings about 3 mm too narrow. Each edge is the median over the beds.
// Offline (2026-11-01): 27 App rounds on the soft board, and 19 labelled steel boards whose edges
// land 0.3-0.8 mm inside the wires; 7 rays and a 0.002 step match 21 rays and 0.001 within 0.1 mm.
constexpr int kRingRaysPerBed = 7;
constexpr double kRingRayHalfSpreadRad = 5.0 * CV_PI / 180.0;
constexpr double kRingRadiusStep = 0.002;
constexpr double kTripleSearchInner = 0.52;
constexpr double kTripleSearchOuter = 0.69;
constexpr double kDoubleSearchInner = 0.90;
constexpr double kDoubleSearchOuter = 1.06;
// The half-height threshold uses this percentile of the profile as its peak, so one bright
// sample cannot raise it.
constexpr double kRingProfilePeakPercentile = 0.95;
// Beds whose profile gave both edges; a dart or glare may spoil one or two.
constexpr int kMinMeasuredBedCount = 8;

float MedianOf(std::vector<double> values) {
    std::nth_element(values.begin(), values.begin() + values.size() / 2, values.end());
    return static_cast<float>(values[values.size() / 2]);
}

// Inner and outer half-height crossings around the profile's peak, interpolated between samples;
// nothing when the band is missing or runs off either end of the search range.
std::optional<std::pair<double, double>> BandEdges(const std::vector<float>& profile, double first_radius) {
    std::vector<float> sorted = profile;
    const size_t peak_rank = static_cast<size_t>(kRingProfilePeakPercentile * static_cast<double>(sorted.size() - 1));
    std::nth_element(sorted.begin(), sorted.begin() + peak_rank, sorted.end());
    const float half = sorted[peak_rank] * 0.5f;
    if (half <= 1.0f) {
        return std::nullopt;
    }
    const size_t peak = static_cast<size_t>(std::max_element(profile.begin(), profile.end()) - profile.begin());
    size_t inner = peak;
    while (inner > 0 && profile[inner - 1] > half) {
        --inner;
    }
    size_t outer = peak;
    while (outer + 1 < profile.size() && profile[outer + 1] > half) {
        ++outer;
    }
    if (inner == 0 || outer + 1 == profile.size()) {
        return std::nullopt;
    }
    const double inner_index = static_cast<double>(inner - 1) +
        (half - profile[inner - 1]) / (profile[inner] - profile[inner - 1]);
    const double outer_index = static_cast<double>(outer) +
        (half - profile[outer]) / (profile[outer + 1] - profile[outer]);
    return std::make_pair(first_radius + inner_index * kRingRadiusStep, first_radius + outer_index * kRingRadiusStep);
}

// Edges of one ring on every red bed: the rays of all beds are mapped into the image at once and
// sampled with one remap (rows = radii, columns = bed rays).
std::vector<std::pair<double, double>> MeasureRingOnRedBeds(
    const cv::Mat& image_bgr,
    const cv::Mat& image_from_board_h,
    double first_radius,
    double last_radius) {
    const int radius_count = static_cast<int>(std::floor((last_radius - first_radius) / kRingRadiusStep)) + 1;
    const int column_count = kExpectedDoubleRegionCount * kRingRaysPerBed;
    std::vector<cv::Point2f> board_points;
    board_points.reserve(static_cast<size_t>(radius_count * column_count));
    for (int row = 0; row < radius_count; ++row) {
        const double radius = first_radius + row * kRingRadiusStep;
        for (int bed = 0; bed < kExpectedDoubleRegionCount; ++bed) {
            for (int ray = 0; ray < kRingRaysPerBed; ++ray) {
                // Seat angles: bed 0 is the top one, then every 36 degrees clockwise; y points up.
                const double angle = bed * 2.0 * CV_PI / kExpectedDoubleRegionCount +
                    kRingRayHalfSpreadRad * (2.0 * ray / (kRingRaysPerBed - 1) - 1.0);
                board_points.emplace_back(
                    static_cast<float>(radius * std::sin(angle)),
                    static_cast<float>(radius * std::cos(angle)));
            }
        }
    }
    std::vector<cv::Point2f> image_points;
    cv::perspectiveTransform(board_points, image_points, image_from_board_h);
    cv::Mat map_x(radius_count, column_count, CV_32F);
    cv::Mat map_y(radius_count, column_count, CV_32F);
    for (int row = 0; row < radius_count; ++row) {
        for (int column = 0; column < column_count; ++column) {
            const cv::Point2f& point = image_points[static_cast<size_t>(row * column_count + column)];
            map_x.at<float>(row, column) = point.x;
            map_y.at<float>(row, column) = point.y;
        }
    }
    cv::Mat samples;
    cv::remap(image_bgr, samples, map_x, map_y, cv::INTER_LINEAR, cv::BORDER_CONSTANT, cv::Scalar(0, 0, 0));

    std::vector<std::pair<double, double>> edges;
    std::vector<float> profile(static_cast<size_t>(radius_count));
    std::array<float, kRingRaysPerBed> rays{};
    for (int bed = 0; bed < kExpectedDoubleRegionCount; ++bed) {
        for (int row = 0; row < radius_count; ++row) {
            const cv::Vec3b* pixels = samples.ptr<cv::Vec3b>(row) + bed * kRingRaysPerBed;
            for (int ray = 0; ray < kRingRaysPerBed; ++ray) {
                const cv::Vec3b& bgr = pixels[ray];
                rays[ray] = static_cast<float>(std::max(0, static_cast<int>(bgr[2]) - std::max<int>(bgr[0], bgr[1])));
            }
            std::nth_element(rays.begin(), rays.begin() + kRingRaysPerBed / 2, rays.end());
            profile[static_cast<size_t>(row)] = rays[kRingRaysPerBed / 2];
        }
        if (const auto bed_edges = BandEdges(profile, first_radius)) {
            edges.push_back(bed_edges.value());
        }
    }
    return edges;
}

std::optional<MeasuredRingEdges> MeasureRingEdges(const cv::Mat& image_bgr, const DoubleSeatFit& seat_fit) {
    const cv::Mat image_from_board_h = seat_fit.homography.inv();
    const auto triple = MeasureRingOnRedBeds(image_bgr, image_from_board_h, kTripleSearchInner, kTripleSearchOuter);
    const auto doubles = MeasureRingOnRedBeds(image_bgr, image_from_board_h, kDoubleSearchInner, kDoubleSearchOuter);
    if (static_cast<int>(triple.size()) < kMinMeasuredBedCount || static_cast<int>(doubles.size()) < kMinMeasuredBedCount) {
        __android_log_print(
            ANDROID_LOG_WARN,
            "BullTrackNativeV2",
            "ring edges: only %d triple and %d double beds measured",
            static_cast<int>(triple.size()),
            static_cast<int>(doubles.size()));
        return std::nullopt;
    }
    const auto median_of = [](const std::vector<std::pair<double, double>>& beds, bool outer) {
        std::vector<double> values;
        values.reserve(beds.size());
        for (const auto& bed : beds) {
            values.push_back(outer ? bed.second : bed.first);
        }
        return MedianOf(std::move(values));
    };

    MeasuredRingEdges edges;
    edges.triple_inner = median_of(triple, false);
    edges.triple_outer = median_of(triple, true);
    edges.double_inner = median_of(doubles, false);
    edges.double_outer = median_of(doubles, true);
    edges.triple_count = static_cast<int>(std::min(triple.size(), doubles.size()));
    // Loose bounds around every common board, so a dart or a stray red blob in a few seats cannot
    // produce an impossible table.
    const float triple_width = edges.triple_outer - edges.triple_inner;
    const float double_width = edges.double_outer - edges.double_inner;
    const bool plausible =
        edges.triple_inner > 0.45f && edges.triple_outer < 0.75f &&
        triple_width >= 0.03f && triple_width <= 0.12f &&
        edges.double_outer >= 0.95f && edges.double_outer <= 1.05f &&
        double_width >= 0.03f && double_width <= 0.10f &&
        edges.double_inner - edges.triple_outer >= 0.15f;
    if (!plausible) {
        __android_log_print(
            ANDROID_LOG_WARN,
            "BullTrackNativeV2",
            "ring edges rejected: triple=%.3f-%.3f double=%.3f-%.3f n=%d",
            edges.triple_inner,
            edges.triple_outer,
            edges.double_inner,
            edges.double_outer,
            edges.triple_count);
        return std::nullopt;
    }
    return edges;
}

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
    // Seen at an angle the board is an ellipse filling the box, so remove an ellipse scaled from
    // the box; a circle from the box width cut into the top and bottom doubles when shot from
    // above or below.
    const cv::Size inner_remove_axes(
        std::max(1, static_cast<int>(std::lround(img_before.cols * 0.5 * kInnerRemoveRadiusScale))),
        std::max(1, static_cast<int>(std::lround(img_before.rows * 0.5 * kInnerRemoveRadiusScale))));
    cv::ellipse(
        red_binary_pre,
        cv::Point(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y))),
        inner_remove_axes,
        0.0,
        0.0,
        360.0,
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
    const cv::Size2d board_half_axes(img_before.cols * 0.5, img_before.rows * 0.5);
    for (const auto& component : elongated_components) {
        if (IsComponentPerpendicularToCenterVector(
                component.rect,
                rough_center,
                board_half_axes,
                circle_config.red_region_perpendicular_min_angle_deg,
                circle_config.red_region_perpendicular_max_angle_deg)) {
            perpendicular_components.push_back(component);
        }
    }
    cv::Mat perpendicular_components_binary;
    cv::Mat perpendicular_rotated_boxes_debug;
#if BT_ENABLE_DEBUG_IMAGES
    if (DebugImagesActive()) {
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
    }
#endif
    if (static_cast<int>(perpendicular_components.size()) < kMinDoubleSeatCount) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "垂直方向筛选后双倍区不足8个"};
    }

    // Drop small fragments, but keep halves of a bed cut by a dart shaft: seats merge those.
    std::vector<double> long_edges;
    long_edges.reserve(perpendicular_components.size());
    for (const auto& component : perpendicular_components) {
        long_edges.push_back(GetRotatedRectLongEdge(component.rect));
    }
    std::nth_element(long_edges.begin(), long_edges.begin() + long_edges.size() / 2, long_edges.end());
    const double median_long_edge = long_edges[long_edges.size() / 2];
    std::vector<ComponentCandidate> pool;
    for (const auto& component : perpendicular_components) {
        if (GetRotatedRectLongEdge(component.rect) > median_long_edge * kFragmentLongEdgeScale) {
            pool.push_back(component);
        }
    }

    std::optional<DoubleSeatFit> seat_fit = FitDoubleSeats(pool, rough_center);
    if (!seat_fit.has_value()) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, cv::Mat(), cv::Mat(), {}, {}, cv::Mat(), "分座位后双倍区不足8个"};
    }
    if (seat_fit->max_residual > kMaxSeatResidual) {
        return {std::nullopt, red_lab_model, red_only_mask, red_only_blurred, {}, inner_removed_binary, perpendicular_rotated_boxes_debug, perpendicular_components_binary, cv::Mat(), cv::Mat(), seat_fit->src_points, seat_fit->dst_points, cv::Mat(), cv::format("双倍区位置不一致(残差%.3f)", seat_fit->max_residual), seat_fit->max_residual, static_cast<int>(seat_fit->src_points.size())};
    }
    const cv::Mat& point_rectification_h = seat_fit->homography;
    const float rectified_radius = 1.0f;
    const auto ring_start = std::chrono::steady_clock::now();
    const std::optional<MeasuredRingEdges> ring_edges = MeasureRingEdges(img_before, seat_fit.value());
    __android_log_print(
        ANDROID_LOG_INFO,
        "BullTrackNativeV2",
        "ring edges: %.2f ms",
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - ring_start).count());

    std::vector<ComponentCandidate> seat_candidates;
    std::vector<cv::Mat> selected_masks;
    for (size_t seat = 0; seat < seat_fit->seat_rects.size(); ++seat) {
        ComponentCandidate merged;
        merged.rect = seat_fit->seat_rects[seat];
        seat_candidates.push_back(merged);
        for (size_t member : seat_fit->seat_members[seat]) {
            selected_masks.push_back(pool[member].mask);
        }
    }
    const double corrected_radius = static_cast<double>(rectified_radius);

    cv::Mat area_grouped_debug;
    cv::Mat perspective_corrected_preview_debug;
#if BT_ENABLE_DEBUG_IMAGES
    if (DebugImagesActive()) {
        perpendicular_rotated_boxes_debug = DrawRotatedBoxesDebugImage(
            perpendicular_components_binary.empty() ? red_binary_pre : perpendicular_components_binary,
            seat_candidates,
            rough_center,
            seat_fit->src_points);
        area_grouped_debug = DrawAreaFilteredDebugImage(
            red_binary_pre.size(),
            pool,
            seat_candidates,
            median_long_edge);

        // Rectified board drawn at the rough board size around the crop centre.
        const cv::Matx33d to_preview(
            rough_radius, 0.0, rough_center.x,
            0.0, -rough_radius, rough_center.y,
            0.0, 0.0, 1.0);
        const cv::Mat preview_h = cv::Mat(to_preview) * point_rectification_h;
        cv::warpPerspective(
            img_before,
            perspective_corrected_preview_debug,
            preview_h,
            img_before.size(),
            cv::INTER_LINEAR,
            cv::BORDER_CONSTANT);
        const cv::Point preview_center(static_cast<int>(std::lround(rough_center.x)), static_cast<int>(std::lround(rough_center.y)));
        cv::circle(perspective_corrected_preview_debug, preview_center, static_cast<int>(std::lround(rough_radius)), cv::Scalar(0, 255, 255), 3);
        cv::circle(perspective_corrected_preview_debug, preview_center, 8, cv::Scalar(0, 0, 255), -1);
        if (ring_edges.has_value()) {
            for (const float edge : {ring_edges->triple_inner, ring_edges->triple_outer, ring_edges->double_inner, ring_edges->double_outer}) {
                cv::circle(
                    perspective_corrected_preview_debug,
                    preview_center,
                    static_cast<int>(std::lround(edge * rough_radius)),
                    cv::Scalar(0, 255, 0),
                    1);
            }
        }
        for (size_t i = 0; i < seat_fit->dst_points.size(); ++i) {
            const cv::Point point(
                static_cast<int>(std::lround(rough_center.x + seat_fit->dst_points[i].x * rough_radius)),
                static_cast<int>(std::lround(rough_center.y - seat_fit->dst_points[i].y * rough_radius)));
            cv::circle(perspective_corrected_preview_debug, point, 8, cv::Scalar(255, 0, 255), -1);
        }
        cv::putText(
            perspective_corrected_preview_debug,
            cv::format("seats=%d residual=%.3f", static_cast<int>(seat_fit->src_points.size()), seat_fit->max_residual),
            cv::Point(12, 28),
            cv::FONT_HERSHEY_SIMPLEX,
            0.7,
            cv::Scalar(255, 255, 0),
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
        seat_fit->src_points,
        seat_fit->dst_points,
        point_rectification_h,
        "透视双倍区纠正成功",
        seat_fit->max_residual,
        static_cast<int>(seat_fit->src_points.size()),
        ring_edges
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
    if (DebugImagesActive()) {
        detection_result.adaptive_red_measurement_base_bgr = PrepareBoardMeasurementBaseImage(img_before);
    }
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
    detection_result.seat_fit_max_residual = red_radius_result.seat_fit_max_residual;
    detection_result.seat_count = red_radius_result.seat_count;
    detection_result.measured_ring_edges = red_radius_result.measured_ring_edges;
    const MeasuredRingEdges logged_edges = red_radius_result.measured_ring_edges.value_or(MeasuredRingEdges{});
    __android_log_print(
        ANDROID_LOG_INFO,
        "BullTrackNativeV2",
        "board setup: %s seats=%d residual=%.4f rings=%s triple=%.3f-%.3f double=%.3f-%.3f n=%d",
        red_radius_result.reason.c_str(),
        red_radius_result.seat_count,
        red_radius_result.seat_fit_max_residual,
        red_radius_result.measured_ring_edges.has_value() ? "measured" : "default",
        logged_edges.triple_inner,
        logged_edges.triple_outer,
        logged_edges.double_inner,
        logged_edges.double_outer,
        logged_edges.triple_count);
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
