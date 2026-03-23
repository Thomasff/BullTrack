#include "YoloNcnnDetector.h"

#include <ncnn/net.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace bulltrack {
namespace {

constexpr const char* kModelParamAssetPath = "ncnn/model.ncnn.param";
constexpr const char* kModelBinAssetPath = "ncnn/model.ncnn.bin";
constexpr const char* kClassesAssetPath = "ncnn/classes.txt";
constexpr const char* kInputBlobName = "in0";
constexpr const char* kOutputBlobName = "out0";
constexpr int kInputSize = 640;
constexpr float kScoreThreshold = 0.25f;
constexpr float kNmsThreshold = 0.45f;

AAssetManager* g_asset_manager = nullptr;

std::vector<unsigned char> ReadAssetBytes(AAssetManager* asset_manager, const char* asset_path) {
    if (asset_manager == nullptr) {
        throw std::runtime_error("NCNN AssetManager 尚未初始化");
    }
    AAsset* asset = AAssetManager_open(asset_manager, asset_path, AASSET_MODE_BUFFER);
    if (asset == nullptr) {
        throw std::runtime_error(std::string("无法打开 assets 文件: ") + asset_path);
    }

    const off_t length = AAsset_getLength(asset);
    if (length <= 0) {
        AAsset_close(asset);
        throw std::runtime_error(std::string("assets 文件为空: ") + asset_path);
    }

    std::vector<unsigned char> buffer(static_cast<size_t>(length));
    const int64_t read_size = AAsset_read(asset, buffer.data(), static_cast<size_t>(length));
    AAsset_close(asset);
    if (read_size != length) {
        throw std::runtime_error(std::string("读取 assets 文件失败: ") + asset_path);
    }
    return buffer;
}

std::vector<std::string> ReadAssetLines(AAssetManager* asset_manager, const char* asset_path) {
    std::vector<unsigned char> bytes = ReadAssetBytes(asset_manager, asset_path);
    std::string content(bytes.begin(), bytes.end());
    std::istringstream stream(content);
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (!line.empty()) {
            lines.push_back(line);
        }
    }
    if (lines.empty()) {
        throw std::runtime_error(std::string("classes.txt 为空: ") + asset_path);
    }
    return lines;
}

struct LetterboxResult {
    cv::Mat image;
    float scale = 1.0f;
    int pad_x = 0;
    int pad_y = 0;
};

LetterboxResult LetterboxResize(const cv::Mat& image_bgr, int target_size) {
    if (image_bgr.empty()) {
        throw std::runtime_error("YOLO 输入图为空");
    }

    const int src_w = image_bgr.cols;
    const int src_h = image_bgr.rows;
    const float scale = std::min(
        static_cast<float>(target_size) / static_cast<float>(src_w),
        static_cast<float>(target_size) / static_cast<float>(src_h));

    const int resized_w = std::max(1, static_cast<int>(std::round(src_w * scale)));
    const int resized_h = std::max(1, static_cast<int>(std::round(src_h * scale)));

    cv::Mat resized;
    cv::resize(image_bgr, resized, cv::Size(resized_w, resized_h), 0.0, 0.0, cv::INTER_LINEAR);

    cv::Mat output(target_size, target_size, CV_8UC3, cv::Scalar(114, 114, 114));
    const int pad_x = (target_size - resized_w) / 2;
    const int pad_y = (target_size - resized_h) / 2;
    resized.copyTo(output(cv::Rect(pad_x, pad_y, resized_w, resized_h)));

    return {output, scale, pad_x, pad_y};
}

float IoU(const cv::Rect2f& a, const cv::Rect2f& b) {
    const float inter_x1 = std::max(a.x, b.x);
    const float inter_y1 = std::max(a.y, b.y);
    const float inter_x2 = std::min(a.x + a.width, b.x + b.width);
    const float inter_y2 = std::min(a.y + a.height, b.y + b.height);
    const float inter_w = std::max(0.0f, inter_x2 - inter_x1);
    const float inter_h = std::max(0.0f, inter_y2 - inter_y1);
    const float inter_area = inter_w * inter_h;
    const float union_area = a.area() + b.area() - inter_area;
    return union_area > 0.0f ? inter_area / union_area : 0.0f;
}

