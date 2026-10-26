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
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <utility>

namespace bulltrack {
namespace {

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
};

#if BT_ENABLE_DEBUG_IMAGES
std::vector<std::uint8_t> EncodeJpegBytes(const cv::Mat& image) {
    std::vector<std::uint8_t> buffer;
    std::vector<int> params{cv::IMWRITE_JPEG_QUALITY, 95};
    if (!cv::imencode(".jpg", image, buffer, params)) {
        throw std::runtime_error("调试图 JPEG 编码失败");
    }
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
        throw std::runtime_error("首帧 board 框无效");
    }
    return cv::Rect(left, top, right - left, bottom - top);
}

cv::Mat CropBoardByRect(const cv::Mat& image, const cv::Rect& rect) {
    if (image.empty()) {
        throw std::runtime_error("输入图为空，无法裁剪 board 区域");
    }
    if (rect.width <= 0 || rect.height <= 0) {
        throw std::runtime_error("board 裁剪区域无效");
    }
    return image(rect).clone();
}

// Dart detection looks at the board box widened on every side, more on the right: shot from the
// left at an angle, a dart near the right edge (or one in the miss ring) sticks out of the board
// box and was cut off, sometimes entirely. Board fitting keeps the plain board box.
constexpr double kDartSearchMarginLeft = 0.10;
constexpr double kDartSearchMarginRight = 0.25;
constexpr double kDartSearchMarginTop = 0.10;
constexpr double kDartSearchMarginBottom = 0.10;

cv::Rect ExpandToDartSearchRect(const cv::Rect& board_box) {
    const int left = static_cast<int>(std::lround(board_box.width * kDartSearchMarginLeft));
    const int right = static_cast<int>(std::lround(board_box.width * kDartSearchMarginRight));
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
        throw std::runtime_error("首帧未检测到 board");
    }
    return board_box.value();
}

FirstFrameBoardBaseline BuildFirstFrameBoardBaseline(
    const cv::Mat& first_frame_bgr,
    const PipelineConfig& pipeline_config) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("首帧为空");
    }

    YoloDetectionResult yolo_detection = DetectYoloObjects(first_frame_bgr);
    const cv::Rect board_box = SelectBestBoardBox(yolo_detection, first_frame_bgr.size());
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
    // Darts are aligned and compared in the widened search area, so the template covers it too.
    baseline.dart_search_rect = ExpandToDartSearchRect(board_box);
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
    return baseline;
}

