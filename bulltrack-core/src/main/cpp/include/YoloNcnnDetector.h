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
    // Dart tip the pose model puts out with the box (image coordinates), also when the tip is
    // hidden behind another dart. tip_score is how sure the model is the dart has a tip in view
    // (not whether it is hidden); boards carry one too, without meaning.
    cv::Point2f tip;
    float tip_score = 0.0f;
};

struct YoloDetectionResult {
    std::vector<YoloDetectionBox> boxes;
    cv::Mat overlay_bgr;
    std::string execution_backend;
    std::string status_detail;
    // Darts scored below the detection threshold. Never counted as darts; the board scan takes
    // their tips for darts YOLO did not box well enough, and debug logs show their scores.
    std::vector<YoloDetectionBox> low_score_dart_boxes;
};

// The model sees only a square of the frame (side = the shorter side); anything outside it is
// never detected. A round starts with the centred square, then moves it along the frame's long
// side to centre the board (BoardCentredSquare) and keeps it for the round.
cv::Rect ModelInputSquare(const cv::Size& image_size);
// The square centred on the board box along the frame's long side, kept inside the frame.
cv::Rect BoardCentredSquare(const cv::Size& image_size, const cv::Rect& board_box);

void SetNcnnAssetManager(AAssetManager* asset_manager);
// Runs YOLO on the CPU even when the GPU works (developer setting); the default uses the GPU.
void SetYoloForceCpu(bool force_cpu);
void WarmUpYoloObjects();
// An empty square means the centred one.
YoloDetectionResult DetectYoloObjects(const cv::Mat& image_bgr, const cv::Rect& square = cv::Rect());

}  // namespace bulltrack
