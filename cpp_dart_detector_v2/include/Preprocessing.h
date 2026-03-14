#pragma once

#include <opencv2/opencv.hpp>

#include <tuple>

namespace bulltrack {

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img);
cv::Mat ExtractRedOnlyMask(const cv::Mat& img);
cv::Mat PrepareBoardDetectionImage(const cv::Mat& img);
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
