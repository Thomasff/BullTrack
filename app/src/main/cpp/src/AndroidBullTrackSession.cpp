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
#include <tuple>
#include <utility>

namespace bulltrack {
namespace {

using BoxTuple = std::tuple<int, int, int, int, int, int>;

struct PreciseDetectionDebugResult {
    SingleDartDetectionResult detection_result;
    std::vector<DebugImageArtifact> debug_images;
};

struct RedetectDebugComputation {
    std::vector<cv::Point2f> points;
    cv::Mat filtered_mask;
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

cv::Mat DrawLongestBoxDebugImage(const cv::Mat& binary_img, const std::vector<BoxTuple>& boxes) {
    cv::Mat debug_image = EnsureColorForDebug(binary_img);
    if (boxes.empty()) {
        return debug_image;
    }
    const auto longest_it = std::max_element(boxes.begin(), boxes.end(), [](const BoxTuple& lhs, const BoxTuple& rhs) {
        return std::get<4>(lhs) < std::get<4>(rhs);
    });
    for (const auto& box : boxes) {
        const bool is_longest = &box == &(*longest_it);
        const auto [x, y, width, height, long_edge, area] = box;
        (void)long_edge;
        (void)area;
        const cv::Scalar color = is_longest ? cv::Scalar(0, 255, 255) : cv::Scalar(255, 0, 0);
        cv::rectangle(debug_image, cv::Rect(x, y, width, height), color, is_longest ? 2 : 1);
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

cv::Mat ResizeLongEdgeTo720(const cv::Mat& image, int long_edge) {
    const int h = image.rows;
    const int w = image.cols;
    const int current_long = std::max(h, w);
    if (current_long <= 0) {
        throw std::runtime_error("图像尺寸无效");
    }
    if (current_long == long_edge) {
        return image.clone();
    }
    const double scale = static_cast<double>(long_edge) / static_cast<double>(current_long);
    const int target_w = std::max(1, static_cast<int>(std::lround(static_cast<double>(w) * scale)));
    const int target_h = std::max(1, static_cast<int>(std::lround(static_cast<double>(h) * scale)));
    cv::Mat resized;
    cv::resize(image, resized, cv::Size(target_w, target_h), 0.0, 0.0, cv::INTER_AREA);
    return resized;
}

cv::Mat GaussianBlurOnce(const cv::Mat& gray, int kernel_size) {
    const int kernel = EnsureOddKernel(kernel_size);
    if (kernel == 1) {
        return gray.clone();
    }
    cv::Mat blurred;
    cv::GaussianBlur(gray, blurred, cv::Size(kernel, kernel), 0);
    return blurred;
}

std::tuple<int, int, int, int> ComputeBoardSquareCrop(const cv::Size& shape, int cx, int cy, int radius) {
    const int left = std::max(0, cx - radius);
    const int top = std::max(0, cy - radius);
    const int right = std::min(shape.width, cx + radius);
    const int bottom = std::min(shape.height, cy + radius);
    if (left >= right || top >= bottom) {
        throw std::runtime_error("靶盘外接正方形裁剪区域无效");
    }
    return {left, top, right, bottom};
}

cv::Mat CropWithBox(const cv::Mat& image, const std::tuple<int, int, int, int>& crop_box) {
    const auto [left, top, right, bottom] = crop_box;
    return image(cv::Rect(left, top, right - left, bottom - top)).clone();
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
    frame_state.board_crop_bgr = CropByReferenceBoardBox(frame_bgr, reference_board_box);
    frame_state.board_box = SelectOptionalBestBoardBox(detection, frame_bgr.size()).value_or(reference_board_box);
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

cv::Mat FilterSmallComponents(const cv::Mat& binary_img, int min_area) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    cv::Mat filtered = cv::Mat::zeros(binary_img.size(), CV_8U);
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area < min_area) {
            continue;
        }
        filtered.setTo(255, labels == label);
    }
    return filtered;
}

cv::Mat ApplyCloseRepeated(const cv::Mat& binary_img, int kernel_size, int iterations) {
    const int kernel = EnsureOddKernel(kernel_size);
    cv::Mat morph_kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(kernel, kernel));
    cv::Mat closed = binary_img.clone();
    for (int i = 0; i < std::max(0, iterations); ++i) {
        cv::morphologyEx(closed, closed, cv::MORPH_CLOSE, morph_kernel, cv::Point(-1, -1), 1);
    }
    return closed;
}

cv::Mat ApplySmallDilate(const cv::Mat& binary_img, int kernel_size, int iterations) {
    const int kernel = EnsureOddKernel(kernel_size);
    cv::Mat morph_kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(kernel, kernel));
    cv::Mat dilated;
    cv::dilate(binary_img, dilated, morph_kernel, cv::Point(-1, -1), std::max(0, iterations));
    return dilated;
}

std::vector<BoxTuple> ExtractComponentBoxes(const cv::Mat& binary_img) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    std::vector<BoxTuple> boxes;
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area <= 0) {
            continue;
        }
        const int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        const int y = stats.at<int>(label, cv::CC_STAT_TOP);
        const int width = stats.at<int>(label, cv::CC_STAT_WIDTH);
        const int height = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        const int long_edge = std::max(width, height);
        boxes.emplace_back(x, y, width, height, long_edge, area);
    }
    return boxes;
}

