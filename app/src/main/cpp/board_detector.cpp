#include "board_detector.h"
#include <opencv2/imgproc.hpp>
#include <cmath>
#include <algorithm>

namespace bulltrack {

cv::Mat BoardDetector::preprocessForCircleDetection(const cv::Mat& image) {
    cv::Mat gray;
    if (image.channels() == 3) {
        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    } else {
        gray = image.clone();
    }
    
    cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);
    return gray;
}

BoardInfo BoardDetector::detect(const cv::Mat& image) {
    BoardInfo info;
    info.detected = false;
    
    cv::Mat gray = preprocessForCircleDetection(image);
    
    int height = gray.rows;
    int width = gray.cols;
    int minDist = std::min(height, width) / 4;
    int maxRadius = std::min(height, width) / 2 - 10;
    
    std::vector<cv::Vec3f> circles;
    cv::HoughCircles(
        gray,
        circles,
        cv::HOUGH_GRADIENT,
        1.2,
        minDist,
        50,
        50,
        50,
        maxRadius
    );
    
    if (circles.empty()) {
        return info;
    }
    
    int imageCenterX = width / 2;
    int imageCenterY = height / 2;
    
    float bestScore = -1;
    cv::Vec3f bestCircle;
    
    for (const auto& circle : circles) {
        int cx = static_cast<int>(circle[0]);
        int cy = static_cast<int>(circle[1]);
        int r = static_cast<int>(circle[2]);
        
        float distToCenter = std::sqrt(static_cast<float>(
            (cx - imageCenterX) * (cx - imageCenterX) +
            (cy - imageCenterY) * (cy - imageCenterY)
        ));
        
        float centerScore = 1.0f / (1.0f + distToCenter / 100.0f);
        float radiusScore = static_cast<float>(r) / maxRadius;
        float totalScore = centerScore * 0.7f + radiusScore * 0.3f;
        
        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestCircle = circle;
        }
    }
    
    info.centerX = static_cast<int>(bestCircle[0]);
    info.centerY = static_cast<int>(bestCircle[1]);
    info.radius = static_cast<int>(bestCircle[2]);
    info.detected = true;
    
    return info;
}

}
