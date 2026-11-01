#include "RoundPhoto.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bulltrack {

namespace {

// Photo circle radius over the double ring's outer radius (the player's choice, 2026-11-01). On a
// standard steel board it reaches a little past the board's own edge.
constexpr double kPhotoBoardScale = 1.4;
constexpr int kFullPhotoSize = 1080;
constexpr int kMaxClosePhotoSize = 1080;
constexpr int kJpegQuality = 90;
constexpr int kCircleOutlinePoints = 96;
// The close-up shows at least this share of the double ring's width, so a tight group still
// shows where on the board it sits, and leaves this much room around the darts.
constexpr double kMinCloseShareOfBoard = 0.5;
constexpr double kCloseMargin = 0.15;
// Share card background (#15120F) where the photo leaves the board.
const cv::Scalar kBackground(15, 18, 21);

// The photo circle mapped back into the frame.
std::vector<cv::Point2f> PhotoCircleInFrame(const cv::Mat& h, float rectified_radius, const cv::Rect& board_box) {
    const double radius = kPhotoBoardScale * rectified_radius;
    std::vector<cv::Point2f> rectified;
    rectified.reserve(kCircleOutlinePoints);
    for (int i = 0; i < kCircleOutlinePoints; ++i) {
        const double angle = 2.0 * CV_PI * i / kCircleOutlinePoints;
        rectified.emplace_back(static_cast<float>(radius * std::cos(angle)), static_cast<float>(radius * std::sin(angle)));
    }
    std::vector<cv::Point2f> image;
    cv::perspectiveTransform(rectified, image, h.inv());
    for (cv::Point2f& point : image) {
        point += cv::Point2f(board_box.tl());
    }
    return image;
}

std::vector<std::uint8_t> EncodeJpeg(const cv::Mat& image) {
    std::vector<std::uint8_t> bytes;
    cv::imencode(".jpg", image, bytes, {cv::IMWRITE_JPEG_QUALITY, kJpegQuality});
    return bytes;
}

}  // namespace

RoundPhotoSource MakeRoundPhotoSource(
    const cv::Mat& frame_bgr,
    const cv::Rect& board_box,
    const cv::Mat& point_rectification_h,
    float rectified_radius,
    std::vector<cv::Rect2f> dart_boxes) {
    if (frame_bgr.empty() || point_rectification_h.empty() || rectified_radius <= 1e-6f) {
        throw std::runtime_error("没有可用的本轮照片");
    }
    RoundPhotoSource source;
    source.board_box = board_box;
    point_rectification_h.convertTo(source.point_rectification_h, CV_64F);
    source.rectified_radius = rectified_radius;
    const cv::Rect area =
        cv::boundingRect(PhotoCircleInFrame(source.point_rectification_h, rectified_radius, board_box)) &
        cv::Rect(0, 0, frame_bgr.cols, frame_bgr.rows);
    if (area.area() <= 0) {
        throw std::runtime_error("靶子不在画面里");
    }
    source.area_bgr = frame_bgr(area).clone();
    source.area_origin = area.tl();
    source.dart_boxes = std::move(dart_boxes);
    return source;
}

RoundPhotoJpegs RenderRoundPhotos(const RoundPhotoSource& source) {
    if (source.area_bgr.empty()) {
        throw std::runtime_error("没有可用的本轮照片");
    }
    RoundPhotoJpegs photos;

    // Area pixel -> board-box crop -> rectified board -> photo pixel. The rectified board has y
    // pointing up (20 at +y), so rows run the other way.
    const cv::Point offset = source.area_origin - source.board_box.tl();
    const cv::Mat from_area = (cv::Mat_<double>(3, 3) << 1, 0, offset.x, 0, 1, offset.y, 0, 0, 1);
    const double scale = kFullPhotoSize / (2.0 * kPhotoBoardScale * source.rectified_radius);
    const double centre = kFullPhotoSize / 2.0;
    const cv::Mat to_photo = (cv::Mat_<double>(3, 3) << scale, 0, centre, 0, -scale, centre, 0, 0, 1);
    cv::Mat full;
    cv::warpPerspective(
        source.area_bgr,
        full,
        to_photo * source.point_rectification_h * from_area,
        cv::Size(kFullPhotoSize, kFullPhotoSize),
        cv::INTER_LINEAR,
        cv::BORDER_CONSTANT,
        kBackground);
    cv::Mat outside(full.size(), CV_8UC1, cv::Scalar(255));
    cv::circle(outside, cv::Point(kFullPhotoSize / 2, kFullPhotoSize / 2), kFullPhotoSize / 2, cv::Scalar(0), cv::FILLED);
    full.setTo(kBackground, outside);
    photos.full = EncodeJpeg(full);

    if (source.dart_boxes.empty()) {
        return photos;
    }
    cv::Rect2f darts = source.dart_boxes.front();
    for (const cv::Rect2f& box : source.dart_boxes) {
        darts |= box;
    }
    darts.x -= static_cast<float>(source.area_origin.x);
    darts.y -= static_cast<float>(source.area_origin.y);
    std::vector<cv::Point> circle;
    for (const cv::Point2f& point :
         PhotoCircleInFrame(source.point_rectification_h, source.rectified_radius, source.board_box)) {
        circle.emplace_back(cvRound(point.x) - source.area_origin.x, cvRound(point.y) - source.area_origin.y);
    }
    const double board_width = cv::boundingRect(circle).height / kPhotoBoardScale;
    const int max_side = std::min(source.area_bgr.cols, source.area_bgr.rows);
    const int side = std::min(
        max_side,
        static_cast<int>(std::lround(std::max(
            std::max(darts.width, darts.height) * (1.0 + 2.0 * kCloseMargin),
            kMinCloseShareOfBoard * board_width))));
    if (side <= 0) {
        return photos;
    }
    const cv::Point2f darts_centre(darts.x + darts.width / 2.0f, darts.y + darts.height / 2.0f);
    const cv::Rect crop(
        std::clamp(static_cast<int>(std::lround(darts_centre.x - side / 2.0)), 0, source.area_bgr.cols - side),
        std::clamp(static_cast<int>(std::lround(darts_centre.y - side / 2.0)), 0, source.area_bgr.rows - side),
        side,
        side);
    cv::Mat close = source.area_bgr(crop).clone();
    // Only the board: anything outside the photo circle (wall, shelves) is painted over.
    std::vector<cv::Point> circle_in_crop;
    circle_in_crop.reserve(circle.size());
    for (const cv::Point& point : circle) {
        circle_in_crop.push_back(point - crop.tl());
    }
    cv::Mat close_outside(close.size(), CV_8UC1, cv::Scalar(255));
    cv::fillPoly(close_outside, std::vector<std::vector<cv::Point>>{circle_in_crop}, cv::Scalar(0));
    close.setTo(kBackground, close_outside);
    if (close.cols > kMaxClosePhotoSize) {
        cv::resize(close, close, cv::Size(kMaxClosePhotoSize, kMaxClosePhotoSize), 0, 0, cv::INTER_AREA);
    }
    photos.close = EncodeJpeg(close);
    return photos;
}

}  // namespace bulltrack
