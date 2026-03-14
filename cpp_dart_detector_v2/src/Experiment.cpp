#include "Experiment.h"

#include "Alignment.h"
#include "BoardDetector.h"
#include "DartDetector.h"
#include "Pipeline.h"
#include "Preprocessing.h"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <numeric>
#include <optional>
#include <sstream>
#include <stdexcept>

namespace bulltrack {
namespace {

namespace fs = std::filesystem;

class CurrentPathGuard {
public:
    CurrentPathGuard() : previous_(fs::current_path()) {}
    ~CurrentPathGuard() { fs::current_path(previous_); }
private:
    fs::path previous_;
};

cv::Mat ResizeLongEdgeTo720(const cv::Mat& image, int long_edge) {
    const int h = image.rows;
    const int w = image.cols;
    const int current_long = std::max(h, w);
    if (current_long <= 0) {
        throw std::runtime_error("图像尺寸无效");
    }
    if (current_long == long_edge) {
        return image.clone();
    }
    const double scale = static_cast<double>(long_edge) / static_cast<double>(current_long);
    const int target_w = std::max(1, static_cast<int>(std::lround(static_cast<double>(w) * scale)));
    const int target_h = std::max(1, static_cast<int>(std::lround(static_cast<double>(h) * scale)));
    cv::Mat resized;
    cv::resize(image, resized, cv::Size(target_w, target_h), 0.0, 0.0, cv::INTER_AREA);
    return resized;
}

cv::Mat GaussianBlurOnce(const cv::Mat& gray, int kernel_size) {
    const int kernel = EnsureOddKernel(kernel_size);
    if (kernel == 1) {
        return gray.clone();
    }
    cv::Mat blurred;
    cv::GaussianBlur(gray, blurred, cv::Size(kernel, kernel), 0);
    return blurred;
}

void SaveImage(const fs::path& path, const cv::Mat& image) {
    fs::create_directories(path.parent_path());
    cv::imwrite(path.string(), image);
}

std::vector<fs::path> CollectImagePaths(const std::string& image_dir, int limit) {
    std::vector<fs::path> paths;
    const std::vector<std::string> suffixes{".jpg", ".jpeg", ".png", ".bmp", ".webp"};
    for (const auto& entry : fs::directory_iterator(image_dir)) {
        if (!entry.is_regular_file()) {
            continue;
        }
        std::string ext = entry.path().extension().string();
        std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
        if (std::find(suffixes.begin(), suffixes.end(), ext) != suffixes.end()) {
            paths.push_back(entry.path());
        }
    }
    std::sort(paths.begin(), paths.end(), [](const fs::path& lhs, const fs::path& rhs) {
        return lhs.filename().string() < rhs.filename().string();
    });
    if (static_cast<int>(paths.size()) < limit) {
        throw std::runtime_error("图片数量不足 " + std::to_string(limit) + " 张: " + image_dir);
    }
    paths.resize(limit);
    return paths;
}

std::tuple<long long, double, int, int, double> ComputeDiffStats(const cv::Mat& diff) {
    const long long diff_sum = static_cast<long long>(cv::sum(diff)[0]);
    const double diff_mean = cv::mean(diff)[0];
    double diff_max = 0.0;
    cv::minMaxLoc(diff, nullptr, &diff_max);
    const int nonzero = cv::countNonZero(diff);
    const double ratio = diff.total() > 0 ? static_cast<double>(nonzero) / static_cast<double>(diff.total()) : 0.0;
    return {diff_sum, diff_mean, static_cast<int>(diff_max), nonzero, ratio};
}

std::tuple<int, int, int, int> ComputeBoardSquareCrop(const cv::Size& shape, int cx, int cy, int radius) {
    const int left = std::max(0, cx - radius);
    const int top = std::max(0, cy - radius);
    const int right = std::min(shape.width, cx + radius);
    const int bottom = std::min(shape.height, cy + radius);
    if (left >= right || top >= bottom) {
        throw std::runtime_error("靶盘外接正方形裁剪区域无效");
    }
    return {left, top, right, bottom};
}

cv::Mat CropWithBox(const cv::Mat& image, const std::tuple<int, int, int, int>& crop_box) {
    const auto [left, top, right, bottom] = crop_box;
    return image(cv::Rect(left, top, right - left, bottom - top)).clone();
}

cv::Mat FilterSmallComponents(const cv::Mat& binary_img, int min_area = 4) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    cv::Mat filtered = cv::Mat::zeros(binary_img.size(), CV_8U);
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area < min_area) {
            continue;
        }
        filtered.setTo(255, labels == label);
    }
    return filtered;
}

