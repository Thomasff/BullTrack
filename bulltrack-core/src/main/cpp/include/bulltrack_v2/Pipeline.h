#pragma once

#include "bulltrack_v2/Config.h"

#include <string>
#include <vector>

namespace bulltrack {

cv::Point2f NormalizePoint(int tip_x, int tip_y, int cx, int cy, int radius);
std::vector<cv::Point2f> DetectDartPosition(
    const std::string& img_before_path,
    const std::string& img_after_path,
    const PipelineConfig& config,
    bool debug = false);
SingleDartDetectionResult DetectSingleDartPosition(
    const std::string& img_before_path,
    const std::string& img_after_path,
    const PipelineConfig& config,
    bool debug = false);

}  // namespace bulltrack
