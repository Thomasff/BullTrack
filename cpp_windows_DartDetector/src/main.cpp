#include <iostream>
#include <string>
#include <vector>
#include <cmath>
#include <filesystem>
#include <cctype>

#include <opencv2/opencv.hpp>

#include "ImagePreprocessor.h"
#include "ArucoDetector.h"
#include "HomographyWarper.h"
#include "BoardCircleDetector.h"
#include "DartDetector.h"
#include "DartScorer.h"

#ifndef DEBUG_IMAGES_PATH
#define DEBUG_IMAGES_PATH "result"
#endif

void printUsage(const char* program_name) {
    std::cout << "Dart Auto Scoring System v1.0\n\n";
    std::cout << "Usage: " << program_name << " <before_image> <after_image> [options]\n\n";
    std::cout << "Arguments:\n";
    std::cout << "  before_image    Empty board image path\n";
    std::cout << "  after_image     Image with darts path\n\n";
    std::cout << "Options:\n";
    std::cout << "  --debug              Generate debug images\n";
    std::cout << "  --min-area <value>   Minimum component area (default: 200)\n";
    std::cout << "  --min-aspect-ratio <value>  Minimum aspect ratio (default: 1.5)\n";
    std::cout << "  --help               Show help\n\n";
    std::cout << "Examples:\n";
    std::cout << "  " << program_name << " before.jpg after.jpg --debug\n";
    std::cout << "  " << program_name << " before.jpg after.jpg --min-area 150 --min-aspect-ratio 2.5\n";
}

struct CommandLineArgs {
    std::string before_image_path;
    std::string after_image_path;
    bool debug = false;
    double min_area = 200.0;
    double min_aspect_ratio = 1.5;
};

bool parseArgs(int argc, char* argv[], CommandLineArgs& args) {
    if (argc < 3) {
        return false;
    }

    args.before_image_path = argv[1];
    args.after_image_path = argv[2];

    for (int i = 3; i < argc; ++i) {
        std::string arg = argv[i];
        
        if (arg == "--debug") {
            args.debug = true;
        } else if (arg == "--help" || arg == "-h") {
            return false;
        } else if (arg == "--min-area" && i + 1 < argc) {
            args.min_area = std::stod(argv[++i]);
        } else if (arg == "--min-aspect-ratio" && i + 1 < argc) {
            args.min_aspect_ratio = std::stod(argv[++i]);
        }
    }

    return true;
}

std::pair<double, double> normalizeCoordinates(int tip_x, int tip_y, int cx, int cy, int R) {
    double x_norm = static_cast<double>(tip_x - cx) / static_cast<double>(R);
    double y_norm = static_cast<double>(tip_y - cy) / static_cast<double>(R);
    return {x_norm, y_norm};
}

void drawResultVisualization(const cv::Mat& img, 
                             const cv::Point& circle_center, 
                             int radius,
                             const std::vector<cv::Point>& tips,
                             const std::vector<std::pair<double, double>>& normalized_positions) {
    cv::Mat result_img = img.clone();

    cv::circle(result_img, circle_center, 8, cv::Scalar(0, 0, 255), -1);
    cv::circle(result_img, circle_center, radius, cv::Scalar(0, 255, 0), 3);

    std::vector<cv::Scalar> colors = {
        cv::Scalar(255, 0, 0), cv::Scalar(0, 255, 0), cv::Scalar(0, 0, 255)
    };

    for (size_t i = 0; i < tips.size(); ++i) {
        cv::Scalar color = colors[i % colors.size()];
        double x_norm = normalized_positions[i].first;
        double y_norm = normalized_positions[i].second;

        cv::circle(result_img, tips[i], 10, color, -1);
        cv::line(result_img, circle_center, tips[i], cv::Scalar(255, 255, 0), 2);

        std::string text = "D" + std::to_string(i + 1) + ":(" + 
                          std::to_string(x_norm).substr(0, 5) + "," + 
                          std::to_string(y_norm).substr(0, 5) + ")";
        
        cv::putText(result_img, text, cv::Point(tips[i].x + 15, tips[i].y),
                   cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(255, 255, 255), 3);
        cv::putText(result_img, text, cv::Point(tips[i].x + 15, tips[i].y),
                   cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(0, 0, 0), 1);
    }

    namespace fs = std::filesystem;
    fs::create_directories("images");
    std::string result_path = "images/result.jpg";
    cv::imwrite(result_path, result_img);
    std::cout << "Result visualization saved to: " << result_path << std::endl;
}

