#pragma once

#include <opencv2/opencv.hpp>

#include <tuple>
#include <vector>

namespace bulltrack {

struct AdaptiveRedLabModel {
    float l = 0.0f;
    float a = 0.0f;
    float b = 0.0f;
    int sample_count = 0;
    cv::Rect sample_rect{};
    std::vector<cv::Point> sample_points;
};

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img);
std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img, const AdaptiveRedLabModel& red_model);
// With reddest_share above 0 only the reddest samples (highest Lab a), as many as this share of the
// image's pixels, set the reference.
AdaptiveRedLabModel EstimateAdaptiveRedLabModel(const cv::Mat& img, double reddest_share = 0.0);
cv::Mat ExtractRedOnlyMask(const cv::Mat& img);
cv::Mat ExtractRedOnlyMask(const cv::Mat& img, const AdaptiveRedLabModel& red_model);
cv::Mat PrepareBoardDetectionImage(const cv::Mat& img);
cv::Mat PrepareBoardDetectionImage(const cv::Mat& img, const AdaptiveRedLabModel& red_model);
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
