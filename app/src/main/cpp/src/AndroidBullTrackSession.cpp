#include "AndroidBullTrackSession.h"

#include "Alignment.h"
#include "BoardDetector.h"
#include "DartDetector.h"
#include "Pipeline.h"
#include "Preprocessing.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <tuple>

namespace bulltrack {
namespace {

using BoxTuple = std::tuple<int, int, int, int, int, int>;

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

SingleDartDetectionResult DetectSingleDartOnFrames(
    const cv::Mat& before_bgr,
    const cv::Mat& after_bgr,
    const PipelineConfig& config) {
    cv::Mat before_view = EnhanceWarpedImage(
        before_bgr,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(
        after_bgr,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);

    BoardCircle board_circle = DetectBoardCircle(before_view, config.edge, config.circle, false);
    TwoStageAlignmentResult alignment = AlignAfterImageTwoStage(
        before_view,
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
    return result;
}

std::vector<cv::Point2f> DetectDartsOnFrames(
    const cv::Mat& before_bgr,
    const cv::Mat& after_bgr,
    const PipelineConfig& config) {
    cv::Mat before_view = EnhanceWarpedImage(
        before_bgr,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(
        after_bgr,
        config.enhancement.saturation_scale,
        config.enhancement.contrast_scale);

    BoardCircle board_circle = DetectBoardCircle(before_view, config.edge, config.circle, false);
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
    return normalized_positions;
}

AndroidFrameProcessResult RunFrameGate(
    const cv::Mat& first_gate_gray,
    const cv::Mat& previous_processed,
    const std::tuple<int, int, int, int>& crop_box,
    const BoardCircle& board_circle,
    const cv::Mat& current_frame_bgr,
    const PipelineConfig& pipeline_config,
    const ExperimentConfig& experiment_config) {
    cv::Mat after_resized = ResizeLongEdgeTo720(current_frame_bgr, experiment_config.long_edge);
    cv::Mat after_enhanced = EnhanceWarpedImage(
        after_resized,
        pipeline_config.enhancement.saturation_scale,
        pipeline_config.enhancement.contrast_scale);
    cv::Mat after_gray;
    cv::cvtColor(after_enhanced, after_gray, cv::COLOR_BGR2GRAY);

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

    AndroidFrameProcessResult result;
    result.gate_reason = "all_black_after_filter";

    if (cv::countNonZero(filtered_thresh) == 0) {
        return result;
    }

    cv::Mat dilated_thresh = ApplySmallDilate(filtered_thresh, 3, 2);
    cv::Mat closed_thresh = ApplyCloseRepeated(dilated_thresh, 3, 2);
    std::optional<BoxTuple> closed_longest_box = LongestBox(closed_thresh);
    const int closed_longest_edge = closed_longest_box.has_value()
        ? std::get<4>(closed_longest_box.value())
        : 0;
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

void AndroidBullTrackSession::StartRound(const cv::Mat& first_frame_bgr) {
    if (first_frame_bgr.empty()) {
        throw std::runtime_error("首帧为空");
    }

    first_frame_bgr_ = first_frame_bgr.clone();
    previous_frame_bgr_ = first_frame_bgr.clone();
    latest_frame_bgr_ = first_frame_bgr.clone();

    cv::Mat before_resized = ResizeLongEdgeTo720(first_frame_bgr_, experiment_config_.long_edge);
    cv::Mat before_enhanced = EnhanceWarpedImage(
        before_resized,
        pipeline_config_.enhancement.saturation_scale,
        pipeline_config_.enhancement.contrast_scale);
    cv::cvtColor(before_enhanced, first_gate_gray_, cv::COLOR_BGR2GRAY);
    gate_board_circle_ = DetectBoardCircle(before_enhanced, pipeline_config_.edge, pipeline_config_.circle, false);

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
}

AndroidFrameProcessResult AndroidBullTrackSession::ProcessFrame(const cv::Mat& frame_bgr) {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    if (frame_bgr.empty()) {
        throw std::runtime_error("输入帧为空");
    }

    latest_frame_bgr_ = frame_bgr.clone();
    AndroidFrameProcessResult result = RunFrameGate(
        first_gate_gray_,
        previous_processed_,
        crop_box_,
        gate_board_circle_,
        latest_frame_bgr_,
        pipeline_config_,
        experiment_config_);

    if (result.gate_triggered) {
        SingleDartDetectionResult precise_result = DetectSingleDartOnFrames(
            previous_frame_bgr_,
            latest_frame_bgr_,
            pipeline_config_);
        result.has_detection = precise_result.has_dart && precise_result.point_norm.has_value();
        if (precise_result.point_norm.has_value()) {
            result.detected_point_norm = precise_result.point_norm.value();
        }
    }

    cv::Mat after_resized = ResizeLongEdgeTo720(latest_frame_bgr_, experiment_config_.long_edge);
    cv::Mat after_enhanced = EnhanceWarpedImage(
        after_resized,
        pipeline_config_.enhancement.saturation_scale,
        pipeline_config_.enhancement.contrast_scale);
    cv::Mat after_gray;
    cv::cvtColor(after_enhanced, after_gray, cv::COLOR_BGR2GRAY);
    PyramidECCResult alignment_result = AlignPyramidEcc(
        first_gate_gray_,
        after_gray,
        experiment_config_.levels,
        experiment_config_.motion_type);
    cv::Mat after_masked = ApplyBoardMask(
        alignment_result.aligned_target,
        gate_board_circle_.cx,
        gate_board_circle_.cy,
        gate_board_circle_.radius);
    cv::Mat after_cropped = CropWithBox(after_masked, crop_box_);
    previous_processed_ = GaussianBlurOnce(after_cropped, experiment_config_.diff_blur_kernel);
    previous_frame_bgr_ = latest_frame_bgr_.clone();

    return result;
}

std::vector<cv::Point2f> AndroidBullTrackSession::RedetectRound() const {
    if (!started_) {
        throw std::runtime_error("round session 尚未开始");
    }
    return DetectDartsOnFrames(first_frame_bgr_, latest_frame_bgr_, pipeline_config_);
}

}  // namespace bulltrack