std::vector<YoloDetectionBox> ApplyNms(std::vector<YoloDetectionBox> boxes) {
    std::stable_sort(boxes.begin(), boxes.end(), [](const YoloDetectionBox& lhs, const YoloDetectionBox& rhs) {
        return lhs.score > rhs.score;
    });

    std::vector<YoloDetectionBox> kept;
    for (const YoloDetectionBox& candidate : boxes) {
        bool suppressed = false;
        for (const YoloDetectionBox& selected : kept) {
            if (candidate.label != selected.label) {
                continue;
            }
            if (IoU(candidate.rect, selected.rect) > kNmsThreshold) {
                suppressed = true;
                break;
            }
        }
        if (!suppressed) {
            kept.push_back(candidate);
        }
    }
    return kept;
}

cv::Mat DrawOverlay(const cv::Mat& image_bgr, const std::vector<YoloDetectionBox>& boxes) {
    cv::Mat overlay = image_bgr.clone();
    for (const YoloDetectionBox& box : boxes) {
        const cv::Scalar color = box.label == "board"
            ? cv::Scalar(0, 255, 255)
            : cv::Scalar(0, 255, 0);
        const cv::Rect rect(
            static_cast<int>(std::round(box.rect.x)),
            static_cast<int>(std::round(box.rect.y)),
            static_cast<int>(std::round(box.rect.width)),
            static_cast<int>(std::round(box.rect.height)));
        cv::rectangle(overlay, rect, color, 3);
        std::ostringstream label_stream;
        label_stream.setf(std::ios::fixed);
        label_stream.precision(2);
        label_stream << box.label << " " << box.score;
        cv::putText(
            overlay,
            label_stream.str(),
            cv::Point(rect.x, std::max(24, rect.y - 8)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.8,
            color,
            2);
    }
    return overlay;
}

class YoloNcnnRuntime {
public:
    YoloDetectionResult Detect(const cv::Mat& image_bgr) {
        std::lock_guard<std::mutex> lock(mutex_);
        EnsureInitialized();

        LetterboxResult letterbox = LetterboxResize(image_bgr, kInputSize);
        ncnn::Mat input = ncnn::Mat::from_pixels(
            letterbox.image.data,
            ncnn::Mat::PIXEL_BGR,
            letterbox.image.cols,
            letterbox.image.rows);
        const float norm_vals[3] = {1.0f / 255.0f, 1.0f / 255.0f, 1.0f / 255.0f};
        input.substract_mean_normalize(nullptr, norm_vals);

        ncnn::Extractor extractor = net_.create_extractor();
        extractor.set_light_mode(true);
        extractor.input(kInputBlobName, input);

        ncnn::Mat output;
        if (extractor.extract(kOutputBlobName, output) != 0) {
            throw std::runtime_error("YOLO 输出提取失败: out0");
        }

        std::vector<YoloDetectionBox> boxes = DecodeOutput(output, letterbox, image_bgr.size());
        std::vector<YoloDetectionBox> final_boxes = ApplyNms(std::move(boxes));
        return {final_boxes, DrawOverlay(image_bgr, final_boxes)};
    }

private:
    void EnsureInitialized() {
        if (initialized_) {
            return;
        }
        if (g_asset_manager == nullptr) {
            throw std::runtime_error("NCNN AssetManager 未设置，无法加载模型");
        }

        class_names_ = ReadAssetLines(g_asset_manager, kClassesAssetPath);
        net_.opt.use_vulkan_compute = false;
        net_.opt.use_fp16_packed = true;
        net_.opt.use_fp16_storage = true;
        net_.opt.use_fp16_arithmetic = true;

        if (net_.load_param(g_asset_manager, kModelParamAssetPath) != 0) {
            throw std::runtime_error("加载 YOLO param 失败: ncnn/model.ncnn.param");
        }
        if (net_.load_model(g_asset_manager, kModelBinAssetPath) != 0) {
            throw std::runtime_error("加载 YOLO bin 失败: ncnn/model.ncnn.bin");
        }
        initialized_ = true;
    }

    std::vector<YoloDetectionBox> DecodeOutput(
        const ncnn::Mat& output,
        const LetterboxResult& letterbox,
        const cv::Size& original_size) const {
        const int value_count = 4 + static_cast<int>(class_names_.size());
        if (output.total() % value_count != 0) {
            throw std::runtime_error("YOLO 输出尺寸与类别数不匹配");
        }

        const int rows = static_cast<int>(output.total() / value_count);
        const float* data = reinterpret_cast<const float*>(output.data);
        if (data == nullptr) {
            throw std::runtime_error("YOLO 输出数据为空");
        }

        auto get_value = [&](int row, int col) -> float {
            if (output.dims == 2) {
                if (output.w == value_count) {
                    return data[row * output.w + col];
                }
                if (output.h == value_count) {
                    return data[col * output.w + row];
                }
            }
            return data[row * value_count + col];
        };

        std::vector<YoloDetectionBox> boxes;
        boxes.reserve(rows);

        for (int i = 0; i < rows; ++i) {
            int best_class = -1;
            float best_score = 0.0f;
            for (int c = 0; c < static_cast<int>(class_names_.size()); ++c) {
                const float score = get_value(i, 4 + c);
                if (score > best_score) {
                    best_score = score;
                    best_class = c;
                }
            }
            if (best_class < 0 || best_score < kScoreThreshold) {
                continue;
            }

            const float cx = get_value(i, 0);
            const float cy = get_value(i, 1);
            const float w = get_value(i, 2);
            const float h = get_value(i, 3);
            const float x0 = (cx - w * 0.5f - static_cast<float>(letterbox.pad_x)) / letterbox.scale;
            const float y0 = (cy - h * 0.5f - static_cast<float>(letterbox.pad_y)) / letterbox.scale;
            const float x1 = (cx + w * 0.5f - static_cast<float>(letterbox.pad_x)) / letterbox.scale;
            const float y1 = (cy + h * 0.5f - static_cast<float>(letterbox.pad_y)) / letterbox.scale;

            const float clipped_x0 = std::clamp(x0, 0.0f, static_cast<float>(original_size.width - 1));
            const float clipped_y0 = std::clamp(y0, 0.0f, static_cast<float>(original_size.height - 1));
            const float clipped_x1 = std::clamp(x1, 0.0f, static_cast<float>(original_size.width - 1));
            const float clipped_y1 = std::clamp(y1, 0.0f, static_cast<float>(original_size.height - 1));
            const float rect_w = clipped_x1 - clipped_x0;
            const float rect_h = clipped_y1 - clipped_y0;
            if (rect_w <= 1.0f || rect_h <= 1.0f) {
                continue;
            }

            boxes.push_back(YoloDetectionBox{
                class_names_[best_class],
                best_score,
                cv::Rect2f(clipped_x0, clipped_y0, rect_w, rect_h)
            });
        }

        return boxes;
    }

private:
    std::mutex mutex_;
    bool initialized_ = false;
    ncnn::Net net_;
    std::vector<std::string> class_names_;
};

YoloNcnnRuntime& GetRuntime() {
    static YoloNcnnRuntime runtime;
    return runtime;
}

}  // namespace

void SetNcnnAssetManager(AAssetManager* asset_manager) {
    g_asset_manager = asset_manager;
}

YoloDetectionResult DetectYoloObjects(const cv::Mat& image_bgr) {
    return GetRuntime().Detect(image_bgr);
}

}  // namespace bulltrack
