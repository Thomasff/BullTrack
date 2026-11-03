#include "AndroidBullTrackSession.h"

#include "bulltrack_v2/Alignment.h"
#include "BoardDetectorAndroid.h"
#include "bulltrack_v2/DartDetector.h"
#include "bulltrack_v2/Pipeline.h"
#include "bulltrack_v2/Preprocessing.h"
#include "YoloNcnnDetector.h"

#include <android/log.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <utility>

namespace bulltrack {
namespace {

double MsSince(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}

// Stage times of the frame ProcessFrame is working on; it adds them to the round's totals.
struct FrameStageTimes {
    double yolo_ms = 0.0;
    double ecc_ms = 0.0;
    int ecc_runs = 0;
    double jpeg_ms = 0.0;
    double change_ms = 0.0;
    bool yolo_skipped = false;
};
FrameStageTimes g_frame_stage_times;

// Skipping YOLO on unchanged frames. A frame counts as unchanged when no pixel of its shrunk,
// blurred model square leaves the range (darkest to brightest) of the reference's 3x3
// neighbourhood by more than kChangeTolerance in any channel, beyond a few scattered pixels: this
// lets the whole picture shift by about 4 full-size pixels (a stand that shakes slightly) while a
// new dart brings colours that were not there. On 128 recorded rounds (2026-10-31) no new dart had
// a changed patch under 39 pixels, and about 75% of idle frame pairs had one under 20.
constexpr double kChangeScale = 0.25;
constexpr int kChangeTolerance = 15;
constexpr int kMinChangedPatchArea = 20;
// YOLO still runs at least every (this + 1) frames, so a dart judged unchanged is about 2 s late at most.
constexpr int kMaxSkippedFramesInRow = 3;
// Frames after a change that run YOLO whatever the check says: a dart YOLO missed on the frame it
// landed would otherwise sit in the reference and be found only by the forced run.
constexpr int kYoloFramesAfterChange = 2;

cv::Mat PrepareChangeImage(const cv::Mat& frame_bgr, const cv::Rect& square) {
    const cv::Rect area = square & cv::Rect(0, 0, frame_bgr.cols, frame_bgr.rows);
    cv::Mat small;
    cv::resize(frame_bgr(area), small, cv::Size(), kChangeScale, kChangeScale, cv::INTER_AREA);
    cv::GaussianBlur(small, small, cv::Size(3, 3), 0);
    return small;
}

// Area of the largest patch of current that falls outside reference's neighbourhood range.
int LargestChangedPatch(const cv::Mat& reference, const cv::Mat& current) {
    const cv::Mat kernel = cv::Mat::ones(3, 3, CV_8U);
    cv::Mat upper;
    cv::Mat lower;
    cv::dilate(reference, upper, kernel);
    cv::erode(reference, lower, kernel);
    cv::add(upper, cv::Scalar::all(kChangeTolerance), upper);
    cv::subtract(lower, cv::Scalar::all(kChangeTolerance), lower);
    cv::Mat inside;
    cv::inRange(current, lower, upper, inside);
    cv::Mat changed;
    cv::bitwise_not(inside, changed);
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int count = cv::connectedComponentsWithStats(changed, labels, stats, centroids, 8);
    int largest = 0;
    for (int label = 1; label < count; ++label) {
        largest = std::max(largest, stats.at<int>(label, cv::CC_STAT_AREA));
    }
    return largest;
}

struct LocalizedDartDetectionResult {
    bool has_dart = false;
    std::optional<cv::Point> point_in_round_board;
    std::optional<cv::Point2f> point_norm;
    std::string reason;
    std::vector<DebugImageArtifact> debug_images;
};

struct FirstFrameBoardBaseline {
    cv::Rect board_box;
    cv::Mat board_crop_bgr;
    cv::Mat enhanced_board_crop_bgr;
    cv::Mat preprocessed_gray;
    cv::Mat point_rectification_h;
    float rectified_radius = 1.0f;
    cv::Rect dart_search_rect;
    BoardCircleDetectionResult board_detection;
    YoloDetectionResult yolo_detection;
    // The square the model sees for the whole round, centred on the board.
    cv::Rect model_square;
    // Board's left half over its right half in the image (0 when unknown) and the phone's side.
    float left_right_half_ratio = 0.0f;
    bool camera_on_left = true;
};

#if BT_ENABLE_DEBUG_IMAGES
std::vector<std::uint8_t> EncodeJpegBytes(const cv::Mat& image) {
    const auto start = std::chrono::steady_clock::now();
    std::vector<std::uint8_t> buffer;
    std::vector<int> params{cv::IMWRITE_JPEG_QUALITY, 95};
    if (!cv::imencode(".jpg", image, buffer, params)) {
        throw std::runtime_error("debug_image_encode_failed");
    }
    g_frame_stage_times.jpeg_ms += MsSince(start);
    return buffer;
}
#endif

cv::Mat EnsureColorForDebug(const cv::Mat& image) {
    if (image.channels() == 3) {
        return image.clone();
    }
    cv::Mat color;
    cv::cvtColor(image, color, cv::COLOR_GRAY2BGR);
    return color;
}

#if BT_ENABLE_DEBUG_IMAGES
void AppendDebugImage(
    std::vector<DebugImageArtifact>& output,
    int frame_index,
    const std::string& step_code,
    const std::string& stage_name,
    const cv::Mat& image) {
    if (!DebugImagesActive()) {
        return;
    }
    char file_name[128];
    std::snprintf(
        file_name,
        sizeof(file_name),
        "f%03d_%s_%s.jpg",
        frame_index,
        step_code.c_str(),
        stage_name.c_str());
    output.push_back(DebugImageArtifact{
        file_name,
        EncodeJpegBytes(image)
    });
}

void AppendDebugImageIfNotEmpty(
    std::vector<DebugImageArtifact>& output,
    int frame_index,
    const std::string& step_code,
    const std::string& stage_name,
    const cv::Mat& image) {
    if (image.empty()) {
        return;
    }
    AppendDebugImage(output, frame_index, step_code, stage_name, image);
}

cv::Mat DrawBoardCenterRadiusDebugImage(
    const cv::Mat& image_bgr,
    const BoardCircle& board_circle,
    const std::vector<cv::Mat>& red_region_masks,
    const std::vector<cv::Point2f>& correction_points_src) {
    cv::Mat debug_image = image_bgr.clone();
    cv::circle(debug_image, cv::Point(board_circle.cx, board_circle.cy), board_circle.radius, cv::Scalar(0, 255, 255), 3);
    cv::circle(debug_image, cv::Point(board_circle.cx, board_circle.cy), 8, cv::Scalar(0, 0, 255), -1);
    for (size_t i = 0; i < red_region_masks.size(); ++i) {
        if (red_region_masks[i].empty()) {
            continue;
        }
        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(red_region_masks[i], contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
        if (contours.empty()) {
            continue;
        }
        cv::drawContours(debug_image, contours, -1, cv::Scalar(0, 255, 0), 2);
        std::vector<cv::Point> merged_points;
        for (const auto& contour : contours) {
            merged_points.insert(merged_points.end(), contour.begin(), contour.end());
        }
        if (merged_points.empty()) {
            continue;
        }
        cv::Rect bbox = cv::boundingRect(merged_points);
        const std::string label = "D" + std::to_string(static_cast<int>(i + 1));
        cv::putText(
            debug_image,
            label,
            cv::Point(bbox.x, std::max(16, bbox.y - 6)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.55,
            cv::Scalar(0, 255, 0),
            2);
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

cv::Mat DrawTipPointOnBinaryImage(const cv::Mat& binary_img, const std::optional<cv::Point>& tip_point) {
    cv::Mat debug_image = EnsureColorForDebug(binary_img);
    if (tip_point.has_value()) {
        cv::circle(debug_image, tip_point.value(), 8, cv::Scalar(0, 255, 0), -1);
    } else {
        cv::putText(debug_image, "no_tip", cv::Point(16, 32), cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 0, 255), 2);
    }
    return debug_image;
}

cv::Mat DrawInnerRemovedBinaryDebugImage(
    const cv::Mat& binary_img,
    const BoardCircleDetectionResult& board_detection) {
    cv::Mat debug_image = EnsureColorForDebug(binary_img);
    const std::string label = cv::format(
        "red LAB l=%.1f a=%.1f b=%.1f n=%d",
        board_detection.adaptive_red_l,
        board_detection.adaptive_red_a,
        board_detection.adaptive_red_b,
        board_detection.adaptive_red_sample_count);
    cv::putText(
        debug_image,
        label,
        cv::Point(12, 28),
        cv::FONT_HERSHEY_SIMPLEX,
        0.55,
        cv::Scalar(0, 255, 255),
        2);
    return debug_image;
}

std::optional<std::tuple<float, float, float>> ComputeAdaptiveRedSampleAStats(
    const cv::Mat& base_image_bgr,
    const BoardCircleDetectionResult& board_detection) {
    if (base_image_bgr.empty() || board_detection.adaptive_red_sample_points.empty()) {
        return std::nullopt;
    }

    cv::Mat lab_image;
    cv::cvtColor(base_image_bgr, lab_image, cv::COLOR_BGR2Lab);

    float min_a = 255.0f;
    float max_a = 0.0f;
    float sum_a = 0.0f;
    int count = 0;
    for (const cv::Point& point : board_detection.adaptive_red_sample_points) {
        if (point.x < 0 || point.x >= lab_image.cols || point.y < 0 || point.y >= lab_image.rows) {
            continue;
        }
        const float a = static_cast<float>(lab_image.at<cv::Vec3b>(point.y, point.x)[1]);
        min_a = std::min(min_a, a);
        max_a = std::max(max_a, a);
        sum_a += a;
        ++count;
    }
    if (count <= 0) {
        return std::nullopt;
    }
    return std::make_tuple(min_a, max_a, sum_a / static_cast<float>(count));
}

std::optional<std::tuple<cv::Point, float, float, float>> ComputeAdaptiveRedSampleCenterLab(
    const cv::Mat& base_image_bgr,
    const BoardCircleDetectionResult& board_detection) {
    if (base_image_bgr.empty()) {
        return std::nullopt;
    }

    const cv::Rect image_bounds(0, 0, base_image_bgr.cols, base_image_bgr.rows);
    const cv::Rect sample_rect = board_detection.adaptive_red_sample_rect & image_bounds;
    if (sample_rect.area() <= 0) {
        return std::nullopt;
    }

    const cv::Point center_point(
        sample_rect.x + sample_rect.width / 2,
        sample_rect.y + sample_rect.height / 2);
    if (center_point.x < 0 || center_point.x >= base_image_bgr.cols ||
        center_point.y < 0 || center_point.y >= base_image_bgr.rows) {
        return std::nullopt;
    }

    cv::Mat lab_image;
    cv::cvtColor(base_image_bgr, lab_image, cv::COLOR_BGR2Lab);
    const cv::Vec3b lab_pixel = lab_image.at<cv::Vec3b>(center_point.y, center_point.x);
    return std::make_tuple(
        center_point,
        static_cast<float>(lab_pixel[0]),
        static_cast<float>(lab_pixel[1]),
        static_cast<float>(lab_pixel[2]));
}

cv::Mat DrawAdaptiveRedSamplePointsDebugImage(
    const cv::Mat& board_crop_bgr,
    const BoardCircleDetectionResult& board_detection) {
    const cv::Mat& base_image =
        board_detection.adaptive_red_measurement_base_bgr.empty()
            ? board_crop_bgr
            : board_detection.adaptive_red_measurement_base_bgr;
    if (base_image.empty()) {
        return cv::Mat();
    }

    const cv::Rect image_bounds(0, 0, base_image.cols, base_image.rows);
    const cv::Rect sample_rect = board_detection.adaptive_red_sample_rect & image_bounds;
    if (sample_rect.area() <= 0) {
        return cv::Mat();
    }

    cv::Mat debug_image = base_image(sample_rect).clone();
    const auto a_stats = ComputeAdaptiveRedSampleAStats(base_image, board_detection);
    const auto center_lab = ComputeAdaptiveRedSampleCenterLab(base_image, board_detection);
    for (const cv::Point& point : board_detection.adaptive_red_sample_points) {
        if (!sample_rect.contains(point)) {
            continue;
        }
        const int local_x = point.x - sample_rect.x;
        const int local_y = point.y - sample_rect.y;
        if (local_x < 0 || local_x >= debug_image.cols || local_y < 0 || local_y >= debug_image.rows) {
            continue;
        }
        debug_image.at<cv::Vec3b>(local_y, local_x) = cv::Vec3b(0, 255, 0);
    }
    if (center_lab.has_value()) {
        const auto [center_point, center_l, center_a, center_b] = center_lab.value();
        const int local_x = center_point.x - sample_rect.x;
        const int local_y = center_point.y - sample_rect.y;
        if (local_x >= 0 && local_x < debug_image.cols && local_y >= 0 && local_y < debug_image.rows) {
            debug_image.at<cv::Vec3b>(local_y, local_x) = cv::Vec3b(0, 255, 0);
        }
        cv::putText(
            debug_image,
            cv::format("center LAB l=%.1f a=%.1f b=%.1f", center_l, center_a, center_b),
            cv::Point(8, 60),
            cv::FONT_HERSHEY_SIMPLEX,
            0.5,
            cv::Scalar(0, 255, 0),
            1);
    }

    const std::string label = cv::format(
        "red LAB l=%.1f a=%.1f b=%.1f n=%d",
        board_detection.adaptive_red_l,
        board_detection.adaptive_red_a,
        board_detection.adaptive_red_b,
        board_detection.adaptive_red_sample_count);
    cv::putText(
        debug_image,
        label,
        cv::Point(8, 24),
        cv::FONT_HERSHEY_SIMPLEX,
        0.5,
        cv::Scalar(0, 255, 255),
        1);
    if (a_stats.has_value()) {
        const auto [min_a, max_a, avg_a] = a_stats.value();
        cv::putText(
            debug_image,
            cv::format("a min=%.1f max=%.1f avg=%.1f", min_a, max_a, avg_a),
            cv::Point(8, 42),
            cv::FONT_HERSHEY_SIMPLEX,
            0.5,
            cv::Scalar(0, 255, 255),
            1);
    }
    return debug_image;
}

#endif

cv::Rect ClampRectToImage(const cv::Rect2f& rect, const cv::Size& image_size);

cv::Point2f BoxCenter(const YoloDetectionBox& box) {
    return cv::Point2f(
        box.rect.x + (box.rect.width * 0.5f),
        box.rect.y + (box.rect.height * 0.5f));
}

bool BoxCenterInside(const YoloDetectionBox& box, const std::optional<cv::Rect>& area) {
    if (!area.has_value()) {
        return true;
    }
    const cv::Point center(
        static_cast<int>(std::lround(box.rect.x + box.rect.width * 0.5f)),
        static_cast<int>(std::lround(box.rect.y + box.rect.height * 0.5f)));
    return area->contains(center);
}

// Darts whose box centre lies outside the dart search area (a clock hand, a door frame) are not
// darts on this board and would only make the count flicker.
std::vector<YoloDetectionBox> SelectTopDartBoxes(
    const YoloDetectionResult& detection,
    int max_count,
    const std::optional<cv::Rect>& search_area) {
    std::vector<YoloDetectionBox> dart_boxes;
    for (const YoloDetectionBox& box : detection.boxes) {
        if (box.label == "dart" && BoxCenterInside(box, search_area)) {
            dart_boxes.push_back(box);
        }
    }
    std::sort(dart_boxes.begin(), dart_boxes.end(), [](const YoloDetectionBox& lhs, const YoloDetectionBox& rhs) {
        return lhs.score > rhs.score;
    });
    const size_t limit = static_cast<size_t>(std::max(0, max_count));
    if (dart_boxes.size() > limit) {
        dart_boxes.resize(limit);
    }
    return dart_boxes;
}

std::optional<cv::Rect> SelectOptionalBestBoardBox(const YoloDetectionResult& detection, const cv::Size& image_size) {
    std::optional<YoloDetectionBox> best_board_box;
    for (const YoloDetectionBox& box : detection.boxes) {
        if (box.label != "board") {
            continue;
        }
        if (!best_board_box.has_value() || box.score > best_board_box->score) {
            best_board_box = box;
        }
    }
    if (!best_board_box.has_value()) {
        return std::nullopt;
    }
    return ClampRectToImage(best_board_box->rect, image_size);
}

#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawFrameOverlayWithHighlightedNewBox(
    const cv::Mat& image_bgr,
    const std::vector<YoloDetectionBox>& dart_boxes,
    const std::optional<YoloDetectionBox>& new_dart_box,
    const std::string& label) {
    cv::Mat debug_image = image_bgr.clone();
    for (const YoloDetectionBox& box : dart_boxes) {
        cv::rectangle(debug_image, box.rect, cv::Scalar(0, 255, 255), 2);
        cv::putText(
            debug_image,
            "dart " + cv::format("%.2f", box.score),
            cv::Point(static_cast<int>(box.rect.x), std::max(18, static_cast<int>(box.rect.y) - 6)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.5,
            cv::Scalar(0, 255, 255),
            2);
    }
    if (new_dart_box.has_value()) {
        cv::rectangle(debug_image, new_dart_box->rect, cv::Scalar(0, 0, 255), 3);
        cv::putText(
            debug_image,
            "new_dart",
            cv::Point(static_cast<int>(new_dart_box->rect.x), std::max(36, static_cast<int>(new_dart_box->rect.y) - 10)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.8,
            cv::Scalar(0, 0, 255),
            2);
    }
    cv::putText(debug_image, label, cv::Point(16, 28), cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(255, 255, 0), 2);
    return debug_image;
}
#endif

void AppendBoardDetectionDebugImages(
    std::vector<DebugImageArtifact>& output,
    int frame_index,
    const BoardCircleDetectionResult& board_detection,
    const cv::Mat& board_crop_bgr) {
#if BT_ENABLE_DEBUG_IMAGES
    // The images below are drawn before AppendDebugImage looks at the switch, so check it first.
    if (!DebugImagesActive()) {
        return;
    }
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s07",
        "adaptive_red_sample_points",
        DrawAdaptiveRedSamplePointsDebugImage(
            board_crop_bgr,
            board_detection));
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s08",
        "red_radius_inner_removed_binary",
        DrawInnerRemovedBinaryDebugImage(
            board_detection.red_radius_inner_removed_binary,
            board_detection));
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s08b",
        "red_radius_perpendicular_rotated_boxes",
        board_detection.red_radius_perpendicular_rotated_boxes_debug);
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s09",
        "red_radius_perpendicular_components_binary",
        board_detection.red_radius_perpendicular_components_binary);
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s09b",
        "red_radius_area_grouped_debug",
        board_detection.red_radius_area_grouped_debug);
    AppendDebugImageIfNotEmpty(
        output,
        frame_index,
        "s10a",
        "board_rectified_preview",
        board_detection.perspective_corrected_preview_debug);
    AppendDebugImage(
        output,
        frame_index,
        "s10",
        "board_center_rectified_points",
        DrawBoardCenterRadiusDebugImage(
            board_crop_bgr,
            board_detection.circle,
            board_detection.red_radius_selected_component_masks,
            board_detection.correction_points_src));
#else
    (void)output;
    (void)frame_index;
    (void)board_detection;
    (void)board_crop_bgr;
#endif
}

cv::Rect ClampRectToImage(const cv::Rect2f& rect, const cv::Size& image_size) {
    const int left = std::max(0, static_cast<int>(std::floor(rect.x)));
    const int top = std::max(0, static_cast<int>(std::floor(rect.y)));
    const int right = std::min(image_size.width, static_cast<int>(std::ceil(rect.x + rect.width)));
    const int bottom = std::min(image_size.height, static_cast<int>(std::ceil(rect.y + rect.height)));
    if (left >= right || top >= bottom) {
        throw std::runtime_error("first_frame_board_box_invalid");
    }
    return cv::Rect(left, top, right - left, bottom - top);
}

cv::Mat CropBoardByRect(const cv::Mat& image, const cv::Rect& rect) {
    if (image.empty()) {
        throw std::runtime_error("board_crop_input_empty");
    }
    if (rect.width <= 0 || rect.height <= 0) {
        throw std::runtime_error("board_crop_invalid");
    }
    return image(rect).clone();
}

// Maps the bull and the outer double edge at 9 and 3 o'clock back into the image and compares
// the two half widths. The rectified board is anchored to the board itself (20 at the top), so
// phone roll does not matter.
float MeasureLeftRightHalfRatio(const cv::Mat& point_rectification_h, float rectified_radius) {
    if (point_rectification_h.empty() || rectified_radius <= 1e-6f) {
        return 0.0f;
    }
    const std::vector<cv::Point2f> rectified_points{
        cv::Point2f(0.0f, 0.0f),
        cv::Point2f(-rectified_radius, 0.0f),
        cv::Point2f(rectified_radius, 0.0f)};
    std::vector<cv::Point2f> image_points;
    cv::perspectiveTransform(rectified_points, image_points, point_rectification_h.inv());
    if (image_points.size() != rectified_points.size()) {
        return 0.0f;
    }
    const float left = static_cast<float>(cv::norm(image_points[1] - image_points[0]));
    const float right = static_cast<float>(cv::norm(image_points[2] - image_points[0]));
    return right > 1e-3f ? left / right : 0.0f;
}

// The half nearer the phone looks longer. An unknown ratio (0) counts as the left.
bool IsCameraOnLeft(float left_right_half_ratio) {
    return !(left_right_half_ratio > 0.0f && left_right_half_ratio < 1.0f);
}

// Dart detection looks at the board box widened on every side, more on the side away from the
// phone: shot at an angle, dart tails stick out that way, and a dart near that edge (or one in
// the miss ring) leaves the board box and was cut off, sometimes entirely. Board fitting keeps
// the plain board box.
constexpr double kDartSearchMarginNearSide = 0.10;
constexpr double kDartSearchMarginFarSide = 0.25;
constexpr double kDartSearchMarginTop = 0.10;
constexpr double kDartSearchMarginBottom = 0.10;

cv::Rect ExpandToDartSearchRect(const cv::Rect& board_box, bool camera_on_left) {
    const double left_margin = camera_on_left ? kDartSearchMarginNearSide : kDartSearchMarginFarSide;
    const double right_margin = camera_on_left ? kDartSearchMarginFarSide : kDartSearchMarginNearSide;
    const int left = static_cast<int>(std::lround(board_box.width * left_margin));
    const int right = static_cast<int>(std::lround(board_box.width * right_margin));
    const int top = static_cast<int>(std::lround(board_box.height * kDartSearchMarginTop));
    const int bottom = static_cast<int>(std::lround(board_box.height * kDartSearchMarginBottom));
    return cv::Rect(
        board_box.x - left,
        board_box.y - top,
        board_box.width + left + right,
        board_box.height + top + bottom);
}

// Crops a rect that may reach past the image edge, filling the outside with black, so every frame
// keeps the same geometry relative to its board box.
cv::Mat CropWithBlackPadding(const cv::Mat& image, const cv::Rect& rect) {
    cv::Mat crop = cv::Mat::zeros(rect.size(), image.type());
    const cv::Rect inside = rect & cv::Rect(0, 0, image.cols, image.rows);
    if (inside.area() > 0) {
        image(inside).copyTo(crop(inside - rect.tl()));
    }
    return crop;
}

cv::Rect SelectBestBoardBox(const YoloDetectionResult& detection, const cv::Size& image_size) {
    std::optional<cv::Rect> board_box = SelectOptionalBestBoardBox(detection, image_size);
    if (!board_box.has_value()) {
        throw std::runtime_error("board_not_found");
    }
    return board_box.value();
}

// Keeps a margin, as a box ending a pixel short of the edge may still be cut off.
bool BoxClearOfSquareEdges(const cv::Rect& box, const cv::Rect& square) {
    const int edge_margin = std::max(2, square.height / 100);
    return box.x >= square.x + edge_margin &&
        box.y >= square.y + edge_margin &&
        box.br().x <= square.br().x - edge_margin &&
        box.br().y <= square.br().y - edge_margin;
}

FirstFrameBoardBaseline BuildFirstFrameBoardBaseline(
    const cv::Mat& first_frame_bgr,
    const PipelineConfig& pipeline_config) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("first_frame_empty");
    }

    // The model sees a square of the frame. Each round centres it on the board along the frame's
    // long side, so the board has the same room on both sides when it swings or the phone gets
    // nudged between rounds. Where the board sits inside the square does not change the tips
    // (2026-10-31, App test set), so this is only about room. A box clear of the centred square's
    // edges is the whole board and is kept; one cut off at an edge is detected again in the
    // square moved towards it.
    const cv::Rect centred_square = ModelInputSquare(first_frame_bgr.size());
    YoloDetectionResult yolo_detection = DetectYoloObjects(first_frame_bgr, centred_square);
    cv::Rect board_box = SelectBestBoardBox(yolo_detection, first_frame_bgr.size());
    if (!BoxClearOfSquareEdges(board_box, centred_square)) {
        const cv::Rect moved_square = BoardCentredSquare(first_frame_bgr.size(), board_box);
        if (moved_square != centred_square) {
            yolo_detection = DetectYoloObjects(first_frame_bgr, moved_square);
            board_box = SelectBestBoardBox(yolo_detection, first_frame_bgr.size());
        }
    }
    const cv::Rect model_square = BoardCentredSquare(first_frame_bgr.size(), board_box);
    cv::Mat board_crop_bgr = CropBoardByRect(first_frame_bgr, board_box);
    cv::Mat enhanced_board_crop_bgr = EnhanceWarpedImage(
        board_crop_bgr,
        pipeline_config.enhancement.saturation_scale,
        pipeline_config.enhancement.contrast_scale);
    BoardCircleDetectionResult board_detection = DetectBoardCircleDetailed(
        enhanced_board_crop_bgr,
        board_box,
        pipeline_config.edge,
        pipeline_config.circle,
        false);

    FirstFrameBoardBaseline baseline;
    baseline.board_box = board_box;
    baseline.board_crop_bgr = std::move(board_crop_bgr);
    baseline.enhanced_board_crop_bgr = std::move(enhanced_board_crop_bgr);
    baseline.left_right_half_ratio = MeasureLeftRightHalfRatio(
        board_detection.point_rectification_h,
        board_detection.rectified_radius);
    baseline.camera_on_left = IsCameraOnLeft(baseline.left_right_half_ratio);
    // Darts are aligned and compared in the widened search area, so the template covers it too.
    baseline.dart_search_rect = ExpandToDartSearchRect(board_box, baseline.camera_on_left);
    baseline.preprocessed_gray = PreprocessImage(
        EnhanceWarpedImage(
            CropWithBlackPadding(first_frame_bgr, baseline.dart_search_rect),
            pipeline_config.enhancement.saturation_scale,
            pipeline_config.enhancement.contrast_scale),
        pipeline_config.dart.preprocess_blur_kernel);
    baseline.point_rectification_h = board_detection.point_rectification_h.clone();
    baseline.rectified_radius = board_detection.rectified_radius;
    baseline.board_detection = std::move(board_detection);
    baseline.yolo_detection = std::move(yolo_detection);
    baseline.model_square = model_square;
    return baseline;
}

