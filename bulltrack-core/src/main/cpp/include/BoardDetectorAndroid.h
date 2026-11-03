#pragma once

#include "bulltrack_v2/Config.h"
#include "DebugImageConfig.h"

#include <array>
#include <optional>
#include <vector>

namespace bulltrack {

// Triple and double ring edges measured on the red beds of this board, in the rectified scale
// (1 = outer edge of the red doubles as the seat fit found them).
struct MeasuredRingEdges {
    float triple_inner = 0.0f;
    float triple_outer = 0.0f;
    float double_inner = 0.0f;
    float double_outer = 0.0f;
    int triple_count = 0;
};

struct BoardCircleDetectionResult {
    BoardCircle circle;
    bool success = true;
    std::string error_message;
    cv::Point2f rough_center{};
    float rough_radius = 0.0f;
    float rectified_radius = 0.0f;
    float adaptive_red_l = 0.0f;
    float adaptive_red_a = 0.0f;
    float adaptive_red_b = 0.0f;
    int adaptive_red_sample_count = 0;
    cv::Mat adaptive_red_measurement_base_bgr;
    cv::Rect adaptive_red_sample_rect{};
    std::vector<cv::Point> adaptive_red_sample_points;
    bool perspective_correction_succeeded = false;
    std::vector<cv::Mat> red_radius_selected_component_masks;
    cv::Mat red_radius_inner_removed_binary;
    cv::Mat red_radius_perpendicular_rotated_boxes_debug;
    cv::Mat red_radius_perpendicular_components_binary;
    cv::Mat red_radius_area_grouped_debug;
    cv::Mat perspective_corrected_preview_debug;
    std::vector<cv::Point2f> correction_points_src;
    std::vector<cv::Point2f> correction_points_dst;
    cv::Mat point_rectification_h;
    // Largest bed-to-seat gap after the homography fit (board radii) and how many seats it used.
    double seat_fit_max_residual = 0.0;
    int seat_count = 0;
    // Empty when the measurement failed its checks; scoring then uses the default ring table.
    std::optional<MeasuredRingEdges> measured_ring_edges;
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
