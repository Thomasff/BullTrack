#ifndef DART_DETECTOR_H
#define DART_DETECTOR_H

#include <opencv2/opencv.hpp>
#include <vector>
#include <string>

struct DartResult {
    int x;
    int y;
    double x_norm;
    double y_norm;
    double distance;
};

struct ComponentInfo {
    int label;
    int area;
    int x;
    int y;
    int width;
    int height;
    double aspect_ratio;
    cv::Mat mask;
};

class DartDetector {
public:
    DartDetector(double min_area = 200, double min_aspect_ratio = 3.0);
    ~DartDetector() = default;

    std::vector<cv::Point> detect(const cv::Mat& img_before, 
                                   const cv::Mat& img_after, 
                                   bool debug = false);

    void setParams(double min_area, double min_aspect_ratio);

private:
    double min_area_;
    double min_aspect_ratio_;

    cv::Mat preprocessDiff(const cv::Mat& gray_before, const cv::Mat& gray_after) const;
    std::vector<ComponentInfo> filterComponents(const cv::Mat& binary_img, bool debug = false) const;
    std::vector<cv::Point> extractTipFromComponent(const cv::Mat& component_mask, 
                                                    int debug_idx, 
                                                    bool debug = false) const;
    cv::Vec2d computePCADirection(const std::vector<cv::Point>& points, cv::Point2d& mean) const;
    void drawDebugImages(const cv::Mat& diff, 
                         const cv::Mat& thresh,
                         const std::vector<ComponentInfo>& components,
                         const std::vector<cv::Point>& tips) const;
};

#endif
