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
    // Board box (the double ring) height over the side of the square the model sees, and
    // whether the box keeps clear of that square's edges. 0 / false when unknown.
    float board_height_share = 0.0f;
    bool board_in_square = false;
    // Top of the square the model sees this round (it moves along the frame's long side to
    // centre the board), kept with recorded frames for offline replay.
    int model_square_top = 0;
};

struct AndroidFrameProcessResult {
    bool gate_triggered = false;
    std::string gate_reason;
    // One entry per dart confirmed on this frame (usually one; two when a dart was thrown before
    // the previous one was confirmed). Empty optional: the dart counts but has no tip point.
    std::vector<std::optional<cv::Point2f>> detected_points;
    // Per detected point: found by a fallback (YOLO lost the new dart and it was confirmed on the
    // image, or the board scan found a dart YOLO never boxed), so the player should check it.
    std::vector<bool> detected_by_fallback;
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
    // Dart boxes under the count threshold inside the search area; only their tips are used.
    std::vector<YoloDetectionBox> low_score_dart_boxes;
    cv::Mat overlay_bgr;
    std::string yolo_status;
};

// Part of the round's board crop that dart alignment matches on: the board's bounding box, and
// the board itself inside it as a mask. An empty rect means the whole crop.
struct BoardAlignmentArea {
    cv::Rect rect;
    cv::Mat mask;
};

// Time a round's frames spent in the main stages: sums over the frames and the slowest frame.
struct FrameStageTotals {
    int frames = 0;
    double total_ms = 0.0;
    double total_max_ms = 0.0;
    double yolo_ms = 0.0;
    double yolo_max_ms = 0.0;
    // Board alignment (ECC); a frame may align several images, or none.
    double ecc_ms = 0.0;
    double ecc_max_ms = 0.0;
    int ecc_runs = 0;
    // Debug images (only with debug info on).
    double jpeg_ms = 0.0;
    double jpeg_max_ms = 0.0;
    // The unchanged-frame check, and frames it let skip YOLO.
    double change_ms = 0.0;
    int yolo_skipped = 0;
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
    // Average and slowest per-frame time of ProcessFrame and its YOLO, ECC and debug JPEG parts
    // this round, for the round's timing log.
    std::string DescribeFrameStageTimes() const;

private:
    FrameStageTotals frame_stage_totals_;
    // Skipping YOLO on unchanged frames: the shrunk model square of the last frame YOLO ran on,
    // frames skipped since, frames after a change that still run YOLO, and whether the last frame
    // was idle (no dart waiting to be confirmed).
    cv::Mat change_reference_;
    int yolo_skipped_in_row_ = 0;
    int yolo_frames_after_change_ = 0;
    bool last_frame_idle_ = false;
    PipelineConfig pipeline_config_{};
    cv::Rect first_frame_board_box_{};
    cv::Mat first_frame_bgr_;
    cv::Mat first_frame_board_crop_bgr_;
    cv::Mat first_frame_preprocessed_for_alignment_;
    BoardAlignmentArea alignment_area_;
    // The square YOLO sees for the whole round, centred on the board at the start.
    cv::Rect model_square_;
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

// Where the board is before a round, for the auto zoom and the aiming arrow.
struct PrepBoardGuide {
    // The part of the frame the model saw, and the board box in it (frame coordinates).
    cv::Rect band;
    std::optional<cv::Rect> board_box;
};

// The model sees a band through the frame centre as wide as the frame and 1400/1080 of that
// tall, padded grey at the sides to a square, so a board above or below the centre square is
// still seen whole. A board zoomed to its target size then takes about 0.64 of the input, inside
// the trained range; on the recorded start frames the boxes matched the round's within 5 px.
// A board too small to find in the band is looked for again in a centre crop.
PrepBoardGuide DetectPrepBoard(const cv::Mat& frame_bgr);

}  // namespace bulltrack
