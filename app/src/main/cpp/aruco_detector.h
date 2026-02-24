#ifndef ARUCO_DETECTOR_H
#define ARUCO_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <vector>

namespace bulltrack {

class ArucoDetector {
public:
    ArucoDetector();
    ~ArucoDetector() = default;
    
    struct DetectionResult {
        std::vector<cv::Point2f> corners;
        std::vector<int> ids;
        bool success;
    };
    
    DetectionResult detect(const cv::Mat& image);
    cv::Mat warpToBoard(const cv::Mat& image, const std::vector<cv::Point2f>& srcPoints, int outputSize = 800);
    
private:
    cv::aruco::ArucoDetector detector_;
};

}

#endif
