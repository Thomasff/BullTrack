#ifndef ARUCO_DETECTOR_H
#define ARUCO_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <opencv2/aruco.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <vector>
#include <string>

class ArucoDetector {
public:
    ArucoDetector();
    ~ArucoDetector() = default;

    cv::Mat detectMarkers(const cv::Mat& img, bool debug = false);

private:
    cv::Ptr<cv::aruco::ArucoDetector> detector_;

    bool validateIds(const std::vector<int>& ids) const;
    cv::Mat extractCorners(const std::vector<std::vector<cv::Point2f>>& corners,
                          const std::vector<int>& ids) const;
    void drawDebugImage(const cv::Mat& img,
                        const std::vector<std::vector<cv::Point2f>>& corners,
                        const std::vector<int>& ids) const;
};

#endif
