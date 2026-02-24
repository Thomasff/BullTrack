#ifndef DART_DETECTOR_H
#define DART_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <vector>

namespace bulltrack {

struct DetectionResult {
    float x;
    float y;
    int sector;
    int ringType;
    int score;
};

class DartDetector {
public:
    DartDetector();
    ~DartDetector();
    
    std::vector<DetectionResult> detect(
        const cv::Mat& imageBefore,
        const cv::Mat& imageAfter,
        bool debug = false
    );
    
    void setMinArea(int area) { minArea_ = area; }
    void setMinAspectRatio(float ratio) { minAspectRatio_ = ratio; }
    
private:
    int minArea_;
    float minAspectRatio_;
    
    cv::Mat preprocessImage(const cv::Mat& img);
    cv::Mat skeletonize(const cv::Mat& binaryImg);
    std::vector<cv::Point2i> detectSkeletonEndpoints(const cv::Mat& skeleton);
    float calculateLocalWidth(const cv::Mat& binaryImg, const cv::Point2i& endpoint, int maxDistance = 15);
    
    std::vector<cv::Rect> filterConnectedComponents(
        const cv::Mat& binaryImg,
        cv::Mat& filteredMask
    );
    
    std::vector<cv::Point2i> extractDartTipsFromComponent(
        const cv::Mat& componentMask,
        int debugIdx = 0
    );
    
    std::vector<cv::Point2i> detectDartTipsPCA(
        const cv::Mat& binaryImg,
        const std::vector<cv::Rect>& components,
        const cv::Mat& labels,
        int maxDarts = 3
    );
};

}

#endif
