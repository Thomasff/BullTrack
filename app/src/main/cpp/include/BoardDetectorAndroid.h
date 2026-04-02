#pragma once

#include "bulltrack_v2/Config.h"
#include "DebugImageConfig.h"

#include <array>

namespace bulltrack {

struct BoardCircleDetectionResult {
    BoardCircle circle;
    bool success = true;
    std::string error_message;
    cv::Point2f rough_center{};
    float rough_radius = 0.0f;
    float rectified_radius = 0.0f;
    float adaptive_red_h = 0.0f;
    float adaptive_red_s = 0.0f;
    float adaptive_red_v = 0.0f;
    int adaptive_red_sample_count = 0;
    bool perspective_correction_succeeded = false;
    std::vector<cv::Mat> red_radius_selected_component_masks;
    cv::Mat red_radius_inner_removed_binary;
    cv::Mat red_radius_perpendicular_rotated_boxes_debug;
    cv::Mat red_radius_perpendicular_components_binary;
    cv::Mat red_radius_area_grouped_debug;
    cv::Mat perspective_corrected_preview_debug;
    std::array<cv::Point2f, 4> correction_points_src{};
    std::array<cv::Point2f, 4> correction_points_dst{};
    cv::Mat point_rectification_h;
};

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const cv::Rect& board_box,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const cv::Rect& board_box,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

}  // namespace bulltrack
