#include "bulltrack_v2/DartDetector.h"

#include "bulltrack_v2/Alignment.h"
#include "BoardDetectorAndroid.h"

#include <algorithm>
#include <set>
#include <stdexcept>

namespace bulltrack {
namespace {

cv::Mat ApplyBinaryMorphology(const cv::Mat& binary_img, int kernel_size, int iterations, int op) {
    kernel_size = EnsureOddKernel(kernel_size);
    if (iterations <= 0) return binary_img.clone();
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(kernel_size, kernel_size));
    cv::Mat output;
    cv::morphologyEx(binary_img, output, op, kernel, cv::Point(-1, -1), iterations);
    return output;
}

cv::Mat DrawComponentDebugImage(const cv::Mat& base_img, const std::vector<RankedComponent>& ranked_components, const std::string& label_prefix) {
    cv::Mat scaled;
    base_img.convertTo(scaled, CV_8U, 255.0);
    cv::Mat debug_img;
    cv::cvtColor(scaled, debug_img, cv::COLOR_GRAY2BGR);
    const std::vector<cv::Scalar> colors{{255,0,0},{0,255,0},{0,0,255},{255,255,0},{255,0,255},{0,255,255}};
    for (size_t i = 0; i < ranked_components.size(); ++i) {
        const auto& component = ranked_components[i].component;
        const auto& color = colors[i % colors.size()];
        cv::rectangle(debug_img, cv::Rect(component.x, component.y, component.width, component.height), color, 2);
        cv::putText(debug_img, label_prefix + std::to_string(i + 1) + ":A=" + std::to_string(component.area), cv::Point(component.x, component.y - 5), cv::FONT_HERSHEY_SIMPLEX, 0.4, color, 1);
    }
    return debug_img;
}

void SaveDiffBinaryDebugImages(const DiffBinaryOutputs& outputs) {
    EnsureDirectory(DebugImagesPath());
    cv::imwrite(DebugImagesPath() + "/debug_01_diff.jpg", outputs.diff);
    cv::imwrite(DebugImagesPath() + "/debug_01_board_masked_diff.jpg", outputs.board_masked_diff);
    cv::imwrite(DebugImagesPath() + "/debug_01_brightened_diff.jpg", outputs.brightened_diff);
    cv::imwrite(DebugImagesPath() + "/debug_01_contrast_diff.jpg", outputs.contrast_diff);
    cv::imwrite(DebugImagesPath() + "/debug_02_thresh.jpg", outputs.thresh);
    cv::imwrite(DebugImagesPath() + "/debug_02_opened.jpg", outputs.opened);
    cv::imwrite(DebugImagesPath() + "/debug_02_closed.jpg", outputs.closed);
    cv::imwrite(DebugImagesPath() + "/debug_02_dilated.jpg", outputs.dilated);
}

std::pair<std::optional<ComponentInfo>, std::string> SelectSingleDartComponent(const std::vector<ComponentInfo>& raw_components, const std::vector<ComponentInfo>& filtered_components, const cv::Mat& ranking_gray_img) {
    if (raw_components.empty()) return {std::nullopt, "no_white"};
    if (raw_components.size() == 1) return {raw_components[0], "raw_single"};
    if (filtered_components.size() == 1) return {filtered_components[0], "filtered_single"};
    if (filtered_components.size() > 1) {
        auto ranked = RankComponentsByMeanGray(filtered_components, ranking_gray_img);
        return {ranked.front().component, "filtered_multi_pick_max_mean_gray"};
    }
    return {std::nullopt, "no_valid_component"};
}

}  // namespace

std::vector<ComponentInfo> ExtractConnectedComponents(const cv::Mat& binary_img) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    std::vector<ComponentInfo> components;
    for (int label = 1; label < num_labels; ++label) {
        ComponentInfo component;
        component.label = label;
        component.area = stats.at<int>(label, cv::CC_STAT_AREA);
        component.x = stats.at<int>(label, cv::CC_STAT_LEFT);
        component.y = stats.at<int>(label, cv::CC_STAT_TOP);
        component.width = stats.at<int>(label, cv::CC_STAT_WIDTH);
        component.height = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        cv::Mat mask = labels == label;
        mask.convertTo(component.mask, CV_8U);
        components.push_back(component);
    }
    std::sort(components.begin(), components.end(), [](const auto& lhs, const auto& rhs) {
        return lhs.area > rhs.area;
    });
    return components;
}

