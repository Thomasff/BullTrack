#include "AndroidBullTrackSession.h"

#include "bulltrack_v2/Alignment.h"
#include "BoardDetectorAndroid.h"
#include "bulltrack_v2/DartDetector.h"
#include "bulltrack_v2/Pipeline.h"
#include "bulltrack_v2/Preprocessing.h"
#include "YoloNcnnDetector.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <utility>

namespace bulltrack {
namespace {

struct PreciseDetectionDebugResult {
    SingleDartDetectionResult detection_result;
    std::vector<DebugImageArtifact> debug_images;
};

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
    BoardCircle board_circle;
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
    bool draw_red_radius_regions,
    const std::vector<cv::Mat>& red_region_masks) {
    cv::Mat debug_image = image_bgr.clone();
    cv::circle(debug_image, cv::Point(board_circle.cx, board_circle.cy), board_circle.radius, cv::Scalar(0, 255, 255), 3);
    cv::circle(debug_image, cv::Point(board_circle.cx, board_circle.cy), 8, cv::Scalar(0, 0, 255), -1);
    if (draw_red_radius_regions) {
        static const cv::Scalar kRegionColors[3] = {
            cv::Scalar(0, 165, 255),
            cv::Scalar(255, 255, 0),
            cv::Scalar(255, 0, 255)
        };
        const size_t draw_count = std::min<size_t>(3, red_region_masks.size());
        for (size_t i = 0; i < draw_count; ++i) {
            if (red_region_masks[i].empty()) {
                continue;
            }
            std::vector<std::vector<cv::Point>> contours;
            cv::findContours(red_region_masks[i], contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
            if (contours.empty()) {
                continue;
            }
            cv::drawContours(debug_image, contours, -1, kRegionColors[i], 2);
            std::vector<cv::Point> merged_points;
            for (const auto& contour : contours) {
                merged_points.insert(merged_points.end(), contour.begin(), contour.end());
            }
            if (merged_points.empty()) {
                continue;
            }
            cv::Rect bbox = cv::boundingRect(merged_points);
            const std::string label = "R" + std::to_string(static_cast<int>(i + 1));
            cv::putText(
                debug_image,
                label,
                cv::Point(bbox.x, std::max(16, bbox.y - 6)),
                cv::FONT_HERSHEY_SIMPLEX,
                0.6,
                kRegionColors[i],
                2);
        }
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
#endif

cv::Rect ClampRectToImage(const cv::Rect2f& rect, const cv::Size& image_size);

cv::Point2f BoxCenter(const YoloDetectionBox& box) {
    return cv::Point2f(
        box.rect.x + (box.rect.width * 0.5f),
        box.rect.y + (box.rect.height * 0.5f));
}

std::vector<YoloDetectionBox> SelectTopDartBoxes(const YoloDetectionResult& detection, int max_count) {
    std::vector<YoloDetectionBox> dart_boxes;
    for (const YoloDetectionBox& box : detection.boxes) {
        if (box.label == "dart") {
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
        "s08",
        "red_radius_inner_removed_binary",
        board_detection.red_radius_inner_removed_binary);
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
    AppendDebugImage(
        output,
        frame_index,
        "s10",
        "board_center_radius",
        DrawBoardCenterRadiusDebugImage(
            board_crop_bgr,
            board_detection.circle,
            board_detection.red_radius_correction_succeeded,
            board_detection.red_radius_selected_component_masks));
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

cv::Rect SelectBestBoardBox(const YoloDetectionResult& detection, const cv::Size& image_size) {
    std::optional<cv::Rect> board_box = SelectOptionalBestBoardBox(detection, image_size);
    if (!board_box.has_value()) {
        throw std::runtime_error("首帧未检测到 board");
    }
    return board_box.value();
}

cv::Mat CropByReferenceBoardBox(const cv::Mat& image, const cv::Rect& board_box) {
    return CropBoardByRect(
        image,
        ClampRectToImage(
            cv::Rect2f(
                static_cast<float>(board_box.x),
                static_cast<float>(board_box.y),
                static_cast<float>(board_box.width),
                static_cast<float>(board_box.height)),
            image.size()));
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
        pipeline_config.edge,
        pipeline_config.circle,
        false);

    FirstFrameBoardBaseline baseline;
    baseline.board_box = board_box;
    baseline.board_crop_bgr = std::move(board_crop_bgr);
    baseline.enhanced_board_crop_bgr = std::move(enhanced_board_crop_bgr);
    baseline.preprocessed_gray = PreprocessImage(
        baseline.enhanced_board_crop_bgr,
        pipeline_config.dart.preprocess_blur_kernel);
    baseline.board_circle = board_detection.circle;
    baseline.board_detection = std::move(board_detection);
    baseline.yolo_detection = std::move(yolo_detection);
    return baseline;
}

TrackedYoloFrameState BuildTrackedYoloFrameState(
    int frame_index,
    const cv::Mat& frame_bgr,
    const cv::Rect& reference_board_box,
    const YoloDetectionResult& detection,
    int max_dart_count) {
    TrackedYoloFrameState frame_state;
    frame_state.frame_index = frame_index;
    frame_state.frame_bgr = frame_bgr.clone();
    frame_state.reference_board_crop_bgr = CropByReferenceBoardBox(frame_bgr, reference_board_box);
    std::optional<cv::Rect> detected_board_box = SelectOptionalBestBoardBox(detection, frame_bgr.size());
    if (detected_board_box.has_value()) {
        frame_state.board_box = detected_board_box.value();
        frame_state.has_board_box = true;
        frame_state.detected_board_crop_bgr = CropBoardByRect(frame_bgr, frame_state.board_box);
    }
    frame_state.dart_boxes = SelectTopDartBoxes(detection, max_dart_count);
    frame_state.overlay_bgr = detection.overlay_bgr.clone();
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

std::optional<cv::Point> SelectTipPointFromLocalMask(const cv::Mat& filtered_binary, const cv::Rect& local_rect) {
    if (filtered_binary.empty() || cv::countNonZero(filtered_binary) == 0) {
        return std::nullopt;
    }
    const bool select_topmost = filtered_binary.rows > ((filtered_binary.cols * 5) / 4);
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

cv::Point2f NormalizePointFromRoundAlignedBoard(
    const cv::Point& point_in_round_board,
    const BoardCircle& round_circle) {
    return NormalizePoint(
        point_in_round_board.x,
        point_in_round_board.y,
        round_circle.cx,
        round_circle.cy,
        round_circle.radius);
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

LocalizedDartDetectionResult DetectLocalizedDartTip(
    const cv::Mat& first_preprocessed_gray,
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const cv::Rect& after_board_box,
    const YoloDetectionBox& dart_box,
    const BoardCircle& board_circle,
    const PipelineConfig& config,
    int frame_index,
    const std::string& debug_prefix) {
    LocalizedDartDetectionResult result;
    const cv::Size round_board_size = first_preprocessed_gray.size();
    if (round_board_size.width <= 0 || round_board_size.height <= 0) {
        throw std::runtime_error("首帧预处理图为空");
    }
    if (before_board_crop_bgr.empty() || after_board_crop_bgr.empty()) {
        result.reason = "local_dart_box_invalid";
        return result;
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

    PyramidECCResult before_alignment = AlignPyramidEcc(
        first_preprocessed_gray,
        before_gray,
        3,
        "affine");
    PyramidECCResult after_alignment = AlignPyramidEcc(
        first_preprocessed_gray,
        after_gray,
        3,
        "affine");

    cv::Mat before_gray_aligned = before_alignment.aligned_target;
    cv::Mat after_gray_aligned = after_alignment.aligned_target;
#if BT_ENABLE_DEBUG_IMAGES
    cv::Mat after_view_aligned = WarpImageWithMatrix(
        after_view,
        after_alignment.warp_matrix,
        "affine",
        round_board_size);
#endif

    cv::Rect local_rect;
    try {
        local_rect = ExpandAndClampLocalRect(
            MapDetectionBoxToBoardCrop(dart_box, after_board_box, round_board_size),
            round_board_size);
    } catch (const std::exception&) {
        result.reason = "local_dart_box_invalid";
        return result;
    }

    cv::Mat before_local_gray = before_gray_aligned(local_rect).clone();
    cv::Mat after_local_gray = after_gray_aligned(local_rect).clone();
    cv::Mat diff_thresh = BuildLocalDiffBinary(before_local_gray, after_local_gray);
    cv::Mat filtered_local = FilterSinglePixelComponents(diff_thresh);
    std::optional<cv::Point> tip_point = SelectTipPointFromLocalMask(filtered_local, local_rect);

    if (cv::countNonZero(filtered_local) == 0) {
        result.reason = "local_mask_empty_after_filter";
    } else if (!tip_point.has_value()) {
        result.reason = "local_tip_not_found";
    } else {
        result.has_dart = true;
        result.point_in_round_board = tip_point;
        result.point_norm = NormalizePointFromRoundAlignedBoard(tip_point.value(), board_circle);
        result.reason = "local_tip_resolved";
    }
#if BT_ENABLE_DEBUG_IMAGES
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
        DrawLocalRectAndTipOnBoardImage(after_view_aligned, local_rect, result.point_in_round_board));
#else
    (void)frame_index;
    (void)debug_prefix;
#endif
    return result;
}

std::optional<YoloDetectionBox> ResolveNewDartBox(
    const std::vector<YoloDetectionBox>& base_boxes,
    const std::vector<YoloDetectionBox>& stable_boxes) {
    if (stable_boxes.size() != base_boxes.size() + 1) {
        return std::nullopt;
    }
    if (base_boxes.empty()) {
        return stable_boxes.front();
    }

    struct DistancePair {
        size_t stable_index = 0;
        size_t base_index = 0;
        float distance = 0.0f;
    };

    std::vector<DistancePair> distances;
    distances.reserve(base_boxes.size() * stable_boxes.size());
    for (size_t stable_index = 0; stable_index < stable_boxes.size(); ++stable_index) {
        const cv::Point2f stable_center = BoxCenter(stable_boxes[stable_index]);
        for (size_t base_index = 0; base_index < base_boxes.size(); ++base_index) {
            const cv::Point2f base_center = BoxCenter(base_boxes[base_index]);
            distances.push_back(DistancePair{
                stable_index,
                base_index,
                static_cast<float>(cv::norm(stable_center - base_center))
            });
        }
    }
    std::sort(distances.begin(), distances.end(), [](const DistancePair& lhs, const DistancePair& rhs) {
        return lhs.distance < rhs.distance;
    });

    std::vector<bool> used_stable(stable_boxes.size(), false);
    std::vector<bool> used_base(base_boxes.size(), false);
    size_t matched_count = 0;
    for (const DistancePair& pair : distances) {
        if (used_stable[pair.stable_index] || used_base[pair.base_index]) {
            continue;
        }
        used_stable[pair.stable_index] = true;
        used_base[pair.base_index] = true;
        matched_count += 1;
        if (matched_count == base_boxes.size()) {
            break;
        }
    }

    if (matched_count != base_boxes.size()) {
        return std::nullopt;
    }

    std::optional<YoloDetectionBox> new_box;
    for (size_t stable_index = 0; stable_index < stable_boxes.size(); ++stable_index) {
        if (used_stable[stable_index]) {
            continue;
        }
        if (new_box.has_value()) {
            return std::nullopt;
        }
        new_box = stable_boxes[stable_index];
    }
    return new_box;
}

PreciseDetectionDebugResult DetectSingleDartOnFrames(
    const cv::Mat& first_preprocessed_gray,
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const cv::Rect& before_board_box,
    const cv::Rect& after_board_box,
    const std::optional<YoloDetectionBox>& new_dart_box,
    const BoardCircle& board_circle,
    const PipelineConfig& config,
    int frame_index) {
    (void)before_board_box;
    PreciseDetectionDebugResult debug_result;
    if (!new_dart_box.has_value()) {
        debug_result.detection_result.reason = "local_dart_box_invalid";
        return debug_result;
    }
    LocalizedDartDetectionResult localized = DetectLocalizedDartTip(
        first_preprocessed_gray,
        before_board_crop_bgr,
        after_board_crop_bgr,
        after_board_box,
        new_dart_box.value(),
        board_circle,
        config,
        frame_index,
        "s3");
    debug_result.detection_result.has_dart = localized.has_dart;
    debug_result.detection_result.tip_point = localized.point_in_round_board;
    debug_result.detection_result.point_norm = localized.point_norm;
    debug_result.detection_result.reason = localized.reason;
    debug_result.debug_images = std::move(localized.debug_images);
    return debug_result;
}

}  // namespace

AndroidBullTrackSession::AndroidBullTrackSession() = default;

AndroidStartRoundResult AndroidBullTrackSession::StartRound(const cv::Mat& first_frame_bgr) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("首帧为空");
    }

    first_frame_bgr_ = first_frame_bgr.clone();
    latest_frame_bgr_ = first_frame_bgr.clone();

    FirstFrameBoardBaseline baseline = BuildFirstFrameBoardBaseline(first_frame_bgr_, pipeline_config_);
    first_frame_board_box_ = baseline.board_box;
    first_frame_board_crop_bgr_ = baseline.board_crop_bgr.clone();
    first_frame_preprocessed_for_alignment_ = baseline.preprocessed_gray.clone();
    gate_board_circle_ = baseline.board_circle;
    recent_frames_.clear();
    pending_candidate_.reset();
    last_confirmed_dart_count_ = static_cast<int>(SelectTopDartBoxes(baseline.yolo_detection, 3).size());
    PushRecentFrame(
        recent_frames_,
        BuildTrackedYoloFrameState(
            1,
            first_frame_bgr_,
            first_frame_board_box_,
            baseline.yolo_detection,
            3));

    started_ = true;
    current_frame_index_ = 2;

    AndroidStartRoundResult result;
    AppendBoardDetectionDebugImages(result.debug_images, 1, baseline.board_detection, first_frame_board_crop_bgr_);
    return result;
}

AndroidFrameProcessResult AndroidBullTrackSession::ProcessFrame(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("输入帧为空");
    }

    latest_frame_bgr_ = frame_bgr.clone();
    AndroidFrameProcessResult result;
    YoloDetectionResult yolo_detection;
    try {
        yolo_detection = DetectYoloObjects(latest_frame_bgr_);
    } catch (const std::exception& error) {
        result.gate_reason = std::string("yolo_detect_failed: ") + error.what();
        current_frame_index_ += 1;
        return result;
    }

    const int max_candidate_count = std::min(3, last_confirmed_dart_count_ + 1);
    TrackedYoloFrameState current_frame_state = BuildTrackedYoloFrameState(
        current_frame_index_,
        latest_frame_bgr_,
        first_frame_board_box_,
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

    if (current_count <= last_confirmed_dart_count_) {
        pending_candidate_.reset();
        result.gate_reason = "yolo_count_not_increased";
    } else if (!pending_candidate_.has_value()) {
        if (recent_frames_.size() < 2) {
            result.gate_reason = "yolo_count_not_increased";
        } else {
            pending_candidate_ = PendingYoloCandidateState{
                recent_frames_[recent_frames_.size() - 2],
                stored_current
            };
            result.gate_reason = "yolo_count_increased_wait_next_frame";
        }
    } else {
        const int candidate_count = static_cast<int>(pending_candidate_->candidate_frame.dart_boxes.size());
        if (current_count < candidate_count) {
            pending_candidate_.reset();
            result.gate_reason = "yolo_count_not_stable";
        } else {
            std::vector<YoloDetectionBox> stable_dart_boxes = stored_current.dart_boxes;
            if (stable_dart_boxes.size() > static_cast<size_t>(candidate_count)) {
                stable_dart_boxes.resize(static_cast<size_t>(candidate_count));
            }
            std::optional<YoloDetectionBox> new_dart_box = ResolveNewDartBox(
                pending_candidate_->base_frame.dart_boxes,
                stable_dart_boxes);
            if (!new_dart_box.has_value()) {
                pending_candidate_.reset();
                result.gate_reason = "yolo_new_dart_box_not_resolved";
            } else if (!pending_candidate_->base_frame.has_board_box || !stored_current.has_board_box) {
                pending_candidate_.reset();
                result.gate_reason = "yolo_detect_failed: precise_board_box_missing";
            } else {
#if BT_ENABLE_DEBUG_IMAGES
                AppendDebugImage(
                    result.gate_debug_images,
                    current_frame_index_,
                    "s13",
                    "gate_yolo_confirmed",
                    DrawFrameOverlayWithHighlightedNewBox(
                        stored_current.frame_bgr,
                        stable_dart_boxes,
                        new_dart_box,
                        "stable_count_confirmed"));
#endif
                PreciseDetectionDebugResult precise_result = DetectSingleDartOnFrames(
                    first_frame_preprocessed_for_alignment_,
                    pending_candidate_->base_frame.detected_board_crop_bgr,
                    stored_current.detected_board_crop_bgr,
                    pending_candidate_->base_frame.board_box,
                    stored_current.board_box,
                    new_dart_box,
                    gate_board_circle_,
                    pipeline_config_,
                    current_frame_index_);
                result.precise_debug_images = std::move(precise_result.debug_images);
                result.gate_triggered = true;
                result.gate_reason = "trigger_precise_detection";
                result.has_detection =
                    precise_result.detection_result.has_dart &&
                    precise_result.detection_result.point_norm.has_value();
                if (precise_result.detection_result.point_norm.has_value()) {
                    result.detected_point_norm = precise_result.detection_result.point_norm.value();
                }
                last_confirmed_dart_count_ = std::min(3, last_confirmed_dart_count_ + 1);
                pending_candidate_.reset();
            }
        }
    }

    current_frame_index_ += 1;

    return result;
}

AndroidRedetectResult AndroidBullTrackSession::RedetectRound(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("重新识别输入帧为空");
    }
    latest_frame_bgr_ = frame_bgr.clone();
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

        std::vector<YoloDetectionBox> top_dart_boxes = SelectTopDartBoxes(yolo_detection, 3);
        if (top_dart_boxes.empty()) {
            result.yolo_status += " no_dart_boxes";
#if BT_ENABLE_DEBUG_IMAGES
            cv::Mat after_board_crop_bgr = CropBoardByRect(latest_frame_bgr_, after_board_box.value());
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

        cv::Mat before_board_crop_bgr = CropBoardByRect(first_frame_bgr_, first_frame_board_box_);
        cv::Mat after_board_crop_bgr = CropBoardByRect(latest_frame_bgr_, after_board_box.value());
        std::vector<std::optional<cv::Point>> summary_points;
        summary_points.reserve(top_dart_boxes.size());

        for (size_t i = 0; i < top_dart_boxes.size(); ++i) {
            const std::string prefix = "s9" + std::to_string(static_cast<int>(i + 1));
            LocalizedDartDetectionResult localized = DetectLocalizedDartTip(
                first_frame_preprocessed_for_alignment_,
                before_board_crop_bgr,
                after_board_crop_bgr,
                after_board_box.value(),
                top_dart_boxes[i],
                gate_board_circle_,
                pipeline_config_,
                current_frame_index_,
                prefix);
            summary_points.push_back(localized.point_in_round_board);
            if (localized.point_norm.has_value()) {
                result.points.push_back(localized.point_norm.value());
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
        const float scale_x = static_cast<float>(after_board_view.cols) / static_cast<float>(after_board_box->width);
        const float scale_y = static_cast<float>(after_board_view.rows) / static_cast<float>(after_board_box->height);
        for (const YoloDetectionBox& dart_box : top_dart_boxes) {
            YoloDetectionBox scaled_box = dart_box;
            scaled_box.rect = cv::Rect2f(
                (dart_box.rect.x - static_cast<float>(after_board_box->x)) * scale_x,
                (dart_box.rect.y - static_cast<float>(after_board_box->y)) * scale_y,
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