TrackedYoloFrameState BuildTrackedYoloFrameState(
    int frame_index,
    const cv::Mat& frame_bgr,
    const YoloDetectionResult& detection,
    int max_dart_count,
    bool camera_on_left) {
    TrackedYoloFrameState frame_state;
    frame_state.frame_index = frame_index;
    // Frames are never modified after capture, so sharing the buffer is safe and saves a copy.
    frame_state.frame_bgr = frame_bgr;
    std::optional<cv::Rect> detected_board_box = SelectOptionalBestBoardBox(detection, frame_bgr.size());
    if (detected_board_box.has_value()) {
        frame_state.board_box = detected_board_box.value();
        frame_state.has_board_box = true;
        frame_state.dart_search_rect = ExpandToDartSearchRect(frame_state.board_box, camera_on_left);
        frame_state.dart_search_crop_bgr = CropWithBlackPadding(frame_bgr, frame_state.dart_search_rect);
    }
    frame_state.dart_boxes = SelectTopDartBoxes(
        detection,
        max_dart_count,
        frame_state.has_board_box ? std::optional<cv::Rect>(frame_state.dart_search_rect) : std::nullopt);
    if (frame_state.has_board_box) {
        for (const YoloDetectionBox& box : detection.low_score_dart_boxes) {
            if (BoxCenterInside(box, frame_state.dart_search_rect)) {
                frame_state.low_score_dart_boxes.push_back(box);
            }
        }
    }
    frame_state.overlay_bgr = detection.overlay_bgr;
    frame_state.yolo_status = detection.execution_backend;
    if (!detection.status_detail.empty()) {
        frame_state.yolo_status += " " + detection.status_detail;
    }
    return frame_state;
}

void PushRecentFrame(std::vector<TrackedYoloFrameState>& recent_frames, TrackedYoloFrameState frame_state) {
    recent_frames.push_back(std::move(frame_state));
    while (recent_frames.size() > 3) {
        recent_frames.erase(recent_frames.begin());
    }
}

cv::Mat ResizeToTargetSize(const cv::Mat& image, const cv::Size& target_size) {
    if (image.empty()) {
        throw std::runtime_error("resize_input_empty");
    }
    if (target_size.width <= 0 || target_size.height <= 0) {
        throw std::runtime_error("resize_target_invalid");
    }
    if (image.size() == target_size) {
        return image.clone();
    }
    cv::Mat resized;
    cv::resize(image, resized, target_size, 0.0, 0.0, cv::INTER_AREA);
    return resized;
}

cv::Rect MapDetectionBoxToBoardCrop(
    const YoloDetectionBox& full_image_box,
    const cv::Rect& board_box,
    const cv::Size& target_size) {
    if (board_box.width <= 0 || board_box.height <= 0) {
        throw std::runtime_error("local_dart_box_invalid");
    }
    const float scale_x = static_cast<float>(target_size.width) / static_cast<float>(board_box.width);
    const float scale_y = static_cast<float>(target_size.height) / static_cast<float>(board_box.height);
    const float left = (full_image_box.rect.x - static_cast<float>(board_box.x)) * scale_x;
    const float top = (full_image_box.rect.y - static_cast<float>(board_box.y)) * scale_y;
    const float right = (full_image_box.rect.x + full_image_box.rect.width - static_cast<float>(board_box.x)) * scale_x;
    const float bottom = (full_image_box.rect.y + full_image_box.rect.height - static_cast<float>(board_box.y)) * scale_y;
    return ClampRectToImage(
        cv::Rect2f(left, top, right - left, bottom - top),
        target_size);
}