TrackedYoloFrameState BuildTrackedYoloFrameState(
    int frame_index,
    const cv::Mat& frame_bgr,
    const YoloDetectionResult& detection,
    int max_dart_count) {
    TrackedYoloFrameState frame_state;
    frame_state.frame_index = frame_index;
    // Frames are never modified after capture, so sharing the buffer is safe and saves a copy.
    frame_state.frame_bgr = frame_bgr;
    std::optional<cv::Rect> detected_board_box = SelectOptionalBestBoardBox(detection, frame_bgr.size());
    if (detected_board_box.has_value()) {
        frame_state.board_box = detected_board_box.value();
        frame_state.has_board_box = true;
        frame_state.dart_search_rect = ExpandToDartSearchRect(frame_state.board_box);
        frame_state.dart_search_crop_bgr = CropWithBlackPadding(frame_bgr, frame_state.dart_search_rect);
    }
    frame_state.dart_boxes = SelectTopDartBoxes(
        detection,
        max_dart_count,
        frame_state.has_board_box ? std::optional<cv::Rect>(frame_state.dart_search_rect) : std::nullopt);
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
        throw std::runtime_error("输入图为空，无法缩放");
    }
    if (target_size.width <= 0 || target_size.height <= 0) {
        throw std::runtime_error("目标缩放尺寸无效");
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

// A tall dart box means the dart points up in the image and its tip is the topmost changed
// pixel; otherwise (camera at the left front) the tip is the leftmost one.
bool IsTipOnTop(const cv::Rect& dart_box) {
    return dart_box.height > ((dart_box.width * 5) / 4);
}

// YOLO boxes often stop short of the thin, dark tip, so the comparison area reaches a third of
// the box further on the tip side.
cv::Rect ExtendTowardTip(const cv::Rect& dart_box, bool tip_on_top) {
    cv::Rect extended = dart_box;
    if (tip_on_top) {
        const int extra = dart_box.height / 3;
        extended.y -= extra;
        extended.height += extra;
    } else {
        const int extra = dart_box.width / 3;
        extended.x -= extra;
        extended.width += extra;
    }
    return extended;
}

std::optional<cv::Point> SelectTipPointFromLocalMask(
    const cv::Mat& filtered_binary,
    const cv::Rect& local_rect,
    bool select_topmost) {
    if (filtered_binary.empty() || cv::countNonZero(filtered_binary) == 0) {
        return std::nullopt;
    }
    if (select_topmost) {
        for (int y = 0; y < filtered_binary.rows; ++y) {
            const uchar* row = filtered_binary.ptr<uchar>(y);
            for (int x = 0; x < filtered_binary.cols; ++x) {
                if (row[x] > 0) {
                    return cv::Point(local_rect.x + x, local_rect.y + y);
                }
            }
        }
    } else {
        for (int x = 0; x < filtered_binary.cols; ++x) {
            for (int y = 0; y < filtered_binary.rows; ++y) {
                if (filtered_binary.at<uchar>(y, x) > 0) {
                    return cv::Point(local_rect.x + x, local_rect.y + y);
                }
            }
        }
    }
    return std::nullopt;
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
    const cv::Point& point_in_round_board,
    const cv::Mat& point_rectification_h,
    float rectified_radius) {
    if (point_rectification_h.empty()) {
        throw std::runtime_error("首帧透视矫正矩阵为空");
    }
    if (rectified_radius <= 1e-6f) {
        throw std::runtime_error("首帧精确半径无效");
    }
    std::vector<cv::Point2f> src_points{
        cv::Point2f(
            static_cast<float>(point_in_round_board.x),
            static_cast<float>(point_in_round_board.y))
    };
    std::vector<cv::Point2f> dst_points;
    cv::perspectiveTransform(src_points, dst_points, point_rectification_h);
    if (dst_points.empty()) {
        throw std::runtime_error("点坐标透视矫正失败");
    }
    return cv::Point2f(
        dst_points.front().x / rectified_radius,
        -dst_points.front().y / rectified_radius);
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

#if BT_ENABLE_DEBUG_IMAGES
cv::Mat DrawLocalRectAndTipOnBoardImage(
    const cv::Mat& board_image_bgr,
    const cv::Rect& local_rect,
    const std::optional<cv::Point>& tip_point) {
    cv::Mat debug_image = board_image_bgr.clone();
    cv::rectangle(debug_image, local_rect, cv::Scalar(0, 255, 255), 2);
    if (tip_point.has_value()) {
        cv::circle(debug_image, tip_point.value(), 8, cv::Scalar(0, 0, 255), -1);
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

// Board-wide preparation shared by every dart box of the same before/after pair.
constexpr const char* kDartAlignmentMotion = "homography";
// Below this ECC score an alignment is not trusted (hand in view, motion blur, board partly out
// of frame): the frame is not used to confirm a dart. Normal frames score 0.99 or more.
constexpr double kMinAlignmentCorrelation = 0.97;

struct AlignedBoardPair {
    cv::Size round_board_size;
    cv::Mat before_gray_aligned;
    cv::Mat after_gray_aligned;
    // Colour view of the aligned after image, only filled while debug images are on.
    cv::Mat after_view_aligned;
    // ECC warp of the after image (inverse map, 3x3) and how well each image matched the template.
    cv::Mat after_warp;
    double before_correlation = 0.0;
    double after_correlation = 0.0;
};

std::optional<AlignedBoardPair> PrepareAlignedBoardPair(
    const cv::Mat& first_preprocessed_gray,
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const PipelineConfig& config) {
    const cv::Size round_board_size = first_preprocessed_gray.size();
    if (round_board_size.width <= 0 || round_board_size.height <= 0) {
        throw std::runtime_error("首帧预处理图为空");
    }
    if (before_board_crop_bgr.empty() || after_board_crop_bgr.empty()) {
        return std::nullopt;
    }

    cv::Mat before_resized = ResizeToTargetSize(before_board_crop_bgr, round_board_size);
    cv::Mat after_resized = ResizeToTargetSize(after_board_crop_bgr, round_board_size);

    cv::Mat before_view = EnhanceWarpedImage(
        before_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(
        after_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);

    cv::Mat before_gray = PreprocessImage(before_view, config.dart.preprocess_blur_kernel);
    cv::Mat after_gray = PreprocessImage(after_view, config.dart.preprocess_blur_kernel);

    // Full perspective model: a hand-held or wobbling phone changes distance and angle, not only
    // position and turn. Measured 2026-10-21: scores never below the rotation+shift model on the
    // stand (0.992-0.999) and back above 0.99 for most hand-held frames (0.96-0.98 before).
    PyramidECCResult before_alignment = AlignPyramidEcc(
        first_preprocessed_gray,
        before_gray,
        3,
        kDartAlignmentMotion);
    PyramidECCResult after_alignment = AlignPyramidEcc(
        first_preprocessed_gray,
        after_gray,
        3,
        kDartAlignmentMotion);

    AlignedBoardPair pair;
    pair.round_board_size = round_board_size;
    pair.before_gray_aligned = before_alignment.aligned_target;
    pair.after_gray_aligned = after_alignment.aligned_target;
    pair.after_warp = after_alignment.warp_matrix.clone();
    pair.before_correlation = before_alignment.correlation;
    pair.after_correlation = after_alignment.correlation;
#if BT_ENABLE_DEBUG_IMAGES
    if (DebugImagesActive()) {
        pair.after_view_aligned = WarpImageWithMatrix(
            after_view,
            after_alignment.warp_matrix,
            kDartAlignmentMotion,
            round_board_size);
    }
#endif
    return pair;
}

// YOLO found the dart box in the after image as captured, but the comparison runs on the
// aligned image, which ECC may have shifted or turned by a few pixels; move the box the same way
// so it still sits on the dart when the phone moved between frames.
cv::Rect MapDartBoxIntoAlignedPair(
    const AlignedBoardPair& pair,
    const cv::Rect& after_search_rect,
    const YoloDetectionBox& dart_box) {
    const cv::Rect box_in_crop = MapDetectionBoxToBoardCrop(dart_box, after_search_rect, pair.round_board_size);
    if (pair.after_warp.empty()) {
        return box_in_crop;
    }
    // WARP_INVERSE_MAP: aligned(p) = after(W p), so a point q of the after image lands at W^-1 q.
    cv::Mat warp;
    pair.after_warp.convertTo(warp, CV_64F);
    if (warp.rows == 2) {
        cv::Mat full = cv::Mat::eye(3, 3, CV_64F);
        warp.copyTo(full(cv::Rect(0, 0, 3, 2)));
        warp = full;
    }
    const cv::Mat inverse_warp = warp.inv();
    const std::vector<cv::Point2f> corners{
        cv::Point2f(static_cast<float>(box_in_crop.x), static_cast<float>(box_in_crop.y)),
        cv::Point2f(static_cast<float>(box_in_crop.br().x), static_cast<float>(box_in_crop.y)),
        cv::Point2f(static_cast<float>(box_in_crop.x), static_cast<float>(box_in_crop.br().y)),
        cv::Point2f(static_cast<float>(box_in_crop.br().x), static_cast<float>(box_in_crop.br().y))};
    std::vector<cv::Point2f> moved;
    cv::perspectiveTransform(corners, moved, inverse_warp);
    return cv::boundingRect(moved) & cv::Rect(cv::Point(0, 0), pair.round_board_size);
}

// Tip of the dart inside box_in_pair (aligned-pair coordinates): a mapped YOLO box, or a changed
// region found by the board scan.
LocalizedDartDetectionResult LocateDartTipInRegion(
    const AlignedBoardPair& pair,
    const cv::Rect& box_in_pair,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search,
    int frame_index,
    const std::string& debug_prefix) {
    LocalizedDartDetectionResult result;
    const bool tip_on_top = IsTipOnTop(box_in_pair);
    cv::Rect local_rect;
    try {
        local_rect = ExpandAndClampLocalRect(ExtendTowardTip(box_in_pair, tip_on_top), pair.round_board_size);
    } catch (const std::exception&) {
        result.reason = "local_dart_box_invalid";
        return result;
    }

    cv::Mat before_local_gray = pair.before_gray_aligned(local_rect).clone();
    cv::Mat after_local_gray = pair.after_gray_aligned(local_rect).clone();
    cv::Mat diff_thresh = BuildTipDiffBinary(before_local_gray, after_local_gray);
    cv::Mat filtered_local = FilterSinglePixelComponents(diff_thresh);
    std::optional<cv::Point> tip_point = SelectTipPointFromLocalMask(filtered_local, local_rect, tip_on_top);

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
            DrawLocalRectAndTipOnBoardImage(pair.after_view_aligned, local_rect, result.point_in_round_board));
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
    int frame_index,
    const std::string& debug_prefix) {
    return LocateDartTipInRegion(
        pair,
        MapDartBoxIntoAlignedPair(pair, after_search_rect, dart_box),
        point_rectification_h,
        rectified_radius,
        board_offset_in_search,
        frame_index,
        debug_prefix);
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
// Margins around known darts whose change the scan ignores: an old dart may wobble when hit; a
// dart YOLO boxed (even one not confirmed yet) also changes its shadow and its tip side.
// Shadows no longer need wide margins (a missed-dart region must brighten), and wide ones hid a
// dart YOLO never boxed that sat next to a boxed group (2026-10-21).
constexpr double kOldDartMargin = 0.3;
constexpr double kBoxedDartMargin = 0.25;
// A region belongs to a known dart when at least this share of its change lies in the known
// areas; a dart that merely touches the edge of one is still reported.
constexpr double kMinKnownShare = 0.5;
// Pieces closer than this (share of the piece size) are merged as parts of one dart.
constexpr double kPieceMergeMargin = 0.3;

struct ChangeRegion {
    cv::Rect rect_in_pair;
    int area = 0;
};

cv::Rect GrowRect(const cv::Rect& rect, double share_each_side) {
    const int dx = static_cast<int>(std::lround(rect.width * share_each_side));
    const int dy = static_cast<int>(std::lround(rect.height * share_each_side));
    return cv::Rect(rect.x - dx, rect.y - dy, rect.width + 2 * dx, rect.height + 2 * dy);
}

std::vector<ChangeRegion> FindUnexplainedChangeRegions(
    const AlignedBoardPair& pair,
    const std::vector<cv::Rect>& explained_in_pair,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search) {
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
    for (bool merged = true; merged;) {
        merged = false;
        for (size_t i = 0; i < pieces.size() && !merged; ++i) {
            for (size_t j = i + 1; j < pieces.size() && !merged; ++j) {
                if ((GrowRect(pieces[i].rect_in_pair, kPieceMergeMargin) & pieces[j].rect_in_pair).area() > 0) {
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
        } else if (changed_count == 0 || bright_count < changed_count * kMinMissedDartBrightShare) {
            verdict = "dark";
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
    const std::vector<const TrackedYoloFrameState*>& boxed_frames) {
    std::vector<cv::Rect> areas;
    for (const YoloDetectionBox& box : clean_frame.dart_boxes) {
        areas.push_back(GrowRect(MapDartBoxIntoAlignedPair(pair, clean_frame.dart_search_rect, box), kOldDartMargin));
    }
    for (const TrackedYoloFrameState* frame : boxed_frames) {
        for (const YoloDetectionBox& box : frame->dart_boxes) {
            const cv::Rect in_pair = MapDartBoxIntoAlignedPair(pair, frame->dart_search_rect, box);
            areas.push_back(GrowRect(ExtendTowardTip(in_pair, IsTipOnTop(in_pair)), kBoxedDartMargin));
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
            previous_frame.dart_search_crop_bgr,
            current_frame.dart_search_crop_bgr,
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
    const PipelineConfig& config,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    const cv::Point& board_offset_in_search) {
    std::optional<AlignedBoardPair> pair;
    try {
        pair = PrepareAlignedBoardPair(
            template_gray,
            clean_frame.dart_search_crop_bgr,
            current_frame.dart_search_crop_bgr,
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
        KnownDartAreas(pair.value(), clean_frame, {&current_frame}),
        point_rectification_h,
        rectified_radius,
        board_offset_in_search).empty();
}

}  // namespace

AndroidBullTrackSession::AndroidBullTrackSession() = default;

AndroidStartRoundResult AndroidBullTrackSession::StartRound(const cv::Mat& first_frame_bgr) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("首帧为空");
    }

    AndroidStartRoundResult result;
    first_frame_bgr_ = first_frame_bgr.clone();
    latest_frame_bgr_ = first_frame_bgr.clone();

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
    first_frame_board_crop_bgr_ = baseline.board_crop_bgr.clone();
    first_frame_preprocessed_for_alignment_ = baseline.preprocessed_gray.clone();
    first_frame_dart_search_rect_ = baseline.dart_search_rect;
    board_offset_in_search_ = baseline.board_box.tl() - baseline.dart_search_rect.tl();
    first_frame_point_rectification_h_ = baseline.point_rectification_h.clone();
    first_frame_rectified_radius_ = baseline.rectified_radius;
    ring_edges_ = baseline.board_detection.measured_ring_edges;
    recent_frames_.clear();
    pending_candidate_.reset();
    phantom_boxes_.clear();
    clean_refresh_frames_left_ = 0;
    last_confirmed_dart_count_ = static_cast<int>(SelectTopDartBoxes(baseline.yolo_detection, 3, baseline.dart_search_rect).size());
    round_start_dart_count_ = last_confirmed_dart_count_;
    result.start_dart_count = round_start_dart_count_;
    result.left_right_half_ratio = MeasureLeftRightHalfRatio(
        first_frame_point_rectification_h_,
        first_frame_rectified_radius_);
    __android_log_print(
        ANDROID_LOG_INFO,
        "BullTrackNativeV2",
        "round start: darts on board=%d, left/right half ratio=%.3f",
        result.start_dart_count,
        result.left_right_half_ratio);
    PushRecentFrame(
        recent_frames_,
        BuildTrackedYoloFrameState(
            1,
            first_frame_bgr_,
            baseline.yolo_detection,
            3));
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
            base_frame.dart_search_crop_bgr,
            stable_frame.dart_search_crop_bgr,
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
                candidate_frame.dart_search_crop_bgr,
                stable_frame.dart_search_crop_bgr,
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
        YoloDetectionBox merged = box;
        for (const YoloDetectionBox& other : candidates) {
            if (overlaps(other.rect, merged.rect)) {
                merged.rect = merged.rect | other.rect;
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
            KnownDartAreas(pair.value(), base_frame, {&stable_frame, &candidate_frame}),
            candidate_frame,
            stable_frame,
            first_frame_preprocessed_for_alignment_,
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
    for (size_t i = 0; i < new_dart_boxes.size(); ++i) {
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
            current_frame_index_,
            i == 0 ? std::string("s3") : cv::format("s3%c", static_cast<char>('a' + i)));
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.precise_debug_images));
        points.push_back(
            localized.has_dart && localized.point_norm.has_value()
                ? std::optional<cv::Point2f>(MapOntoDefaultRings(localized.point_norm.value(), ring_edges_))
                : std::nullopt);
        by_fallback.push_back(!yolo_sees_new_dart);
    }
    for (size_t i = 0; i < missed_regions.size(); ++i) {
        LocalizedDartDetectionResult localized = LocateDartTipInRegion(
            pair.value(),
            missed_regions[i].rect_in_pair,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            current_frame_index_,
            cv::format("s3m%c", static_cast<char>('a' + i)));
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.precise_debug_images));
        points.push_back(
            localized.has_dart && localized.point_norm.has_value()
                ? std::optional<cv::Point2f>(MapOntoDefaultRings(localized.point_norm.value(), ring_edges_))
                : std::nullopt);
        by_fallback.push_back(true);
    }
    result.gate_reason = std::string(yolo_sees_new_dart ? "trigger_precise_detection" : "trigger_lost_box_on_image") +
        change_text + cv::format(" darts=%d missed=%d", static_cast<int>(points.size()), static_cast<int>(missed_regions.size()));
    count_darts(points, by_fallback);
}

AndroidFrameProcessResult AndroidBullTrackSession::ProcessFrame(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("输入帧为空");
    }

    latest_frame_bgr_ = frame_bgr;
    AndroidFrameProcessResult result;
    YoloDetectionResult yolo_detection;
    try {
        yolo_detection = DetectYoloObjects(latest_frame_bgr_);
    } catch (const std::exception& error) {
        result.gate_reason = std::string("yolo_detect_failed: ") + error.what();
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
        max_candidate_count);
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
            "frame %d darts=%d board=%d low=[%s ]",
            current_frame_index_,
            current_count,
            stored_current.has_board_box ? 1 : 0,
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
                pipeline_config_,
                first_frame_point_rectification_h_,
                first_frame_rectified_radius_,
                board_offset_in_search_)) {
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

    current_frame_index_ += 1;

    return result;
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
            last_clean_frame_->dart_search_crop_bgr,
            current.dart_search_crop_bgr,
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
        KnownDartAreas(pair.value(), last_clean_frame_.value(), {}),
        previous,
        current,
        first_frame_preprocessed_for_alignment_,
        pipeline_config_,
        first_frame_point_rectification_h_,
        first_frame_rectified_radius_,
        board_offset_in_search_);
    if (static_cast<int>(regions.size()) > remaining) {
        regions.resize(static_cast<size_t>(remaining));
    }
    for (size_t i = 0; i < regions.size(); ++i) {
        LocalizedDartDetectionResult localized = LocateDartTipInRegion(
            pair.value(),
            regions[i].rect_in_pair,
            first_frame_point_rectification_h_,
            first_frame_rectified_radius_,
            board_offset_in_search_,
            current_frame_index_,
            cv::format("s3e%c", static_cast<char>('a' + i)));
        std::move(
            localized.debug_images.begin(),
            localized.debug_images.end(),
            std::back_inserter(result.debug_images));
        if (localized.has_dart && localized.point_norm.has_value()) {
            result.points.push_back(MapOntoDefaultRings(localized.point_norm.value(), ring_edges_));
        }
    }
    last_confirmed_dart_count_ += static_cast<int>(regions.size());
    return result;
}

AndroidRedetectResult AndroidBullTrackSession::RedetectRound(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("重新识别输入帧为空");
    }
    latest_frame_bgr_ = frame_bgr;
    AndroidRedetectResult result;
    result.yolo_status = "not_run";

    try {
        YoloDetectionResult yolo_detection = DetectYoloObjects(latest_frame_bgr_);
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
        const cv::Rect after_search_rect = ExpandToDartSearchRect(after_board_box.value());

        std::vector<YoloDetectionBox> top_dart_boxes = SelectTopDartBoxes(yolo_detection, 3, after_search_rect);
        if (top_dart_boxes.empty()) {
            result.yolo_status += " no_dart_boxes";
#if BT_ENABLE_DEBUG_IMAGES
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
            before_board_crop_bgr,
            after_board_crop_bgr,
            pipeline_config_);
        for (size_t i = 0; aligned_pair.has_value() && i < top_dart_boxes.size(); ++i) {
            const std::string prefix = "s9" + std::to_string(static_cast<int>(i + 1));
            LocalizedDartDetectionResult localized = LocateDartTipInAlignedPair(
                aligned_pair.value(),
                after_search_rect,
                top_dart_boxes[i],
                first_frame_point_rectification_h_,
                first_frame_rectified_radius_,
                board_offset_in_search_,
                current_frame_index_,
                prefix);
            summary_points.push_back(localized.point_in_round_board);
            if (localized.point_norm.has_value()) {
                result.points.push_back(MapOntoDefaultRings(localized.point_norm.value(), ring_edges_));
            }
            std::move(
                localized.debug_images.begin(),
                localized.debug_images.end(),
                std::back_inserter(result.debug_images));
        }

#if BT_ENABLE_DEBUG_IMAGES
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
#endif
    } catch (const std::exception& error) {
        result.yolo_status = std::string("error: ") + error.what();
    }

    return result;
}

}  // namespace bulltrack
