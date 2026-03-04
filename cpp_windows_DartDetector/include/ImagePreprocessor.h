#ifndef IMAGE_PREPROCESSOR_H
#define IMAGE_PREPROCESSOR_H

#include <opencv2/opencv.hpp>

class ImagePreprocessor {
public:
    ImagePreprocessor() = default;
    ~ImagePreprocessor() = default;

    cv::Mat preprocess(const cv::Mat& img) const;
    cv::Mat toGray(const cv::Mat& img) const;
    cv::Mat gaussianBlur(const cv::Mat& gray, int kernelSize = 5, double sigma = 0) const;
};

#endif