cv::Rect ExpandAndClampLocalRect(const cv::Rect& rect, const cv::Size& image_size) {
    const int expand_pixels = std::max(4, std::min(rect.width, rect.height) / 8);
    const int left = std::max(0, rect.x - expand_pixels);
    const int top = std::max(0, rect.y - expand_pixels);
    const int right = std::min(image_size.width, rect.x + rect.width + expand_pixels);
    const int bottom = std::min(image_size.height, rect.y + rect.height + expand_pixels);
    if (left >= right || top >= bottom) {
        throw std::runtime_error("local_dart_box_invalid");
    }
    return cv::Rect(left, top, right - left, bottom - top);
}

cv::Mat BuildLocalDiffBinary(const cv::Mat& before_local_gray, const cv::Mat& after_local_gray) {
    cv::Mat diff;
    cv::absdiff(before_local_gray, after_local_gray, diff);
    cv::Mat thresh;
    cv::threshold(diff, thresh, 30, 255, cv::THRESH_BINARY);
    return thresh;
}

// For the tip only: a thin grey barrel over a dark bed changes the blurred image by just 20-29,
// under the change threshold, so the mask stopped short of the tip. Weak change (>= 15) is kept
// where it connects to strong change (> 30): the mask follows the barrel to its front while
// isolated weak specks (wobble, noise) stay out. Only weak change that brightens counts: the
// barrel over a dark bed brightens it, while the dart's shadow only darkens and would otherwise
// lead the mask away from the dart (2026-10-21: a shadow trail became the "tip").
constexpr double kStrongTipDiff = 30.0;
constexpr double kWeakTipDiff = 15.0;

cv::Mat BuildTipDiffBinary(const cv::Mat& before_local_gray, const cv::Mat& after_local_gray) {
    cv::Mat diff;
    cv::absdiff(before_local_gray, after_local_gray, diff);
    cv::Mat brightened;
    cv::subtract(after_local_gray, before_local_gray, brightened);
    cv::Mat strong;
    cv::threshold(diff, strong, kStrongTipDiff, 255, cv::THRESH_BINARY);
    cv::Mat weak;
    cv::threshold(brightened, weak, kWeakTipDiff - 1.0, 255, cv::THRESH_BINARY);
    cv::bitwise_or(weak, strong, weak);
    cv::Mat labels;
    const int label_count = cv::connectedComponents(weak, labels, 8, CV_32S);
    std::vector<uchar> keep(static_cast<size_t>(label_count), 0);
    for (int y = 0; y < diff.rows; ++y) {
        const uchar* diff_row = diff.ptr<uchar>(y);
        const int* label_row = labels.ptr<int>(y);
        for (int x = 0; x < diff.cols; ++x) {
            if (diff_row[x] > kStrongTipDiff) {
                keep[static_cast<size_t>(label_row[x])] = 255;
            }
        }
    }
    cv::Mat result(diff.size(), CV_8U);
    for (int y = 0; y < diff.rows; ++y) {
        const int* label_row = labels.ptr<int>(y);
        uchar* result_row = result.ptr<uchar>(y);
        for (int x = 0; x < diff.cols; ++x) {
            result_row[x] = label_row[x] == 0 ? 0 : keep[static_cast<size_t>(label_row[x])];
        }
    }
    return result;
}

cv::Mat FilterSinglePixelComponents(const cv::Mat& binary_img) {
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    cv::Mat filtered = cv::Mat::zeros(binary_img.size(), CV_8U);
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area <= 1) {
            continue;
        }
        filtered.setTo(255, labels == label);
    }
    return filtered;
}

// Shot from the front left (right), dart tails stick out to the right (left), so the tip is on
// the phone's side of the dart.
// YOLO boxes often stop short of the thin, dark tip, so the comparison area reaches a third of
// the box further on the tip side.
cv::Rect ExtendTowardTip(const cv::Rect& dart_box, bool camera_on_left) {
    cv::Rect extended = dart_box;
    const int extra = dart_box.width / 3;
    if (camera_on_left) {
        extended.x -= extra;
    }
    extended.width += extra;
    return extended;
}

// The tip is the changed pixel furthest towards the phone's side.
std::optional<cv::Point> SelectTipPointFromLocalMask(
    const cv::Mat& filtered_binary,
    const cv::Rect& local_rect,
    bool camera_on_left) {
    if (filtered_binary.empty() || cv::countNonZero(filtered_binary) == 0) {
        return std::nullopt;
    }
    for (int i = 0; i < filtered_binary.cols; ++i) {
        const int x = camera_on_left ? i : filtered_binary.cols - 1 - i;
        for (int y = 0; y < filtered_binary.rows; ++y) {
            if (filtered_binary.at<uchar>(y, x) > 0) {
                return cv::Point(local_rect.x + x, local_rect.y + y);
            }
        }
    }
    return std::nullopt;
}

// Scoring edges sit outside the measured colour edges by a margin set by the player's board type
// (r = 1 is the 170 mm double edge). Steel boards score on the wire's centre, about half a wire
// beyond the colour edge, and darts land right up to it: on 1729 labelled steel-board darts a
// 1 mm margin scored 25 wrong against 7 at 0.5 mm. On the soft board a tip in a bed often reads
// up to 2.5 mm outside it while no dart outside a bed lands within 3 mm of it (the hole layout),
// so the wider margin puts more of those back: 3 wrong against 5 on 31 recorded darts near edges.
constexpr float kSteelRingEdgeOutwardShift = 0.5f / 170.0f;
constexpr float kSoftRingEdgeOutwardShift = 1.0f / 170.0f;

std::optional<MeasuredRingEdges> ScoringRingEdges(const std::optional<MeasuredRingEdges>& colour_edges, bool soft_board) {
    if (!colour_edges.has_value()) {
        return std::nullopt;
    }
    const float shift = soft_board ? kSoftRingEdgeOutwardShift : kSteelRingEdgeOutwardShift;
    MeasuredRingEdges edges = colour_edges.value();
    edges.triple_inner -= shift;
    edges.triple_outer += shift;
    edges.double_inner -= shift;
    edges.double_outer += shift;
    __android_log_print(
        ANDROID_LOG_INFO,
        "BullTrackNativeV2",
        "scoring rings (%s board): triple=%.3f-%.3f double=%.3f-%.3f",
        soft_board ? "soft" : "steel",
        edges.triple_inner,
        edges.triple_outer,
        edges.double_inner,
        edges.double_outer);
    return edges;
}

// Ring edges the Kotlin scorer expects (VirtualBoardScorer.REAL_RING_EDGES from the outer bull
// on). A board measured at setup has its own edges moved onto these ring by ring, keeping the
// angle, so the scorer needs no per-board table. The bull is not measured and stays as it is.
constexpr std::array<float, 5> kDefaultRingEdges{0.122f, 0.560f, 0.635f, 0.933f, 0.990f};

cv::Point2f MapOntoDefaultRings(const cv::Point2f& point_norm, const std::optional<MeasuredRingEdges>& measured) {
    const float radius = std::hypot(point_norm.x, point_norm.y);
    if (!measured.has_value() || radius <= kDefaultRingEdges[0]) {
        return point_norm;
    }
    const std::array<float, 5> board_edges{
        kDefaultRingEdges[0],
        measured->triple_inner,
        measured->triple_outer,
        measured->double_inner,
        measured->double_outer};
    float mapped = kDefaultRingEdges.back() + (radius - board_edges.back());
    for (size_t i = 1; i < board_edges.size(); ++i) {
        if (radius < board_edges[i]) {
            const float t = (radius - board_edges[i - 1]) / (board_edges[i] - board_edges[i - 1]);
            mapped = kDefaultRingEdges[i - 1] + t * (kDefaultRingEdges[i] - kDefaultRingEdges[i - 1]);
            break;
        }
    }
    return point_norm * (mapped / radius);
}

cv::Point2f NormalizePointFromRoundAlignedBoard(
    const cv::Point2f& point_in_round_board,
    const cv::Mat& point_rectification_h,
    float rectified_radius) {
    if (point_rectification_h.empty()) {
        throw std::runtime_error("first_frame_rectification_missing");
    }
    if (rectified_radius <= 1e-6f) {
        throw std::runtime_error("first_frame_radius_invalid");
    }
    std::vector<cv::Point2f> src_points{point_in_round_board};
    std::vector<cv::Point2f> dst_points;
    cv::perspectiveTransform(src_points, dst_points, point_rectification_h);
    if (dst_points.empty()) {
        throw std::runtime_error("point_rectification_failed");
    }
    return cv::Point2f(
        dst_points.front().x / rectified_radius,
        -dst_points.front().y / rectified_radius);
}

#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawLocalRectAndTipOnBoardImage(
    const cv::Mat& board_image_bgr,
    const cv::Rect& local_rect,
    const std::optional<cv::Point>& tip_point,
    const std::optional<cv::Point2f>& model_tip_point) {
    cv::Mat debug_image = board_image_bgr.clone();
    cv::rectangle(debug_image, local_rect, cv::Scalar(0, 255, 255), 2);
    if (tip_point.has_value()) {
        cv::circle(debug_image, tip_point.value(), 8, cv::Scalar(0, 0, 255), -1);
    }
    // The model's tip (magenta ring) next to the difference tip (red dot).
    if (model_tip_point.has_value()) {
        cv::circle(debug_image, model_tip_point.value(), 10, cv::Scalar(255, 0, 255), 2);
    }
    return debug_image;
}

