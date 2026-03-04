#include "ImagePreprocessor.h"

cv::Mat ImagePreprocessor::preprocess(const cv::Mat& img) const {
    cv::Mat gray = toGray(img);
    return gaussianBlur(gray);
}

cv::Mat ImagePreprocessor::toGray(const cv::Mat& img) const {
    if (img.channels() == 1) {
        return img.clone();
    }
    cv::Mat gray;
    cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    return gray;
}

cv::Mat ImagePreprocessor::gaussianBlur(const cv::Mat& gray, int kernelSize, double sigma) const {
    cv::Mat blurred;
    cv::GaussianBlur(gray, blurred, cv::Size(kernelSize, kernelSize), sigma);
    return blurred;
}
