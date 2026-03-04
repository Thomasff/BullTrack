#include "ArucoDetector.h"
#include <stdexcept>
#include <filesystem>
#include <map>

#ifndef DEBUG_IMAGES_PATH
#define DEBUG_IMAGES_PATH "result"
#endif

ArucoDetector::ArucoDetector() {
    cv::aruco::Dictionary dictionary = cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50);
    cv::aruco::DetectorParameters parameters;
    detector_ = cv::makePtr<cv::aruco::ArucoDetector>(dictionary, parameters);
}

cv::Mat ArucoDetector::detectMarkers(const cv::Mat& img, bool debug) {
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

    if (debug) {
        drawDebugImage(img, corners, ids);
    }

    return extractCorners(corners, ids);
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

void ArucoDetector::drawDebugImage(const cv::Mat& img,
                                    const std::vector<std::vector<cv::Point2f>>& corners,
                                    const std::vector<int>& ids) const {
    cv::Mat debug_img = img.clone();

    // 一次性绘制所有检测到的标记
    cv::aruco::drawDetectedMarkers(debug_img, corners, ids, cv::Scalar(0, 255, 0));

    // 绘制ID文字
    for (size_t i = 0; i < ids.size(); ++i) {
        int marker_id = ids[i];
        auto corner = corners[i];

        cv::Point2f pt = corner[0];
        cv::putText(debug_img, "ID:" + std::to_string(marker_id),
                    cv::Point(pt.x, pt.y - 10),
                    cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(0, 255, 0), 2);
    }

    std::string debug_path = std::string(DEBUG_IMAGES_PATH) + "/debug_aruco_markers.jpg";
    
    namespace fs = std::filesystem;
    fs::create_directories(DEBUG_IMAGES_PATH);
    
    cv::imwrite(debug_path, debug_img);
    std::cout << "Debug image saved to: " << debug_path << std::endl;
}