cv::Mat ApplyCloseRepeated(const cv::Mat& binary_img, int kernel_size = 3, int iterations = 2) {
    const int kernel = EnsureOddKernel(kernel_size);
    cv::Mat morph_kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(kernel, kernel));
    cv::Mat closed = binary_img.clone();
    for (int i = 0; i < std::max(0, iterations); ++i) {
        cv::morphologyEx(closed, closed, cv::MORPH_CLOSE, morph_kernel, cv::Point(-1, -1), 1);
    }
    return closed;
}

cv::Mat ApplySmallDilate(const cv::Mat& binary_img, int kernel_size = 3, int iterations = 2) {
    const int kernel = EnsureOddKernel(kernel_size);
    cv::Mat morph_kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(kernel, kernel));
    cv::Mat dilated;
    cv::dilate(binary_img, dilated, morph_kernel, cv::Point(-1, -1), std::max(0, iterations));
    return dilated;
}

using BoxTuple = std::tuple<int, int, int, int, int, int>;

std::vector<BoxTuple> ExtractComponentBoxes(const cv::Mat& binary_img) {
    cv::Mat labels, stats, centroids;
    const int num_labels = cv::connectedComponentsWithStats(binary_img, labels, stats, centroids, 8, CV_32S);
    std::vector<BoxTuple> boxes;
    for (int label = 1; label < num_labels; ++label) {
        const int area = stats.at<int>(label, cv::CC_STAT_AREA);
        if (area <= 0) {
            continue;
        }
        const int x = stats.at<int>(label, cv::CC_STAT_LEFT);
        const int y = stats.at<int>(label, cv::CC_STAT_TOP);
        const int width = stats.at<int>(label, cv::CC_STAT_WIDTH);
        const int height = stats.at<int>(label, cv::CC_STAT_HEIGHT);
        const int long_edge = std::max(width, height);
        boxes.emplace_back(x, y, width, height, long_edge, area);
    }
    return boxes;
}

std::optional<BoxTuple> LongestBox(const cv::Mat& binary_img) {
    std::vector<BoxTuple> boxes = ExtractComponentBoxes(binary_img);
    if (boxes.empty()) {
        return std::nullopt;
    }
    return *std::max_element(boxes.begin(), boxes.end(), [](const BoxTuple& lhs, const BoxTuple& rhs) {
        return std::get<4>(lhs) < std::get<4>(rhs);
    });
}

std::tuple<int, int, double> ComputeBoxFillRatio(const cv::Mat& binary_img, const std::optional<BoxTuple>& box) {
    if (!box.has_value()) {
        return {0, 0, 0.0};
    }
    const auto [x, y, w, h, long_edge, area] = box.value();
    (void)long_edge;
    (void)area;
    if (w <= 0 || h <= 0) {
        return {0, 0, 0.0};
    }
    cv::Mat roi = binary_img(cv::Rect(x, y, w, h));
    const int box_area = w * h;
    const int white_area = cv::countNonZero(roi);
    const double fill_ratio = box_area > 0 ? static_cast<double>(white_area) / static_cast<double>(box_area) : 0.0;
    return {box_area, white_area, fill_ratio};
}

