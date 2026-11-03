#include "bulltrack_v2/Preprocessing.h"

#include "bulltrack_v2/Config.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace bulltrack {
namespace {

// The red reference is sampled inside this fraction of the board radius: the treble beds (about
// 0.58-0.63 of the double ring's outer edge) and the bull, but not the doubles. The doubles are
// what the reference must find; at the board's edge they catch the most uneven light, and the
// box corners can hold a red surround.
constexpr double kRedSampleRadius = 0.66;
// Only clearly red pixels (Lab a above this) are samples.
constexpr float kRedSampleMinA = 140.0f;
// Sample points kept for the debug image.
constexpr int kRedDebugSampleCount = 40;

AdaptiveRedLabModel BuildFallbackAdaptiveRedLabModel(const cv::Size& image_size) {
    AdaptiveRedLabModel model;
    model.sample_rect = cv::Rect(0, 0, image_size.width, image_size.height);
    return model;
}

}  // namespace

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img) {
    AdaptiveRedLabModel red_model = EstimateAdaptiveRedLabModel(img);
    return ExtractBoardColorMasks(img, red_model);
}

AdaptiveRedLabModel EstimateAdaptiveRedLabModel(const cv::Mat& img, double reddest_share) {
    if (img.empty()) {
        throw std::runtime_error("red_lab_input_empty");
    }

    cv::Mat lab;
    cv::cvtColor(img, lab, cv::COLOR_BGR2Lab);
    const cv::Rect sample_rect(0, 0, img.cols, img.rows);

    struct SamplePixel {
        cv::Point point;
        float l = 0.0f;
        float a = 0.0f;
        float b = 0.0f;
    };

    // The crop is the board box, so the board is the inscribed ellipse.
    const double half_width = std::max(1.0, img.cols * 0.5);
    const double half_height = std::max(1.0, img.rows * 0.5);
    std::vector<SamplePixel> candidates;
    for (int y = 0; y < img.rows; ++y) {
        const double ny = (y + 0.5 - half_height) / half_height;
        for (int x = 0; x < img.cols; ++x) {
            const double nx = (x + 0.5 - half_width) / half_width;
            const double radius_sq = nx * nx + ny * ny;
            if (radius_sq > kRedSampleRadius * kRedSampleRadius) {
                continue;
            }
            const cv::Vec3b lab_pixel = lab.at<cv::Vec3b>(y, x);
            const float l = static_cast<float>(lab_pixel[0]);
            const float a = static_cast<float>(lab_pixel[1]);
            const float b = static_cast<float>(lab_pixel[2]);
            if (a <= kRedSampleMinA || b <= 128.0f) {
                continue;
            }
            candidates.push_back(SamplePixel{
                cv::Point(x, y),
                l,
                a,
                b
            });
        }
    }

    if (candidates.empty()) {
        return BuildFallbackAdaptiveRedLabModel(img.size());
    }
    if (reddest_share > 0.0) {
        const size_t keep = std::max<size_t>(1, static_cast<size_t>(reddest_share * img.cols * img.rows));
        if (candidates.size() > keep) {
            std::nth_element(
                candidates.begin(),
                candidates.begin() + keep,
                candidates.end(),
                [](const SamplePixel& lhs, const SamplePixel& rhs) { return lhs.a > rhs.a; });
            candidates.resize(keep);
        }
    }

    // The median of every red sample is the beds' typical red; the mean of the 40 reddest was an
    // extreme of the board's red and left lighter or darker beds out of the window.
    std::vector<float> ls;
    std::vector<float> as;
    std::vector<float> bs;
    ls.reserve(candidates.size());
    as.reserve(candidates.size());
    bs.reserve(candidates.size());
    for (const SamplePixel& sample : candidates) {
        ls.push_back(sample.l);
        as.push_back(sample.a);
        bs.push_back(sample.b);
    }
    const auto median = [](std::vector<float>& values) {
        std::nth_element(values.begin(), values.begin() + values.size() / 2, values.end());
        return values[values.size() / 2];
    };

    AdaptiveRedLabModel model;
    model.sample_rect = sample_rect;
    model.sample_count = static_cast<int>(candidates.size());
    const size_t debug_step = std::max<size_t>(1, candidates.size() / kRedDebugSampleCount);
    for (size_t i = 0; i < candidates.size(); i += debug_step) {
        model.sample_points.push_back(candidates[i].point);
    }
    model.l = median(ls);
    model.a = median(as);
    model.b = median(bs);
    return model;
}

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img, const AdaptiveRedLabModel& red_model) {
    cv::Mat lab;
    cv::cvtColor(img, lab, cv::COLOR_BGR2Lab);

    cv::Mat red_mask = cv::Mat::zeros(img.size(), CV_8U);
    cv::Mat blue_mask = cv::Mat::zeros(img.size(), CV_8U);
    cv::Mat green_mask = cv::Mat::zeros(img.size(), CV_8U);

    // Wide in L: light from one side leaves the beds near it far brighter than the far ones
    // (L 42 to 132 on one board); a and b keep out what is not red.
    const float min_l = std::max(0.0f, red_model.l - 60.0f);
    const float max_l = std::min(255.0f, red_model.l + 60.0f);
    const float min_a = std::max(0.0f, red_model.a - 15.0f);
    const float max_a = std::min(255.0f, red_model.a + 15.0f);
    const float min_b = std::max(0.0f, red_model.b - 15.0f);
    const float max_b = std::min(255.0f, red_model.b + 15.0f);
    for (int y = 0; y < lab.rows; ++y) {
        for (int x = 0; x < lab.cols; ++x) {
            const cv::Vec3b lab_pixel = lab.at<cv::Vec3b>(y, x);
            const float l = static_cast<float>(lab_pixel[0]);
            const float a = static_cast<float>(lab_pixel[1]);
            const float b = static_cast<float>(lab_pixel[2]);
            if (a > 128.0f && b > 128.0f &&
                l >= min_l && l <= max_l &&
                a >= min_a && a <= max_a &&
                b >= min_b && b <= max_b) {
                red_mask.at<uchar>(y, x) = 255;
            }
        }
    }

    return {red_mask, blue_mask, green_mask};
}

cv::Mat ExtractRedOnlyMask(const cv::Mat& img) {
    AdaptiveRedLabModel red_model = EstimateAdaptiveRedLabModel(img);
    return ExtractRedOnlyMask(img, red_model);
}

cv::Mat ExtractRedOnlyMask(const cv::Mat& img, const AdaptiveRedLabModel& red_model) {
    auto [red_mask, blue_mask, green_mask] = ExtractBoardColorMasks(img, red_model);
    (void)blue_mask;
    (void)green_mask;
    return red_mask;
}

cv::Mat PrepareBoardDetectionImage(const cv::Mat& img) {
    AdaptiveRedLabModel red_model = EstimateAdaptiveRedLabModel(img);
    return PrepareBoardDetectionImage(img, red_model);
}

cv::Mat PrepareBoardDetectionImage(const cv::Mat& img, const AdaptiveRedLabModel& red_model) {
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
