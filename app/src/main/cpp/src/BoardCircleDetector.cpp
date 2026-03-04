#include "BoardCircleDetector.h"
#include "ImagePreprocessor.h"
#include <stdexcept>
#include <cmath>
#include <algorithm>

BoardCircleDetector::BoardCircleDetector() 
    : dp_(1.2), minDist_(100), param1_(50), param2_(50), minRadius_(50), maxRadius_(400) {
}

CircleResult BoardCircleDetector::detect(const cv::Mat& img) {
    if (img.empty()) {
        throw std::runtime_error("Input image is empty");
    }

    cv::Mat gray;
    if (img.channels() == 1) {
        gray = img;
    } else {
        cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    }

    ImagePreprocessor preprocessor;
    gray = preprocessor.gaussianBlur(gray);

    int height = gray.rows;
    int width = gray.cols;

    minDist_ = std::min(height, width) / 4;
    maxRadius_ = std::min(height, width) / 2 - 10;

    std::vector<cv::Vec3f> circles;
    cv::HoughCircles(gray, circles, cv::HOUGH_GRADIENT, dp_, minDist_,
                     param1_, param2_, minRadius_, maxRadius_);

    if (circles.empty()) {
        throw std::runtime_error("No board circle detected");
    }

    CircleResult best = selectBestCircle(circles, width, height);

    return best;
}

void BoardCircleDetector::setParams(double dp, double minDist, int param1, 
                                     int param2, int minRadius, int maxRadius) {
    dp_ = dp;
    minDist_ = minDist;
    param1_ = param1;
    param2_ = param2;
    minRadius_ = minRadius;
    maxRadius_ = maxRadius;
}

CircleResult BoardCircleDetector::selectBestCircle(const std::vector<cv::Vec3f>& circles,
                                                   int imgWidth, int imgHeight) const {
    int center_x = imgWidth / 2;
    int center_y = imgHeight / 2;

    double max_radius = static_cast<double>(maxRadius_);

    CircleResult best;
    best.score = -1.0;

    for (const auto& circle : circles) {
        float cx = circle[0];
        float cy = circle[1];
        float R = circle[2];

        double dist_to_center = std::sqrt(std::pow(cx - center_x, 2) + std::pow(cy - center_y, 2));

        double center_score = 1.0 / (1.0 + dist_to_center / 100.0);
        double radius_score = R / max_radius;
        double total_score = center_score * 0.7 + radius_score * 0.3;

        if (total_score > best.score) {
            best.score = total_score;
            best.cx = static_cast<int>(cx);
            best.cy = static_cast<int>(cy);
            best.radius = static_cast<int>(R);
        }
    }

    return best;
}
