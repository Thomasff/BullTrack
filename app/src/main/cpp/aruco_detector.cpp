#include "aruco_detector.h"
#include <opencv2/objdetect/aruco_detector.hpp>

namespace bulltrack {

ArucoDetector::ArucoDetector() {
    cv::aruco::Dictionary dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    cv::aruco::DetectorParameters parameters = cv::aruco::DetectorParameters();
    detector_ = cv::aruco::ArucoDetector(dictionary, parameters);
}

ArucoDetector::DetectionResult ArucoDetector::detect(const cv::Mat& image) {
    DetectionResult result;
    result.success = false;
    
    cv::Mat gray;
    if (image.channels() == 3) {
        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    } else {
        gray = image;
    }
    
    std::vector<std::vector<cv::Point2f>> corners;
    std::vector<int> ids;
    std::vector<std::vector<cv::Point2f>> rejected;
    
    detector_.detectMarkers(gray, corners, ids, rejected);
    
    if (ids.empty()) {
        return result;
    }
    
    std::vector<int> requiredIds = {0, 1, 2, 3};
    std::vector<cv::Point2f> orderedPoints(4);
    bool allFound = true;
    
    for (int reqId : requiredIds) {
        bool found = false;
        for (size_t i = 0; i < ids.size(); i++) {
            if (ids[i] == reqId) {
                orderedPoints[reqId] = corners[i][0];
                found = true;
                break;
            }
        }
        if (!found) {
            allFound = false;
            break;
        }
    }
    
    if (!allFound) {
        return result;
    }
    
    result.corners = orderedPoints;
    result.ids = requiredIds;
    result.success = true;
    
    return result;
}

cv::Mat ArucoDetector::warpToBoard(const cv::Mat& image, const std::vector<cv::Point2f>& srcPoints, int outputSize) {
    int verticalOffset = outputSize / 6;
    int markerRegionSize = 80;
    
    std::vector<cv::Point2f> dstPoints = {
        cv::Point2f(0, verticalOffset),
        cv::Point2f(markerRegionSize - 1, verticalOffset),
        cv::Point2f(0, verticalOffset + markerRegionSize - 1),
        cv::Point2f(markerRegionSize - 1, verticalOffset + markerRegionSize - 1)
    };
    
    cv::Mat H = cv::findHomography(srcPoints, dstPoints, cv::RANSAC, 5.0);
    
    cv::Mat warped;
    cv::warpPerspective(image, warped, H, cv::Size(outputSize, outputSize));
    
    return warped;
}

}
