#ifndef DART_TIP_DETECTOR_H
#define DART_TIP_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <vector>

namespace bulltrack {

struct DetectedTip {
    float x;
    float y;
    float normalizedX;
    float normalizedY;
};

class DartTipDetector {
public:
    DartTipDetector();
    ~DartTipDetector() = default;
    
    std::vector<DetectedTip> detect(
        const cv::Mat& imageBefore,
        const cv::Mat& imageAfter,
        int boardCenterX,
        int boardCenterY,
        int boardRadius,
        int maxDarts = 3
    );
    
    void setMinArea(int area) { minArea_ = area; }
    void setMinAspectRatio(float ratio) { minAspectRatio_ = ratio; }
    
private:
    int minArea_;
    float minAspectRatio_;
    
    cv::Mat computeDiffMask(const cv::Mat& before, const cv::Mat& after);
    std::vector<cv::Rect> findCandidateRegions(const cv::Mat& mask);
    std::vector<cv::Point2i> extractTipsFromRegion(const cv::Mat& mask, const cv::Rect& region);
    DetectedTip normalizePosition(const cv::Point2i& tip, int cx, int cy, int radius);
};

}

#endif
