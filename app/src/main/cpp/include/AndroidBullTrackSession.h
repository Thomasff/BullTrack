#pragma once

#include "Config.h"

#include <opencv2/opencv.hpp>

#include <optional>
#include <string>
#include <tuple>
#include <vector>

namespace bulltrack {

struct AndroidFrameProcessResult {
    bool gate_triggered = false;
    std::string gate_reason;
    bool has_detection = false;
    std::optional<cv::Point2f> detected_point_norm;
};

class AndroidBullTrackSession {
public:
    AndroidBullTrackSession();

    void StartRound(const cv::Mat& first_frame_bgr);
    AndroidFrameProcessResult ProcessFrame(const cv::Mat& frame_bgr);
    std::vector<cv::Point2f> RedetectRound() const;

private:
    std::tuple<int, int, int, int> crop_box_{0, 0, 0, 0};
    PipelineConfig pipeline_config_{};
    ExperimentConfig experiment_config_{};
    BoardCircle gate_board_circle_{};
    cv::Mat first_frame_bgr_;
    cv::Mat latest_frame_bgr_;
    cv::Mat previous_frame_bgr_;
    cv::Mat first_gate_gray_;
    cv::Mat previous_processed_;
    bool started_ = false;
};

}  // namespace bulltrack