cv::Mat DrawRedetectSummaryImage(
    const cv::Mat& board_image_bgr,
    const std::vector<YoloDetectionBox>& dart_boxes,
    const std::vector<std::optional<cv::Point>>& tip_points) {
    cv::Mat debug_image = board_image_bgr.clone();
    const size_t draw_count = std::min(dart_boxes.size(), tip_points.size());
    for (size_t i = 0; i < draw_count; ++i) {
        const cv::Scalar box_color = tip_points[i].has_value() ? cv::Scalar(0, 255, 0) : cv::Scalar(0, 165, 255);
        cv::rectangle(debug_image, dart_boxes[i].rect, box_color, 2);
        const std::string label = "dart" + std::to_string(static_cast<int>(i + 1));
        cv::putText(
            debug_image,
            label,
            cv::Point(static_cast<int>(dart_boxes[i].rect.x), std::max(20, static_cast<int>(dart_boxes[i].rect.y) - 6)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.6,
            box_color,
            2);
        if (tip_points[i].has_value()) {
            cv::circle(debug_image, tip_points[i].value(), 8, cv::Scalar(0, 0, 255), -1);
        } else {
            cv::putText(
                debug_image,
                "no_tip",
                cv::Point(static_cast<int>(dart_boxes[i].rect.x), std::min(debug_image.rows - 8, static_cast<int>(dart_boxes[i].rect.y + dart_boxes[i].rect.height + 18.0f))),
                cv::FONT_HERSHEY_SIMPLEX,
                0.5,
                cv::Scalar(0, 0, 255),
                2);
        }
    }
    return debug_image;
}
#endif

// Outer double edge (rectified radius 1) in mm: the image scale for sizes given in mm, and how
// far two tips lie apart in the log.
constexpr float kDoubleOuterRadiusMm = 170.0f;
// The board area, out to this rectified radius (the outer double edge is about 1.0, plus slack
// for a tip on the wire), is what darts are aligned on and the only place the board scan looks.
// A hit board swings: the wall behind it and the black padding past the image edge move
// differently, one warp cannot fit them all, and the numbers and the rim against the wall stayed
// a pixel or two off and read as change (2026-10-31).
constexpr float kBoardAreaRadius = 1.02f;
// Extra pixels around the board area's bounding box in the alignment crop.
constexpr int kAlignmentMargin = 8;

// The board area as an outline in the round's board crop (the aligned pair), and how many pixels
// make a mm there. Empty when the board rectification is missing.
struct BoardArea {
    std::vector<cv::Point> outline;
    double pixels_per_mm = 0.0;
};

BoardArea ComputeBoardArea(
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search) {
    BoardArea area;
    if (point_rectification_h.empty() || rectified_radius <= 1e-6f) {
        return area;
    }
    constexpr int kOutlinePoints = 72;
    const double radius = kBoardAreaRadius * rectified_radius;
    std::vector<cv::Point2f> rectified{cv::Point2f(0.0f, 0.0f)};
    for (int i = 0; i < kOutlinePoints; ++i) {
        const double angle = 2.0 * CV_PI * i / kOutlinePoints;
        rectified.emplace_back(static_cast<float>(radius * std::cos(angle)), static_cast<float>(radius * std::sin(angle)));
    }
    std::vector<cv::Point2f> in_pair;
    cv::perspectiveTransform(rectified, in_pair, point_rectification_h.inv());
    double radius_sum = 0.0;
    for (size_t i = 1; i < in_pair.size(); ++i) {
        const cv::Point2f point = in_pair[i] + cv::Point2f(board_offset_in_search);
        area.outline.emplace_back(cvRound(point.x), cvRound(point.y));
        radius_sum += cv::norm(in_pair[i] - in_pair[0]);
    }
    area.pixels_per_mm = radius_sum / kOutlinePoints / (kBoardAreaRadius * kDoubleOuterRadiusMm);
    return area;
}

// Alignment matches only the board: its bounding box (also about a third faster than the whole
// crop) with the board as the mask. Without a board area the whole crop is used.
BoardAlignmentArea BuildBoardAlignmentArea(const BoardArea& board_area, const cv::Size& round_board_size) {
    BoardAlignmentArea area;
    if (board_area.outline.empty()) {
        return area;
    }
    const cv::Rect bounds = cv::boundingRect(board_area.outline);
    area.rect = cv::Rect(
        bounds.x - kAlignmentMargin,
        bounds.y - kAlignmentMargin,
        bounds.width + 2 * kAlignmentMargin,
        bounds.height + 2 * kAlignmentMargin) & cv::Rect(cv::Point(0, 0), round_board_size);
    if (area.rect.area() <= 0) {
        return {};
    }
    std::vector<cv::Point> outline;
    for (const cv::Point& point : board_area.outline) {
        outline.push_back(point - area.rect.tl());
    }
    area.mask = cv::Mat::zeros(area.rect.size(), CV_8U);
    cv::fillPoly(area.mask, std::vector<std::vector<cv::Point>>{outline}, cv::Scalar(255));
    return area;
}

// Board-wide preparation shared by every dart box of the same before/after pair.
constexpr const char* kDartAlignmentMotion = "homography";
// Below this ECC score an alignment is not trusted (a hand or arm over the board, board partly out
// of frame): the frame is not used to confirm a dart. The empty board scores 0.99 or more, but
// every dart left on the board lowers the score for the rest of the round: soft darts about 0.005
// each, dark steel darts with hard shadows up to 0.02 (rendered rounds, third dart down to 0.943;
// 0.97 left real third darts waiting for good). A hand over 10% of the board scores about 0.88;
// motion blur barely lowers the score.
constexpr double kMinAlignmentCorrelation = 0.90;
// One iteration on the full-size level instead of three: each full-size iteration costs about as
// much as both coarser levels together, and starting from the half-size result the first one does
// nearly all the correcting. On 974 recorded frames (2026-10-31) it left about the same edge
// residue as three; skipping the level (0.2-0.6 px off) left ring-edge strips the board scan
// could take for a dart.
constexpr int kDartAlignmentFinestLevelIterations = 1;

// Aligns target to the template on the alignment area only, then warps the whole target: the
// crop's warp is moved to whole-image points (W = T W_crop T^-1, T the shift by the crop corner).
PyramidECCResult AlignOnBoardArea(
    const cv::Mat& template_gray,
    const cv::Mat& target_gray,
    const BoardAlignmentArea& area) {
    const auto start = std::chrono::steady_clock::now();
    g_frame_stage_times.ecc_runs += 1;
    if (area.rect.area() <= 0) {
        PyramidECCResult result = AlignPyramidEcc(
            template_gray,
            target_gray,
            3,
            kDartAlignmentMotion,
            cv::Mat(),
            kDartAlignmentFinestLevelIterations);
        g_frame_stage_times.ecc_ms += MsSince(start);
        return result;
    }
    PyramidECCResult result = AlignPyramidEcc(
        template_gray(area.rect),
        target_gray(area.rect),
        3,
        kDartAlignmentMotion,
        area.mask,
        kDartAlignmentFinestLevelIterations);
    cv::Mat shift = cv::Mat::eye(3, 3, CV_32F);
    shift.at<float>(0, 2) = static_cast<float>(area.rect.x);
    shift.at<float>(1, 2) = static_cast<float>(area.rect.y);
    cv::Mat crop_warp;
    result.warp_matrix.convertTo(crop_warp, CV_32F);
    result.warp_matrix = shift * crop_warp * shift.inv();
    result.aligned_target = WarpImageWithMatrix(target_gray, result.warp_matrix, kDartAlignmentMotion, template_gray.size());
    g_frame_stage_times.ecc_ms += MsSince(start);
    return result;
}

struct AlignedBoardPair {
    cv::Size round_board_size;
    cv::Mat before_gray_aligned;
    cv::Mat after_gray_aligned;
    // Colour view of the aligned after image, only filled while debug images are on.
    cv::Mat after_view_aligned;
    // ECC warps of the two images (inverse map, 3x3) and how well each image matched the template.
    cv::Mat before_warp;
    cv::Mat after_warp;
    double before_correlation = 0.0;
    double after_correlation = 0.0;
};

cv::Mat EnhancedBoardView(const cv::Mat& board_crop_bgr, const cv::Size& round_board_size, const PipelineConfig& config) {
    return EnhanceWarpedImage(
        ResizeToTargetSize(board_crop_bgr, round_board_size),
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
}

AlignedBoardImage AlignBoardImage(
    const cv::Mat& first_preprocessed_gray,
    const BoardAlignmentArea& alignment_area,
    const cv::Mat& board_crop_bgr,
    const PipelineConfig& config) {
    cv::Mat gray = PreprocessImage(
        EnhancedBoardView(board_crop_bgr, first_preprocessed_gray.size(), config),
        config.dart.preprocess_blur_kernel);
    // Full perspective model: a hand-held or wobbling phone changes distance and angle, not only
    // position and turn. Measured 2026-10-21: scores never below the rotation+shift model on the
    // stand (0.992-0.999) and back above 0.99 for most hand-held frames (0.96-0.98 before).
    PyramidECCResult alignment = AlignOnBoardArea(first_preprocessed_gray, gray, alignment_area);
    return AlignedBoardImage{alignment.aligned_target, alignment.warp_matrix.clone(), alignment.correlation};
}

// The frame's alignment, made on first use and kept with the frame.
const AlignedBoardImage& FrameBoardAlignment(
    const TrackedYoloFrameState& frame,
    const cv::Mat& first_preprocessed_gray,
    const BoardAlignmentArea& alignment_area,
    const PipelineConfig& config) {
    if (!frame.board_alignment->has_value()) {
        *frame.board_alignment = AlignBoardImage(first_preprocessed_gray, alignment_area, frame.dart_search_crop_bgr, config);
    }
    return frame.board_alignment->value();
}

AlignedBoardPair PairAlignedBoardImages(
    const cv::Size& round_board_size,
    const AlignedBoardImage& before,
    const AlignedBoardImage& after,
    const cv::Mat& after_board_crop_bgr,
    const PipelineConfig& config) {
    AlignedBoardPair pair;
    pair.round_board_size = round_board_size;
    pair.before_gray_aligned = before.gray_aligned;
    pair.after_gray_aligned = after.gray_aligned;
    pair.before_warp = before.warp;
    pair.after_warp = after.warp;
    pair.before_correlation = before.correlation;
    pair.after_correlation = after.correlation;
#if BT_ENABLE_DEBUG_IMAGES
    if (DebugImagesActive()) {
        pair.after_view_aligned = WarpImageWithMatrix(
            EnhancedBoardView(after_board_crop_bgr, round_board_size, config),
            after.warp,
            kDartAlignmentMotion,
            round_board_size);
    }
#endif
    return pair;
}

void CheckRoundBoardSize(const cv::Mat& first_preprocessed_gray) {
    if (first_preprocessed_gray.cols <= 0 || first_preprocessed_gray.rows <= 0) {
        throw std::runtime_error("first_frame_preprocessed_empty");
    }
}

std::optional<AlignedBoardPair> PrepareAlignedBoardPair(
    const cv::Mat& first_preprocessed_gray,
    const BoardAlignmentArea& alignment_area,
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const PipelineConfig& config) {
    CheckRoundBoardSize(first_preprocessed_gray);
    if (before_board_crop_bgr.empty() || after_board_crop_bgr.empty()) {
        return std::nullopt;
    }
    return PairAlignedBoardImages(
        first_preprocessed_gray.size(),
        AlignBoardImage(first_preprocessed_gray, alignment_area, before_board_crop_bgr, config),
        AlignBoardImage(first_preprocessed_gray, alignment_area, after_board_crop_bgr, config),
        after_board_crop_bgr,
        config);
}

// Same for two tracked frames, reusing (and keeping) each frame's alignment.
std::optional<AlignedBoardPair> PrepareAlignedBoardPair(
    const cv::Mat& first_preprocessed_gray,
    const BoardAlignmentArea& alignment_area,
    const TrackedYoloFrameState& before_frame,
    const TrackedYoloFrameState& after_frame,
    const PipelineConfig& config) {
    CheckRoundBoardSize(first_preprocessed_gray);
    if (before_frame.dart_search_crop_bgr.empty() || after_frame.dart_search_crop_bgr.empty()) {
        return std::nullopt;
    }
    const AlignedBoardImage& before = FrameBoardAlignment(before_frame, first_preprocessed_gray, alignment_area, config);
    const AlignedBoardImage& after = FrameBoardAlignment(after_frame, first_preprocessed_gray, alignment_area, config);
    return PairAlignedBoardImages(first_preprocessed_gray.size(), before, after, after_frame.dart_search_crop_bgr, config);
}

// YOLO found the dart box in the after image as captured, but the comparison runs on the
// aligned image, which ECC may have shifted or turned by a few pixels; move the box the same way
// so it still sits on the dart when the phone moved between frames.
// WARP_INVERSE_MAP: aligned(p) = image(W p), so a point q of the image lands at W^-1 q.
cv::Mat InverseOfEccWarp(const cv::Mat& ecc_warp) {
    cv::Mat warp;
    ecc_warp.convertTo(warp, CV_64F);
    if (warp.rows == 2) {
        cv::Mat full = cv::Mat::eye(3, 3, CV_64F);
        warp.copyTo(full(cv::Rect(0, 0, 3, 2)));
        warp = full;
    }
    return warp.inv();
}

cv::Rect MapDartBoxIntoAlignedPair(
    const AlignedBoardPair& pair,
    const cv::Rect& after_search_rect,
    const YoloDetectionBox& dart_box) {
    const cv::Rect box_in_crop = MapDetectionBoxToBoardCrop(dart_box, after_search_rect, pair.round_board_size);
    if (pair.after_warp.empty()) {
        return box_in_crop;
    }
    const cv::Mat inverse_warp = InverseOfEccWarp(pair.after_warp);
    const std::vector<cv::Point2f> corners{
        cv::Point2f(static_cast<float>(box_in_crop.x), static_cast<float>(box_in_crop.y)),
        cv::Point2f(static_cast<float>(box_in_crop.br().x), static_cast<float>(box_in_crop.y)),
        cv::Point2f(static_cast<float>(box_in_crop.x), static_cast<float>(box_in_crop.br().y)),
        cv::Point2f(static_cast<float>(box_in_crop.br().x), static_cast<float>(box_in_crop.br().y))};
    std::vector<cv::Point2f> moved;
    cv::perspectiveTransform(corners, moved, inverse_warp);
    return cv::boundingRect(moved) & cv::Rect(cv::Point(0, 0), pair.round_board_size);
}

// Tip of the dart inside box_in_pair (aligned-pair coordinates) from the image difference: a
// mapped YOLO box, or a changed region found by the board scan. model_tip_in_pair is only drawn.
LocalizedDartDetectionResult LocateDartTipInRegion(
    const AlignedBoardPair& pair,
    const cv::Rect& box_in_pair,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search,
    bool camera_on_left,
    int frame_index,
    const std::string& debug_prefix,
    const std::optional<cv::Point2f>& model_tip_in_pair = std::nullopt) {
    LocalizedDartDetectionResult result;
    // ChooseDartTip takes a usable model tip, so the image-difference tip is only worked out
    // without one, or with debug info on to log how far apart the two lie.
    if (model_tip_in_pair.has_value() && !DebugImagesActive()) {
        try {
            NormalizePointFromRoundAlignedBoard(
                model_tip_in_pair.value() - cv::Point2f(board_offset_in_search),
                point_rectification_h,
                rectified_radius);
            result.reason = "diff_skipped_model_tip";
            return result;
        } catch (const std::exception&) {
        }
    }
    cv::Rect local_rect;
    try {
        local_rect = ExpandAndClampLocalRect(ExtendTowardTip(box_in_pair, camera_on_left), pair.round_board_size);
    } catch (const std::exception&) {
        result.reason = "local_dart_box_invalid";
        return result;
    }

    cv::Mat before_local_gray = pair.before_gray_aligned(local_rect).clone();
    cv::Mat after_local_gray = pair.after_gray_aligned(local_rect).clone();
    cv::Mat diff_thresh = BuildTipDiffBinary(before_local_gray, after_local_gray);
    cv::Mat filtered_local = FilterSinglePixelComponents(diff_thresh);
    std::optional<cv::Point> tip_point = SelectTipPointFromLocalMask(filtered_local, local_rect, camera_on_left);

    if (cv::countNonZero(filtered_local) == 0) {
        result.reason = "local_mask_empty_after_filter";
    } else if (!tip_point.has_value()) {
        result.reason = "local_tip_not_found";
    } else {
        result.has_dart = true;
        result.point_in_round_board = tip_point;
        result.point_norm = NormalizePointFromRoundAlignedBoard(
            tip_point.value() - board_offset_in_search,
            point_rectification_h,
            rectified_radius);
        result.reason = "local_tip_resolved";
    }
#if BT_ENABLE_DEBUG_IMAGES
    if (DebugImagesActive()) {
        AppendDebugImage(result.debug_images, frame_index, debug_prefix + "1", "local_before", before_local_gray);
        AppendDebugImage(result.debug_images, frame_index, debug_prefix + "2", "local_after", after_local_gray);
        AppendDebugImage(result.debug_images, frame_index, debug_prefix + "3", "local_diff_thresh", diff_thresh);
        AppendDebugImage(result.debug_images, frame_index, debug_prefix + "4", "local_filtered", filtered_local);
        AppendDebugImage(
            result.debug_images,
            frame_index,
            debug_prefix + "5",
            "tip_marked",
            DrawTipPointOnBinaryImage(filtered_local, result.point_in_round_board));
        AppendDebugImage(
            result.debug_images,
            frame_index,
            debug_prefix + "6",
            "after_board_tip",
            DrawLocalRectAndTipOnBoardImage(
                pair.after_view_aligned,
                local_rect,
                result.point_in_round_board,
                model_tip_in_pair));
    }
#else
    (void)frame_index;
    (void)debug_prefix;
#endif
    return result;
}

LocalizedDartDetectionResult LocateDartTipInAlignedPair(
    const AlignedBoardPair& pair,
    const cv::Rect& after_search_rect,
    const YoloDetectionBox& dart_box,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search,
    bool camera_on_left,
    int frame_index,
    const std::string& debug_prefix,
    const std::optional<cv::Point2f>& model_tip_in_pair = std::nullopt) {
    return LocateDartTipInRegion(
        pair,
        MapDartBoxIntoAlignedPair(pair, after_search_rect, dart_box),
        point_rectification_h,
        rectified_radius,
        board_offset_in_search,
        camera_on_left,
        frame_index,
        debug_prefix,
        model_tip_in_pair);
}

// A model tip this sure is used; below it the tip comes from the image difference. Tips of real
// darts scored 0.98 and up on the 44 App test frames (2026-10-29).
constexpr float kMinModelTipScore = 0.5f;
// The model tip of a dart box, moved into the aligned pair the way its box is: scaled from the
// search area of the image the box came from, then through that image's ECC warp.
std::optional<cv::Point2f> ModelTipInAlignedPair(
    const cv::Size& round_board_size,
    const cv::Mat& ecc_warp,
    const cv::Rect& search_rect,
    const YoloDetectionBox& dart_box) {
    if (dart_box.tip_score < kMinModelTipScore || search_rect.width <= 0 || search_rect.height <= 0) {
        return std::nullopt;
    }
    const cv::Point2f in_crop(
        (dart_box.tip.x - static_cast<float>(search_rect.x)) * round_board_size.width / search_rect.width,
        (dart_box.tip.y - static_cast<float>(search_rect.y)) * round_board_size.height / search_rect.height);
    if (ecc_warp.empty()) {
        return in_crop;
    }
    std::vector<cv::Point2f> moved;
    cv::perspectiveTransform(std::vector<cv::Point2f>{in_crop}, moved, InverseOfEccWarp(ecc_warp));
    return moved.front();
}

// The model tip of the most likely dart box over a region the board scan found: a box under the
// count threshold, or one never confirmed, covering enough of the region. frame is the after
// image of the pair.
constexpr double kMinRegionBoxOverlap = 0.3;

std::optional<cv::Point2f> ModelTipForRegion(
    const AlignedBoardPair& pair,
    const TrackedYoloFrameState& frame,
    const cv::Rect& region_in_pair) {
    const YoloDetectionBox* best = nullptr;
    for (const std::vector<YoloDetectionBox>* boxes : {&frame.dart_boxes, &frame.low_score_dart_boxes}) {
        for (const YoloDetectionBox& box : *boxes) {
            if (box.tip_score < kMinModelTipScore || (best != nullptr && box.score <= best->score)) {
                continue;
            }
            cv::Rect box_in_pair;
            try {
                box_in_pair = MapDartBoxIntoAlignedPair(pair, frame.dart_search_rect, box);
            } catch (const std::exception&) {
                continue;
            }
            if ((box_in_pair & region_in_pair).area() >= region_in_pair.area() * kMinRegionBoxOverlap) {
                best = &box;
            }
        }
    }
    if (best == nullptr) {
        return std::nullopt;
    }
    return ModelTipInAlignedPair(pair.round_board_size, pair.after_warp, frame.dart_search_rect, *best);
}

// Model tip first, the image-difference tip when the model has none. Which one was taken, and
// how far apart the two lie (worked out only with debug info on), goes to log_text.
std::optional<cv::Point2f> ChooseDartTip(
    const LocalizedDartDetectionResult& by_difference,
    const std::optional<cv::Point2f>& model_tip_in_pair,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search,
    std::string& log_text) {
    std::optional<cv::Point2f> by_model;
    if (model_tip_in_pair.has_value()) {
        try {
            by_model = NormalizePointFromRoundAlignedBoard(
                model_tip_in_pair.value() - cv::Point2f(board_offset_in_search),
                point_rectification_h,
                rectified_radius);
        } catch (const std::exception&) {
        }
    }
    const std::optional<cv::Point2f> by_diff =
        by_difference.has_dart ? by_difference.point_norm : std::optional<cv::Point2f>();
    if (by_model.has_value() && by_diff.has_value()) {
        log_text += cv::format(" tip=model(diff %.1fmm)", cv::norm(by_model.value() - by_diff.value()) * kDoubleOuterRadiusMm);
    } else if (by_model.has_value()) {
        log_text += " tip=model(no diff)";
    } else {
        log_text += by_diff.has_value() ? " tip=diff" : " tip=none";
    }
    return by_model.has_value() ? by_model : by_diff;
}

// A dart the board scan found stuck in the board, so a tip past the outer double edge (a point
// on the default rings) means the region was something else at the board edge.
bool IsScanTipOffBoard(const cv::Point2f& point_on_default_rings) {
    return std::hypot(point_on_default_rings.x, point_on_default_rings.y) > kDefaultRingEdges.back();
}

// Below this much change in the most changed box, a rise in the YOLO count is treated as an
// extra box rather than a new dart. Rough first values; the counts go to the gate reason
// (shown with debug info) so they can be tuned from real rounds.
constexpr int kMinNewDartChangedPixels = 8;
constexpr double kMinNewDartChangedRatio = 0.005;

// After a no-change check, frames showing the same boxes skip the check for about 2 s (at ~3
// frames per second) before it runs again, which keeps a lingering duplicate box cheap.
constexpr int kPhantomSkipFrames = 6;
// Boxes this similar are taken as the same detection.
constexpr float kSameBoxMinIou = 0.5f;
// Looser match for a new dart seen in two frames in a row: small low-confidence boxes jitter.
constexpr float kSettledDartMinIou = 0.3f;
// A box YOLO lost is taken as a settled dart only if it changed this little against the previous
// frame, compared with its change against the clean frame (a landed dart may still wobble).
constexpr double kMaxStillChangeShare = 0.25;

float BoxIou(const cv::Rect2f& a, const cv::Rect2f& b) {
    const float intersection = (a & b).area();
    const float union_area = a.area() + b.area() - intersection;
    return union_area > 0.0f ? intersection / union_area : 0.0f;
}

// True when every current box pairs with its own reference box. A box anywhere else (a real new
// dart) means the board may have changed and must be checked again.
bool BoxesMatchOneToOne(
    const std::vector<YoloDetectionBox>& current,
    const std::vector<YoloDetectionBox>& reference) {
    if (reference.empty() || current.size() > reference.size()) {
        return false;
    }
    std::vector<bool> used(reference.size(), false);
    for (const YoloDetectionBox& box : current) {
        int best = -1;
        float best_iou = kSameBoxMinIou;
        for (size_t i = 0; i < reference.size(); ++i) {
            const float iou = used[i] ? 0.0f : BoxIou(box.rect, reference[i].rect);
            if (iou >= best_iou) {
                best_iou = iou;
                best = static_cast<int>(i);
            }
        }
        if (best < 0) {
            return false;
        }
        used[static_cast<size_t>(best)] = true;
    }
    return true;
}

// Frames after a confirmation that may replace the clean frame with a settled view (~0.7 s).
constexpr int kCleanRefreshFrames = 2;

// Indices of current boxes that pair with no reference box (greedy one-to-one, best IoU first).
std::vector<size_t> UnmatchedBoxIndices(
    const std::vector<YoloDetectionBox>& current,
    const std::vector<YoloDetectionBox>& reference) {
    struct Pair {
        size_t current_index;
        size_t reference_index;
        float iou;
    };
    std::vector<Pair> pairs;
    for (size_t i = 0; i < current.size(); ++i) {
        for (size_t j = 0; j < reference.size(); ++j) {
            const float iou = BoxIou(current[i].rect, reference[j].rect);
            if (iou >= kSameBoxMinIou) {
                pairs.push_back(Pair{i, j, iou});
            }
        }
    }
    std::sort(pairs.begin(), pairs.end(), [](const Pair& lhs, const Pair& rhs) {
        return lhs.iou > rhs.iou;
    });
    std::vector<bool> current_used(current.size(), false);
    std::vector<bool> reference_used(reference.size(), false);
    for (const Pair& pair : pairs) {
        if (!current_used[pair.current_index] && !reference_used[pair.reference_index]) {
            current_used[pair.current_index] = true;
            reference_used[pair.reference_index] = true;
        }
    }
    std::vector<size_t> unmatched;
    for (size_t i = 0; i < current.size(); ++i) {
        if (!current_used[i]) {
            unmatched.push_back(i);
        }
    }
    return unmatched;
}

struct BoxChange {
    int changed_pixels = 0;
    int local_area = 0;
};

// Changed pixels inside a dart box between the aligned before/after images. These are the
// blurred grayscale images, so board holes that shift by a pixel do not count as change.
BoxChange CountChangedPixelsInBox(
    const AlignedBoardPair& pair,
    const cv::Rect& after_search_rect,
    const YoloDetectionBox& dart_box) {
    cv::Rect local_rect;
    try {
        local_rect = ExpandAndClampLocalRect(
            MapDartBoxIntoAlignedPair(pair, after_search_rect, dart_box),
            pair.round_board_size);
    } catch (const std::exception&) {
        return {};
    }
    cv::Mat diff_thresh = BuildLocalDiffBinary(
        pair.before_gray_aligned(local_rect),
        pair.after_gray_aligned(local_rect));
    return {cv::countNonZero(FilterSinglePixelComponents(diff_thresh)), local_rect.area()};
}

int CountChangedPixelsInRegion(const AlignedBoardPair& pair, const cv::Rect& region) {
    const cv::Rect local_rect = region & cv::Rect(cv::Point(0, 0), pair.round_board_size);
    if (local_rect.area() <= 0) {
        return 0;
    }
    cv::Mat diff_thresh = BuildLocalDiffBinary(
        pair.before_gray_aligned(local_rect),
        pair.after_gray_aligned(local_rect));
    return cv::countNonZero(FilterSinglePixelComponents(diff_thresh));
}

// Board scan for darts YOLO never boxed (a red dart on the bull can score under 0.1 in every
// frame). It runs on a clean/current pair already aligned for a confirmation, at half size: the
// images are blurred anyway, and averaging hides one-pixel misalignment along the wires.
constexpr double kBoardScanScale = 0.5;
constexpr double kBoardScanChangeThreshold = 30.0;
// Changed area, in full-size pixels, of a region taken as a dart: real darts changed 40-1900
// pixels of their box (2026-10-21); a person's shadow or a light change covers far more.
constexpr int kMinMissedDartArea = 40;
constexpr int kMaxMissedDartArea = 6000;
// Smaller specks are noise; more pieces than this mean the whole image changed.
constexpr int kMinMissedDartPieceArea = 8;
constexpr size_t kMaxBoardScanPieces = 200;
// Regions further out than this (rectified radius) are off the board.
constexpr float kMaxMissedDartRadius = 1.05f;
// Share of a region's changed pixels that must have brightened. Darts YOLO cannot see sit on dark
// beds (a red dart on the blue/black bull) and brighten them; a shadow (the player, an arm) only
// darkens, and darkened a whole cream bed into a false dart (2026-10-21).
constexpr double kMinMissedDartBrightShare = 0.25;
// Strongest change (half-size gray difference) a missed-dart region must reach. A dart covers the
// bed with metal or a coloured flight; the misses seen so far (red darts YOLO scored low) peaked
// at 69 and 98. Leftover misalignment of the honeycomb dots only nudges the shade: the six false
// darts the scan added (cream bed tips by the bull, bed edges) peaked at 36-45 (2026-11-01).
constexpr double kMinMissedDartPeakChange = 55.0;
// Margins around known darts whose change the scan ignores: an old dart may wobble when hit; a
// dart YOLO boxed (even one not confirmed yet) also changes its shadow and its tip side.
// Shadows no longer need wide margins (a missed-dart region must brighten), and wide ones hid a
// dart YOLO never boxed that sat next to a boxed group (2026-10-21).
constexpr double kOldDartMargin = 0.3;
constexpr double kBoxedDartMargin = 0.25;
// A region belongs to a known dart when at least this share of its change lies in the known
// areas; a dart that merely touches the edge of one is still reported.
constexpr double kMinKnownShare = 0.5;
// Pieces closer than this are merged as parts of one dart (a wire gap is 1-3 mm). A fixed gap,
// not a share of the piece size: a growing region reached ever further and chained the numbers
// down the board edge into one 300 mm strip (2026-10-31).
constexpr double kPieceMergeGapMm = 8.0;
// A merged region longer than this is no dart (one spans about 70 mm in the image).
constexpr double kMaxMissedDartLengthMm = 130.0;

struct ChangeRegion {
    cv::Rect rect_in_pair;
    int area = 0;
};

cv::Rect GrowRect(const cv::Rect& rect, double share_each_side) {
    const int dx = static_cast<int>(std::lround(rect.width * share_each_side));
    const int dy = static_cast<int>(std::lround(rect.height * share_each_side));
    return cv::Rect(rect.x - dx, rect.y - dy, rect.width + 2 * dx, rect.height + 2 * dy);
}

double PeakChange(const cv::Mat& diff, const cv::Mat& changed) {
    double peak = 0.0;
    cv::minMaxLoc(diff, nullptr, &peak, nullptr, nullptr, changed);
    return peak;
}

std::vector<ChangeRegion> FindUnexplainedChangeRegions(
    const AlignedBoardPair& pair,
    const std::vector<cv::Rect>& explained_in_pair,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search) {
    const BoardArea scan_area = ComputeBoardArea(point_rectification_h, rectified_radius, board_offset_in_search);
    if (scan_area.outline.empty() || scan_area.pixels_per_mm <= 0.0) {
        return {};
    }
    cv::Mat before_small;
    cv::Mat after_small;
    cv::resize(pair.before_gray_aligned, before_small, cv::Size(), kBoardScanScale, kBoardScanScale, cv::INTER_AREA);
    cv::resize(pair.after_gray_aligned, after_small, cv::Size(), kBoardScanScale, kBoardScanScale, cv::INTER_AREA);
    cv::Mat diff;
    cv::absdiff(before_small, after_small, diff);
    cv::Mat changed;
    cv::threshold(diff, changed, kBoardScanChangeThreshold, 255, cv::THRESH_BINARY);
    cv::Mat brightened;
    cv::subtract(after_small, before_small, brightened);
    cv::threshold(brightened, brightened, kBoardScanChangeThreshold, 255, cv::THRESH_BINARY);
    cv::Mat scan_mask = cv::Mat::zeros(changed.size(), CV_8U);
    std::vector<cv::Point> outline_small;
    for (const cv::Point& point : scan_area.outline) {
        outline_small.emplace_back(cvRound(point.x * kBoardScanScale), cvRound(point.y * kBoardScanScale));
    }
    cv::fillPoly(scan_mask, std::vector<std::vector<cv::Point>>{outline_small}, cv::Scalar(255));
    cv::bitwise_and(changed, scan_mask, changed);
    cv::bitwise_and(brightened, scan_mask, brightened);
    const cv::Mat changed_raw = changed.clone();
    // Join the pieces of one dart cut apart by wires and holes.
    cv::morphologyEx(changed, changed, cv::MORPH_CLOSE, cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(5, 5)));
    cv::Mat labels;
    cv::Mat stats;
    cv::Mat centroids;
    const int label_count = cv::connectedComponentsWithStats(changed, labels, stats, centroids, 8, CV_32S);
    const double to_full = 1.0 / kBoardScanScale;
    const cv::Rect pair_bounds(cv::Point(0, 0), pair.round_board_size);
    // Pieces first, then merge the ones close enough to be parts of one dart (flight and barrel
    // separated by a wire, say); size limits apply to the merged region.
    std::vector<ChangeRegion> pieces;
    for (int label = 1; label < label_count; ++label) {
        const int area = static_cast<int>(stats.at<int>(label, cv::CC_STAT_AREA) * to_full * to_full);
        if (area < kMinMissedDartPieceArea) {
            continue;
        }
        const cv::Rect rect = cv::Rect(
            static_cast<int>(stats.at<int>(label, cv::CC_STAT_LEFT) * to_full),
            static_cast<int>(stats.at<int>(label, cv::CC_STAT_TOP) * to_full),
            static_cast<int>(std::ceil(stats.at<int>(label, cv::CC_STAT_WIDTH) * to_full)),
            static_cast<int>(std::ceil(stats.at<int>(label, cv::CC_STAT_HEIGHT) * to_full))) & pair_bounds;
        pieces.push_back(ChangeRegion{rect, area});
    }
    if (pieces.size() > kMaxBoardScanPieces) {
        // The whole image changed (light, exposure, a bad alignment): nothing here is a dart.
        __android_log_print(ANDROID_LOG_INFO, "BullTrackNativeV2", "board scan: %d pieces, skipped", static_cast<int>(pieces.size()));
        return {};
    }
    const int merge_gap = static_cast<int>(std::lround(kPieceMergeGapMm * scan_area.pixels_per_mm));
    const int max_length = static_cast<int>(std::lround(kMaxMissedDartLengthMm * scan_area.pixels_per_mm));
    for (bool merged = true; merged;) {
        merged = false;
        for (size_t i = 0; i < pieces.size() && !merged; ++i) {
            const cv::Rect& rect = pieces[i].rect_in_pair;
            const cv::Rect reach(rect.x - merge_gap, rect.y - merge_gap, rect.width + 2 * merge_gap, rect.height + 2 * merge_gap);
            for (size_t j = i + 1; j < pieces.size() && !merged; ++j) {
                if ((reach & pieces[j].rect_in_pair).area() > 0) {
                    pieces[i].rect_in_pair |= pieces[j].rect_in_pair;
                    pieces[i].area += pieces[j].area;
                    pieces.erase(pieces.begin() + static_cast<std::ptrdiff_t>(j));
                    merged = true;
                }
            }
        }
    }
    const cv::Rect small_bounds(cv::Point(0, 0), changed_raw.size());
    const auto to_small = [&](const cv::Rect& rect) {
        return cv::Rect(
            static_cast<int>(rect.x * kBoardScanScale),
            static_cast<int>(rect.y * kBoardScanScale),
            static_cast<int>(std::ceil(rect.width * kBoardScanScale)),
            static_cast<int>(std::ceil(rect.height * kBoardScanScale))) & small_bounds;
    };
    cv::Mat known_small = cv::Mat::zeros(changed_raw.size(), CV_8U);
    for (const cv::Rect& known : explained_in_pair) {
        const cv::Rect known_rect = to_small(known);
        if (known_rect.area() > 0) {
            known_small(known_rect).setTo(255);
        }
    }

    // Every region of dart size is logged with why it was dropped, to tune the rules from rounds.
    std::vector<ChangeRegion> regions;
    std::string log_text;
    for (const ChangeRegion& piece : pieces) {
        const int area = piece.area;
        const cv::Rect& rect = piece.rect_in_pair;
        if (area < kMinMissedDartArea) {
            continue;
        }
        const char* verdict = "";
        const cv::Rect rect_small = to_small(rect);
        const int changed_count = rect_small.area() > 0 ? cv::countNonZero(changed_raw(rect_small)) : 0;
        const int bright_count = rect_small.area() > 0 ? cv::countNonZero(brightened(rect_small)) : 0;
        cv::Mat known_change;
        if (rect_small.area() > 0) {
            cv::bitwise_and(changed_raw(rect_small), known_small(rect_small), known_change);
        }
        const int known_count = known_change.empty() ? 0 : cv::countNonZero(known_change);
        if (area > kMaxMissedDartArea) {
            verdict = "large";
        } else if (std::max(rect.width, rect.height) > max_length) {
            verdict = "long";
        } else if (changed_count == 0 || bright_count < changed_count * kMinMissedDartBrightShare) {
            verdict = "dark";
        } else if (PeakChange(diff(rect_small), changed_raw(rect_small)) < kMinMissedDartPeakChange) {
            verdict = "faint";
        } else if (known_count >= changed_count * kMinKnownShare) {
            verdict = "known";
        } else {
            try {
                const cv::Point center(rect.x + rect.width / 2, rect.y + rect.height / 2);
                const cv::Point2f norm = NormalizePointFromRoundAlignedBoard(
                    center - board_offset_in_search,
                    point_rectification_h,
                    rectified_radius);
                if (std::hypot(norm.x, norm.y) > kMaxMissedDartRadius) {
                    verdict = "off";
                }
            } catch (const std::exception&) {
                verdict = "off";
            }
        }
        log_text += cv::format(
            " %d@(%d,%d)%s",
            area,
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
            verdict);
        if (verdict[0] == '\0') {
            regions.push_back(ChangeRegion{rect, area});
        }
    }
    if (!log_text.empty()) {
        __android_log_print(ANDROID_LOG_INFO, "BullTrackNativeV2", "board scan candidates:%s", log_text.c_str());
    }
    std::sort(regions.begin(), regions.end(), [](const ChangeRegion& lhs, const ChangeRegion& rhs) {
        return lhs.area > rhs.area;
    });
    return regions;
}

// Areas of known darts for the scan: old darts of the clean frame, and every dart YOLO boxed in
// the given frames (confirmed now, or still waiting) with its tip side.
std::vector<cv::Rect> KnownDartAreas(
    const AlignedBoardPair& pair,
    const TrackedYoloFrameState& clean_frame,
    const std::vector<const TrackedYoloFrameState*>& boxed_frames,
    bool camera_on_left) {
    std::vector<cv::Rect> areas;
    for (const YoloDetectionBox& box : clean_frame.dart_boxes) {
        areas.push_back(GrowRect(MapDartBoxIntoAlignedPair(pair, clean_frame.dart_search_rect, box), kOldDartMargin));
    }
    for (const TrackedYoloFrameState* frame : boxed_frames) {
        for (const YoloDetectionBox& box : frame->dart_boxes) {
            const cv::Rect in_pair = MapDartBoxIntoAlignedPair(pair, frame->dart_search_rect, box);
            areas.push_back(GrowRect(ExtendTowardTip(in_pair, camera_on_left), kBoxedDartMargin));
        }
    }
    return areas;
}

// Changed regions no known dart explains that also sat still since previous_frame (not a dart
// in flight). Without a previous frame aligned well enough, nothing is reported.
std::vector<ChangeRegion> FindStillMissedDartRegions(
    const AlignedBoardPair& pair,
    const std::vector<cv::Rect>& known_areas,
    const TrackedYoloFrameState& previous_frame,
    const TrackedYoloFrameState& current_frame,
    const cv::Mat& template_gray,
    const BoardAlignmentArea& alignment_area,
    const PipelineConfig& config,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search) {
    std::vector<ChangeRegion> regions = FindUnexplainedChangeRegions(
        pair,
        known_areas,
        point_rectification_h,
        rectified_radius,
        board_offset_in_search);
    if (regions.empty()) {
        return regions;
    }
    std::optional<AlignedBoardPair> still_pair;
    try {
        still_pair = PrepareAlignedBoardPair(
            template_gray,
            alignment_area,
            previous_frame,
            current_frame,
            config);
    } catch (const std::exception&) {
    }
    std::vector<ChangeRegion> still;
    std::string log_text;
    for (const ChangeRegion& region : regions) {
        bool keep = false;
        if (still_pair.has_value() && still_pair->before_correlation >= kMinAlignmentCorrelation) {
            const int change = CountChangedPixelsInRegion(pair, region.rect_in_pair);
            const int moved = CountChangedPixelsInRegion(still_pair.value(), region.rect_in_pair);
            keep = change > 0 && moved <= change * kMaxStillChangeShare;
        }
        log_text += cv::format(
            " %d@(%d,%d)%s",
            region.area,
            region.rect_in_pair.x + region.rect_in_pair.width / 2,
            region.rect_in_pair.y + region.rect_in_pair.height / 2,
            keep ? "" : "moved");
        if (keep) {
            still.push_back(region);
        }
    }
    __android_log_print(ANDROID_LOG_INFO, "BullTrackNativeV2", "board scan regions:%s", log_text.c_str());
    return still;
}

// A settled view may replace the clean frame only if both align well and it shows no change the
// known darts do not explain: a dart YOLO cannot see landing right now would be swallowed.
bool CanRefreshCleanFrame(
    const TrackedYoloFrameState& clean_frame,
    const TrackedYoloFrameState& current_frame,
    const cv::Mat& template_gray,
    const BoardAlignmentArea& alignment_area,
    const PipelineConfig& config,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search,
    bool camera_on_left) {
    std::optional<AlignedBoardPair> pair;
    try {
        pair = PrepareAlignedBoardPair(
            template_gray,
            alignment_area,
            clean_frame,
            current_frame,
            config);
    } catch (const std::exception&) {
        return false;
    }
    if (!pair.has_value() || pair->before_correlation < kMinAlignmentCorrelation ||
        pair->after_correlation < kMinAlignmentCorrelation) {
        return false;
    }
    return FindUnexplainedChangeRegions(
        pair.value(),
        KnownDartAreas(pair.value(), clean_frame, {&current_frame}, camera_on_left),
        point_rectification_h,
        rectified_radius,
        board_offset_in_search).empty();
}

// Darts the prep check reports on the board; more than a round leaves, in case a few rounds were
// not pulled.
constexpr int kMaxPrepDarts = 9;

// Tips of the darts boxed around the board (box centre in the dart search area, as in a round,
// widened on both sides since the phone's side is not known yet), moved by offset from the
// model's input into frame coordinates.
std::vector<cv::Point> PrepDartTips(
    const YoloDetectionResult& detection,
    const cv::Rect& board_box,
    const cv::Point& offset) {
    std::vector<cv::Point> tips;
    const cv::Rect search_rect = ExpandToDartSearchRect(board_box, true) | ExpandToDartSearchRect(board_box, false);
    for (const YoloDetectionBox& box : SelectTopDartBoxes(detection, kMaxPrepDarts, search_rect)) {
        tips.push_back(cv::Point(
            static_cast<int>(std::lround(box.tip.x)),
            static_cast<int>(std::lround(box.tip.y))) + offset);
    }
    return tips;
}

}  // namespace

