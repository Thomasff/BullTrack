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

    CircleResult detect(const cv::Mat& img, bool debug = false);

    void setParams(double dp = 1.2, double minDist = 100, int param1 = 50, 
                   int param2 = 50, int minRadius = 50, int maxRadius = 400);

    void drawScoreZones(const cv::Mat& img, const CircleResult& circle,
                        const std::vector<cv::Point>& dart_tips,
                        const std::vector<int>& scores) const;

private:
    double dp_;
    double minDist_;
    int param1_;
    int param2_;
    int minRadius_;
    int maxRadius_;

    static constexpr double BULL_CENTER = 0.1392;
    static constexpr double INNER_SINGLE_START = 0.56708;
    static constexpr double TRIPLE_START = 0.6443;
    static constexpr double OUTER_SINGLE_START = 0.91265;
    static constexpr double DOUBLE_START = 1.0;

    CircleResult selectBestCircle(const std::vector<cv::Vec3f>& circles, 
                                   int imgWidth, int imgHeight) const;
    void drawDebugImage(const cv::Mat& img, 
                        const std::vector<cv::Vec3f>& circles,
                        const CircleResult& best) const;
};

#endif
