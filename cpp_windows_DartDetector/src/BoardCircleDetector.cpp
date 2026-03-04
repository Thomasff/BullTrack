#include "BoardCircleDetector.h"
#include "ImagePreprocessor.h"
#include <stdexcept>
#include <cmath>
#include <algorithm>
#include <filesystem>

#ifndef DEBUG_IMAGES_PATH
#define DEBUG_IMAGES_PATH "result"
#endif

BoardCircleDetector::BoardCircleDetector() 
    : dp_(1.2), minDist_(100), param1_(50), param2_(50), minRadius_(50), maxRadius_(400) {
}

CircleResult BoardCircleDetector::detect(const cv::Mat& img, bool debug) {
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

    if (debug) {
        drawDebugImage(img, circles, best);
    }

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

void BoardCircleDetector::drawDebugImage(const cv::Mat& img,
                                         const std::vector<cv::Vec3f>& circles,
                                         const CircleResult& best) const {
    namespace fs = std::filesystem;
    fs::create_directories(DEBUG_IMAGES_PATH);

    cv::Mat debug_img_all = img.clone();
    for (size_t i = 0; i < circles.size(); ++i) {
        cv::Vec3f circle = circles[i];
        cv::Point center(cvRound(circle[0]), cvRound(circle[1]));
        int radius = cvRound(circle[2]);

        cv::Scalar color = (i == 0) ? cv::Scalar(0, 255, 0) : cv::Scalar(255, 0, 0);
        cv::circle(debug_img_all, center, radius, color, 2);
        cv::circle(debug_img_all, center, 5, color, -1);

        std::string text = "R=" + std::to_string(radius);
        cv::putText(debug_img_all, text, cv::Point(center.x - 30, center.y - radius - 10),
                    cv::FONT_HERSHEY_SIMPLEX, 0.5, color, 1);
    }

    std::string debug_path_all = std::string(DEBUG_IMAGES_PATH) + "/debug_00_all_circles.jpg";
    cv::imwrite(debug_path_all, debug_img_all);
    std::cout << "Debug image saved to: " << debug_path_all << " (detected " << circles.size() << " circles)" << std::endl;

    cv::Mat debug_img = img.clone();
    cv::Point center(best.cx, best.cy);
    cv::circle(debug_img, center, 8, cv::Scalar(0, 0, 255), -1);
    cv::circle(debug_img, center, best.radius, cv::Scalar(0, 255, 0), 3);

    cv::putText(debug_img, "Center: (" + std::to_string(best.cx) + ", " + std::to_string(best.cy) + ")",
                cv::Point(best.cx - 100, best.cy - best.radius - 20),
                cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 255, 0), 2);
    cv::putText(debug_img, "Radius: " + std::to_string(best.radius),
                cv::Point(best.cx - 100, best.cy - best.radius + 10),
                cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 255, 0), 2);

    cv::Point img_center(img.cols / 2, img.rows / 2);
    cv::circle(debug_img, img_center, 5, cv::Scalar(255, 255, 0), -1);
    cv::putText(debug_img, "Image Center", cv::Point(img_center.x + 10, img_center.y),
                cv::FONT_HERSHEY_SIMPLEX, 0.6, cv::Scalar(255, 255, 0), 1);

    std::string debug_path = std::string(DEBUG_IMAGES_PATH) + "/debug_00_board_circle.jpg";
    cv::imwrite(debug_path, debug_img);
    std::cout << "Debug image saved to: " << debug_path << std::endl;
}

void BoardCircleDetector::drawScoreZones(const cv::Mat& img, const CircleResult& circle,
                                         const std::vector<cv::Point>& dart_tips,
                                         const std::vector<int>& scores) const {
    namespace fs = std::filesystem;
    fs::create_directories(DEBUG_IMAGES_PATH);

    cv::Mat debug_img = img.clone();

    int R = circle.radius;
    int cx = circle.cx;
    int cy = circle.cy;

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * DOUBLE_START), cv::Scalar(200, 200, 200), 1);
    cv::putText(debug_img, "DOUBLE", cv::Point(cx + cvRound(R * 0.9), cy - 10),
                cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(200, 200, 200), 1);

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * OUTER_SINGLE_START), cv::Scalar(0, 255, 255), 1);
    cv::putText(debug_img, "SINGLE", cv::Point(cx + cvRound(R * 0.7), cy - 10),
                cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(0, 255, 255), 1);

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * TRIPLE_START), cv::Scalar(0, 0, 255), 1);
    cv::putText(debug_img, "TRIPLE", cv::Point(cx + cvRound(R * 0.35), cy - 10),
                cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(0, 0, 255), 1);

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * INNER_SINGLE_START), cv::Scalar(255, 0, 255), 1);
    cv::putText(debug_img, "SINGLE", cv::Point(cx + cvRound(R * 0.25), cy - 10),
                cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(255, 0, 255), 1);

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * BULL_CENTER), cv::Scalar(0, 255, 0), -1);
    cv::putText(debug_img, "50", cv::Point(cx - 8, cy + 4),
                cv::FONT_HERSHEY_SIMPLEX, 0.4, cv::Scalar(0, 0, 0), 1);

    cv::circle(debug_img, cv::Point(cx, cy), cvRound(R * INNER_SINGLE_START), cv::Scalar(0, 255, 0), 1);

    std::vector<cv::Scalar> colors = {
        cv::Scalar(255, 0, 0), cv::Scalar(0, 255, 0), cv::Scalar(0, 0, 255)
    };

    for (size_t i = 0; i < dart_tips.size(); ++i) {
        cv::Scalar color = colors[i % colors.size()];
        cv::circle(debug_img, dart_tips[i], 12, color, -1);
        cv::circle(debug_img, dart_tips[i], 14, cv::Scalar(255, 255, 255), 2);

        std::string label = "D" + std::to_string(i + 1) + ":" + std::to_string(scores[i]);
        cv::putText(debug_img, label, cv::Point(dart_tips[i].x + 15, dart_tips[i].y - 15),
                    cv::FONT_HERSHEY_SIMPLEX, 0.6, cv::Scalar(255, 255, 255), 2);
        cv::putText(debug_img, label, cv::Point(dart_tips[i].x + 15, dart_tips[i].y - 15),
                    cv::FONT_HERSHEY_SIMPLEX, 0.6, color, 1);
    }

    int total_score = 0;
    for (int s : scores) total_score += s;
    std::string total_label = "Total: " + std::to_string(total_score);
    cv::putText(debug_img, total_label, cv::Point(10, 30),
                cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(0, 255, 0), 2);

    std::string debug_path = std::string(DEBUG_IMAGES_PATH) + "/debug_00_board_circle.jpg";
    cv::imwrite(debug_path, debug_img);
    std::cout << "Debug image saved to: " << debug_path << std::endl;
}
