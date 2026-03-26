#pragma once

#include "bulltrack_v2/Config.h"
#include "DebugImageConfig.h"
#include "YoloNcnnDetector.h"

#include <opencv2/opencv.hpp>

#include <optional>
#include <cstdint>
#include <string>
#include <tuple>
#include <vector>

namespace bulltrack {

struct DebugImageArtifact {
    std::string file_name;
    std::vector<std::uint8_t> jpeg_bytes;
};

struct AndroidStartRoundResult {
    std::vector<DebugImageArtifact> debug_images;
};

struct AndroidFrameProcessResult {
    bool gate_triggered = false;
    std::string gate_reason;
    bool has_detection = false;
    std::optional<cv::Point2f> detected_point_norm;
    std::vector<DebugImageArtifact> gate_debug_images;
    std::vector<DebugImageArtifact> precise_debug_images;
};

struct AndroidRedetectResult {
    std::vector<cv::Point2f> points;
    std::vector<DebugImageArtifact> debug_images;
    std::string yolo_status;
};

struct TrackedYoloFrameState {
    int frame_index = 0;
    cv::Mat frame_bgr;
    cv::Mat reference_board_crop_bgr;
    cv::Mat detected_board_crop_bgr;
    cv::Rect board_box{};
    bool has_board_box = false;
    std::vector<YoloDetectionBox> dart_boxes;
    cv::Mat overlay_bgr;
    std::string yolo_status;
};

struct PendingYoloCandidateState {
    TrackedYoloFrameState base_frame;
    TrackedYoloFrameState candidate_frame;
};

class AndroidBullTrackSession {
public:
    AndroidBullTrackSession();

    AndroidStartRoundResult StartRound(const cv::Mat& first_frame_bgr);
    AndroidFrameProcessResult ProcessFrame(const cv::Mat& frame_bgr);
    AndroidRedetectResult RedetectRound(const cv::Mat& frame_bgr);

private:
    std::tuple<int, int, int, int> crop_box_{0, 0, 0, 0};
    PipelineConfig pipeline_config_{};
    ExperimentConfig experiment_config_{};
    BoardCircle gate_board_circle_{};
    cv::Rect first_frame_board_box_{};
    cv::Mat first_frame_bgr_;
    cv::Mat first_frame_board_crop_bgr_;
    cv::Mat first_frame_preprocessed_for_alignment_;
    cv::Mat latest_frame_bgr_;
    cv::Mat previous_frame_bgr_;
    cv::Mat first_gate_gray_;
    cv::Mat previous_processed_;
    std::vector<TrackedYoloFrameState> recent_frames_;
    std::optional<PendingYoloCandidateState> pending_candidate_;
    int last_confirmed_dart_count_ = 0;
    bool started_ = false;
    int current_frame_index_ = 2;
};

}  // namespace bulltrack
