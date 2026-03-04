#include "HomographyWarper.h"
#include <iostream>
#include <fstream>
#include <filesystem>

#ifndef DEBUG_IMAGES_PATH
#define DEBUG_IMAGES_PATH "result"
#endif

HomographyWarper::HomographyWarper() : output_size_(800) {
}

cv::Mat HomographyWarper::warp(const cv::Mat& img, const cv::Mat& src_points, bool debug) {
    if (img.empty()) {
        throw std::runtime_error("Input image is empty");
    }

    if (src_points.rows != 4 || src_points.cols != 2) {
        throw std::runtime_error("Source points format error, need 4x2 matrix");
    }

    cv::Mat dst_points = computeDstPoints();

    homography_matrix_ = cv::findHomography(src_points, dst_points);

    if (homography_matrix_.empty()) {
        throw std::runtime_error("Failed to compute homography matrix");
    }

    cv::Mat warped;
    cv::warpPerspective(img, warped, homography_matrix_, cv::Size(output_size_, output_size_));

    if (debug) {
        std::string matrix_path = std::string(DEBUG_IMAGES_PATH) + "/homography_matrix.txt";
        saveHomographyMatrix(matrix_path);
        drawDebugImage(warped);
    }

    return warped;
}

cv::Mat HomographyWarper::getHomographyMatrix() const {
    return homography_matrix_;
}

cv::Mat HomographyWarper::warp(const cv::Mat& img) const {
    if (img.empty()) {
        throw std::runtime_error("Input image is empty");
    }

    if (homography_matrix_.empty()) {
        throw std::runtime_error("Homography matrix is empty, call warp(img, src_points) first");
    }

    cv::Mat warped;
    cv::warpPerspective(img, warped, homography_matrix_, cv::Size(output_size_, output_size_));
    return warped;
}

cv::Mat HomographyWarper::computeDstPoints() const {
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

void HomographyWarper::saveHomographyMatrix(const std::string& filename) const {
    namespace fs = std::filesystem;
    fs::create_directories(DEBUG_IMAGES_PATH);

    std::ofstream file(filename);
    if (file.is_open()) {
        file << "Homography Matrix:\n";
        for (int i = 0; i < 3; ++i) {
            for (int j = 0; j < 3; ++j) {
                file << homography_matrix_.at<double>(i, j) << " ";
            }
            file << "\n";
        }
        file.close();
        std::cout << "Homography matrix saved to: " << filename << std::endl;
    }
}

void HomographyWarper::drawDebugImage(const cv::Mat& warped) const {
    std::string warped_path = std::string(DEBUG_IMAGES_PATH) + "/front_view.jpg";
    cv::imwrite(warped_path, warped);
    std::cout << "Warped front view saved to: " << warped_path << std::endl;
}