std::pair<cv::Mat, std::vector<ComponentInfo>> FilterConnectedComponents(const cv::Mat& binary_img, double min_area, bool debug) {
    cv::Mat filtered_mask = cv::Mat::zeros(binary_img.size(), CV_8U);
    std::vector<ComponentInfo> valid_components;
    for (const auto& component : ExtractConnectedComponents(binary_img)) {
        if (component.area >= min_area) {
            valid_components.push_back(component);
            cv::bitwise_or(filtered_mask, component.mask, filtered_mask);
        }
    }
    if (debug) {
        EnsureDirectory(DebugImagesPath());
        cv::imwrite(DebugImagesPath() + "/debug_03_filtered_components.jpg", filtered_mask * 255);
    }
    return {filtered_mask, valid_components};
}

double ComputeComponentMeanGray(const cv::Mat& component_mask, const cv::Mat& gray_img) {
    cv::Mat positive_mask = (component_mask > 0) & (gray_img > 0);
    const int count = cv::countNonZero(positive_mask);
    if (count == 0) return 0.0;
    return cv::mean(gray_img, positive_mask)[0];
}

std::vector<RankedComponent> RankComponentsByMeanGray(const std::vector<ComponentInfo>& components, const cv::Mat& gray_img) {
    std::vector<RankedComponent> ranked;
    for (const auto& component : components) {
        ranked.push_back({component, ComputeComponentMeanGray(component.mask, gray_img)});
    }
    std::sort(ranked.begin(), ranked.end(), [](const auto& lhs, const auto& rhs) {
        if (lhs.mean_gray != rhs.mean_gray) return lhs.mean_gray > rhs.mean_gray;
        if (lhs.component.area != rhs.component.area) return lhs.component.area > rhs.component.area;
        if (lhs.component.y != rhs.component.y) return lhs.component.y < rhs.component.y;
        return lhs.component.x < rhs.component.x;
    });
    return ranked;
}

std::vector<RankedComponent> SelectDartComponents(const std::vector<ComponentInfo>& raw_components, const std::vector<ComponentInfo>& filtered_components, const cv::Mat& ranking_gray_img, int max_darts) {
    if (static_cast<int>(raw_components.size()) < max_darts) return RankComponentsByMeanGray(raw_components, ranking_gray_img);
    if (static_cast<int>(filtered_components.size()) > max_darts) {
        auto ranked = RankComponentsByMeanGray(filtered_components, ranking_gray_img);
        ranked.resize(max_darts);
        return ranked;
    }
    if (static_cast<int>(filtered_components.size()) == max_darts) return RankComponentsByMeanGray(filtered_components, ranking_gray_img);

    auto selected_ranked = RankComponentsByMeanGray(filtered_components, ranking_gray_img);
    std::set<int> selected_labels;
    for (const auto& ranked : selected_ranked) selected_labels.insert(ranked.component.label);

    std::vector<ComponentInfo> fallback_components;
    for (const auto& component : raw_components) {
        if (selected_labels.count(component.label) == 0) fallback_components.push_back(component);
    }
    auto fallback_ranked = RankComponentsByMeanGray(fallback_components, ranking_gray_img);
    while (static_cast<int>(selected_ranked.size()) < max_darts && !fallback_ranked.empty()) {
        selected_ranked.push_back(fallback_ranked.front());
        fallback_ranked.erase(fallback_ranked.begin());
    }
    return selected_ranked;
}

cv::Point ExtractComponentLeftmostPoint(const cv::Mat& component_mask) {
    std::vector<cv::Point> points;
    cv::findNonZero(component_mask, points);
    if (points.empty()) throw std::runtime_error("dart_component_empty");

    int left_x = points.front().x;
    int y_min = points.front().y;
    int y_max = points.front().y;
    for (const auto& point : points) {
        if (point.x < left_x) {
            left_x = point.x;
            y_min = point.y;
            y_max = point.y;
        } else if (point.x == left_x) {
            y_min = std::min(y_min, point.y);
            y_max = std::max(y_max, point.y);
        }
    }
    return {left_x, (y_min + y_max) / 2};
}

