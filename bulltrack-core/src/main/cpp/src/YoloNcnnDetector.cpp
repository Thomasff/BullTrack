#include "YoloNcnnDetector.h"

#include "DebugImageConfig.h"

#include <android/log.h>
#include <ncnn/gpu.h>
#include <ncnn/net.h>

#include <algorithm>
#include <atomic>
#include <chrono>
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

// Developer switch: run YOLO on the CPU even when the GPU works, to compare speed and power
// (2026-10-31: on a Snapdragon 8 Gen 3 the CPU took 66-103 ms a frame, the GPU 169-180 ms).
std::atomic<bool> g_force_cpu{false};

constexpr const char* kModelParamAssetPath = "ncnn/model.ncnn.param";
constexpr const char* kModelBinAssetPath = "ncnn/model.ncnn.bin";
constexpr const char* kClassesAssetPath = "ncnn/classes.txt";
constexpr const char* kInputBlobName = "in0";
constexpr const char* kOutputBlobName = "out0";
constexpr int kInputSize = 640;
// Pose model: after the class scores each candidate carries
// one keypoint, the dart tip (x, y, score).
constexpr int kTipValueCount = 3;
constexpr float kScoreThreshold = 0.25f;
// Matches the bundled model: on the 44 App test frames (2026-10-29) real darts scored 0.90 and
// up and no other box reached 0.10 (the previous model: darts 0.81 and up, false boxes on an
// empty board 0.10-0.18).
constexpr float kDartScoreThreshold = 0.25f;
// Dart candidates down to this score are kept apart (low_score_dart_boxes).
constexpr float kLowDartScoreThreshold = 0.10f;

float CountedScoreThreshold(const std::string& label) {
    return label == "dart" ? kDartScoreThreshold : kScoreThreshold;
}
constexpr float kNmsThreshold = 0.45f;
// Darts are thin and often land side by side, so their boxes overlap a lot without being the
// same dart; a low threshold merged neighbours into one box and the second dart was missed.
constexpr float kDartNmsThreshold = 0.7f;
constexpr int kGpuDeviceIndex = 0;

AAssetManager* g_asset_manager = nullptr;

long long ElapsedMs(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start).count();
}

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

struct ModelInput {
    cv::Mat image;
    // Model pixel p maps back to image pixel p / scale + square.tl().
    float scale = 1.0f;
    cv::Rect square;
};

