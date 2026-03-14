#pragma once

#include <opencv2/opencv.hpp>

#include <optional>
#include <string>
#include <vector>

namespace bulltrack {

struct EdgeDetectionConfig {
    int preprocess_blur_kernel = 5;
    int canny_low = 90;
    int canny_high = 150;
    int close_kernel = 3;
    int close_iterations = 1;
    int dilate_iterations = 1;
};

struct CircleDetectionConfig {
    double line_rho = 1.0;
    double line_theta = CV_PI / 180.0;
    int line_threshold = 80;
    int line_min_length = 40;
    int line_max_gap = 12;
    double line_intersection_min_length = 60.0;
    double max_abs_slope = 6.4;
    int red_region_min_area = 400;
    int red_region_open_kernel = 3;
    int red_region_open_iterations = 1;
    int red_region_dilate_kernel = 3;
    int red_region_dilate_iterations = 1;
    double red_region_perpendicular_min_angle_deg = 75.0;
    double red_region_perpendicular_max_angle_deg = 105.0;
};

struct DartDetectionConfig {
    int preprocess_blur_kernel = 5;
    double min_area = 200.0;
    int diff_brightness_beta = 50;
    double diff_contrast_alpha = 2.5;
    double diff_contrast_center = 110.0;
    int diff_open_kernel = 5;
    int diff_open_iterations = 2;
    int diff_close_kernel = 7;
    int diff_close_iterations = 2;
    int diff_dilate_kernel = 5;
    int diff_dilate_iterations = 1;
    int max_darts = 3;
};

struct EnhancementConfig {
    double saturation_scale = 1.6;
    double contrast_scale = 0.92;
};

struct PipelineConfig {
    EdgeDetectionConfig edge;
    CircleDetectionConfig circle;
    DartDetectionConfig dart;
    EnhancementConfig enhancement;
};

struct ExperimentConfig {
    int max_images = 10;
    int long_edge = 720;
    int levels = 3;
    std::string motion_type = "affine";
    int diff_blur_kernel = 5;
    int diff_brightness_beta = 50;
    double diff_contrast_alpha = 2.5;
    double diff_contrast_center = 110.0;
};

struct BoardCircle {
    int cx = 0;
    int cy = 0;
    int radius = 0;
};

struct TwoStageAlignmentResult {
    cv::Mat before_gray_stage1;
    cv::Mat after_gray_stage1;
    cv::Mat after_gray_stage1_aligned;
    cv::Mat before_gray_masked;
    cv::Mat after_gray_masked;
    cv::Mat before_gray_final;
    cv::Mat after_gray_final;
    int shared_gray_max = 0;
    cv::Mat warp_stage1;
    cv::Mat warp_stage2;
    cv::Mat warp_combined;
};

struct PyramidECCResult {
    cv::Mat aligned_target;
    cv::Mat warp_matrix;
    double correlation = 0.0;
    std::vector<double> level_correlations;
    std::vector<int> level_iterations;
    std::string motion_type;
};

struct ComponentInfo {
    int label = 0;
    int area = 0;
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    cv::Mat mask;
};

struct RankedComponent {
    ComponentInfo component;
    double mean_gray = 0.0;
};

struct DiffBinaryOutputs {
    cv::Mat diff;
    cv::Mat board_masked_diff;
    cv::Mat brightened_diff;
    cv::Mat contrast_diff;
    cv::Mat thresh;
    cv::Mat opened;
    cv::Mat closed;
    cv::Mat dilated;
    cv::Mat binary_img;
    int max_value = 0;
    int threshold_value = 0;
};

struct SingleDartSelectionResult {
    bool has_dart = false;
    std::optional<cv::Point> tip_point;
    std::string reason;
    int raw_component_count = 0;
    int filtered_component_count = 0;
};

struct SingleDartDetectionResult {
    bool has_dart = false;
    std::optional<cv::Point> tip_point;
    std::optional<cv::Point2f> point_norm;
    std::string reason;
};

struct PipelineContext {
    cv::Mat before_view;
    cv::Mat after_view;
    BoardCircle board_circle;
    TwoStageAlignmentResult alignment;
    cv::Mat after_view_aligned;
    DartDetectionConfig dart_config;
};

std::string DebugImagesPath();
std::string ResultImagesPath();
void EnsureDirectory(const std::string& path);
int EnsureOddKernel(int kernel_size);

}  // namespace bulltrack