std::pair<cv::Mat, cv::Mat> EnhanceDiffImage(const cv::Mat& diff, int brightness_beta, double contrast_alpha, double contrast_center) {
    cv::Mat brightened;
    cv::convertScaleAbs(diff, brightened, 1.0, brightness_beta);
    cv::Mat brightened_f;
    brightened.convertTo(brightened_f, CV_32F);
    cv::Mat contrast_f = (brightened_f - contrast_center) * contrast_alpha + contrast_center;
    cv::Mat contrast_img;
    contrast_f.convertTo(contrast_img, CV_8U);
    return {brightened, contrast_img};
}

DiffBinaryOutputs BuildDiffBinaryOutputs(const cv::Mat& before_gray, const cv::Mat& after_gray_aligned, int cx, int cy, int radius, const DartDetectionConfig& config) {
    DiffBinaryOutputs outputs;
    cv::absdiff(before_gray, after_gray_aligned, outputs.diff);
    outputs.board_masked_diff = ApplyBoardMask(outputs.diff, cx, cy, radius);
    std::tie(outputs.brightened_diff, outputs.contrast_diff) = EnhanceDiffImage(outputs.board_masked_diff, config.diff_brightness_beta, config.diff_contrast_alpha, config.diff_contrast_center);

    double max_value = 0.0;
    cv::minMaxLoc(outputs.contrast_diff, nullptr, &max_value);
    outputs.max_value = static_cast<int>(max_value);
    outputs.threshold_value = outputs.max_value > 0 ? std::max(1, static_cast<int>(outputs.max_value * 0.15)) : 1;
    cv::threshold(outputs.contrast_diff, outputs.thresh, outputs.threshold_value, 255, cv::THRESH_BINARY);
    outputs.opened = ApplyBinaryMorphology(outputs.thresh, config.diff_open_kernel, config.diff_open_iterations, cv::MORPH_OPEN);
    outputs.closed = ApplyBinaryMorphology(outputs.opened, config.diff_close_kernel, config.diff_close_iterations, cv::MORPH_CLOSE);
    outputs.dilated = ApplyBinaryMorphology(outputs.closed, config.diff_dilate_kernel, config.diff_dilate_iterations, cv::MORPH_DILATE);
    outputs.binary_img = outputs.dilated / 255;
    return outputs;
}

std::vector<cv::Point> DetectDartPointsFromGrayImages(const cv::Mat& before_gray, const cv::Mat& after_gray_aligned, int cx, int cy, int radius, const DartDetectionConfig& config, bool debug) {
    DiffBinaryOutputs outputs = BuildDiffBinaryOutputs(before_gray, after_gray_aligned, cx, cy, radius, config);
    if (outputs.max_value <= 0) throw std::runtime_error("dart_diff_blank");
    if (debug) SaveDiffBinaryDebugImages(outputs);
    if (cv::countNonZero(outputs.binary_img) == 0) throw std::runtime_error("dart_contour_not_found");

    auto raw_components = ExtractConnectedComponents(outputs.binary_img);
    auto [filtered_mask, filtered_components] = FilterConnectedComponents(outputs.binary_img, config.min_area, false);
    (void)filtered_mask;
    if (raw_components.empty()) throw std::runtime_error("dart_contour_not_found");

    auto selected_ranked = SelectDartComponents(raw_components, filtered_components, outputs.contrast_diff, config.max_darts);
    std::vector<cv::Point> tip_points;
    for (const auto& ranked : selected_ranked) tip_points.push_back(ExtractComponentLeftmostPoint(ranked.component.mask));

    if (debug) {
        const auto& candidate_source = (static_cast<int>(raw_components.size()) < config.max_darts || filtered_components.empty()) ? raw_components : filtered_components;
        auto candidate_ranked = RankComponentsByMeanGray(candidate_source, outputs.contrast_diff);
        cv::Mat candidate_debug_img = DrawComponentDebugImage(outputs.binary_img, candidate_ranked, "C");
        cv::Mat selected_debug_img = DrawComponentDebugImage(outputs.binary_img, selected_ranked, "D");
        cv::Mat final_debug;
        cv::cvtColor(after_gray_aligned, final_debug, cv::COLOR_GRAY2BGR);
        cv::circle(final_debug, cv::Point(cx, cy), 6, cv::Scalar(0, 0, 255), -1);
        cv::circle(final_debug, cv::Point(cx, cy), radius, cv::Scalar(0, 255, 255), 2);
        const std::vector<cv::Scalar> colors{{255,0,0},{0,255,0},{0,0,255}};
        for (size_t i = 0; i < selected_ranked.size(); ++i) {
            const auto& component = selected_ranked[i].component;
            const auto& color = colors[i % colors.size()];
            cv::rectangle(final_debug, cv::Rect(component.x, component.y, component.width, component.height), color, 2);
            cv::circle(final_debug, tip_points[i], 8, color, -1);
        }
        cv::imwrite(DebugImagesPath() + "/debug_03_candidate_components.jpg", candidate_debug_img);
        cv::imwrite(DebugImagesPath() + "/debug_03_filtered_components.jpg", selected_debug_img);
        cv::imwrite(DebugImagesPath() + "/debug_dart_detection.jpg", final_debug);
    }

    return tip_points;
}

