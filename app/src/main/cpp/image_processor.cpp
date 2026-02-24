#include "image_processor.h"
#include <opencv2/imgproc.hpp>

namespace bulltrack {

cv::Mat ImageProcessor::preprocess(const cv::Mat& image) {
    cv::Mat gray = convertToGray(image);
    return applyGaussianBlur(gray, 5);
}

cv::Mat ImageProcessor::convertToGray(const cv::Mat& image) {
    cv::Mat gray;
    if (image.channels() == 3 || image.channels() == 4) {
        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    } else {
        gray = image.clone();
    }
    return gray;
}

cv::Mat ImageProcessor::applyGaussianBlur(const cv::Mat& image, int kernelSize) {
    cv::Mat blurred;
    cv::GaussianBlur(image, blurred, cv::Size(kernelSize, kernelSize), 0);
    return blurred;
}

cv::Mat ImageProcessor::threshold(const cv::Mat& image, double thresh, double maxVal) {
    cv::Mat binary;
    cv::threshold(image, binary, thresh, maxVal, cv::THRESH_BINARY);
    return binary;
}

cv::Mat ImageProcessor::morphologicalClose(const cv::Mat& image, int kernelSize) {
    cv::Mat result;
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(kernelSize, kernelSize));
    cv::morphologyEx(image, result, cv::MORPH_CLOSE, kernel);
    return result;
}

cv::Mat ImageProcessor::morphologicalOpen(const cv::Mat& image, int kernelSize) {
    cv::Mat result;
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(kernelSize, kernelSize));
    cv::morphologyEx(image, result, cv::MORPH_OPEN, kernel);
    return result;
}

cv::Mat ImageProcessor::computeDifference(const cv::Mat& before, const cv::Mat& after) {
    cv::Mat diff;
    cv::absdiff(before, after, diff);
    return diff;
}

}