AndroidBullTrackSession::AndroidBullTrackSession() = default;

AndroidStartRoundResult AndroidBullTrackSession::StartRound(const cv::Mat& first_frame_bgr, bool soft_board) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("first_frame_empty");
    }

    AndroidStartRoundResult result;
    frame_stage_totals_ = FrameStageTotals();
    change_reference_.release();
    yolo_skipped_in_row_ = 0;
    yolo_frames_after_change_ = 0;
    last_frame_idle_ = false;
    first_frame_bgr_ = first_frame_bgr.clone();
    latest_frame_bgr_ = first_frame_bgr.clone();
    photo_frame_override_.reset();

    FirstFrameBoardBaseline baseline = BuildFirstFrameBoardBaseline(first_frame_bgr_, pipeline_config_);
    AppendBoardDetectionDebugImages(result.debug_images, 1, baseline.board_detection, baseline.board_crop_bgr);
    if (!baseline.board_detection.success) {
        result.error_message = baseline.board_detection.error_message;
        started_ = false;
        recent_frames_.clear();
        pending_candidate_.reset();
        return result;
    }

    first_frame_board_box_ = baseline.board_box;
    model_square_ = baseline.model_square;
    first_frame_board_crop_bgr_ = baseline.board_crop_bgr.clone();
    first_frame_preprocessed_for_alignment_ = baseline.preprocessed_gray.clone();
    first_frame_dart_search_rect_ = baseline.dart_search_rect;
    camera_on_left_ = baseline.camera_on_left;
    board_offset_in_search_ = baseline.board_box.tl() - baseline.dart_search_rect.tl();
    first_frame_point_rectification_h_ = baseline.point_rectification_h.clone();
    first_frame_rectified_radius_ = baseline.rectified_radius;
    alignment_area_ = BuildBoardAlignmentArea(
        ComputeBoardArea(first_frame_point_rectification_h_, first_frame_rectified_radius_, board_offset_in_search_),
        first_frame_preprocessed_for_alignment_.size());
    ring_edges_ = ScoringRingEdges(baseline.board_detection.measured_ring_edges, soft_board);
    recent_frames_.clear();
    pending_candidate_.reset();
    phantom_boxes_.clear();
    clean_refresh_frames_left_ = 0;
    last_confirmed_dart_count_ = static_cast<int>(SelectTopDartBoxes(baseline.yolo_detection, 3, baseline.dart_search_rect).size());
    round_start_dart_count_ = last_confirmed_dart_count_;
    result.start_dart_count = round_start_dart_count_;
    result.left_right_half_ratio = baseline.left_right_half_ratio;
    // The model was trained on boards taking 0.55-0.9 of the square's height; a board box running
    // into the square's edge is cut off where the model stops seeing. Centring the square fixes
    // that along the frame's long side but not across it.
    result.board_height_share = static_cast<float>(first_frame_board_box_.height) / static_cast<float>(model_square_.height);
    result.board_in_square = BoxClearOfSquareEdges(first_frame_board_box_, model_square_);
    result.model_square_top = model_square_.y;
    __android_log_print(
        ANDROID_LOG_INFO,
        "BullTrackNativeV2",
        "round start: darts on board=%d, left/right half ratio=%.3f (phone %s), board height share=%.3f, model square top=%d%s",
        result.start_dart_count,
        result.left_right_half_ratio,
        camera_on_left_ ? "left" : "right",
        result.board_height_share,
        model_square_.y,
        result.board_in_square ? "" : " (touches the square's edge)");
    PushRecentFrame(
        recent_frames_,
        BuildTrackedYoloFrameState(
            1,
            first_frame_bgr_,
            baseline.yolo_detection,
            3,
            camera_on_left_));
    last_clean_frame_ = recent_frames_.back();

    started_ = true;
    current_frame_index_ = 2;
    return result;
}