// The square scaled to the model input with INTER_AREA, as the training crops were made; a
// linear resize leaves moire on a soft board's holes.
ModelInput SquareResize(const cv::Mat& image_bgr, const cv::Rect& requested_square, int target_size) {
    if (image_bgr.empty()) {
        throw std::runtime_error("YOLO 输入图为空");
    }
    const cv::Rect square = requested_square.empty() ? ModelInputSquare(image_bgr.size()) : requested_square;
    if ((square & cv::Rect(0, 0, image_bgr.cols, image_bgr.rows)) != square) {
        throw std::runtime_error("YOLO 输入正方形超出画面");
    }
    cv::Mat resized;
    cv::resize(
        image_bgr(square),
        resized,
        cv::Size(target_size, target_size),
        0.0,
        0.0,
        square.width > target_size ? cv::INTER_AREA : cv::INTER_LINEAR);
    return {resized, static_cast<float>(target_size) / static_cast<float>(square.width), square};
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
            const float threshold = candidate.label == "dart" ? kDartNmsThreshold : kNmsThreshold;
            if (IoU(candidate.rect, selected.rect) > threshold) {
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

cv::Mat DrawOverlay(
    const cv::Mat& image_bgr,
    const std::vector<YoloDetectionBox>& boxes,
    const cv::Rect& square,
    const std::string& backend,
    const std::string& status_detail) {
    cv::Mat overlay = image_bgr.clone();
    cv::rectangle(overlay, square, cv::Scalar(255, 255, 255), 1);
    for (const YoloDetectionBox& box : boxes) {
        if (box.label == "dart") {
            cv::circle(overlay, box.tip, 6, cv::Scalar(255, 0, 255), -1);
        }
        const bool below_threshold = box.score < CountedScoreThreshold(box.label);
        const cv::Scalar color = box.label == "board"
            ? cv::Scalar(0, 255, 255)
            : (below_threshold ? cv::Scalar(0, 140, 255) : cv::Scalar(0, 255, 0));
        const cv::Rect rect(
            static_cast<int>(std::round(box.rect.x)),
            static_cast<int>(std::round(box.rect.y)),
            static_cast<int>(std::round(box.rect.width)),
            static_cast<int>(std::round(box.rect.height)));
        cv::rectangle(overlay, rect, color, below_threshold ? 1 : 3);
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

    const std::string backend_text = "NCNN " + backend;
    int baseline = 0;
    const double font_scale = 0.9;
    const int thickness = 2;
    const cv::Size backend_size = cv::getTextSize(
        backend_text,
        cv::FONT_HERSHEY_SIMPLEX,
        font_scale,
        thickness,
        &baseline);
    const bool used_gpu = backend == "GPU";
    const cv::Scalar backend_color = used_gpu ? cv::Scalar(0, 220, 0) : cv::Scalar(0, 170, 255);
    const int margin = 12;
    const int line_height = backend_size.height + baseline + 8;
    int box_height = line_height + margin;
    if (!status_detail.empty()) {
        box_height += line_height;
    }
    cv::rectangle(
        overlay,
        cv::Rect(8, 8, std::max(220, backend_size.width + margin * 2), box_height),
        cv::Scalar(0, 0, 0),
        cv::FILLED);
    cv::putText(
        overlay,
        backend_text,
        cv::Point(16, 16 + backend_size.height),
        cv::FONT_HERSHEY_SIMPLEX,
        font_scale,
        backend_color,
        thickness);
    if (!status_detail.empty()) {
        cv::putText(
            overlay,
            status_detail,
            cv::Point(16, 16 + backend_size.height + line_height),
            cv::FONT_HERSHEY_SIMPLEX,
            0.55,
            cv::Scalar(255, 255, 255),
            1);
    }
    return overlay;
}

class YoloNcnnRuntime {
public:
    YoloDetectionResult Detect(const cv::Mat& image_bgr, const cv::Rect& square) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (g_asset_manager == nullptr) {
            throw std::runtime_error("NCNN AssetManager 未设置，无法加载模型");
        }

        std::string gpu_failure_detail;
        if (g_force_cpu.load()) {
            // Chosen in the settings, not a failure: no detail on the overlay.
        } else if (TryPrepareGpu()) {
            try {
                return DetectWithBackend(image_bgr, square, gpu_runtime_, "GPU", "");
            } catch (const std::exception& error) {
                gpu_failure_detail = std::string("GPU fallback: ") + error.what();
                // A model that failed to load on the GPU would be reloaded (~20 MB) on every
                // frame before falling back, so stay on the CPU from now on. A one-off
                // inference error after a successful load keeps the GPU.
                if (!gpu_runtime_.initialized) {
                    gpu_available_ = false;
                    gpu_failure_reason_ = error.what();
                }
            }
        } else {
            gpu_failure_detail = gpu_failure_reason_.empty()
                ? "GPU unavailable"
                : "GPU fallback: " + gpu_failure_reason_;
        }

        try {
            return DetectWithBackend(image_bgr, square, cpu_runtime_, "CPU", gpu_failure_detail);
        } catch (const std::exception& cpu_error) {
            if (!gpu_failure_detail.empty()) {
                throw std::runtime_error(gpu_failure_detail + "; CPU failed: " + cpu_error.what());
            }
            throw;
        }
    }

private:
    struct BackendRuntime {
        bool initialized = false;
        bool use_vulkan = false;
        ncnn::Net net;
    };

    bool TryPrepareGpu() {
        if (gpu_checked_) {
            return gpu_available_;
        }
        gpu_checked_ = true;
        const auto start = std::chrono::steady_clock::now();
        const int create_result = ncnn::create_gpu_instance();
        __android_log_print(ANDROID_LOG_INFO, "BullTrackYolo", "GPU instance took %lld ms", ElapsedMs(start));
        if (create_result != 0) {
            gpu_failure_reason_ = "create_gpu_instance failed";
            gpu_available_ = false;
            return false;
        }
        if (ncnn::get_gpu_count() <= 0) {
            gpu_failure_reason_ = "get_gpu_count == 0";
            gpu_available_ = false;
            return false;
        }
        gpu_available_ = true;
        return true;
    }

    void EnsureInitialized(BackendRuntime& runtime) {
        if (runtime.initialized) {
            return;
        }
        if (class_names_.empty()) {
            class_names_ = ReadAssetLines(g_asset_manager, kClassesAssetPath);
        }
        runtime.net.opt.use_vulkan_compute = runtime.use_vulkan;
        runtime.net.opt.use_fp16_packed = true;
        runtime.net.opt.use_fp16_storage = true;
        runtime.net.opt.use_fp16_arithmetic = true;
        if (runtime.use_vulkan) {
            runtime.net.set_vulkan_device(kGpuDeviceIndex);
        }

        auto start = std::chrono::steady_clock::now();
        if (runtime.net.load_param(g_asset_manager, kModelParamAssetPath) != 0) {
            throw std::runtime_error("加载 YOLO param 失败: ncnn/model.ncnn.param");
        }
        const long long param_ms = ElapsedMs(start);
        start = std::chrono::steady_clock::now();
        if (runtime.net.load_model(g_asset_manager, kModelBinAssetPath) != 0) {
            throw std::runtime_error("加载 YOLO bin 失败: ncnn/model.ncnn.bin");
        }
        __android_log_print(
            ANDROID_LOG_INFO,
            "BullTrackYolo",
            "Model load (%s): param %lld ms, model %lld ms",
            runtime.use_vulkan ? "GPU" : "CPU",
            param_ms,
            ElapsedMs(start));
        runtime.initialized = true;
    }

    YoloDetectionResult DetectWithBackend(
        const cv::Mat& image_bgr,
        const cv::Rect& square,
        BackendRuntime& runtime,
        const std::string& backend,
        const std::string& status_detail) {
        EnsureInitialized(runtime);

        ModelInput model_input = SquareResize(image_bgr, square, kInputSize);
        // The model was trained on RGB images; fed BGR it scored the same darts but put tips
        // 1.5 px further off (median, 44 App test frames) with tip scores all over the place.
        ncnn::Mat input = ncnn::Mat::from_pixels(
            model_input.image.data,
            ncnn::Mat::PIXEL_BGR2RGB,
            model_input.image.cols,
            model_input.image.rows);
        const float norm_vals[3] = {1.0f / 255.0f, 1.0f / 255.0f, 1.0f / 255.0f};
        input.substract_mean_normalize(nullptr, norm_vals);

        ncnn::Extractor extractor = runtime.net.create_extractor();
        extractor.set_light_mode(true);
        if (extractor.input(kInputBlobName, input) != 0) {
            throw std::runtime_error("YOLO 输入失败: in0");
        }

        ncnn::Mat output;
        if (extractor.extract(kOutputBlobName, output) != 0) {
            throw std::runtime_error("YOLO 输出提取失败: out0");
        }

        std::vector<YoloDetectionBox> boxes = DecodeOutput(output, model_input, image_bgr.size());
        // Sorted by score, so a low candidate never suppresses a counted box.
        std::vector<YoloDetectionBox> kept_boxes = ApplyNms(std::move(boxes));
        // The overlay is only a debug image; skip the full-frame copy and drawing otherwise.
        cv::Mat overlay = DebugImagesActive()
            ? DrawOverlay(image_bgr, kept_boxes, model_input.square, backend, status_detail)
            : cv::Mat();
        YoloDetectionResult result{{}, overlay, backend, status_detail, {}};
        for (YoloDetectionBox& box : kept_boxes) {
            (box.score >= CountedScoreThreshold(box.label) ? result.boxes : result.low_score_dart_boxes).push_back(std::move(box));
        }
        return result;
    }

    std::vector<YoloDetectionBox> DecodeOutput(
        const ncnn::Mat& output,
        const ModelInput& model_input,
        const cv::Size& original_size) const {
        const int class_count = static_cast<int>(class_names_.size());
        const int value_count = 4 + class_count + kTipValueCount;
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
        const float offset_x = static_cast<float>(model_input.square.x);
        const float offset_y = static_cast<float>(model_input.square.y);

        for (int i = 0; i < rows; ++i) {
            int best_class = -1;
            float best_score = 0.0f;
            for (int c = 0; c < class_count; ++c) {
                const float score = get_value(i, 4 + c);
                if (score > best_score) {
                    best_score = score;
                    best_class = c;
                }
            }
            if (best_class < 0 ||
                best_score < (class_names_[best_class] == "dart" ? kLowDartScoreThreshold : kScoreThreshold)) {
                continue;
            }

            const float cx = get_value(i, 0);
            const float cy = get_value(i, 1);
            const float w = get_value(i, 2);
            const float h = get_value(i, 3);
            const float x0 = (cx - w * 0.5f) / model_input.scale + offset_x;
            const float y0 = (cy - h * 0.5f) / model_input.scale + offset_y;
            const float x1 = (cx + w * 0.5f) / model_input.scale + offset_x;
            const float y1 = (cy + h * 0.5f) / model_input.scale + offset_y;
            const cv::Point2f tip(
                get_value(i, 4 + class_count) / model_input.scale + offset_x,
                get_value(i, 4 + class_count + 1) / model_input.scale + offset_y);
            const float tip_score = get_value(i, 4 + class_count + 2);

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
                cv::Rect2f(clipped_x0, clipped_y0, rect_w, rect_h),
                tip,
                tip_score
            });
        }

        return boxes;
    }

private:
    std::mutex mutex_;
    bool gpu_checked_ = false;
    bool gpu_available_ = false;
    std::string gpu_failure_reason_;
    BackendRuntime gpu_runtime_{false, true, {}};
    BackendRuntime cpu_runtime_{false, false, {}};
    std::vector<std::string> class_names_;
};

