#pragma once

#include "Config.h"

namespace bulltrack {

struct BoardCircleDetectionResult {
    BoardCircle circle;
    bool red_radius_correction_succeeded = false;
    std::vector<cv::Mat> red_radius_selected_component_masks;
    cv::Mat red_radius_inner_removed_binary;
    cv::Mat red_radius_perpendicular_components_binary;
    cv::Mat red_radius_area_grouped_debug;
};

BoardCircleDetectionResult DetectBoardCircleDetailed(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

BoardCircle DetectBoardCircle(
    const cv::Mat& img_before,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    bool debug = false);

}  // namespace bulltrack
