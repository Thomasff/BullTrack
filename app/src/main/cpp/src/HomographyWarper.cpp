#include "HomographyWarper.h"
#include <stdexcept>

HomographyWarper::HomographyWarper() : output_size_(800) {
}

cv::Mat HomographyWarper::warp(const cv::Mat& img, const cv::Mat& src_points) {
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
        return img.clone();
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