std::optional<BoxTuple> LongestBox(const cv::Mat& binary_img) {
    std::vector<BoxTuple> boxes = ExtractComponentBoxes(binary_img);
    if (boxes.empty()) {
        return std::nullopt;
    }
    return *std::max_element(boxes.begin(), boxes.end(), [](const BoxTuple& lhs, const BoxTuple& rhs) {
        return std::get<4>(lhs) < std::get<4>(rhs);
    });
}

std::tuple<int, int, double> ComputeBoxFillRatio(const cv::Mat& binary_img, const std::optional<BoxTuple>& box) {
    if (!box.has_value()) {
        return {0, 0, 0.0};
    }
    const auto [x, y, w, h, long_edge, area] = box.value();
    (void)long_edge;
    (void)area;
    if (w <= 0 || h <= 0) {
        return {0, 0, 0.0};
    }
    cv::Mat roi = binary_img(cv::Rect(x, y, w, h));
    const int box_area = w * h;
    const int white_area = cv::countNonZero(roi);
    const double fill_ratio = box_area > 0 ? static_cast<double>(white_area) / static_cast<double>(box_area) : 0.0;
    return {box_area, white_area, fill_ratio};
}

double ComputeBoxLongShortRatio(const std::optional<BoxTuple>& box) {
    if (!box.has_value()) {
        return 0.0;
    }
    const auto [x, y, w, h, long_edge, area] = box.value();
    (void)x;
    (void)y;
    (void)long_edge;
    (void)area;
    const int short_edge = std::min(w, h);
    const int longer_edge = std::max(w, h);
    if (short_edge <= 0) {
        return 0.0;
    }
    return static_cast<double>(longer_edge) / static_cast<double>(short_edge);
}

