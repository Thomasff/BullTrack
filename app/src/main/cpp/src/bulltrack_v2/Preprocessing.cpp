#include "bulltrack_v2/Preprocessing.h"

#include "bulltrack_v2/Config.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace bulltrack {
namespace {

cv::Rect BuildCenteredThirdRect(const cv::Size& image_size) {
    const int width = std::max(1, image_size.width / 3);
    const int height = std::max(1, image_size.height / 3);
    const int x = std::max(0, (image_size.width - width) / 2);
    const int y = std::max(0, (image_size.height - height) / 2);
    return cv::Rect(x, y, width, height);
}

AdaptiveRedLabModel BuildFallbackAdaptiveRedLabModel(const cv::Size& image_size) {
    AdaptiveRedLabModel model;
    model.sample_rect = BuildCenteredThirdRect(image_size);
    return model;
}

}  // namespace

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img) {
    AdaptiveRedLabModel red_model = EstimateAdaptiveRedLabModel(img);
    return ExtractBoardColorMasks(img, red_model);
}

AdaptiveRedLabModel EstimateAdaptiveRedLabModel(const cv::Mat& img, int max_sample_count) {
    if (img.empty()) {
        throw std::runtime_error("图像为空，无法估计红色 LAB");
    }

    cv::Mat lab;
    cv::cvtColor(img, lab, cv::COLOR_BGR2Lab);
    const cv::Rect sample_rect = BuildCenteredThirdRect(img.size());

    struct SamplePixel {
        cv::Point point;
        float l = 0.0f;
        float a = 0.0f;
        float b = 0.0f;
    };

    std::vector<SamplePixel> candidates;
    candidates.reserve(static_cast<size_t>(sample_rect.area()));
    for (int y = sample_rect.y; y < sample_rect.y + sample_rect.height; ++y) {
        for (int x = sample_rect.x; x < sample_rect.x + sample_rect.width; ++x) {
            const cv::Vec3b lab_pixel = lab.at<cv::Vec3b>(y, x);
            const float l = static_cast<float>(lab_pixel[0]);
            const float a = static_cast<float>(lab_pixel[1]);
            const float b = static_cast<float>(lab_pixel[2]);
            if (a <= 128.0f || b <= 128.0f) {
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

    std::stable_sort(candidates.begin(), candidates.end(), [](const SamplePixel& lhs, const SamplePixel& rhs) {
        if (lhs.a != rhs.a) {
            return lhs.a > rhs.a;
        }
        if (lhs.l != rhs.l) {
            return lhs.l > rhs.l;
        }
        return lhs.b > rhs.b;
    });

    const int selected_count = std::min<int>(std::max(1, max_sample_count), static_cast<int>(candidates.size()));
    float sum_l = 0.0f;
    float sum_a = 0.0f;
    float sum_b = 0.0f;

    AdaptiveRedLabModel model;
    model.sample_rect = sample_rect;
    model.sample_count = selected_count;
    model.sample_points.reserve(static_cast<size_t>(selected_count));
    for (int i = 0; i < selected_count; ++i) {
        const SamplePixel& sample = candidates[i];
        sum_l += sample.l;
        sum_a += sample.a;
        sum_b += sample.b;
        model.sample_points.push_back(sample.point);
    }

    model.l = sum_l / static_cast<float>(selected_count);
    model.a = sum_a / static_cast<float>(selected_count);
    model.b = sum_b / static_cast<float>(selected_count);
    return model;
}

std::tuple<cv::Mat, cv::Mat, cv::Mat> ExtractBoardColorMasks(const cv::Mat& img, const AdaptiveRedLabModel& red_model) {
    cv::Mat lab;
    cv::cvtColor(img, lab, cv::COLOR_BGR2Lab);

    cv::Mat red_mask = cv::Mat::zeros(img.size(), CV_8U);
    cv::Mat blue_mask = cv::Mat::zeros(img.size(), CV_8U);
    cv::Mat green_mask = cv::Mat::zeros(img.size(), CV_8U);

    const float min_l = std::max(0.0f, red_model.l - 25.0f);
    const float max_l = std::min(255.0f, red_model.l + 25.0f);
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
