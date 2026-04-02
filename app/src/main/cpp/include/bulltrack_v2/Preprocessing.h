#pragma once

#include <opencv2/opencv.hpp>

#include <tuple>
#include <vector>

namespace bulltrack {

struct AdaptiveRedHsvModel {
    float h = 0.0f;
    float s = 0.0f;
    float v = 0.0f;
    int sample_count = 0;
    cv::Rect sample_rect{};
    std::vector<cv::Point> sample_points;
};

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img);
std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img, const AdaptiveRedHsvModel& red_model);
AdaptiveRedHsvModel EstimateAdaptiveRedHsvModel(const cv::Mat& img, int max_sample_count = 40);
cv::Mat ExtractRedOnlyMask(const cv::Mat& img);
cv::Mat ExtractRedOnlyMask(const cv::Mat& img, const AdaptiveRedHsvModel& red_model);
cv::Mat PrepareBoardDetectionImage(const cv::Mat& img);
cv::Mat PrepareBoardDetectionImage(const cv::Mat& img, const AdaptiveRedHsvModel& red_model);
cv::Mat PreprocessImage(const cv::Mat& img, int blur_kernel = 5);
cv::Mat EnhanceWarpedImage(const cv::Mat& img, double saturation_scale = 1.6, double contrast_scale = 0.92);
std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractEdgesWithConnectionRepair(
    const cv::Mat& img,
    int preprocess_blur_kernel = 5,
    int canny_low = 60,
    int canny_high = 140,
    int edge_close_kernel = 5,
    int edge_close_iterations = 1,
    int edge_dilate_iterations = 1);

}  // namespace bulltrack
