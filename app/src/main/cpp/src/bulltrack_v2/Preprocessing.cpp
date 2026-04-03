#include "bulltrack_v2/Preprocessing.h"

#include "bulltrack_v2/Config.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace bulltrack {
namespace {

float HueDistanceToRed(float hue) {
    const float dist_to_zero = std::abs(hue);
    const float dist_to_wrap = std::abs(180.0f - hue);
    return std::min(dist_to_zero, dist_to_wrap);
}

float CircularHueDistance(float lhs, float rhs) {
    const float diff = std::abs(lhs - rhs);
    return std::min(diff, 180.0f - diff);
}

bool IsWithinAdaptiveHueRange(float hue, float reference_hue, float tolerance) {
    return CircularHueDistance(hue, reference_hue) <= tolerance;
}

cv::Rect BuildCenteredThirdRect(const cv::Size& image_size) {
    const int width = std::max(1, image_size.width / 3);
    const int height = std::max(1, image_size.height / 3);
    const int x = std::max(0, (image_size.width - width) / 2);
    const int y = std::max(0, (image_size.height - height) / 2);
    return cv::Rect(x, y, width, height);
}

AdaptiveRedHsvModel BuildFallbackAdaptiveRedHsvModel(const cv::Size& image_size) {
    AdaptiveRedHsvModel model;
    model.sample_rect = BuildCenteredThirdRect(image_size);
    return model;
}

}  // namespace

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img) {
    AdaptiveRedHsvModel red_model = EstimateAdaptiveRedHsvModel(img);
    return ExtractBoardColorMasks(img, red_model);
}

AdaptiveRedHsvModel EstimateAdaptiveRedHsvModel(const cv::Mat& img, int max_sample_count) {
    if (img.empty()) {
        throw std::runtime_error("图像为空，无法估计红色 HSV");
    }

    cv::Mat hsv;
    cv::cvtColor(img, hsv, cv::COLOR_BGR2HSV);
    const cv::Rect sample_rect = BuildCenteredThirdRect(img.size());

    struct SamplePixel {
        cv::Point point;
        float h = 0.0f;
        float s = 0.0f;
        float v = 0.0f;
        float hue_distance = 0.0f;
    };

    std::vector<SamplePixel> candidates;
    candidates.reserve(static_cast<size_t>(sample_rect.area()));
    for (int y = sample_rect.y; y < sample_rect.y + sample_rect.height; ++y) {
        for (int x = sample_rect.x; x < sample_rect.x + sample_rect.width; ++x) {
            const cv::Vec3b hsv_pixel = hsv.at<cv::Vec3b>(y, x);
            const float s = static_cast<float>(hsv_pixel[1]);
            const float v = static_cast<float>(hsv_pixel[2]);
            if (s <= 100.0f || v <= 100.0f) {
                continue;
            }
            candidates.push_back(SamplePixel{
                cv::Point(x, y),
                static_cast<float>(hsv_pixel[0]),
                s,
                v,
                HueDistanceToRed(static_cast<float>(hsv_pixel[0]))
            });
        }
    }

    if (candidates.empty()) {
        return BuildFallbackAdaptiveRedHsvModel(img.size());
    }

    std::stable_sort(candidates.begin(), candidates.end(), [](const SamplePixel& lhs, const SamplePixel& rhs) {
        if (lhs.hue_distance != rhs.hue_distance) {
            return lhs.hue_distance < rhs.hue_distance;
        }
        if (lhs.s != rhs.s) {
            return lhs.s > rhs.s;
        }
        return lhs.v > rhs.v;
    });

    const int selected_count = std::min<int>(std::max(1, max_sample_count), static_cast<int>(candidates.size()));
    float sum_s = 0.0f;
    float sum_v = 0.0f;
    float sum_hx = 0.0f;
    float sum_hy = 0.0f;

    AdaptiveRedHsvModel model;
    model.sample_rect = sample_rect;
    model.sample_count = selected_count;
    model.sample_points.reserve(static_cast<size_t>(selected_count));
    for (int i = 0; i < selected_count; ++i) {
        const SamplePixel& sample = candidates[i];
        const float angle_rad = (sample.h / 180.0f) * (2.0f * static_cast<float>(CV_PI));
        sum_hx += std::cos(angle_rad);
        sum_hy += std::sin(angle_rad);
        sum_s += sample.s;
        sum_v += sample.v;
        model.sample_points.push_back(sample.point);
    }

    float mean_angle = std::atan2(sum_hy, sum_hx);
    if (mean_angle < 0.0f) {
        mean_angle += 2.0f * static_cast<float>(CV_PI);
    }
    model.h = mean_angle * 180.0f / (2.0f * static_cast<float>(CV_PI));
    model.s = sum_s / static_cast<float>(selected_count);
    model.v = sum_v / static_cast<float>(selected_count);
    return model;
}

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img, const AdaptiveRedHsvModel& red_model) {
    cv::Mat hsv;
    cv::cvtColor(img, hsv, cv::COLOR_BGR2HSV);

    cv::Mat red_mask = cv::Mat::zeros(img.size(), CV_8U);
    cv::Mat blue_mask;
    cv::Mat green_mask;

    cv::inRange(hsv, cv::Scalar(100, 40, 40), cv::Scalar(125, 255, 255), blue_mask);
    cv::inRange(hsv, cv::Scalar(45, 40, 40), cv::Scalar(85, 255, 255), green_mask);

    const float min_s = std::max(0.0f, red_model.s - 30.0f);
    const float max_s = std::min(255.0f, red_model.s + 30.0f);
    const float min_v = std::max(0.0f, red_model.v - 30.0f);
    const float max_v = std::min(255.0f, red_model.v + 30.0f);
    for (int y = 0; y < hsv.rows; ++y) {
        for (int x = 0; x < hsv.cols; ++x) {
            const cv::Vec3b hsv_pixel = hsv.at<cv::Vec3b>(y, x);
            const float h = static_cast<float>(hsv_pixel[0]);
            const float s = static_cast<float>(hsv_pixel[1]);
            const float v = static_cast<float>(hsv_pixel[2]);
            if (IsWithinAdaptiveHueRange(h, red_model.h, 20.0f) &&
                s >= min_s && s <= max_s &&
                v >= min_v && v <= max_v) {
                red_mask.at<uchar>(y, x) = 255;
            }
        }
    }

    return {red_mask, blue_mask, green_mask};
}