void AndroidBullTrackSession::ConfirmNewDarts(
    const TrackedYoloFrameState& stable_frame,
    int max_dart_count,
    bool yolo_sees_new_dart,
    AndroidFrameProcessResult& result) {
    const TrackedYoloFrameState base_frame = pending_candidate_->base_frame;
    const TrackedYoloFrameState candidate_frame = pending_candidate_->candidate_frame;
    pending_candidate_.reset();
    const auto count_darts = [&](const std::vector<std::optional<cv::Point2f>>& points,
                                 const std::vector<bool>& by_fallback) {
        result.gate_triggered = true;
        for (size_t i = 0; i < points.size(); ++i) {
            if (last_confirmed_dart_count_ >= max_dart_count) {
                break;
            }
            last_confirmed_dart_count_ += 1;
            result.detected_points.push_back(points[i]);
            result.detected_by_fallback.push_back(by_fallback[i]);
        }
        last_clean_frame_ = stable_frame;
        // The dart may still wobble in this frame; the next frames showing the same boxes replace
        // the clean frame with a settled view, so the wobble does not look like change next time.
        clean_refresh_frames_left_ = kCleanRefreshFrames;
    };

    std::optional<AlignedBoardPair> pair;
    try {
        pair = PrepareAlignedBoardPair(
            first_frame_preprocessed_for_alignment_,
            alignment_area_,
            base_frame,
            stable_frame,
            pipeline_config_);
    } catch (const std::exception& error) {
        result.gate_reason = std::string("precise_detection_failed: ") + error.what();
        if (yolo_sees_new_dart) {
            // YOLO saw one more dart in two frames in a row, so it counts; it just has no tip point.
            count_darts({std::nullopt}, {false});
        }
        return;
    }
    if (!pair.has_value()) {
        result.gate_reason = "precise_detection_failed: board_crop_empty";
        if (yolo_sees_new_dart) {
            count_darts({std::nullopt}, {false});
        }
        return;
    }
    if (pair->before_correlation < kMinAlignmentCorrelation || pair->after_correlation < kMinAlignmentCorrelation) {
        // Not trusted (shaking, blur, a hand in view): keep waiting and try again with the next frame.
        pending_candidate_ = PendingYoloCandidateState{base_frame, yolo_sees_new_dart ? stable_frame : candidate_frame};
        result.gate_reason = cv::format(
            "alignment_low ecc=%.3f/%.3f",
            pair->before_correlation,
            pair->after_correlation);
        return;
    }

    // Boxes that may hold a new dart, with the frame whose coordinates they are in.
    //  - YOLO still sees more darts: boxes of this frame that pair with no box of the clean frame
    //    (old darts keep their boxes, so they drop out even when they wobble or a new dart touches
    //    them; when every box pairs up, all boxes). Each must sit in the same place in the previous
    //    frame too: equal counts in two frames can come from different darts, and a dart in flight
    //    or falling off moves between frames.
    //  - YOLO lost the new dart in this frame (a red dart on the bull scores under 0.1 most of the
    //    time): the new boxes of the previous frame, checked on this frame's image instead. The
    //    box must have changed against the clean frame but hardly against the previous frame, so
    //    the dart was already sitting there (not in flight) and the box fits it.
    std::vector<YoloDetectionBox> candidates;
    std::vector<bool> settled;
    std::optional<AlignedBoardPair> still_pair;
    if (yolo_sees_new_dart) {
        const std::vector<YoloDetectionBox>& boxes = stable_frame.dart_boxes;
        std::vector<size_t> unmatched = UnmatchedBoxIndices(boxes, base_frame.dart_boxes);
        if (unmatched.empty()) {
            for (size_t i = 0; i < boxes.size(); ++i) {
                unmatched.push_back(i);
            }
        }
        for (size_t i : unmatched) {
            bool in_previous = false;
            for (const YoloDetectionBox& previous : candidate_frame.dart_boxes) {
                if (BoxIou(boxes[i].rect, previous.rect) >= kSettledDartMinIou) {
                    in_previous = true;
                    break;
                }
            }
            candidates.push_back(boxes[i]);
            settled.push_back(in_previous);
        }
    } else {
        for (size_t i : UnmatchedBoxIndices(candidate_frame.dart_boxes, base_frame.dart_boxes)) {
            candidates.push_back(candidate_frame.dart_boxes[i]);
            settled.push_back(true);
        }
        try {
            still_pair = PrepareAlignedBoardPair(
                first_frame_preprocessed_for_alignment_,
                alignment_area_,
                candidate_frame,
                stable_frame,
                pipeline_config_);
        } catch (const std::exception&) {
        }
        if (!still_pair.has_value() || still_pair->before_correlation < kMinAlignmentCorrelation) {
            result.gate_reason = "lost_box_not_checked";
            return;
        }
    }

    const auto min_changed = [](const BoxChange& change) {
        return std::max(
            kMinNewDartChangedPixels,
            static_cast<int>(static_cast<double>(change.local_area) * kMinNewDartChangedRatio));
    };
    struct Qualified {
        size_t index;
        BoxChange change;
    };
    std::vector<Qualified> qualified;
    BoxChange best_change;
    int settled_count = 0;
    for (size_t i = 0; i < candidates.size(); ++i) {
        if (!settled[i]) {
            continue;
        }
        settled_count += 1;
        const BoxChange change = CountChangedPixelsInBox(pair.value(), stable_frame.dart_search_rect, candidates[i]);
        best_change = change.changed_pixels > best_change.changed_pixels ? change : best_change;
        if (change.changed_pixels < min_changed(change)) {
            continue;
        }
        if (still_pair.has_value()) {
            const BoxChange moved = CountChangedPixelsInBox(still_pair.value(), stable_frame.dart_search_rect, candidates[i]);
            if (moved.changed_pixels > change.changed_pixels * kMaxStillChangeShare) {
                continue;
            }
        }
        qualified.push_back(Qualified{i, change});
    }
    const std::string change_text =
        " changed=" + std::to_string(best_change.changed_pixels) + "/" + std::to_string(best_change.local_area) +
        cv::format(" ecc=%.3f/%.3f", pair->before_correlation, pair->after_correlation);

    if (qualified.empty()) {
        if (!yolo_sees_new_dart) {
            // The lost box shows nothing new, or something still moving there: drop it.
            result.gate_reason = "lost_box_no_settled_change" + change_text;
        } else if (settled_count < static_cast<int>(candidates.size())) {
            // The settled boxes hold nothing new, but another new box has only just appeared (a
            // dart that just landed next to a duplicate box, or one still in flight): wait for it
            // instead of filing the whole box set, the new dart included, as a phantom.
            pending_candidate_ = PendingYoloCandidateState{base_frame, stable_frame};
            result.gate_reason = "new_box_moved";
        } else {
            // Nothing new on the board: YOLO drew an extra box, often a duplicate of an old dart.
            phantom_boxes_ = stable_frame.dart_boxes;
            phantom_frame_index_ = current_frame_index_;
            result.gate_reason = "yolo_count_increased_no_board_change" + change_text;
        }
        return;
    }

    // Most changed first. Boxes overlapping a chosen dart belong to it: YOLO sometimes splits one
    // dart into overlapping boxes, each holding part of it, so the tip is looked for in their union.
    // A further dart (two thrown before the first was confirmed) must also stay clear of every old
    // dart's box, so a duplicate box of an old dart nudged by the new one is not counted again.
    std::sort(qualified.begin(), qualified.end(), [](const Qualified& lhs, const Qualified& rhs) {
        return lhs.change.changed_pixels > rhs.change.changed_pixels;
    });
    const auto overlaps = [](const cv::Rect2f& a, const cv::Rect2f& b) {
        return (a & b).area() > 0.0f;
    };
    std::vector<YoloDetectionBox> new_dart_boxes;
    for (const Qualified& item : qualified) {
        const YoloDetectionBox& box = candidates[item.index];
        bool taken = false;
        for (const YoloDetectionBox& chosen : new_dart_boxes) {
            taken = taken || overlaps(box.rect, chosen.rect);
        }
        if (taken) {
            continue;
        }
        if (!new_dart_boxes.empty()) {
            bool near_old_dart = false;
            for (const YoloDetectionBox& old_box : base_frame.dart_boxes) {
                near_old_dart = near_old_dart || overlaps(box.rect, old_box.rect);
            }
            if (near_old_dart) {
                continue;
            }
        }
        // The model tip stays the chosen box's own; a merged part's tip only stands in when the
        // chosen box has none (an overlapping box may also be a second new dart).
        YoloDetectionBox merged = box;
        for (const YoloDetectionBox& other : candidates) {
            if (overlaps(other.rect, merged.rect)) {
                merged.rect = merged.rect | other.rect;
                if (merged.tip_score < kMinModelTipScore && other.tip_score > merged.tip_score) {
                    merged.tip = other.tip;
                    merged.tip_score = other.tip_score;
                }
            }
        }
        new_dart_boxes.push_back(merged);
    }
    const int remaining = std::max(0, max_dart_count - last_confirmed_dart_count_);
    if (static_cast<int>(new_dart_boxes.size()) > remaining) {
        new_dart_boxes.resize(static_cast<size_t>(remaining));
    }
    // Darts YOLO never boxed (none in this frame, the previous one or the clean one), found on
    // the same aligned pair; they would otherwise go into the new clean frame and be lost.
    std::vector<ChangeRegion> missed_regions;
    if (static_cast<int>(new_dart_boxes.size()) < remaining) {
        missed_regions = FindStillMissedDartRegions(
            pair.value(),
            KnownDartAreas(pair.value(), base_frame, {&stable_frame, &candidate_frame}, camera_on_left_),
            candidate_frame,
            stable_frame,
            first_frame_preprocessed_for_alignment_,
            alignment_area_,
            pipeline_config_,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_);
        const size_t room = static_cast<size_t>(remaining) - new_dart_boxes.size();
        if (missed_regions.size() > room) {
            missed_regions.resize(room);
        }
    }

    std::vector<std::optional<cv::Point2f>> points;
    std::vector<bool> by_fallback;
    std::string tip_text;
    for (size_t i = 0; i < new_dart_boxes.size(); ++i) {
        // The box (and its model tip) is from this frame, or from the previous frame when YOLO
        // lost the dart here; the previous frame was aligned for the stillness check, and the dart
        // sat still since, so its tip there is where it landed.
        const std::optional<cv::Point2f> model_tip = yolo_sees_new_dart
            ? ModelTipInAlignedPair(pair->round_board_size, pair->after_warp, stable_frame.dart_search_rect, new_dart_boxes[i])
            : ModelTipInAlignedPair(still_pair->round_board_size, still_pair->before_warp, candidate_frame.dart_search_rect, new_dart_boxes[i]);
#if BT_ENABLE_DEBUG_IMAGES
        if (DebugImagesActive()) {
            AppendDebugImage(
                result.gate_debug_images,
                current_frame_index_,
                i == 0 ? std::string("s13") : cv::format("s13%c", static_cast<char>('a' + i)),
                "gate_yolo_confirmed",
                DrawFrameOverlayWithHighlightedNewBox(
                    yolo_sees_new_dart ? stable_frame.frame_bgr : candidate_frame.frame_bgr,
                    yolo_sees_new_dart ? stable_frame.dart_boxes : candidate_frame.dart_boxes,
                    new_dart_boxes[i],
                    yolo_sees_new_dart ? "most_changed_box" : "lost_box_checked_on_image"));
        }
#endif
        LocalizedDartDetectionResult localized = LocateDartTipInAlignedPair(
            pair.value(),
            stable_frame.dart_search_rect,
            new_dart_boxes[i],
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            camera_on_left_,
            current_frame_index_,
            i == 0 ? std::string("s3") : cv::format("s3%c", static_cast<char>('a' + i)),
            model_tip);
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.precise_debug_images));
        const std::optional<cv::Point2f> tip = ChooseDartTip(
            localized,
            model_tip,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            tip_text);
        points.push_back(tip.has_value() ? std::optional<cv::Point2f>(MapOntoDefaultRings(tip.value(), ring_edges_)) : std::nullopt);
        by_fallback.push_back(!yolo_sees_new_dart);
    }
    for (size_t i = 0; i < missed_regions.size(); ++i) {
        const std::optional<cv::Point2f> model_tip = ModelTipForRegion(pair.value(), stable_frame, missed_regions[i].rect_in_pair);
        LocalizedDartDetectionResult localized = LocateDartTipInRegion(
            pair.value(),
            missed_regions[i].rect_in_pair,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            camera_on_left_,
            current_frame_index_,
            cv::format("s3m%c", static_cast<char>('a' + i)),
            model_tip);
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.precise_debug_images));
        const std::optional<cv::Point2f> tip = ChooseDartTip(
            localized,
            model_tip,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            tip_text);
        const std::optional<cv::Point2f> point = tip.has_value() ? std::optional<cv::Point2f>(MapOntoDefaultRings(tip.value(), ring_edges_)) : std::nullopt;
        if (point.has_value() && IsScanTipOffBoard(point.value())) {
            tip_text += "(off board, dropped)";
            continue;
        }
        points.push_back(point);
        by_fallback.push_back(true);
    }
    result.gate_reason = std::string(yolo_sees_new_dart ? "trigger_precise_detection" : "trigger_lost_box_on_image") +
        change_text + cv::format(" darts=%d missed=%d", static_cast<int>(points.size()), static_cast<int>(missed_regions.size())) +
        tip_text;
    count_darts(points, by_fallback);
}