double ComputeBoxLongShortRatio(const std::optional<BoxTuple>& box) {
    if (!box.has_value()) {
        return 0.0;
    }
    const auto [x, y, w, h, long_edge, area] = box.value();
    (void)x;
    (void)y;
    (void)long_edge;
    (void)area;
    const int short_edge = std::min(w, h);
    const int longer_edge = std::max(w, h);
    if (short_edge <= 0) {
        return 0.0;
    }
    return static_cast<double>(longer_edge) / static_cast<double>(short_edge);
}

cv::Mat DrawComponentBoxesDebug(
    const cv::Mat& binary_img,
    int radius,
    const std::optional<BoxTuple>& longest_box,
    bool sector_boundary,
    const std::optional<double>& fill_ratio) {
    cv::Mat debug_img;
    cv::cvtColor(binary_img, debug_img, cv::COLOR_GRAY2BGR);
    std::vector<BoxTuple> boxes = ExtractComponentBoxes(binary_img);

    std::ostringstream bottom;
    bottom << "R=" << radius;
    if (fill_ratio.has_value()) {
        bottom << ",F=" << std::fixed << std::setprecision(4) << fill_ratio.value();
    }
    cv::putText(debug_img, bottom.str(), cv::Point(8, std::max(20, debug_img.rows - 10)), cv::FONT_HERSHEY_SIMPLEX, 0.6, cv::Scalar(255, 255, 0), 2);

    for (size_t i = 0; i < boxes.size(); ++i) {
        const auto& box = boxes[i];
        const auto [x, y, w, h, long_edge, area] = box;
        (void)area;
        const bool is_longest = longest_box.has_value() && box == longest_box.value();
        const cv::Scalar color = sector_boundary && is_longest ? cv::Scalar(0, 0, 255) : (is_longest ? cv::Scalar(255, 255, 0) : cv::Scalar(0, 255, 0));
        const int thickness = is_longest ? 3 : 2;
        cv::rectangle(debug_img, cv::Rect(x, y, w, h), color, thickness);
        std::ostringstream label;
        label << "B" << (i + 1) << ":L=" << long_edge;
        if (is_longest && fill_ratio.has_value()) {
            label << ",F=" << std::fixed << std::setprecision(2) << fill_ratio.value();
        }
        cv::putText(debug_img, label.str(), cv::Point(x, std::max(18, y - 8)), cv::FONT_HERSHEY_SIMPLEX, 0.45, color, 1);
        if (sector_boundary && is_longest) {
            cv::putText(debug_img, "扇形边界", cv::Point(x, std::min(debug_img.rows - 8, y + h + 18)), cv::FONT_HERSHEY_SIMPLEX, 0.65, color, 2);
        }
    }
    return debug_img;
}

void WriteBeforeMetadata(
    const fs::path& metadata_path,
    const fs::path& before_source,
    const cv::Size& before_size,
    int cx,
    int cy,
    int radius,
    const std::tuple<int, int, int, int>& crop_box,
    const ExperimentConfig& exp_cfg) {
    std::ofstream out(metadata_path);
    const auto [left, top, right, bottom] = crop_box;
    out << "source=" << before_source.filename().string() << "\n";
    out << "size=" << before_size.width << "x" << before_size.height << "\n";
    out << "center_x=" << cx << "\n";
    out << "center_y=" << cy << "\n";
    out << "radius=" << radius << "\n";
    out << "crop_left=" << left << "\n";
    out << "crop_top=" << top << "\n";
    out << "crop_right=" << right << "\n";
    out << "crop_bottom=" << bottom << "\n";
    out << "levels=" << exp_cfg.levels << "\n";
    out << "motion_type=" << exp_cfg.motion_type << "\n";
    out << "diff_blur_kernel=" << EnsureOddKernel(exp_cfg.diff_blur_kernel) << "\n";
    out << "diff_brightness_beta=" << exp_cfg.diff_brightness_beta << "\n";
    out << "diff_contrast_alpha=" << exp_cfg.diff_contrast_alpha << "\n";
    out << "diff_contrast_center=" << exp_cfg.diff_contrast_center << "\n";
    out << "gate_filter_min_area=4\n";
    out << "gate_threshold_scale=0.4\n";
    out << "gate_dilate_iterations=2\n";
    out << "gate_close_iterations=2\n";
    out << "gate_closed_longest_edge_threshold=radius/2\n";
    out << "gate_filtered_fill_ratio_threshold=0.25\n";
    out << "gate_filtered_box_long_short_ratio_lt=4.0\n";
}