YoloNcnnRuntime& GetRuntime() {
    static YoloNcnnRuntime runtime;
    return runtime;
}

}  // namespace

cv::Rect ModelInputSquare(const cv::Size& image_size) {
    const int side = std::min(image_size.width, image_size.height);
    return cv::Rect((image_size.width - side) / 2, (image_size.height - side) / 2, side, side);
}

cv::Rect BoardCentredSquare(const cv::Size& image_size, const cv::Rect& board_box) {
    cv::Rect square = ModelInputSquare(image_size);
    if (image_size.height > image_size.width) {
        const int top = board_box.y + board_box.height / 2 - square.height / 2;
        square.y = std::clamp(top, 0, image_size.height - square.height);
    } else {
        const int left = board_box.x + board_box.width / 2 - square.width / 2;
        square.x = std::clamp(left, 0, image_size.width - square.width);
    }
    return square;
}

void SetNcnnAssetManager(AAssetManager* asset_manager) {
    g_asset_manager = asset_manager;
}

void SetYoloForceCpu(bool force_cpu) {
    g_force_cpu.store(force_cpu);
}

void WarmUpYoloObjects() {
    cv::Mat warmup_image(kInputSize, kInputSize, CV_8UC3, cv::Scalar(114, 114, 114));
    GetRuntime().Detect(warmup_image, cv::Rect());
}

YoloDetectionResult DetectYoloObjects(const cv::Mat& image_bgr, const cv::Rect& square) {
    return GetRuntime().Detect(image_bgr, square);
}

}  // namespace bulltrack
