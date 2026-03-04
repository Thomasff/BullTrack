#ifndef BOARD_CIRCLE_DETECTOR_H
#define BOARD_CIRCLE_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <string>
#include <vector>

struct CircleResult {
    int cx;
    int cy;
    int radius;
    double score;
};

class BoardCircleDetector {
public:
    BoardCircleDetector();
    ~BoardCircleDetector() = default;

    CircleResult detect(const cv::Mat& img);

    void setParams(double dp = 1.2, double minDist = 100, int param1 = 50, 
                   int param2 = 50, int minRadius = 50, int maxRadius = 400);

private:
    double dp_;
    double minDist_;
    int param1_;
    int param2_;
    int minRadius_;
    int maxRadius_;

    CircleResult selectBestCircle(const std::vector<cv::Vec3f>& circles, 
                                   int imgWidth, int imgHeight) const;
};

#endif