AndroidFrameProcessResult AndroidBullTrackSession::ProcessFrame(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round_not_started");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("frame_empty");
    }

    // Adds this frame's stage times to the round's totals on every way out.
    struct StageTimesGuard {
        FrameStageTotals& totals;
        std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
        ~StageTimesGuard() {
            const FrameStageTimes& frame = g_frame_stage_times;
            const double total_ms = MsSince(start);
            totals.frames += 1;
            totals.total_ms += total_ms;
            totals.total_max_ms = std::max(totals.total_max_ms, total_ms);
            totals.yolo_ms += frame.yolo_ms;
            totals.yolo_max_ms = std::max(totals.yolo_max_ms, frame.yolo_ms);
            totals.ecc_ms += frame.ecc_ms;
            totals.ecc_max_ms = std::max(totals.ecc_max_ms, frame.ecc_ms);
            totals.ecc_runs += frame.ecc_runs;
            totals.jpeg_ms += frame.jpeg_ms;
            totals.jpeg_max_ms = std::max(totals.jpeg_max_ms, frame.jpeg_ms);
            totals.change_ms += frame.change_ms;
            totals.yolo_skipped += frame.yolo_skipped ? 1 : 0;
        }
    } stage_times_guard{frame_stage_totals_};
    g_frame_stage_times = FrameStageTimes();

    latest_frame_bgr_ = frame_bgr;
    AndroidFrameProcessResult result;

    // While nothing happens (no dart waiting to be confirmed, no box under review, the last frame
    // idle), a frame whose model square has not changed since the last frame YOLO ran on skips it.
    const auto change_start = std::chrono::steady_clock::now();
    cv::Mat change_image = PrepareChangeImage(latest_frame_bgr_, model_square_);
    const bool may_skip_yolo = last_frame_idle_ && !pending_candidate_.has_value() &&
        clean_refresh_frames_left_ == 0 && phantom_boxes_.empty() && yolo_frames_after_change_ == 0 &&
        yolo_skipped_in_row_ < kMaxSkippedFramesInRow && change_reference_.size() == change_image.size();
    const int changed_patch = may_skip_yolo ? LargestChangedPatch(change_reference_, change_image) : -1;
    g_frame_stage_times.change_ms = MsSince(change_start);
    if (may_skip_yolo && changed_patch < kMinChangedPatchArea) {
        yolo_skipped_in_row_ += 1;
        g_frame_stage_times.yolo_skipped = true;
        result.gate_reason = "yolo_skipped_unchanged";
#if BT_ENABLE_DEBUG_IMAGES
        if (DebugImagesActive()) {
            __android_log_print(
                ANDROID_LOG_INFO,
                "BullTrackNativeV2",
                "frame %d unchanged (patch %d), YOLO skipped",
                current_frame_index_,
                changed_patch);
        }
#endif
        current_frame_index_ += 1;
        return result;
    }
    if (changed_patch >= kMinChangedPatchArea) {
        yolo_frames_after_change_ = kYoloFramesAfterChange;
    } else if (yolo_frames_after_change_ > 0) {
        yolo_frames_after_change_ -= 1;
    }
    yolo_skipped_in_row_ = 0;
    change_reference_ = change_image;

    YoloDetectionResult yolo_detection;
    try {
        const auto yolo_start = std::chrono::steady_clock::now();
        yolo_detection = DetectYoloObjects(latest_frame_bgr_, model_square_);
        g_frame_stage_times.yolo_ms = MsSince(yolo_start);
    } catch (const std::exception& error) {
        result.gate_reason = std::string("yolo_detect_failed: ") + error.what();
        last_frame_idle_ = false;
        current_frame_index_ += 1;
        return result;
    }

    const int max_dart_count = round_start_dart_count_ + 3;
    // Room for two new darts (one thrown before the other was confirmed) and one phantom box, so a
    // phantom cannot crowd out a real new dart.
    const int max_candidate_count = std::min(max_dart_count + 1, last_confirmed_dart_count_ + 3);
    TrackedYoloFrameState current_frame_state = BuildTrackedYoloFrameState(
        current_frame_index_,
        latest_frame_bgr_,
        yolo_detection,
        max_candidate_count,
        camera_on_left_);
#if BT_ENABLE_DEBUG_IMAGES
    if (!current_frame_state.overlay_bgr.empty()) {
        AppendDebugImage(
            result.gate_debug_images,
            current_frame_index_,
            "s12",
            "gate_yolo_current",
            current_frame_state.overlay_bgr);
    }
#endif

    const int current_count = static_cast<int>(current_frame_state.dart_boxes.size());
    PushRecentFrame(recent_frames_, current_frame_state);
    const TrackedYoloFrameState& stored_current = recent_frames_.back();

#if BT_ENABLE_DEBUG_IMAGES
    // Debug only: the YOLO dart count of every frame, to see why a confirmation came late, and the
    // scores of darts YOLO saw on the board but below the threshold, to choose the threshold.
    if (DebugImagesActive()) {
        std::string low_scores;
        for (const YoloDetectionBox& box : yolo_detection.low_score_dart_boxes) {
            if (stored_current.has_board_box && BoxCenterInside(box, stored_current.dart_search_rect)) {
                low_scores += cv::format(
                    " %.2f@(%d,%d)",
                    box.score,
                    static_cast<int>(box.rect.x + box.rect.width * 0.5f),
                    static_cast<int>(box.rect.y + box.rect.height * 0.5f));
            }
        }
        __android_log_print(
            ANDROID_LOG_INFO,
            "BullTrackNativeV2",
            "frame %d darts=%d board=%d change=%d low=[%s ]",
            current_frame_index_,
            current_count,
            stored_current.has_board_box ? 1 : 0,
            changed_patch,
            low_scores.c_str());
    }
#endif

    if (clean_refresh_frames_left_ > 0) {
        clean_refresh_frames_left_ -= 1;
        // Only a frame that still shows exactly the confirmed darts (no box elsewhere), aligns well
        // (no hand in view, no blur) and shows no unexplained change may stand in.
        if (!pending_candidate_.has_value() && stored_current.has_board_box && last_clean_frame_.has_value() &&
            current_count >= last_confirmed_dart_count_ &&
            BoxesMatchOneToOne(stored_current.dart_boxes, last_clean_frame_->dart_boxes) &&
            CanRefreshCleanFrame(
                last_clean_frame_.value(),
                stored_current,
                first_frame_preprocessed_for_alignment_,
                alignment_area_,
                pipeline_config_,
                first_frame_point_rectification_h_,
                first_frame_rectified_radius_,
                board_offset_in_search_,
                camera_on_left_)) {
            last_clean_frame_ = stored_current;
        }
    }

    if (current_count <= last_confirmed_dart_count_) {
        phantom_boxes_.clear();
        if (pending_candidate_.has_value() && pending_candidate_->base_frame.has_board_box &&
            pending_candidate_->candidate_frame.has_board_box && stored_current.has_board_box) {
            // YOLO lost the new dart in this frame: check its box from the previous frame on this
            // frame's image instead of dropping it.
            ConfirmNewDarts(stored_current, max_dart_count, false, result);
        } else {
            pending_candidate_.reset();
            result.gate_reason = "yolo_count_not_increased";
        }
    } else if (current_frame_index_ - phantom_frame_index_ <= kPhantomSkipFrames &&
               BoxesMatchOneToOne(stored_current.dart_boxes, phantom_boxes_)) {
        // Same boxes as a frame already checked with no change on the board.
        pending_candidate_.reset();
        result.gate_reason = "yolo_phantom_box_ignored";
    } else if (!pending_candidate_.has_value()) {
        // Compare against the frame of the last confirmation (or the empty board), not a frame
        // picked by box count: YOLO often misses a low-confidence dart (one in the bull, say)
        // for a frame or two, and such a frame may already hold the new dart.
        if (!last_clean_frame_.has_value()) {
            result.gate_reason = "yolo_count_not_increased";
        } else {
            pending_candidate_ = PendingYoloCandidateState{
                last_clean_frame_.value(),
                stored_current
            };
            result.gate_reason = "yolo_count_increased_wait_next_frame";
        }
    } else {
        const int candidate_count = static_cast<int>(pending_candidate_->candidate_frame.dart_boxes.size());
        if (current_count < candidate_count) {
            // YOLO often flickers by one box (a dart split in two, a flight seen as a dart), so
            // 4-3-4-3 boxes would restart the wait forever; this frame still shows more darts than
            // confirmed, so let it be the candidate and check it against the next frame.
            pending_candidate_->candidate_frame = stored_current;
            result.gate_reason = "yolo_count_increased_wait_next_frame";
        } else if (!pending_candidate_->base_frame.has_board_box || !stored_current.has_board_box) {
            pending_candidate_.reset();
            result.gate_reason = "yolo_detect_failed: precise_board_box_missing";
        } else {
            ConfirmNewDarts(stored_current, max_dart_count, true, result);
        }
    }

    last_frame_idle_ = result.gate_reason == "yolo_count_not_increased";
    current_frame_index_ += 1;

    return result;
}

