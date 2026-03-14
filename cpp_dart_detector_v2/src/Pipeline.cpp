#include "Pipeline.h"

#include "Alignment.h"
#include "BoardDetector.h"
#include "DartDetector.h"
#include "Preprocessing.h"

#include <filesystem>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace bulltrack {
namespace {

std::pair<cv::Mat, cv::Mat> LoadImages(const std::string& img_before_path, const std::string& img_after_path) {
    if (!std::filesystem::exists(img_before_path)) throw std::runtime_error("未找到图片: " + img_before_path);
    if (!std::filesystem::exists(img_after_path)) throw std::runtime_error("未找到图片: " + img_after_path);

    cv::Mat img_before = cv::imread(img_before_path);
    cv::Mat img_after = cv::imread(img_after_path);
    if (img_before.empty()) throw std::runtime_error("无法读取图片: " + img_before_path);
    if (img_after.empty()) throw std::runtime_error("无法读取图片: " + img_after_path);
    return {img_before, img_after};
}

void SaveCommonDebugImages(const cv::Mat& before_view, const cv::Mat& after_view, const cv::Mat& after_view_aligned) {
    EnsureDirectory(DebugImagesPath());
    cv::imwrite(DebugImagesPath() + "/before_input_enhanced.jpg", before_view);
    cv::imwrite(DebugImagesPath() + "/after_input_enhanced.jpg", after_view);
    cv::imwrite(DebugImagesPath() + "/after_input_aligned.jpg", after_view_aligned);
}

PipelineContext PreparePipelineContext(const std::string& img_before_path, const std::string& img_after_path, const PipelineConfig& config, bool debug) {
    auto [img_before, img_after] = LoadImages(img_before_path, img_after_path);
    cv::Mat before_view = EnhanceWarpedImage(img_before, config.enhancement.saturation_scale, config.enhancement.contrast_scale);
    cv::Mat after_view = EnhanceWarpedImage(img_after, config.enhancement.saturation_scale, config.enhancement.contrast_scale);

    BoardCircle board_circle = DetectBoardCircle(before_view, config.edge, config.circle, debug);
    std::cout << "靶盘圆心: (" << board_circle.cx << ", " << board_circle.cy << "), 半径: " << board_circle.radius << "\n";

    TwoStageAlignmentResult alignment = AlignAfterImageTwoStage(before_view, after_view, board_circle.cx, board_circle.cy, board_circle.radius, debug, config.dart.preprocess_blur_kernel, 2);
    cv::Mat after_view_aligned = WarpImageWithMatrix(after_view, alignment.warp_combined, "affine", before_view.size());
    if (debug) SaveCommonDebugImages(before_view, after_view, after_view_aligned);

    PipelineContext context;
    context.before_view = before_view;
    context.after_view = after_view;
    context.board_circle = board_circle;
    context.alignment = alignment;
    context.after_view_aligned = after_view_aligned;
    context.dart_config = config.dart;
    return context;
}

void DrawResultVisualization(const cv::Mat& img, const BoardCircle& circle, const std::vector<cv::Point>& tips, const std::vector<cv::Point2f>& normalized_positions) {
    cv::Mat result_img = img.clone();
    cv::circle(result_img, cv::Point(circle.cx, circle.cy), 8, cv::Scalar(0, 0, 255), -1);
    cv::circle(result_img, cv::Point(circle.cx, circle.cy), circle.radius, cv::Scalar(0, 255, 0), 3);
    const std::vector<cv::Scalar> colors{{255,0,0},{0,255,0},{0,0,255}};

    for (size_t i = 0; i < tips.size(); ++i) {
        const auto& color = colors[i % colors.size()];
        cv::circle(result_img, tips[i], 10, color, -1);
        cv::line(result_img, cv::Point(circle.cx, circle.cy), tips[i], cv::Scalar(255, 255, 0), 2);
        std::ostringstream label;
        label << std::fixed << std::setprecision(3) << "D" << (i + 1) << ":(" << normalized_positions[i].x << "," << normalized_positions[i].y << ")";
        cv::putText(result_img, label.str(), cv::Point(tips[i].x + 15, tips[i].y), cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(255,255,255), 3);
        cv::putText(result_img, label.str(), cv::Point(tips[i].x + 15, tips[i].y), cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(0,0,0), 1);
    }

    EnsureDirectory(ResultImagesPath());
    cv::imwrite(ResultImagesPath() + "/result.jpg", result_img);
}

}  // namespace

cv::Point2f NormalizePoint(int tip_x, int tip_y, int cx, int cy, int radius) {
    return {static_cast<float>(tip_x - cx) / static_cast<float>(radius), static_cast<float>(tip_y - cy) / static_cast<float>(radius)};
}

std::vector<cv::Point2f> DetectDartPosition(const std::string& img_before_path, const std::string& img_after_path, const PipelineConfig& config, bool debug) {
    PipelineContext context = PreparePipelineContext(img_before_path, img_after_path, config, debug);
    std::vector<cv::Point> tip_points = DetectDartPointsFromGrayImages(context.alignment.before_gray_final, context.alignment.after_gray_final, context.board_circle.cx, context.board_circle.cy, context.board_circle.radius, context.dart_config, debug);

    std::cout << "检测到 " << tip_points.size() << " 支飞镖\n";
    std::vector<cv::Point2f> normalized_positions;
    for (size_t i = 0; i < tip_points.size(); ++i) {
        cv::Point2f normalized = NormalizePoint(tip_points[i].x, tip_points[i].y, context.board_circle.cx, context.board_circle.cy, context.board_circle.radius);
        normalized_positions.push_back(normalized);
        std::cout << "飞镖" << (i + 1) << "尖端: (" << tip_points[i].x << ", " << tip_points[i].y << "), 标准化坐标: (" << normalized.x << ", " << normalized.y << ")\n";
    }

    DrawResultVisualization(context.after_view_aligned, context.board_circle, tip_points, normalized_positions);
    return normalized_positions;
}

SingleDartDetectionResult DetectSingleDartPosition(const std::string& img_before_path, const std::string& img_after_path, const PipelineConfig& config, bool debug) {
    PipelineContext context = PreparePipelineContext(img_before_path, img_after_path, config, debug);
    DartDetectionConfig single_config = config.dart;
    single_config.max_darts = 1;

    SingleDartSelectionResult selection = DetectSingleDartPointFromGrayImages(context.alignment.before_gray_final, context.alignment.after_gray_final, context.board_circle.cx, context.board_circle.cy, context.board_circle.radius, single_config, debug);

    SingleDartDetectionResult result;
    result.has_dart = selection.has_dart;
    result.tip_point = selection.tip_point;
    result.reason = selection.reason;
    if (selection.has_dart && selection.tip_point.has_value()) {
        result.point_norm = NormalizePoint(selection.tip_point->x, selection.tip_point->y, context.board_circle.cx, context.board_circle.cy, context.board_circle.radius);
    }
    return result;
}

}  // namespace bulltrack
