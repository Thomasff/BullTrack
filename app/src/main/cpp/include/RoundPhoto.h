#pragma once

#include <opencv2/opencv.hpp>

#include <cstdint>
#include <vector>

namespace bulltrack {

// What a share card's photo is made from: the board area of a round's final frame (every dart
// in) and the board fit that maps it onto a round board. The app keeps it after the round's
// session is gone, until the next round starts.
struct RoundPhotoSource {
    // Crop of the frame around the photo circle, and its top-left corner in the frame.
    cv::Mat area_bgr;
    cv::Point area_origin;
    // The round's board box in the frame. The homography maps board-box crop points onto the
    // rectified board, where the double ring's outer edge has radius rectified_radius.
    cv::Rect board_box;
    cv::Mat point_rectification_h;
    float rectified_radius = 1.0f;
    // Dart boxes in frame coordinates; empty when unknown.
    std::vector<cv::Rect2f> dart_boxes;
};

struct RoundPhotoJpegs {
    // The board seen face-on, cut round.
    std::vector<std::uint8_t> full;
    // The camera's own view around the darts; empty without dart boxes.
    std::vector<std::uint8_t> close;
};

// Keeps only the part of the frame the photos can show.
RoundPhotoSource MakeRoundPhotoSource(
    const cv::Mat& frame_bgr,
    const cv::Rect& board_box,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    std::vector<cv::Rect2f> dart_boxes);

RoundPhotoJpegs RenderRoundPhotos(const RoundPhotoSource& source);

}  // namespace bulltrack