int main(int argc, char* argv[]) {
    CommandLineArgs args;

    if (!parseArgs(argc, argv, args)) {
        printUsage(argv[0]);
        return 1;
    }

    try {
        std::cout << "=== Dart Auto Scoring System ===\n\n";

        namespace fs = std::filesystem;
        if (!fs::exists(args.before_image_path)) {
            std::cerr << "Error: Image not found: " << args.before_image_path << std::endl;
            return 1;
        }
        if (!fs::exists(args.after_image_path)) {
            std::cerr << "Error: Image not found: " << args.after_image_path << std::endl;
            return 1;
        }

        std::cout << "Step 1: Loading images\n";
        cv::Mat img_before = cv::imread(args.before_image_path);
        cv::Mat img_after = cv::imread(args.after_image_path);

        if (img_before.empty()) {
            std::cerr << "Error: Cannot read image: " << args.before_image_path << std::endl;
            return 1;
        }
        if (img_after.empty()) {
            std::cerr << "Error: Cannot read image: " << args.after_image_path << std::endl;
            return 1;
        }
        std::cout << "  - Before image: " << args.before_image_path 
                  << " (" << img_before.cols << "x" << img_before.rows << ")\n";
        std::cout << "  - After image: " << args.after_image_path 
                  << " (" << img_after.cols << "x" << img_after.rows << ")\n\n";

        fs::create_directories(DEBUG_IMAGES_PATH);

        std::cout << "Step 2: Detecting ArUco markers\n";
        ArucoDetector aruco_detector;
        cv::Mat src_points = aruco_detector.detectMarkers(img_before, args.debug);
        std::cout << "  - Detected 4 ArUco markers\n\n";

        std::cout << "Step 3: Image alignment (homography warp)\n";
        HomographyWarper warper;
        cv::Mat warped_before = warper.warp(img_before, src_points, args.debug);
        cv::Mat warped_after = warper.warp(img_after);

        if (args.debug) {
            std::string warped_after_path = std::string(DEBUG_IMAGES_PATH) + "/front_view_after.jpg";
            cv::imwrite(warped_after_path, warped_after);
            std::cout << "  - Warped after image saved\n";
        }
        std::cout << "  - Warped image size: " << warped_before.cols << "x" << warped_before.rows << "\n\n";

        std::cout << "Step 4: Board circle detection\n";
        BoardCircleDetector circle_detector;
        CircleResult circle = circle_detector.detect(warped_before, args.debug);
        std::cout << "  - Center: (" << circle.cx << ", " << circle.cy << ")\n";
        std::cout << "  - Radius: " << circle.radius << "\n\n";

        std::cout << "Step 5: Dart detection\n";
        DartDetector dart_detector(args.min_area, args.min_aspect_ratio);
        std::vector<cv::Point> tip_points = dart_detector.detect(warped_before, warped_after, args.debug);
        std::cout << "  - Detected " << tip_points.size() << " darts\n\n";

        std::cout << "=== Detection Results ===\n\n";
        std::vector<std::pair<double, double>> normalized_positions;

        for (size_t i = 0; i < tip_points.size(); ++i) {
            auto [x_norm, y_norm] = normalizeCoordinates(
                tip_points[i].x, tip_points[i].y, 
                circle.cx, circle.cy, circle.radius
            );
            normalized_positions.push_back({x_norm, y_norm});

            double distance = std::sqrt(x_norm * x_norm + y_norm * y_norm);

            std::cout << "Dart" << (i + 1) << ":\n";
            std::cout << "  Tip position: (" << tip_points[i].x << ", " << tip_points[i].y << ")\n";
            std::cout << "  Normalized: (" << x_norm << ", " << y_norm << ")\n";
            std::cout << "  Distance from center: " << distance << "\n\n";
        }

        std::cout << "Step 6: Calculating scores\n";
        DartScorer scorer;
        std::vector<DartScorer::ScoreResult> score_results = scorer.scoreDarts(normalized_positions);

        std::vector<int> scores;
        for (const auto& result : score_results) {
            scores.push_back(result.score);
        }
        circle_detector.drawScoreZones(warped_after, circle, tip_points, scores);

        int total_score = 0;
        std::cout << "\n=== Score Summary ===\n";
        for (size_t i = 0; i < score_results.size(); ++i) {
            std::cout << "Dart" << (i + 1) << ": " << score_results[i].score << " points (" << score_results[i].zone << ")\n";
            total_score += score_results[i].score;
        }
        std::cout << "\nTotal Score: " << total_score << "\n\n";

        std::cout << "Step 7: Generating result image\n";
        drawResultVisualization(warped_after, cv::Point(circle.cx, circle.cy), 
                               circle.radius, tip_points, normalized_positions);

        std::cout << "=== Complete ===\n";

        return 0;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }
}
