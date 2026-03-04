#ifndef HOMOGRAPHY_WARPER_H
#define HOMOGRAPHY_WARPER_H

#include <opencv2/opencv.hpp>
#include <string>

class HomographyWarper {
public:
    HomographyWarper();
    ~HomographyWarper() = default;

    cv::Mat warp(const cv::Mat& img, const cv::Mat& src_points);
    cv::Mat getHomographyMatrix() const;
    cv::Mat warp(const cv::Mat& img) const;
    bool hasHomography() const { return !homography_matrix_.empty(); }

private:
    cv::Mat homography_matrix_;
    int output_size_;

    cv::Mat computeDstPoints() const;
};

#endif
