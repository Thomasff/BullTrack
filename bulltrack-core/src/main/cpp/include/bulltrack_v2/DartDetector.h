#pragma once

#include "bulltrack_v2/Config.h"

#include <optional>
#include <string>
#include <tuple>
#include <vector>

namespace bulltrack {

std::vector<ComponentInfo> ExtractConnectedComponents(const cv::Mat& binary_img);
std::pair<cv::Mat, std::vector<ComponentInfo>> FilterConnectedComponents(
    const cv::Mat& binary_img,
    double min_area = 200.0,
    bool debug = false);
double ComputeComponentMeanGray(const cv::Mat& component_mask, const cv::Mat& gray_img);
std::vector<RankedComponent> RankComponentsByMeanGray(
    const std::vector<ComponentInfo>& components,
    const cv::Mat& gray_img);
std::vector<RankedComponent> SelectDartComponents(
    const std::vector<ComponentInfo>& raw_components,
    const std::vector<ComponentInfo>& filtered_components,
    const cv::Mat& ranking_gray_img,
    int max_darts);
cv::Point ExtractComponentLeftmostPoint(const cv::Mat& component_mask);
std::pair<cv::Mat, cv::Mat> EnhanceDiffImage(
    const cv::Mat& diff,
    int brightness_beta,
    double contrast_alpha,
    double contrast_center);
DiffBinaryOutputs BuildDiffBinaryOutputs(
    const cv::Mat& before_gray,
    const cv::Mat& after_gray_aligned,
    int cx,
    int cy,
    int radius,
    const DartDetectionConfig& config);
std::vector<cv::Point> DetectDartPointsFromGrayImages(
    const cv::Mat& before_gray,
    const cv::Mat& after_gray_aligned,
    int cx,
    int cy,
    int radius,
    const DartDetectionConfig& config,
    bool debug = false);
SingleDartSelectionResult DetectSingleDartPointFromGrayImages(
    const cv::Mat& before_gray,
    const cv::Mat& after_gray_aligned,
    int cx,
    int cy,
    int radius,
    const DartDetectionConfig& config,
    bool debug = false);
std::vector<cv::Point> DetectDartTip(
    const cv::Mat& img_before,
    const cv::Mat& img_after,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    const DartDetectionConfig& dart_config,
    bool debug = false);

}  // namespace bulltrack
