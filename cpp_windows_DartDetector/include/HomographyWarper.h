#ifndef HOMOGRAPHY_WARPER_H
#define HOMOGRAPHY_WARPER_H

#include <opencv2/opencv.hpp>
#include <string>

class HomographyWarper {
public:
    HomographyWarper();
    ~HomographyWarper() = default;

    cv::Mat warp(const cv::Mat& img, const cv::Mat& src_points, bool debug = false);
    cv::Mat getHomographyMatrix() const;
    cv::Mat warp(const cv::Mat& img) const;

private:
    cv::Mat homography_matrix_;
    int output_size_;

    cv::Mat computeDstPoints() const;
    void saveHomographyMatrix(const std::string& filename) const;
    void drawDebugImage(const cv::Mat& warped) const;
};

#endif