void WriteFrameStats(
    const fs::path& path,
    const fs::path& image_path,
    const std::string& previous_name,
    const std::tuple<int, int, int, int>& crop_box,
    const PyramidECCResult& alignment_result,
    long long diff_sum,
    double diff_mean,
    int diff_max,
    int diff_nonzero_count,
    double diff_nonzero_ratio,
    int max_value,
    int threshold_value,
    bool gate_has_dart,
    const std::string& gate_reason,
    int closed_longest_edge,
    int filtered_longest_edge,
    int filtered_longest_box_area,
    int filtered_longest_box_white_area,
    double filtered_longest_box_fill_ratio,
    bool precise_detection_triggered,
    const std::string& precise_detection_output_dir,
    int precise_detection_count,
    const std::string& precise_detection_reason,
    const std::string& precise_detection_point_norm) {
    const auto [left, top, right, bottom] = crop_box;
    std::ofstream out(path);
    out << "image=" << image_path.filename().string() << "\n";
    out << "compared_to=" << previous_name << "\n";
    out << "crop_left=" << left << "\n";
    out << "crop_top=" << top << "\n";
    out << "crop_right=" << right << "\n";
    out << "crop_bottom=" << bottom << "\n";
    out << "correlation=" << std::fixed << std::setprecision(8) << alignment_result.correlation << "\n";
    out << "level_correlations=";
    for (size_t i = 0; i < alignment_result.level_correlations.size(); ++i) {
        if (i > 0) out << ",";
        out << std::fixed << std::setprecision(8) << alignment_result.level_correlations[i];
    }
    out << "\n";
    out << "level_iterations=";
    for (size_t i = 0; i < alignment_result.level_iterations.size(); ++i) {
        if (i > 0) out << ",";
        out << alignment_result.level_iterations[i];
    }
    out << "\n";
    out << "diff_sum=" << diff_sum << "\n";
    out << "diff_mean=" << std::fixed << std::setprecision(8) << diff_mean << "\n";
    out << "diff_max=" << diff_max << "\n";
    out << "diff_nonzero_count=" << diff_nonzero_count << "\n";
    out << "diff_nonzero_ratio=" << std::fixed << std::setprecision(8) << diff_nonzero_ratio << "\n";
    out << "threshold_max_value=" << max_value << "\n";
    out << "threshold_value=" << threshold_value << "\n";
    out << "gate_has_dart=" << static_cast<int>(gate_has_dart) << "\n";
    out << "gate_reason=" << gate_reason << "\n";
    out << "closed_longest_edge=" << closed_longest_edge << "\n";
    out << "filtered_longest_edge=" << filtered_longest_edge << "\n";
    out << "filtered_longest_box_area=" << filtered_longest_box_area << "\n";
    out << "filtered_longest_box_white_area=" << filtered_longest_box_white_area << "\n";
    out << "filtered_longest_box_fill_ratio=" << std::fixed << std::setprecision(8) << filtered_longest_box_fill_ratio << "\n";
    out << "precise_detection_triggered=" << static_cast<int>(precise_detection_triggered) << "\n";
    out << "precise_detection_output_dir=" << precise_detection_output_dir << "\n";
    out << "precise_detection_count=" << precise_detection_count << "\n";
    out << "precise_detection_reason=" << precise_detection_reason << "\n";
    out << "precise_detection_point_norm=" << precise_detection_point_norm << "\n";
    out << "post_thresh_filter=connected_components_area>=4\n";
    out << "post_thresh_close_iterations=2\n";
    out << "post_thresh_dilate_iterations=2\n";
}

