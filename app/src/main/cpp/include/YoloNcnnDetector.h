#pragma once

#include <android/asset_manager.h>
#include <opencv2/opencv.hpp>

#include <string>
#include <vector>

namespace bulltrack {

struct YoloDetectionBox {
    std::string label;
    float score = 0.0f;
    cv::Rect2f rect;
};

struct YoloDetectionResult {
    std::vector<YoloDetectionBox> boxes;
    cv::Mat overlay_bgr;
    std::string execution_backend;
    std::string status_detail;
};

void SetNcnnAssetManager(AAssetManager* asset_manager);
void WarmUpYoloObjects();
YoloDetectionResult DetectYoloObjects(const cv::Mat& image_bgr);

}  // namespace bulltrack
