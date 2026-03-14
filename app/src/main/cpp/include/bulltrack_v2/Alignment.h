#pragma once

#include "bulltrack_v2/Config.h"

#include <string>
#include <tuple>

namespace bulltrack {

cv::Mat ApplyAdditionalGaussianBlur(const cv::Mat& gray, int blur_kernel, int passes = 2);
cv::Mat PrepareEccDiffGrayscale(const cv::Mat& img, int preprocess_blur_kernel = 5, int extra_blur_passes = 2);
cv::Mat BuildBoardMask(const cv::Size& size, int cx, int cy, int radius);
cv::Mat ApplyBoardMask(const cv::Mat& gray, int cx, int cy, int radius);
std::tuple<cv::Mat, cv::Mat, int> NormalizeGrayPairSharedMax(const cv::Mat& before_gray, const cv::Mat& after_gray);
cv::Mat WarpImageWithMatrix(
    const cv::Mat& image,
    const cv::Mat& warp_matrix,
    const std::string& motion_type = "affine",
    const std::optional<cv::Size>& output_size = std::nullopt,
    int interpolation = cv::INTER_LINEAR,
    int border_mode = cv::BORDER_REPLICATE);
PyramidECCResult AlignPyramidEcc(
    const cv::Mat& templ,
    const cv::Mat& target,
    int levels = 3,
    const std::string& motion_type = "affine");
cv::Mat ComposeInverseMapWarps(const cv::Mat& first_warp, const cv::Mat& second_warp);
TwoStageAlignmentResult AlignAfterImageTwoStage(
    const cv::Mat& img_before,
    const cv::Mat& img_after,
    int cx,
    int cy,
    int radius,
    bool debug = false,
    int preprocess_blur_kernel = 5,
    int extra_blur_passes = 2);

}  // namespace bulltrack
