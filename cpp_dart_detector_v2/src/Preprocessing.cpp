#include "Preprocessing.h"

#include "Config.h"

#include <stdexcept>

namespace bulltrack {

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img) {
    cv::Mat hsv;
    cv::cvtColor(img, hsv, cv::COLOR_BGR2HSV);

    cv::Mat red_mask_1;
    cv::Mat red_mask_2;
    cv::Mat red_mask;
    cv::Mat blue_mask;
    cv::Mat green_mask;

    cv::inRange(hsv, cv::Scalar(0, 40, 40), cv::Scalar(10, 255, 255), red_mask_1);
    cv::inRange(hsv, cv::Scalar(170, 40, 40), cv::Scalar(179, 255, 255), red_mask_2);
    cv::bitwise_or(red_mask_1, red_mask_2, red_mask);
    cv::inRange(hsv, cv::Scalar(100, 40, 40), cv::Scalar(125, 255, 255), blue_mask);
    cv::inRange(hsv, cv::Scalar(45, 40, 40), cv::Scalar(85, 255, 255), green_mask);

    return {red_mask, blue_mask, green_mask};
}

cv::Mat ExtractRedOnlyMask(const cv::Mat& img) {
    auto [red_mask, blue_mask, green_mask] = ExtractBoardColorMasks(img);
    (void)blue_mask;
    (void)green_mask;
    return red_mask;
}

cv::Mat PrepareBoardDetectionImage(const cv::Mat& img) {
    auto [red_mask, blue_mask, green_mask] = ExtractBoardColorMasks(img);
    cv::Mat dark_mask;
    cv::bitwise_or(blue_mask, green_mask, dark_mask);

    cv::Mat filtered = img.clone();
    filtered.setTo(cv::Scalar(255, 255, 255), red_mask > 0);
    filtered.setTo(cv::Scalar(0, 0, 0), dark_mask > 0);
    return filtered;
}

cv::Mat PreprocessImage(const cv::Mat& img, int blur_kernel) {
    cv::Mat gray;
    cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    blur_kernel = EnsureOddKernel(blur_kernel);
    if (blur_kernel > 1) {
        for (int i = 0; i < 3; ++i) {
            cv::GaussianBlur(gray, gray, cv::Size(blur_kernel, blur_kernel), 0);
        }
    }
    return gray;
}

cv::Mat EnhanceWarpedImage(const cv::Mat& img, double saturation_scale, double contrast_scale) {
    cv::Mat hsv;
    cv::cvtColor(img, hsv, cv::COLOR_BGR2HSV);
    cv::Mat hsv_f;
    hsv.convertTo(hsv_f, CV_32F);

    std::vector<cv::Mat> channels;
    cv::split(hsv_f, channels);
    channels[1] *= static_cast<float>(saturation_scale);
    cv::min(channels[1], 255.0f, channels[1]);
    cv::max(channels[1], 0.0f, channels[1]);
    cv::merge(channels, hsv_f);

    cv::Mat saturated_hsv;
    hsv_f.convertTo(saturated_hsv, CV_8U);
    cv::Mat saturated_bgr;
    cv::cvtColor(saturated_hsv, saturated_bgr, cv::COLOR_HSV2BGR);

    cv::Mat enhanced;
    cv::convertScaleAbs(saturated_bgr, enhanced, contrast_scale, 0.0);
    return enhanced;
}

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractEdgesWithConnectionRepair(
    const cv::Mat& img,
    int preprocess_blur_kernel,
    int canny_low,
    int canny_high,
    int edge_close_kernel,
    int edge_close_iterations,
    int edge_dilate_iterations) {
    cv::Mat board_detection_img = PrepareBoardDetectionImage(img);
    cv::Mat gray = PreprocessImage(board_detection_img, preprocess_blur_kernel);

    edge_close_kernel = EnsureOddKernel(edge_close_kernel);
    cv::Mat edges;
    cv::Canny(gray, edges, canny_low, canny_high);

    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(edge_close_kernel, edge_close_kernel));
    cv::Mat edges_connected;
    cv::morphologyEx(edges, edges_connected, cv::MORPH_CLOSE, kernel, cv::Point(-1, -1), edge_close_iterations);
    if (edge_dilate_iterations > 0) {
        cv::dilate(edges_connected, edges_connected, kernel, cv::Point(-1, -1), edge_dilate_iterations);
    }

    return {gray, edges, edges_connected};
}

}  // namespace bulltrack