PreciseDetectionDebugResult DetectSingleDartOnFrames(
    const cv::Mat& first_board_crop_bgr,
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const std::optional<YoloDetectionBox>& new_dart_box,
    const BoardCircle& board_circle,
    const PipelineConfig& config,
    int long_edge,
    int frame_index) {
    (void)new_dart_box;
    cv::Mat first_resized = ResizeLongEdgeTo720(first_board_crop_bgr, long_edge);
    cv::Mat before_resized = ResizeLongEdgeTo720(before_board_crop_bgr, long_edge);
    cv::Mat after_resized = ResizeLongEdgeTo720(after_board_crop_bgr, long_edge);

    cv::Mat first_view = EnhanceWarpedImage(
        first_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat before_view = EnhanceWarpedImage(
        before_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(
        after_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);

    cv::Mat first_gray_for_alignment = PrepareEccDiffGrayscale(
        first_view,
        config.dart.preprocess_blur_kernel,
        2);
    cv::Mat before_gray_for_alignment = PrepareEccDiffGrayscale(
        before_view,
        config.dart.preprocess_blur_kernel,
        2);
    PyramidECCResult before_alignment = AlignPyramidEcc(
        first_gray_for_alignment,
        before_gray_for_alignment,
        3,
        "euclidean");
    cv::Mat before_view_aligned = WarpImageWithMatrix(
        before_view,
        before_alignment.warp_matrix,
        "euclidean",
        first_view.size());

    TwoStageAlignmentResult alignment = AlignAfterImageTwoStage(
        before_view_aligned,
        after_view,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        false,
        config.dart.preprocess_blur_kernel,
        2);

    DartDetectionConfig single_config = config.dart;
    single_config.max_darts = 1;

    SingleDartSelectionResult selection = DetectSingleDartPointFromGrayImages(
        alignment.before_gray_final,
        alignment.after_gray_final,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        single_config,
        false);

    SingleDartDetectionResult result;
    result.has_dart = selection.has_dart;
    result.tip_point = selection.tip_point;
    result.reason = selection.reason;
    if (selection.has_dart && selection.tip_point.has_value()) {
        result.point_norm = NormalizePoint(
            selection.tip_point->x,
            selection.tip_point->y,
            board_circle.cx,
            board_circle.cy,
            board_circle.radius);
    }
    DiffBinaryOutputs outputs = BuildDiffBinaryOutputs(
        alignment.before_gray_final,
        alignment.after_gray_final,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        single_config);
    auto [filtered_mask, filtered_components] = FilterConnectedComponents(outputs.binary_img, single_config.min_area, false);

    PreciseDetectionDebugResult debug_result;
    debug_result.detection_result = std::move(result);
#if BT_ENABLE_DEBUG_IMAGES
    AppendDebugImage(debug_result.debug_images, frame_index, "s30", "precise_thresh", outputs.thresh);
    AppendDebugImage(debug_result.debug_images, frame_index, "s31", "precise_morph_area_filtered", filtered_mask * 255);
    AppendDebugImage(
        debug_result.debug_images,
        frame_index,
        "s32",
        "precise_tip_marked",
        DrawTipPointOnBinaryImage(filtered_mask * 255, debug_result.detection_result.tip_point));
#endif
    return debug_result;
}

RedetectDebugComputation DetectDartsOnFramesForRedetect(
    const cv::Mat& before_board_crop_bgr,
    const cv::Mat& after_board_crop_bgr,
    const BoardCircle& board_circle,
    const PipelineConfig& config,
    int long_edge) {
    cv::Mat before_resized = ResizeLongEdgeTo720(before_board_crop_bgr, long_edge);
    cv::Mat after_resized = ResizeLongEdgeTo720(after_board_crop_bgr, long_edge);

    cv::Mat before_view = EnhanceWarpedImage(
        before_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(
        after_resized,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);

    TwoStageAlignmentResult alignment = AlignAfterImageTwoStage(
        before_view,
        after_view,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        false,
        config.dart.preprocess_blur_kernel,
        2);

    std::vector<cv::Point> tip_points = DetectDartPointsFromGrayImages(
        alignment.before_gray_final,
        alignment.after_gray_final,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        config.dart,
        false);

    std::vector<cv::Point2f> normalized_positions;
    normalized_positions.reserve(tip_points.size());
    for (const cv::Point& tip : tip_points) {
        normalized_positions.push_back(NormalizePoint(
            tip.x,
            tip.y,
            board_circle.cx,
            board_circle.cy,
            board_circle.radius));
    }

    DiffBinaryOutputs outputs = BuildDiffBinaryOutputs(
        alignment.before_gray_final,
        alignment.after_gray_final,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        config.dart);
    auto [filtered_mask, filtered_components] = FilterConnectedComponents(outputs.binary_img, config.dart.min_area, false);
    (void)filtered_components;

    return {normalized_positions, filtered_mask * 255};
}

AndroidFrameProcessResult RunFrameGate(
    const cv::Mat& first_gate_gray,
    const cv::Mat& previous_processed,
    const std::tuple<int, int, int, int>& crop_box,
    const BoardCircle& board_circle,
    const cv::Mat& current_frame_board_crop_bgr,
    const PipelineConfig& pipeline_config,
    const ExperimentConfig& experiment_config,
    int frame_index) {
    cv::Mat after_resized = ResizeLongEdgeTo720(current_frame_board_crop_bgr, experiment_config.long_edge);
    cv::Mat after_enhanced = EnhanceWarpedImage(
        after_resized,
        pipeline_config.enhancement.saturation_scale,
        pipeline_config.enhancement.contrast_scale);
    cv::Mat after_gray = PreprocessImage(after_enhanced, pipeline_config.dart.preprocess_blur_kernel);

    PyramidECCResult alignment_result = AlignPyramidEcc(
        first_gate_gray,
        after_gray,
        experiment_config.levels,
        experiment_config.motion_type);
    cv::Mat after_masked = ApplyBoardMask(
        alignment_result.aligned_target,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius);
    cv::Mat after_cropped = CropWithBox(after_masked, crop_box);
    cv::Mat after_blurred = GaussianBlurOnce(after_cropped, experiment_config.diff_blur_kernel);

    cv::Mat diff;
    cv::absdiff(previous_processed, after_blurred, diff);
    cv::Mat brightened_diff;
    cv::Mat contrast_diff;
    std::tie(brightened_diff, contrast_diff) = EnhanceDiffImage(
        diff,
        experiment_config.diff_brightness_beta,
        experiment_config.diff_contrast_alpha,
        experiment_config.diff_contrast_center);

    double max_value_f = 0.0;
    cv::minMaxLoc(contrast_diff, nullptr, &max_value_f);
    const int max_value = static_cast<int>(max_value_f);
    const int threshold_value = max_value > 0 ? std::max(1, static_cast<int>(max_value * 0.4)) : 1;
    cv::Mat thresh;
    cv::threshold(contrast_diff, thresh, threshold_value, 255, cv::THRESH_BINARY);
    cv::Mat filtered_thresh = FilterSmallComponents(thresh, 4);
    std::vector<BoxTuple> closed_boxes;

    AndroidFrameProcessResult result;
    result.gate_reason = "all_black_after_filter";
#if BT_ENABLE_DEBUG_IMAGES
    AppendDebugImage(result.gate_debug_images, frame_index, "s14", "gate_dynamic_thresh", thresh);
    AppendDebugImage(result.gate_debug_images, frame_index, "s15", "gate_area_filtered", filtered_thresh);
#endif

    if (cv::countNonZero(filtered_thresh) == 0) {
#if BT_ENABLE_DEBUG_IMAGES
        AppendDebugImage(result.gate_debug_images, frame_index, "s18", "gate_closed_bbox", DrawLongestBoxDebugImage(filtered_thresh, closed_boxes));
#endif
        return result;
    }

    cv::Mat dilated_thresh = ApplySmallDilate(filtered_thresh, 3, 2);
    cv::Mat closed_thresh = ApplyCloseRepeated(dilated_thresh, 3, 2);
    closed_boxes = ExtractComponentBoxes(closed_thresh);
    std::optional<BoxTuple> closed_longest_box = LongestBox(closed_thresh);
    const int closed_longest_edge = closed_longest_box.has_value()
        ? std::get<4>(closed_longest_box.value())
        : 0;
#if BT_ENABLE_DEBUG_IMAGES
    AppendDebugImage(result.gate_debug_images, frame_index, "s18", "gate_closed_bbox", DrawLongestBoxDebugImage(closed_thresh, closed_boxes));
#endif
    if (!closed_longest_box.has_value()) {
        result.gate_reason = "no_closed_box";
        return result;
    }
    if (static_cast<double>(closed_longest_edge) >= (static_cast<double>(board_circle.radius) / 2.0)) {
        result.gate_reason = "closed_box_ge_half_radius";
        return result;
    }

    std::optional<BoxTuple> filtered_longest_box = LongestBox(filtered_thresh);
    if (!filtered_longest_box.has_value()) {
        result.gate_reason = "no_filtered_box";
        return result;
    }

    int filtered_box_area = 0;
    int filtered_white_area = 0;
    double filtered_fill_ratio = 0.0;
    std::tie(filtered_box_area, filtered_white_area, filtered_fill_ratio) =
        ComputeBoxFillRatio(filtered_thresh, filtered_longest_box);
    (void)filtered_box_area;
    (void)filtered_white_area;

    if (filtered_fill_ratio < 0.25) {
        result.gate_reason = "filtered_box_fill_lt_quarter";
        return result;
    }
    if (ComputeBoxLongShortRatio(filtered_longest_box) >= 4.0) {
        result.gate_reason = "filtered_box_long_short_ratio_ge_4";
        return result;
    }

    result.gate_triggered = true;
    result.gate_reason = "trigger_precise_detection";
    return result;
}

}  // namespace

AndroidBullTrackSession::AndroidBullTrackSession() = default;

AndroidStartRoundResult AndroidBullTrackSession::StartRound(const cv::Mat& first_frame_bgr) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("首帧为空");
    }

    first_frame_bgr_ = first_frame_bgr.clone();
    previous_frame_bgr_ = first_frame_bgr.clone();
    latest_frame_bgr_ = first_frame_bgr.clone();

    FirstFrameBoardBaseline baseline = BuildFirstFrameBoardBaseline(first_frame_bgr_, pipeline_config_);
    first_frame_board_box_ = baseline.board_box;
    first_frame_board_crop_bgr_ = baseline.board_crop_bgr.clone();
    first_frame_preprocessed_for_alignment_ = baseline.preprocessed_gray.clone();
    gate_board_circle_ = baseline.board_circle;
    first_gate_gray_ = baseline.preprocessed_gray.clone();
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

    cv::Mat before_masked = ApplyBoardMask(
        first_gate_gray_,
        gate_board_circle_.cx,
        gate_board_circle_.cy,
        gate_board_circle_.radius);
    crop_box_ = ComputeBoardSquareCrop(
        before_masked.size(),
        gate_board_circle_.cx,
        gate_board_circle_.cy,
        gate_board_circle_.radius);
    cv::Mat before_cropped = CropWithBox(before_masked, crop_box_);
    previous_processed_ = GaussianBlurOnce(before_cropped, experiment_config_.diff_blur_kernel);
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
        previous_frame_bgr_ = latest_frame_bgr_.clone();
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
                    first_frame_board_crop_bgr_,
                    pending_candidate_->base_frame.board_crop_bgr,
                    stored_current.board_crop_bgr,
                    new_dart_box,
                    gate_board_circle_,
                    pipeline_config_,
                    experiment_config_.long_edge,
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

    previous_frame_bgr_ = latest_frame_bgr_.clone();
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
    cv::Mat latest_board_crop_bgr = CropByReferenceBoardBox(latest_frame_bgr_, first_frame_board_box_);

    RedetectDebugComputation detection = DetectDartsOnFramesForRedetect(
        first_frame_board_crop_bgr_,
        latest_board_crop_bgr,
        gate_board_circle_,
        pipeline_config_,
        experiment_config_.long_edge);
    result.points = std::move(detection.points);
    result.yolo_status = "not_run";

    try {
        YoloDetectionResult yolo_detection = DetectYoloObjects(latest_frame_bgr_);
        result.yolo_status = "ok (" + yolo_detection.execution_backend + ")";
        if (!yolo_detection.status_detail.empty()) {
            result.yolo_status += " " + yolo_detection.status_detail;
        }
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
    } catch (const std::exception& error) {
        result.yolo_status = std::string("error: ") + error.what();
    }

#if BT_ENABLE_DEBUG_IMAGES
    AppendDebugImage(
        result.debug_images,
        current_frame_index_,
        "s31",
        "redetect_diff_morph_area_filtered",
        detection.filtered_mask);
#endif

    return result;
}

}  // namespace bulltrack