cv::Mat ExtractRedOnlyMask(const cv::Mat& img) {
    AdaptiveRedHsvModel red_model = EstimateAdaptiveRedHsvModel(img);
    return ExtractRedOnlyMask(img, red_model);
}

cv::Mat ExtractRedOnlyMask(const cv::Mat& img, const AdaptiveRedHsvModel& red_model) {
    auto [red_mask, blue_mask, green_mask] = ExtractBoardColorMasks(img, red_model);
    (void)blue_mask;
    (void)green_mask;
    return red_mask;
}

cv::Mat PrepareBoardDetectionImage(const cv::Mat& img) {
    AdaptiveRedHsvModel red_model = EstimateAdaptiveRedHsvModel(img);
    return PrepareBoardDetectionImage(img, red_model);
}

cv::Mat PrepareBoardDetectionImage(const cv::Mat& img, const AdaptiveRedHsvModel& red_model) {
    auto [red_mask, blue_mask, green_mask] = ExtractBoardColorMasks(img, red_model);
    cv::Mat dark_mask;
    cv::bitwise_or(blue_mask, green_mask, dark_mask);

    cv::Mat filtered = img.clone();
    filtered.setTo(cv::Scalar(255, 255, 255), red_mask > 0);
    filtered.setTo(cv::Scalar(0, 0, 0), dark_mask > 0);
    return filtered;
}

cv::Mat PreprocessImage(const cv::Mat& img, int blur_kernel) {
    cv::Mat gray;
    cv::cvtColor(img, gray, cv::COLOR_BGR2GRAY);
    blur_kernel = EnsureOddKernel(blur_kernel);
    if (blur_kernel > 1) {
        for (int i = 0; i < 3; ++i) {
            cv::GaussianBlur(gray, gray, cv::Size(blur_kernel, blur_kernel), 0);
        }
    }
    return gray;
}

cv::Mat EnhanceWarpedImage(const cv::Mat& img, double saturation_scale, double contrast_scale) {
    cv::Mat hsv;
    cv::cvtColor(img, hsv, cv::COLOR_BGR2HSV);
    cv::Mat hsv_f;
    hsv.convertTo(hsv_f, CV_32F);

    std::vector<cv::Mat> channels;
    cv::split(hsv_f, channels);
    channels[1] *= static_cast<float>(saturation_scale);
    cv::min(channels[1], 255.0f, channels[1]);
    cv::max(channels[1], 0.0f, channels[1]);
    cv::merge(channels, hsv_f);

    cv::Mat saturated_hsv;
    hsv_f.convertTo(saturated_hsv, CV_8U);
    cv::Mat saturated_bgr;
    cv::cvtColor(saturated_hsv, saturated_bgr, cv::COLOR_HSV2BGR);

    cv::Mat enhanced;
    cv::convertScaleAbs(saturated_bgr, enhanced, contrast_scale, 0.0);
    return enhanced;
}

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractEdgesWithConnectionRepair(
    const cv::Mat& img,
    int preprocess_blur_kernel,
    int canny_low,
    int canny_high,
    int edge_close_kernel,
    int edge_close_iterations,
    int edge_dilate_iterations) {
    cv::Mat board_detection_img = PrepareBoardDetectionImage(img);
    cv::Mat gray = PreprocessImage(board_detection_img, preprocess_blur_kernel);

    edge_close_kernel = EnsureOddKernel(edge_close_kernel);
    cv::Mat edges;
    cv::Canny(gray, edges, canny_low, canny_high);

    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(edge_close_kernel, edge_close_kernel));
    cv::Mat edges_connected;
    cv::morphologyEx(edges, edges_connected, cv::MORPH_CLOSE, kernel, cv::Point(-1, -1), edge_close_iterations);
    if (edge_dilate_iterations > 0) {
        cv::dilate(edges_connected, edges_connected, kernel, cv::Point(-1, -1), edge_dilate_iterations);
    }

    return {gray, edges, edges_connected};
}

}  // namespace bulltrack
