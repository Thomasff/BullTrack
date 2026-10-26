#pragma once

#include "BoardDetectorAndroid.h"
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
    // Darts already on the board in the first frame (the round still counts new darts).
    int start_dart_count = 0;
    // Image length of the board's left half over its right half; the half nearer the camera
    // looks longer, so above 1 means the phone is left of the board. 0 when unknown.
    float left_right_half_ratio = 0.0f;
};

struct AndroidFrameProcessResult {
    bool gate_triggered = false;
    std::string gate_reason;
    // One entry per dart confirmed on this frame (usually one; two when a dart was thrown before
    // the previous one was confirmed). Empty optional: the dart counts but has no tip point.
    std::vector<std::optional<cv::Point2f>> detected_points;
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
    // Widened area around the board box used for dart detection (may reach past the image).
    cv::Rect dart_search_rect{};
    cv::Mat dart_search_crop_bgr;
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
    // On a manual end: darts never confirmed (YOLO never saw them), found by comparing the last
    // frame with the clean frame. Points without a tip are left out (the round pads misses).
    AndroidRedetectResult FindMissedDartsAtEnd();

private:
    PipelineConfig pipeline_config_{};
    cv::Rect first_frame_board_box_{};
    cv::Mat first_frame_bgr_;
    cv::Mat first_frame_board_crop_bgr_;
    cv::Mat first_frame_preprocessed_for_alignment_;
    cv::Mat first_frame_point_rectification_h_;
    float first_frame_rectified_radius_ = 1.0f;
    // Triple/double edges measured on this board at setup; empty means the default table.
    std::optional<MeasuredRingEdges> ring_edges_;
    cv::Rect first_frame_dart_search_rect_{};
    // Board box corner inside the dart search crop, to map tips back to board-crop coordinates.
    cv::Point board_offset_in_search_{};
    cv::Mat latest_frame_bgr_;
    std::vector<TrackedYoloFrameState> recent_frames_;
    std::optional<PendingYoloCandidateState> pending_candidate_;
    // Frame of the last confirmed dart (or the empty board): the "before" image of the next dart.
    std::optional<TrackedYoloFrameState> last_clean_frame_;
    int last_confirmed_dart_count_ = 0;
    // Darts YOLO already saw on the empty-board frame; the round still allows three more.
    int round_start_dart_count_ = 0;
    // Boxes of the last frame whose extra box showed no change on the board. The same set of boxes
    // is not checked again for a short while; any box elsewhere (a real new dart) is checked at once.
    std::vector<YoloDetectionBox> phantom_boxes_;
    int phantom_frame_index_ = 0;
    // Frames left in which a settled view may replace the clean frame after a confirmation.
    int clean_refresh_frames_left_ = 0;

    // Confirms the new dart(s) of the pending candidate on stable_frame. yolo_sees_new_dart is
    // false when YOLO lost the new dart in this frame and its earlier box is checked on the image.
    void ConfirmNewDarts(
        const TrackedYoloFrameState& stable_frame,
        int max_dart_count,
        bool yolo_sees_new_dart,
        AndroidFrameProcessResult& result);
    bool started_ = false;
    int current_frame_index_ = 2;
};

}  // namespace bulltrack
