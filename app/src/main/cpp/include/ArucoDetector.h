#ifndef ARUCO_DETECTOR_H
#define ARUCO_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <opencv2/objdetect/aruco_dictionary.hpp>
#include <vector>
#include <string>

class ArucoDetector {
public:
    ArucoDetector();
    ~ArucoDetector() = default;

    cv::Mat detectMarkers(const cv::Mat& img);
    bool hasHomography() const { return !homography_matrix_.empty(); }

    cv::Mat warp(const cv::Mat& img) const;
    void setOutputSize(int size) { output_size_ = size; }

private:
    cv::Ptr<cv::aruco::ArucoDetector> detector_;
    cv::Mat homography_matrix_;
    int output_size_;

    bool validateIds(const std::vector<int>& ids) const;
    cv::Mat extractCorners(const std::vector<std::vector<cv::Point2f>>& corners,
                          const std::vector<int>& ids) const;
    cv::Mat computeDstPoints() const;
};

#endif
