#ifndef IMAGE_PROCESSOR_H
#define IMAGE_PROCESSOR_H

#include <opencv2/opencv.hpp>

namespace bulltrack {

class ImageProcessor {
public:
    static cv::Mat preprocess(const cv::Mat& image);
    static cv::Mat convertToGray(const cv::Mat& image);
    static cv::Mat applyGaussianBlur(const cv::Mat& image, int kernelSize = 5);
    static cv::Mat threshold(const cv::Mat& image, double thresh = 127.0, double maxVal = 255.0);
    static cv::Mat morphologicalClose(const cv::Mat& image, int kernelSize = 3);
    static cv::Mat morphologicalOpen(const cv::Mat& image, int kernelSize = 3);
    static cv::Mat computeDifference(const cv::Mat& before, const cv::Mat& after);
};

}

#endif