SingleDartSelectionResult DetectSingleDartPointFromGrayImages(const cv::Mat& before_gray, const cv::Mat& after_gray_aligned, int cx, int cy, int radius, const DartDetectionConfig& config, bool debug) {
    DiffBinaryOutputs outputs = BuildDiffBinaryOutputs(before_gray, after_gray_aligned, cx, cy, radius, config);
    if (debug) SaveDiffBinaryDebugImages(outputs);
    if (outputs.max_value <= 0 || cv::countNonZero(outputs.binary_img) == 0) {
        return {false, std::nullopt, "no_white", 0, 0};
    }

    auto raw_components = ExtractConnectedComponents(outputs.binary_img);
    auto [filtered_mask, filtered_components] = FilterConnectedComponents(outputs.binary_img, config.min_area, false);
    (void)filtered_mask;
    auto [selected_component, reason] = SelectSingleDartComponent(raw_components, filtered_components, outputs.contrast_diff);
    if (!selected_component.has_value()) {
        return {false, std::nullopt, reason, static_cast<int>(raw_components.size()), static_cast<int>(filtered_components.size())};
    }

    cv::Point tip_point = ExtractComponentLeftmostPoint(selected_component->mask);
    if (debug) {
        auto raw_ranked = RankComponentsByMeanGray(raw_components, outputs.contrast_diff);
        auto filtered_ranked = RankComponentsByMeanGray(filtered_components, outputs.contrast_diff);
        std::vector<RankedComponent> selected_ranked{{selected_component.value(), ComputeComponentMeanGray(selected_component->mask, outputs.contrast_diff)}};
        cv::imwrite(DebugImagesPath() + "/debug_03_single_raw_components.jpg", DrawComponentDebugImage(outputs.binary_img, raw_ranked, "R"));
        cv::imwrite(DebugImagesPath() + "/debug_03_single_filtered_components.jpg", DrawComponentDebugImage(outputs.binary_img, filtered_ranked, "F"));
        cv::imwrite(DebugImagesPath() + "/debug_03_single_selected_component.jpg", DrawComponentDebugImage(outputs.binary_img, selected_ranked, "S"));
        cv::Mat debug_img;
        cv::cvtColor(after_gray_aligned, debug_img, cv::COLOR_GRAY2BGR);
        cv::circle(debug_img, cv::Point(cx, cy), 6, cv::Scalar(0, 0, 255), -1);
        cv::circle(debug_img, cv::Point(cx, cy), radius, cv::Scalar(0, 255, 255), 2);
        cv::circle(debug_img, tip_point, 8, cv::Scalar(0, 255, 0), -1);
        cv::imwrite(DebugImagesPath() + "/debug_single_dart_detection.jpg", debug_img);
    }

    return {true, tip_point, reason, static_cast<int>(raw_components.size()), static_cast<int>(filtered_components.size())};
}

std::vector<cv::Point> DetectDartTip(
    const cv::Mat& img_before,
    const cv::Mat& img_after,
    const EdgeDetectionConfig& edge_config,
    const CircleDetectionConfig& circle_config,
    const DartDetectionConfig& dart_config,
    bool debug) {
    BoardCircle board_circle = DetectBoardCircle(img_before, edge_config, circle_config, debug);
    TwoStageAlignmentResult alignment = AlignAfterImageTwoStage(
        img_before,
        img_after,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        debug,
        dart_config.preprocess_blur_kernel,
        2);
    return DetectDartPointsFromGrayImages(
        alignment.before_gray_final,
        alignment.after_gray_final,
        board_circle.cx,
        board_circle.cy,
        board_circle.radius,
        dart_config,
        debug);
}

}  // namespace bulltrack

