#ifndef BOARD_DETECTOR_H
#define BOARD_DETECTOR_H

#include <opencv2/opencv.hpp>

namespace bulltrack {

struct BoardInfo {
    int centerX;
    int centerY;
    int radius;
    bool detected;
};

class BoardDetector {
public:
    BoardDetector() = default;
    ~BoardDetector() = default;
    
    BoardInfo detect(const cv::Mat& image);
    
private:
    cv::Mat preprocessForCircleDetection(const cv::Mat& image);
};

}

#endif