std::string AndroidBullTrackSession::DescribeFrameStageTimes() const {
    const FrameStageTotals& t = frame_stage_totals_;
    if (t.frames == 0) {
        return "no frames";
    }
    char text[256];
    std::snprintf(
        text,
        sizeof(text),
        "native avg %.0f max %.0f ms: YOLO avg %.0f max %.0f ms, ECC avg %.0f max %.0f ms (%d runs), "
        "debug JPEG avg %.0f max %.0f ms, change check avg %.1f ms, YOLO skipped on %d of %d frames",
        t.total_ms / t.frames,
        t.total_max_ms,
        t.yolo_ms / t.frames,
        t.yolo_max_ms,
        t.ecc_ms / t.frames,
        t.ecc_max_ms,
        t.ecc_runs,
        t.jpeg_ms / t.frames,
        t.jpeg_max_ms,
        t.change_ms / t.frames,
        t.yolo_skipped,
        t.frames);
    return text;
}

AndroidRedetectResult AndroidBullTrackSession::FindMissedDartsAtEnd() {
    AndroidRedetectResult result;
    result.yolo_status = "board_scan";
    const int remaining = round_start_dart_count_ + 3 - last_confirmed_dart_count_;
    if (!started_ || remaining <= 0 || recent_frames_.size() < 2 || !last_clean_frame_.has_value()) {
        return result;
    }
    const TrackedYoloFrameState& current = recent_frames_.back();
    const TrackedYoloFrameState& previous = recent_frames_[recent_frames_.size() - 2];
    if (!current.has_board_box || !previous.has_board_box || !last_clean_frame_->has_board_box) {
        return result;
    }
    std::optional<AlignedBoardPair> pair;
    try {
        pair = PrepareAlignedBoardPair(
            first_frame_preprocessed_for_alignment_,
            alignment_area_,
            last_clean_frame_.value(),
            current,
            pipeline_config_);
    } catch (const std::exception&) {
        return result;
    }
    if (!pair.has_value() || pair->before_correlation < kMinAlignmentCorrelation ||
        pair->after_correlation < kMinAlignmentCorrelation) {
        return result;
    }
    // Only the confirmed darts are known here: a dart YOLO boxed but never confirmed counts too.
    std::vector<ChangeRegion> regions = FindStillMissedDartRegions(
        pair.value(),
        KnownDartAreas(pair.value(), last_clean_frame_.value(), {}, camera_on_left_),
        previous,
        current,
        first_frame_preprocessed_for_alignment_,
        alignment_area_,
        pipeline_config_,
        first_frame_point_rectification_h_,
        first_frame_rectified_radius_,
        board_offset_in_search_);
    if (static_cast<int>(regions.size()) > remaining) {
        regions.resize(static_cast<size_t>(remaining));
    }
    std::string tip_text;
    int found_count = 0;
    for (size_t i = 0; i < regions.size(); ++i) {
        const std::optional<cv::Point2f> model_tip = ModelTipForRegion(pair.value(), current, regions[i].rect_in_pair);
        LocalizedDartDetectionResult localized = LocateDartTipInRegion(
            pair.value(),
            regions[i].rect_in_pair,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            camera_on_left_,
            current_frame_index_,
            cv::format("s3e%c", static_cast<char>('a' + i)),
            model_tip);
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.debug_images));
        const std::optional<cv::Point2f> tip = ChooseDartTip(
            localized,
            model_tip,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            tip_text);
        if (tip.has_value()) {
            const cv::Point2f point = MapOntoDefaultRings(tip.value(), ring_edges_);
            if (IsScanTipOffBoard(point)) {
                tip_text += "(off board, dropped)";
                continue;
            }
            result.points.push_back(point);
        }
        found_count += 1;
    }
    if (!tip_text.empty()) {
        __android_log_print(ANDROID_LOG_INFO, "BullTrackNativeV2", "end board scan:%s", tip_text.c_str());
    }
    if (found_count > 0) {
        // YOLO never boxed the darts found here, so the photo has no close-up.
        photo_frame_override_ = current;
        photo_frame_override_->dart_boxes.clear();
    }
    last_confirmed_dart_count_ += found_count;
    return result;
}

AndroidRedetectResult AndroidBullTrackSession::RedetectRound(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round_not_started");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("redetect_frame_empty");
    }
    latest_frame_bgr_ = frame_bgr;
    AndroidRedetectResult result;
    result.yolo_status = "not_run";

    try {
        YoloDetectionResult yolo_detection = DetectYoloObjects(latest_frame_bgr_, model_square_);
        result.yolo_status = "ok (" + yolo_detection.execution_backend + ")";
        if (!yolo_detection.status_detail.empty()) {
            result.yolo_status += " " + yolo_detection.status_detail;
        }
        std::optional<cv::Rect> after_board_box = SelectOptionalBestBoardBox(yolo_detection, latest_frame_bgr_.size());
#if BT_ENABLE_DEBUG_IMAGES
        if (!yolo_detection.overlay_bgr.empty()) {
            AppendDebugImage(
                result.debug_images,
                current_frame_index_,
                "s90",
                "yolo_redetect_overlay",
                yolo_detection.overlay_bgr);
        }
#endif
        if (!after_board_box.has_value()) {
            result.points.clear();
            result.yolo_status += " board_missing";
            return result;
        }
        const cv::Rect after_search_rect = ExpandToDartSearchRect(after_board_box.value(), camera_on_left_);

        std::vector<YoloDetectionBox> top_dart_boxes = SelectTopDartBoxes(yolo_detection, 3, after_search_rect);
        if (top_dart_boxes.empty()) {
            result.yolo_status += " no_dart_boxes";
#if BT_ENABLE_DEBUG_IMAGES
            if (DebugImagesActive()) {
                cv::Mat after_board_crop_bgr = CropWithBlackPadding(latest_frame_bgr_, after_search_rect);
                cv::Mat after_board_resized = ResizeToTargetSize(after_board_crop_bgr, first_frame_preprocessed_for_alignment_.size());
                cv::Mat after_board_view = EnhanceWarpedImage(
                    after_board_resized,
                    pipeline_config_.enhancement.saturation_scale,
                    pipeline_config_.enhancement.contrast_scale);
                AppendDebugImage(
                    result.debug_images,
                    current_frame_index_,
                    "s96",
                    "redetect_board_summary",
                    after_board_view);
            }
#endif
            return result;
        }

        cv::Mat before_board_crop_bgr = CropWithBlackPadding(first_frame_bgr_, first_frame_dart_search_rect_);
        cv::Mat after_board_crop_bgr = CropWithBlackPadding(latest_frame_bgr_, after_search_rect);
        std::vector<std::optional<cv::Point>> summary_points;
        summary_points.reserve(top_dart_boxes.size());

        // The board-wide preparation (resize, enhance, blur, two ECC alignments) only depends on
        // the before/after pair, so it runs once and every dart box reuses it.
        std::optional<AlignedBoardPair> aligned_pair = PrepareAlignedBoardPair(
            first_frame_preprocessed_for_alignment_,
            alignment_area_,
            before_board_crop_bgr,
            after_board_crop_bgr,
            pipeline_config_);
        std::string tip_text;
        for (size_t i = 0; aligned_pair.has_value() && i < top_dart_boxes.size(); ++i) {
            const std::string prefix = "s9" + std::to_string(static_cast<int>(i + 1));
            const std::optional<cv::Point2f> model_tip = ModelTipInAlignedPair(
                aligned_pair->round_board_size,
                aligned_pair->after_warp,
                after_search_rect,
                top_dart_boxes[i]);
            LocalizedDartDetectionResult localized = LocateDartTipInAlignedPair(
                aligned_pair.value(),
                after_search_rect,
                top_dart_boxes[i],
                first_frame_point_rectification_h_,
                first_frame_rectified_radius_,
                board_offset_in_search_,
                camera_on_left_,
                current_frame_index_,
                prefix,
                model_tip);
            summary_points.push_back(localized.point_in_round_board);
            const std::optional<cv::Point2f> tip = ChooseDartTip(
                localized,
                model_tip,
                first_frame_point_rectification_h_,
                first_frame_rectified_radius_,
                board_offset_in_search_,
                tip_text);
            if (tip.has_value()) {
                result.points.push_back(MapOntoDefaultRings(tip.value(), ring_edges_));
            }
            std::move(
                localized.debug_images.begin(),
                localized.debug_images.end(),
                std::back_inserter(result.debug_images));
        }
        if (!tip_text.empty()) {
            __android_log_print(ANDROID_LOG_INFO, "BullTrackNativeV2", "redetect:%s", tip_text.c_str());
        }
        TrackedYoloFrameState photo_frame;
        photo_frame.frame_bgr = latest_frame_bgr_;
        photo_frame.dart_boxes = top_dart_boxes;
        photo_frame_override_ = std::move(photo_frame);

#if BT_ENABLE_DEBUG_IMAGES
        if (DebugImagesActive()) {
            cv::Mat after_board_resized = ResizeToTargetSize(after_board_crop_bgr, first_frame_preprocessed_for_alignment_.size());
            cv::Mat after_board_view = EnhanceWarpedImage(
                after_board_resized,
                pipeline_config_.enhancement.saturation_scale,
                pipeline_config_.enhancement.contrast_scale);
            std::vector<YoloDetectionBox> summary_boxes;
            summary_boxes.reserve(top_dart_boxes.size());
            const float scale_x = static_cast<float>(after_board_view.cols) / static_cast<float>(after_search_rect.width);
            const float scale_y = static_cast<float>(after_board_view.rows) / static_cast<float>(after_search_rect.height);
            for (const YoloDetectionBox& dart_box : top_dart_boxes) {
                YoloDetectionBox scaled_box = dart_box;
                scaled_box.rect = cv::Rect2f(
                    (dart_box.rect.x - static_cast<float>(after_search_rect.x)) * scale_x,
                    (dart_box.rect.y - static_cast<float>(after_search_rect.y)) * scale_y,
                    dart_box.rect.width * scale_x,
                    dart_box.rect.height * scale_y);
                summary_boxes.push_back(scaled_box);
            }
            AppendDebugImage(
                result.debug_images,
                current_frame_index_,
                "s96",
                "redetect_board_summary",
                DrawRedetectSummaryImage(after_board_view, summary_boxes, summary_points));
        }
#endif
    } catch (const std::exception& error) {
        result.yolo_status = std::string("error: ") + error.what();
    }

    return result;
}

RoundPhotoSource AndroidBullTrackSession::TakePhotoSource() const {
    if (!started_) {
        throw std::runtime_error("round_not_started");
    }
    const TrackedYoloFrameState* frame = photo_frame_override_.has_value() ? &photo_frame_override_.value()
        : last_clean_frame_.has_value()                                    ? &last_clean_frame_.value()
                                                                           : nullptr;
    std::vector<cv::Rect2f> dart_boxes;
    if (frame != nullptr) {
        for (const YoloDetectionBox& box : frame->dart_boxes) {
            dart_boxes.push_back(box.rect);
        }
    }
    return MakeRoundPhotoSource(
        frame != nullptr ? frame->frame_bgr : first_frame_bgr_,
        first_frame_board_box_,
        first_frame_point_rectification_h_,
        first_frame_rectified_radius_,
        std::move(dart_boxes));
}

PrepBoardGuide DetectPrepBoard(const cv::Mat& frame_bgr) {
    if (frame_bgr.empty()) {
        throw std::runtime_error("prep_frame_empty");
    }
    constexpr double kBandHeightPerWidth = 1400.0 / 1080.0;
    const int band_height = std::min(
        frame_bgr.rows,
        static_cast<int>(std::lround(frame_bgr.cols * kBandHeightPerWidth)));
    PrepBoardGuide guide;
    guide.band = cv::Rect(0, (frame_bgr.rows - band_height) / 2, frame_bgr.cols, band_height);
    const int side = std::max(guide.band.width, guide.band.height);
    const int pad_x = (side - guide.band.width) / 2;
    const int pad_y = (side - guide.band.height) / 2;
    cv::Mat square;
    // Grey as in the model's training letterbox.
    cv::copyMakeBorder(
        frame_bgr(guide.band),
        square,
        pad_y,
        side - guide.band.height - pad_y,
        pad_x,
        side - guide.band.width - pad_x,
        cv::BORDER_CONSTANT,
        cv::Scalar(114, 114, 114));
    const YoloDetectionResult detection = DetectYoloObjects(square);
    const std::optional<cv::Rect> box = SelectOptionalBestBoardBox(detection, square.size());
    if (box.has_value()) {
        const cv::Point offset = guide.band.tl() - cv::Point(pad_x, pad_y);
        const cv::Rect in_frame = (box.value() + offset) & guide.band;
        if (in_frame.area() > 0) {
            guide.board_box = in_frame;
            guide.dart_tips = PrepDartTips(detection, box.value(), offset);
        }
    }
    if (!guide.board_box.has_value()) {
        // A small board shrinks to a quarter of the band's input or less, where the model stops
        // finding it (2026-10-31: boards 0.29-0.33 of the frame width were missed in the band and
        // found in a centre crop 3/4 of the width, scores 0.98-0.99). Only a box clear of the
        // crop's edges is taken, as one at an edge may be cut off.
        const int crop_side = std::min(frame_bgr.cols, frame_bgr.rows) * 3 / 4;
        const cv::Rect crop(
            (frame_bgr.cols - crop_side) / 2,
            (frame_bgr.rows - crop_side) / 2,
            crop_side,
            crop_side);
        const YoloDetectionResult small_detection = DetectYoloObjects(frame_bgr(crop));
        const std::optional<cv::Rect> small_box = SelectOptionalBestBoardBox(small_detection, crop.size());
        if (small_box.has_value() && BoxClearOfSquareEdges(small_box.value(), cv::Rect(cv::Point(), crop.size()))) {
            guide.board_box = small_box.value() + crop.tl();
            guide.dart_tips = PrepDartTips(small_detection, small_box.value(), crop.tl());
        }
    }
    return guide;
}

}  // namespace bulltrack
