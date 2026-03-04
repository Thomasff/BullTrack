#include "ArucoDetector.h"
#include <stdexcept>
#include <map>

ArucoDetector::ArucoDetector() : output_size_(800) {
    cv::aruco::Dictionary dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    cv::aruco::DetectorParameters parameters;
    detector_ = cv::makePtr<cv::aruco::ArucoDetector>(dictionary, parameters);
}

cv::Mat ArucoDetector::detectMarkers(const cv::Mat& img) {
    if (img.empty()) {
        throw std::runtime_error("Input image is empty");
    }

    cv::Mat gray;
    if (img.channels() == 1) {
        gray = img;
    } else {
        cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    }

    std::vector<std::vector<cv::Point2f>> corners;
    std::vector<int> ids;
    std::vector<std::vector<cv::Point2f>> rejected;

    detector_->detectMarkers(gray, corners, ids, rejected);

    if (ids.empty()) {
        throw std::runtime_error("No ArUco markers detected");
    }

    if (!validateIds(ids)) {
        throw std::runtime_error("Not all 4 ArUco markers detected (need ID 0,1,2,3), only detected: " + std::to_string(ids.size()));
    }

    cv::Mat src_points = extractCorners(corners, ids);

    cv::Mat dst_points = computeDstPoints();
    homography_matrix_ = cv::findHomography(src_points, dst_points);

    if (homography_matrix_.empty()) {
        throw std::runtime_error("Failed to compute homography matrix");
    }

    return src_points;
}

bool ArucoDetector::validateIds(const std::vector<int>& ids) const {
    std::vector<int> required = {0, 1, 2, 3};
    for (int id : required) {
        bool found = false;
        for (int detected_id : ids) {
            if (detected_id == id) {
                found = true;
                break;
            }
        }
        if (!found) {
            return false;
        }
    }
    return true;
}

cv::Mat ArucoDetector::extractCorners(const std::vector<std::vector<cv::Point2f>>& corners,
                                      const std::vector<int>& ids) const {
    std::map<int, cv::Point2f> corner_map;
    for (size_t i = 0; i < ids.size(); ++i) {
        corner_map[ids[i]] = corners[i][0];
    }

    cv::Mat src_points = cv::Mat::zeros(4, 2, CV_32F);
    for (int i = 0; i < 4; ++i) {
        src_points.at<float>(i, 0) = corner_map[i].x;
        src_points.at<float>(i, 1) = corner_map[i].y;
    }

    return src_points;
}

cv::Mat ArucoDetector::computeDstPoints() const {
    int side_length = output_size_;
    int marker_region_size = 80;
    int vertical_offset = side_length / 6;

    cv::Mat dst_points = (cv::Mat_<float>(4, 2) <<
        0, vertical_offset,
        marker_region_size - 1, vertical_offset,
        0, vertical_offset + marker_region_size - 1,
        marker_region_size - 1, vertical_offset + marker_region_size - 1);

    return dst_points;
}

cv::Mat ArucoDetector::warp(const cv::Mat& img) const {
    if (img.empty()) {
        throw std::runtime_error("Input image is empty");
    }

    if (homography_matrix_.empty()) {
        return img.clone();
    }

    cv::Mat warped;
    cv::warpPerspective(img, warped, homography_matrix_, cv::Size(output_size_, output_size_));
    return warped;
}