void WriteSummaryCsv(const fs::path& path, const std::vector<ExperimentFrameResult>& results) {
    std::ofstream out(path);
    out << "image_name,compared_to,output_dir,correlation,level_correlations,level_iterations,diff_sum,diff_mean,diff_max,diff_nonzero_count,diff_nonzero_ratio,gate_has_dart,gate_reason,closed_longest_edge,filtered_longest_edge,filtered_longest_box_area,filtered_longest_box_white_area,filtered_longest_box_fill_ratio,precise_detection_triggered,precise_detection_output_dir,precise_detection_count,precise_detection_reason,precise_detection_point_norm\n";
    for (const auto& r : results) {
        std::ostringstream corr_values;
        for (size_t i = 0; i < r.level_correlations.size(); ++i) {
            if (i > 0) corr_values << ",";
            corr_values << std::fixed << std::setprecision(8) << r.level_correlations[i];
        }
        std::ostringstream iter_values;
        for (size_t i = 0; i < r.level_iterations.size(); ++i) {
            if (i > 0) iter_values << ",";
            iter_values << r.level_iterations[i];
        }
        out << r.image_name << ","
            << r.compared_to << ","
            << r.output_dir << ","
            << std::fixed << std::setprecision(8) << r.correlation << ","
            << "\"" << corr_values.str() << "\","
            << "\"" << iter_values.str() << "\","
            << r.diff_sum << ","
            << std::fixed << std::setprecision(8) << r.diff_mean << ","
            << r.diff_max << ","
            << r.diff_nonzero_count << ","
            << std::fixed << std::setprecision(8) << r.diff_nonzero_ratio << ","
            << static_cast<int>(r.gate_has_dart) << ","
            << r.gate_reason << ","
            << r.closed_longest_edge << ","
            << r.filtered_longest_edge << ","
            << r.filtered_longest_box_area << ","
            << r.filtered_longest_box_white_area << ","
            << std::fixed << std::setprecision(8) << r.filtered_longest_box_fill_ratio << ","
            << static_cast<int>(r.precise_detection_triggered) << ","
            << r.precise_detection_output_dir << ","
            << r.precise_detection_count << ","
            << r.precise_detection_reason << ","
            << r.precise_detection_point_norm << "\n";
    }
}

}  // namespace

