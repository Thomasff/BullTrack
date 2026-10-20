#pragma once

#include "bulltrack_v2/Config.h"
#include "DebugImageConfig.h"
#include "YoloNcnnDetector.h"

#include <opencv2/opencv.hpp>

#include <optional>
#include <cstdint>
#include <string>
#include <vector>

namespace bulltrack {

struct DebugImageArtifact {
    std::string file_name;
    std::vector<std::uint8_t> jpeg_bytes;
};

struct AndroidStartRoundResult {
    std::vector<DebugImageArtifact> debug_images;
    std::string error_message;
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
    PipelineConfig pipeline_config_{};
    cv::Rect first_frame_board_box_{};
    cv::Mat first_frame_bgr_;
    cv::Mat first_frame_board_crop_bgr_;
    cv::Mat first_frame_preprocessed_for_alignment_;
    cv::Mat first_frame_point_rectification_h_;
    float first_frame_rectified_radius_ = 1.0f;
    cv::Mat latest_frame_bgr_;
    std::vector<TrackedYoloFrameState> recent_frames_;
    std::optional<PendingYoloCandidateState> pending_candidate_;
    // Latest frame whose dart count equals the confirmed count: the "before" image of the next dart.
    std::optional<TrackedYoloFrameState> last_clean_frame_;
    int last_confirmed_dart_count_ = 0;
    // Darts YOLO already saw on the empty-board frame; the round still allows three more.
    int round_start_dart_count_ = 0;
    bool started_ = false;
    int current_frame_index_ = 2;
};

}  // namespace bulltrack
