#include "bulltrack_v2/Alignment.h"

#include "bulltrack_v2/Preprocessing.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <stdexcept>

namespace bulltrack {
namespace {

std::pair<int, std::string> NormalizeMotionType(const std::string& motion_type) {
    std::string motion = motion_type;
    std::transform(motion.begin(), motion.end(), motion.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (motion == "translation") return {cv::MOTION_TRANSLATION, motion};
    if (motion == "euclidean") return {cv::MOTION_EUCLIDEAN, motion};
    if (motion == "affine") return {cv::MOTION_AFFINE, motion};
    if (motion == "homography") return {cv::MOTION_HOMOGRAPHY, motion};
    throw std::runtime_error("不支持的 motion_type: " + motion_type);
}

cv::Mat InitialWarpMatrix(int motion_mode) {
    return motion_mode == cv::MOTION_HOMOGRAPHY ? cv::Mat::eye(3, 3, CV_32F) : cv::Mat::eye(2, 3, CV_32F);
}

std::vector<cv::Mat> BuildGaussianPyramid(const cv::Mat& gray, int levels) {
    std::vector<cv::Mat> pyramid{gray};
    for (int i = 1; i < levels; ++i) {
        const cv::Mat& previous = pyramid.back();
        if (std::min(previous.rows, previous.cols) <= 32) break;
        cv::Mat down;
        cv::pyrDown(previous, down);
        pyramid.push_back(down);
    }
    std::reverse(pyramid.begin(), pyramid.end());
    return pyramid;
}

std::vector<int> AllocateLevelIterations(int levels) {
    if (levels <= 0) throw std::runtime_error("levels 必须 >= 1");
    if (levels == 1) return {15};

    std::vector<int> result;
    for (int i = 0; i < levels; ++i) {
        const double t = static_cast<double>(i) * 2.0 / static_cast<double>(levels - 1);
        double interpolated = 3.0;
        if (t <= 1.0) {
            interpolated = 15.0 + (8.0 - 15.0) * t;
        } else {
            interpolated = 8.0 + (3.0 - 8.0) * (t - 1.0);
        }
        result.push_back(std::max(1, static_cast<int>(std::lround(interpolated))));
    }
    return result;
}

cv::Mat ScaleWarpForNextLevel(const cv::Mat& warp_matrix) {
    cv::Mat scaled = warp_matrix.clone();
    scaled.convertTo(scaled, CV_32F);
    scaled.at<float>(0, 2) *= 2.0f;
    scaled.at<float>(1, 2) *= 2.0f;
    if (scaled.rows == 3) {
        // Homography: S * H * S^-1 with S = diag(2, 2, 1) also halves the perspective terms.
        scaled.at<float>(2, 0) *= 0.5f;
        scaled.at<float>(2, 1) *= 0.5f;
    }
    return scaled;
}

void SaveMatrixText(const std::string& path, const cv::Mat& matrix) {
    std::ofstream out(path);
    if (!out.is_open()) return;
    for (int r = 0; r < matrix.rows; ++r) {
        for (int c = 0; c < matrix.cols; ++c) {
            out << std::fixed << std::setprecision(8) << matrix.at<float>(r, c);
            if (c + 1 < matrix.cols) out << ' ';
        }
        out << '\n';
    }
}

}  // namespace

cv::Mat ApplyAdditionalGaussianBlur(const cv::Mat& gray, int blur_kernel, int passes) {
    blur_kernel = EnsureOddKernel(blur_kernel);
    if (blur_kernel == 1 || passes <= 0) return gray.clone();

    cv::Mat blurred = gray.clone();
    for (int i = 0; i < passes; ++i) {
        cv::GaussianBlur(blurred, blurred, cv::Size(blur_kernel, blur_kernel), 0);
    }
    return blurred;
}

cv::Mat PrepareEccDiffGrayscale(const cv::Mat& img, int preprocess_blur_kernel, int extra_blur_passes) {
    cv::Mat gray = PreprocessImage(img, preprocess_blur_kernel);
    return ApplyAdditionalGaussianBlur(gray, preprocess_blur_kernel, extra_blur_passes);
}

cv::Mat BuildBoardMask(const cv::Size& size, int cx, int cy, int radius) {
    cv::Mat mask = cv::Mat::zeros(size, CV_8U);
    cv::circle(mask, cv::Point(cx, cy), radius, cv::Scalar(255), -1);
    return mask;
}

cv::Mat ApplyBoardMask(const cv::Mat& gray, int cx, int cy, int radius) {
    cv::Mat mask = BuildBoardMask(gray.size(), cx, cy, radius);
    cv::Mat output;
    cv::bitwise_and(gray, gray, output, mask);
    return output;
}

std::tuple<cv::Mat, cv::Mat, int> NormalizeGrayPairSharedMax(const cv::Mat& before_gray, const cv::Mat& after_gray) {
    double before_max = 0.0;
    double after_max = 0.0;
    cv::minMaxLoc(before_gray, nullptr, &before_max);
    cv::minMaxLoc(after_gray, nullptr, &after_max);
    const int shared_max = static_cast<int>(std::max(before_max, after_max));
    if (shared_max <= 0) {
        return {cv::Mat::zeros(before_gray.size(), CV_8U), cv::Mat::zeros(after_gray.size(), CV_8U), 0};
    }

    const double scale = 255.0 / static_cast<double>(shared_max);
    cv::Mat before_norm;
    cv::Mat after_norm;
    before_gray.convertTo(before_norm, CV_8U, scale);
    after_gray.convertTo(after_norm, CV_8U, scale);
    return {before_norm, after_norm, shared_max};
}

cv::Mat WarpImageWithMatrix(const cv::Mat& image, const cv::Mat& warp_matrix, const std::string& motion_type, const std::optional<cv::Size>& output_size, int interpolation, int border_mode) {
    auto [motion_mode, motion_name] = NormalizeMotionType(motion_type);
    (void)motion_name;
    const cv::Size target_size = output_size.value_or(image.size());
    cv::Mat output;
    if (motion_mode == cv::MOTION_HOMOGRAPHY) {
        cv::warpPerspective(image, output, warp_matrix, target_size, interpolation | cv::WARP_INVERSE_MAP, border_mode);
    } else {
        cv::warpAffine(image, output, warp_matrix, target_size, interpolation | cv::WARP_INVERSE_MAP, border_mode);
    }
    return output;
}

// target_mask (optional, target size): only these pixels of the target count in the match.
PyramidECCResult AlignPyramidEcc(const cv::Mat& templ, const cv::Mat& target, int levels, const std::string& motion_type, const cv::Mat& target_mask) {
    if (templ.size() != target.size()) throw std::runtime_error("ECC 对齐失败：template/target 尺寸不一致");
    if (levels < 1) throw std::runtime_error("levels 必须 >= 1");

    auto [motion_mode, motion_name] = NormalizeMotionType(motion_type);
    cv::Mat template_gray = templ.channels() == 3 ? PreprocessImage(templ, 1) : templ.clone();
    cv::Mat target_gray = target.channels() == 3 ? PreprocessImage(target, 1) : target.clone();

    auto template_pyramid = BuildGaussianPyramid(template_gray, levels);
    auto target_pyramid = BuildGaussianPyramid(target_gray, levels);
    const int actual_levels = static_cast<int>(std::min(template_pyramid.size(), target_pyramid.size()));
    template_pyramid.resize(actual_levels);
    target_pyramid.resize(actual_levels);
    std::vector<int> level_iterations = AllocateLevelIterations(actual_levels);

    cv::Mat warp_matrix = InitialWarpMatrix(motion_mode);
    std::vector<double> level_correlations;

    for (int level_index = 0; level_index < actual_levels; ++level_index) {
        cv::Mat template_f;
        cv::Mat target_f;
        template_pyramid[level_index].convertTo(template_f, CV_32F, 1.0 / 255.0);
        target_pyramid[level_index].convertTo(target_f, CV_32F, 1.0 / 255.0);
        cv::TermCriteria criteria(cv::TermCriteria::EPS | cv::TermCriteria::COUNT, level_iterations[level_index], 1e-6);
        cv::Mat level_mask;
        if (!target_mask.empty()) {
            cv::resize(target_mask, level_mask, target_f.size(), 0.0, 0.0, cv::INTER_NEAREST);
        }

        double cc = 0.0;
        try {
            cc = cv::findTransformECC(template_f, target_f, warp_matrix, motion_mode, criteria, level_mask);
        } catch (const cv::Exception& exc) {
            throw std::runtime_error(std::string("金字塔 ECC 对齐失败: ") + exc.what());
        }
        level_correlations.push_back(cc);
        if (level_index < actual_levels - 1) warp_matrix = ScaleWarpForNextLevel(warp_matrix);
    }

    PyramidECCResult result;
    result.aligned_target = WarpImageWithMatrix(target_gray, warp_matrix, motion_name, template_gray.size());
    result.warp_matrix = warp_matrix;
    result.correlation = level_correlations.empty() ? 0.0 : level_correlations.back();
    result.level_correlations = level_correlations;
    result.level_iterations = level_iterations;
    result.motion_type = motion_name;
    return result;
}

cv::Mat ComposeInverseMapWarps(const cv::Mat& first_warp, const cv::Mat& second_warp) {
    cv::Mat first_aug = cv::Mat::eye(3, 3, CV_32F);
    cv::Mat second_aug = cv::Mat::eye(3, 3, CV_32F);
    first_warp.copyTo(first_aug(cv::Rect(0, 0, 3, 2)));
    second_warp.copyTo(second_aug(cv::Rect(0, 0, 3, 2)));
    cv::Mat combined = first_aug * second_aug;
    return combined(cv::Rect(0, 0, 3, 2)).clone();
}

TwoStageAlignmentResult AlignAfterImageTwoStage(const cv::Mat& img_before, const cv::Mat& img_after, int cx, int cy, int radius, bool debug, int preprocess_blur_kernel, int extra_blur_passes) {
    TwoStageAlignmentResult result;
    result.before_gray_stage1 = PrepareEccDiffGrayscale(img_before, preprocess_blur_kernel, extra_blur_passes);
    result.after_gray_stage1 = PrepareEccDiffGrayscale(img_after, preprocess_blur_kernel, extra_blur_passes);

    PyramidECCResult stage1 = AlignPyramidEcc(result.before_gray_stage1, result.after_gray_stage1, 3, "affine");
    result.after_gray_stage1_aligned = stage1.aligned_target;
    result.warp_stage1 = stage1.warp_matrix;

    result.before_gray_masked = ApplyBoardMask(result.before_gray_stage1, cx, cy, radius);
    result.after_gray_masked = ApplyBoardMask(result.after_gray_stage1_aligned, cx, cy, radius);

    PyramidECCResult stage2 = AlignPyramidEcc(result.before_gray_masked, result.after_gray_masked, 3, "euclidean");
    result.warp_stage2 = stage2.warp_matrix;
    std::tie(result.before_gray_final, result.after_gray_final, result.shared_gray_max) = NormalizeGrayPairSharedMax(result.before_gray_masked, stage2.aligned_target);
    result.warp_combined = ComposeInverseMapWarps(result.warp_stage1, result.warp_stage2);

    if (debug) {
        EnsureDirectory(DebugImagesPath());
        cv::imwrite(DebugImagesPath() + "/debug_00_ecc_before_gray_stage1.jpg", result.before_gray_stage1);
        cv::imwrite(DebugImagesPath() + "/debug_00_ecc_after_gray_stage1.jpg", result.after_gray_stage1);
        cv::imwrite(DebugImagesPath() + "/debug_00_aligned_after_gray_stage1.jpg", result.after_gray_stage1_aligned);
        cv::imwrite(DebugImagesPath() + "/debug_00_board_masked_before_gray.jpg", result.before_gray_masked);
        cv::imwrite(DebugImagesPath() + "/debug_00_board_masked_after_gray.jpg", result.after_gray_masked);
        cv::imwrite(DebugImagesPath() + "/debug_00_ecc_before_gray_stage2.jpg", result.before_gray_masked);
        cv::imwrite(DebugImagesPath() + "/debug_00_ecc_after_gray_stage2.jpg", result.after_gray_masked);
        cv::imwrite(DebugImagesPath() + "/debug_00_aligned_after_gray_stage2.jpg", stage2.aligned_target);
        cv::imwrite(DebugImagesPath() + "/debug_00_before_gray_final_normalized.jpg", result.before_gray_final);
        cv::imwrite(DebugImagesPath() + "/debug_00_after_gray_final_normalized.jpg", result.after_gray_final);
        SaveMatrixText(DebugImagesPath() + "/debug_00_ecc_warp_matrix_stage1.txt", result.warp_stage1);
        SaveMatrixText(DebugImagesPath() + "/debug_00_ecc_warp_matrix_stage2.txt", result.warp_stage2);
        SaveMatrixText(DebugImagesPath() + "/debug_00_ecc_warp_matrix_combined.txt", result.warp_combined);
        std::ofstream out(DebugImagesPath() + "/debug_00_shared_gray_max.txt");
        out << result.shared_gray_max << '\n';
    }

    return result;
}

}  // namespace bulltrack