std::vector<ExperimentFrameResult> RunPyramidEccExperiment(
    const std::string& image_dir,
    const std::string& output_dir,
    const PipelineConfig& pipeline_config,
    const ExperimentConfig& experiment_config) {
    const std::vector<fs::path> image_paths = CollectImagePaths(image_dir, experiment_config.max_images);
    const fs::path output_root(output_dir);
    fs::create_directories(output_root);

    cv::Mat before_raw = cv::imread(image_paths[0].string());
    if (before_raw.empty()) {
        throw std::runtime_error("无法读取图片: " + image_paths[0].string());
    }

    cv::Mat before_resized = ResizeLongEdgeTo720(before_raw, experiment_config.long_edge);
    cv::Mat before_enhanced = EnhanceWarpedImage(before_resized, pipeline_config.enhancement.saturation_scale, pipeline_config.enhancement.contrast_scale);
    cv::Mat before_gray;
    cv::cvtColor(before_enhanced, before_gray, cv::COLOR_BGR2GRAY);
    BoardCircle board_circle = DetectBoardCircle(before_enhanced, pipeline_config.edge, pipeline_config.circle, false);

    cv::Mat before_masked = ApplyBoardMask(before_gray, board_circle.cx, board_circle.cy, board_circle.radius);
    const auto crop_box = ComputeBoardSquareCrop(before_masked.size(), board_circle.cx, board_circle.cy, board_circle.radius);
    cv::Mat before_cropped = CropWithBox(before_masked, crop_box);
    cv::Mat before_blurred = GaussianBlurOnce(before_cropped, experiment_config.diff_blur_kernel);

    SaveImage(output_root / "before_resized.jpg", before_resized);
    SaveImage(output_root / "before_enhanced.jpg", before_enhanced);
    SaveImage(output_root / "before_gray.jpg", before_gray);
    SaveImage(output_root / "before_board_masked.jpg", before_masked);
    SaveImage(output_root / "before_cropped.jpg", before_cropped);
    SaveImage(output_root / "before_blurred.jpg", before_blurred);
    WriteBeforeMetadata(output_root / "before_metadata.txt", image_paths[0], before_resized.size(), board_circle.cx, board_circle.cy, board_circle.radius, crop_box, experiment_config);

    std::vector<ExperimentFrameResult> results;
    cv::Mat previous_processed = before_blurred;
    std::string previous_name = image_paths[0].filename().string();
    fs::path previous_source_path = fs::absolute(image_paths[0]);

    for (size_t index = 1; index < image_paths.size(); ++index) {
        const fs::path& image_path = image_paths[index];
        const fs::path image_abs_path = fs::absolute(image_path);
        cv::Mat after_raw = cv::imread(image_path.string());
        if (after_raw.empty()) {
            throw std::runtime_error("无法读取图片: " + image_path.string());
        }

        cv::Mat after_resized = ResizeLongEdgeTo720(after_raw, experiment_config.long_edge);
        cv::Mat after_enhanced = EnhanceWarpedImage(after_resized, pipeline_config.enhancement.saturation_scale, pipeline_config.enhancement.contrast_scale);
        cv::Mat after_gray;
        cv::cvtColor(after_enhanced, after_gray, cv::COLOR_BGR2GRAY);

        PyramidECCResult alignment_result = AlignPyramidEcc(before_gray, after_gray, experiment_config.levels, experiment_config.motion_type);
        cv::Mat aligned_after_color = WarpImageWithMatrix(
            after_enhanced,
            alignment_result.warp_matrix,
            alignment_result.motion_type,
            cv::Size(before_gray.cols, before_gray.rows));
        cv::Mat after_masked = ApplyBoardMask(alignment_result.aligned_target, board_circle.cx, board_circle.cy, board_circle.radius);
        cv::Mat after_cropped = CropWithBox(after_masked, crop_box);
        cv::Mat after_blurred = GaussianBlurOnce(after_cropped, experiment_config.diff_blur_kernel);

        cv::Mat diff;
        cv::absdiff(previous_processed, after_blurred, diff);
        cv::Mat brightened_diff;
        cv::Mat contrast_diff;
        std::tie(brightened_diff, contrast_diff) = EnhanceDiffImage(
            diff,
            experiment_config.diff_brightness_beta,
            experiment_config.diff_contrast_alpha,
            experiment_config.diff_contrast_center);

        double max_value_f = 0.0;
        cv::minMaxLoc(contrast_diff, nullptr, &max_value_f);
        const int max_value = static_cast<int>(max_value_f);
        const int threshold_value = max_value > 0 ? std::max(1, static_cast<int>(max_value * 0.4)) : 1;
        cv::Mat thresh;
        cv::threshold(contrast_diff, thresh, threshold_value, 255, cv::THRESH_BINARY);
        cv::Mat filtered_thresh = FilterSmallComponents(thresh, 4);
        const bool is_filtered_all_black = cv::countNonZero(filtered_thresh) == 0;

        cv::Mat dilated_thresh = cv::Mat::zeros(filtered_thresh.size(), CV_8U);
        cv::Mat closed_thresh = cv::Mat::zeros(filtered_thresh.size(), CV_8U);
        std::optional<BoxTuple> closed_longest_box;
        std::optional<BoxTuple> filtered_longest_box;
        int closed_longest_edge = 0;
        int filtered_longest_edge = 0;
        int filtered_longest_box_area = 0;
        int filtered_longest_box_white_area = 0;
        double filtered_longest_box_fill_ratio = 0.0;
        bool gate_has_dart = false;
        std::string gate_reason = "all_black_after_filter";
        bool precise_detection_triggered = false;
        std::string precise_detection_output_dir;
        int precise_detection_count = 0;
        std::string precise_detection_reason;
        std::string precise_detection_point_norm;

        if (!is_filtered_all_black) {
            dilated_thresh = ApplySmallDilate(filtered_thresh, 3, 2);
            closed_thresh = ApplyCloseRepeated(dilated_thresh, 3, 2);
            closed_longest_box = LongestBox(closed_thresh);
            closed_longest_edge = closed_longest_box.has_value() ? std::get<4>(closed_longest_box.value()) : 0;

            if (!closed_longest_box.has_value()) {
                gate_reason = "no_closed_box";
            } else if (static_cast<double>(closed_longest_edge) >= (static_cast<double>(board_circle.radius) / 2.0)) {
                gate_reason = "closed_box_ge_half_radius";
            } else {
                filtered_longest_box = LongestBox(filtered_thresh);
                filtered_longest_edge = filtered_longest_box.has_value() ? std::get<4>(filtered_longest_box.value()) : 0;
                std::tie(filtered_longest_box_area, filtered_longest_box_white_area, filtered_longest_box_fill_ratio) =
                    ComputeBoxFillRatio(filtered_thresh, filtered_longest_box);
                if (!filtered_longest_box.has_value()) {
                    gate_reason = "no_filtered_box";
                } else if (filtered_longest_box_fill_ratio < 0.25) {
                    gate_reason = "filtered_box_fill_lt_quarter";
                } else if (ComputeBoxLongShortRatio(filtered_longest_box) >= 4.0) {
                    gate_reason = "filtered_box_long_short_ratio_ge_4";
                } else {
                    gate_has_dart = true;
                    gate_reason = "trigger_precise_detection";
                }
            }
        }

        const bool sector_boundary = closed_longest_box.has_value() && (static_cast<double>(closed_longest_edge) >= (static_cast<double>(board_circle.radius) / 2.0));
        cv::Mat component_boxes_closed = DrawComponentBoxesDebug(closed_thresh, board_circle.radius, closed_longest_box, sector_boundary, std::nullopt);
        cv::Mat component_boxes_filtered = DrawComponentBoxesDebug(
            filtered_thresh,
            board_circle.radius,
            filtered_longest_box,
            false,
            filtered_longest_box.has_value() ? std::optional<double>(filtered_longest_box_fill_ratio) : std::nullopt);

        long long diff_sum = 0;
        double diff_mean = 0.0;
        int diff_max = 0;
        int diff_nonzero_count = 0;
        double diff_nonzero_ratio = 0.0;
        std::tie(diff_sum, diff_mean, diff_max, diff_nonzero_count, diff_nonzero_ratio) = ComputeDiffStats(diff);

        std::ostringstream frame_name;
        frame_name << std::setw(2) << std::setfill('0') << index << "_" << image_path.stem().string();
        fs::path frame_dir = output_root / frame_name.str();
        SaveImage(frame_dir / "after_resized.jpg", after_resized);
        SaveImage(frame_dir / "after_enhanced.jpg", after_enhanced);
        SaveImage(frame_dir / "after_gray.jpg", after_gray);
        SaveImage(frame_dir / "after_aligned_gray.jpg", alignment_result.aligned_target);
        SaveImage(frame_dir / "after_aligned_color.jpg", aligned_after_color);
        SaveImage(frame_dir / "after_board_masked.jpg", after_masked);
        SaveImage(frame_dir / "after_cropped.jpg", after_cropped);
        SaveImage(frame_dir / "after_blurred.jpg", after_blurred);
        SaveImage(frame_dir / "previous_blurred.jpg", previous_processed);
        SaveImage(frame_dir / "diff.jpg", diff);
        SaveImage(frame_dir / "brightened_diff.jpg", brightened_diff);
        SaveImage(frame_dir / "contrast_diff.jpg", contrast_diff);
        SaveImage(frame_dir / "thresh.jpg", thresh);
        SaveImage(frame_dir / "thresh_filtered.jpg", filtered_thresh);
        SaveImage(frame_dir / "thresh_dilated.jpg", dilated_thresh);
        SaveImage(frame_dir / "thresh_closed.jpg", closed_thresh);
        SaveImage(frame_dir / "component_boxes_closed.jpg", component_boxes_closed);
        SaveImage(frame_dir / "component_boxes_filtered.jpg", component_boxes_filtered);

        if (gate_has_dart) {
            fs::path precise_detection_dir = frame_dir / "precise_detection";
            fs::create_directories(precise_detection_dir);
            CurrentPathGuard path_guard;
            fs::current_path(precise_detection_dir);
            SingleDartDetectionResult single_result = DetectSingleDartPosition(
                previous_source_path.string(),
                image_abs_path.string(),
                pipeline_config,
                true);
            precise_detection_triggered = true;
            precise_detection_output_dir = precise_detection_dir.string();
            precise_detection_count = single_result.has_dart ? 1 : 0;
            precise_detection_reason = single_result.reason;
            if (single_result.point_norm.has_value()) {
                std::ostringstream point;
                point << std::fixed << std::setprecision(8) << single_result.point_norm->x << "," << single_result.point_norm->y;
                precise_detection_point_norm = point.str();
            }
        }

        std::ofstream matrix_out(frame_dir / "ecc_warp_matrix.txt");
        matrix_out << std::fixed << std::setprecision(8);
        for (int r = 0; r < alignment_result.warp_matrix.rows; ++r) {
            for (int c = 0; c < alignment_result.warp_matrix.cols; ++c) {
                matrix_out << alignment_result.warp_matrix.at<float>(r, c);
                if (c + 1 < alignment_result.warp_matrix.cols) matrix_out << " ";
            }
            matrix_out << "\n";
        }

        WriteFrameStats(
            frame_dir / "stats.txt",
            image_path,
            previous_name,
            crop_box,
            alignment_result,
            diff_sum,
            diff_mean,
            diff_max,
            diff_nonzero_count,
            diff_nonzero_ratio,
            max_value,
            threshold_value,
            gate_has_dart,
            gate_reason,
            closed_longest_edge,
            filtered_longest_edge,
            filtered_longest_box_area,
            filtered_longest_box_white_area,
            filtered_longest_box_fill_ratio,
            precise_detection_triggered,
            precise_detection_output_dir,
            precise_detection_count,
            precise_detection_reason,
            precise_detection_point_norm);

        ExperimentFrameResult frame_result;
        frame_result.image_name = image_path.filename().string();
        frame_result.compared_to = previous_name;
        frame_result.output_dir = frame_dir.string();
        frame_result.correlation = alignment_result.correlation;
        frame_result.level_correlations = alignment_result.level_correlations;
        frame_result.level_iterations = alignment_result.level_iterations;
        frame_result.diff_sum = diff_sum;
        frame_result.diff_mean = diff_mean;
        frame_result.diff_max = diff_max;
        frame_result.diff_nonzero_count = diff_nonzero_count;
        frame_result.diff_nonzero_ratio = diff_nonzero_ratio;
        frame_result.gate_has_dart = gate_has_dart;
        frame_result.gate_reason = gate_reason;
        frame_result.closed_longest_edge = closed_longest_edge;
        frame_result.filtered_longest_edge = filtered_longest_edge;
        frame_result.filtered_longest_box_area = filtered_longest_box_area;
        frame_result.filtered_longest_box_white_area = filtered_longest_box_white_area;
        frame_result.filtered_longest_box_fill_ratio = filtered_longest_box_fill_ratio;
        frame_result.precise_detection_triggered = precise_detection_triggered;
        frame_result.precise_detection_output_dir = precise_detection_output_dir;
        frame_result.precise_detection_count = precise_detection_count;
        frame_result.precise_detection_reason = precise_detection_reason;
        frame_result.precise_detection_point_norm = precise_detection_point_norm;
        results.push_back(frame_result);

        previous_processed = after_blurred;
        previous_name = image_path.filename().string();
        previous_source_path = image_abs_path;
    }

    WriteSummaryCsv(output_root / "summary.csv", results);
    return results;
}

}  // namespace bulltrack
