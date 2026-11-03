#include <jni.h>
#include <opencv2/opencv.hpp>
#include <android/log.h>
#include <android/asset_manager_jni.h>
#include <android/bitmap.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "AndroidBullTrackSession.h"
#include "YoloNcnnDetector.h"

#define LOG_TAG "BullTrackNativeV2"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

// Reads the ARGB_8888 bitmap's pixels in place (no Java copy) and turns the frame upright by
// rotating it clockwise by rotation_degrees, which saves the camera code a full-size rotated bitmap.
cv::Mat BitmapToBgrMat(JNIEnv* env, jobject bitmap, jint rotation_degrees) {
    if (bitmap == nullptr) {
        throw std::runtime_error("bitmap_null");
    }
    AndroidBitmapInfo info;
    if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS) {
        throw std::runtime_error("bitmap_info_failed");
    }
    if (info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || info.width == 0 || info.height == 0) {
        throw std::runtime_error("bitmap_format_invalid");
    }

    void* pixels = nullptr;
    if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS || pixels == nullptr) {
        throw std::runtime_error("bitmap_pixels_failed");
    }
    cv::Mat bgr;
    try {
        cv::Mat rgba(static_cast<int>(info.height), static_cast<int>(info.width), CV_8UC4, pixels, info.stride);
        cv::cvtColor(rgba, bgr, cv::COLOR_RGBA2BGR);
    } catch (...) {
        AndroidBitmap_unlockPixels(env, bitmap);
        throw;
    }
    AndroidBitmap_unlockPixels(env, bitmap);

    switch (rotation_degrees) {
        case 0:
            return bgr;
        case 90: {
            cv::Mat upright;
            cv::rotate(bgr, upright, cv::ROTATE_90_CLOCKWISE);
            return upright;
        }
        case 180: {
            cv::Mat upright;
            cv::rotate(bgr, upright, cv::ROTATE_180);
            return upright;
        }
        case 270: {
            cv::Mat upright;
            cv::rotate(bgr, upright, cv::ROTATE_90_COUNTERCLOCKWISE);
            return upright;
        }
        default:
            throw std::runtime_error("rotation_invalid");
    }
}

void ThrowJavaRuntimeException(JNIEnv* env, const std::string& message) {
    jclass exception_class = env->FindClass("java/lang/RuntimeException");
    if (exception_class != nullptr) {
        env->ThrowNew(exception_class, message.c_str());
    }
}

jobject CreateNativeDebugImageResult(JNIEnv* env, const bulltrack::DebugImageArtifact& artifact) {
    jclass result_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativeDebugImageResult");
    jmethodID constructor = env->GetMethodID(result_class, "<init>", "(Ljava/lang/String;[B)V");
    jstring file_name = env->NewStringUTF(artifact.file_name.c_str());
    jbyteArray jpeg_bytes = env->NewByteArray(static_cast<jsize>(artifact.jpeg_bytes.size()));
    if (jpeg_bytes != nullptr && !artifact.jpeg_bytes.empty()) {
        env->SetByteArrayRegion(
            jpeg_bytes,
            0,
            static_cast<jsize>(artifact.jpeg_bytes.size()),
            reinterpret_cast<const jbyte*>(artifact.jpeg_bytes.data()));
    }
    jobject obj = env->NewObject(result_class, constructor, file_name, jpeg_bytes);
    env->DeleteLocalRef(file_name);
    env->DeleteLocalRef(jpeg_bytes);
    return obj;
}

jobjectArray CreateNativeDebugImageArray(JNIEnv* env, const std::vector<bulltrack::DebugImageArtifact>& artifacts) {
    jclass result_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativeDebugImageResult");
    jobjectArray array = env->NewObjectArray(static_cast<jsize>(artifacts.size()), result_class, nullptr);
    for (size_t i = 0; i < artifacts.size(); ++i) {
        jobject obj = CreateNativeDebugImageResult(env, artifacts[i]);
        env->SetObjectArrayElement(array, static_cast<jsize>(i), obj);
        env->DeleteLocalRef(obj);
    }
    return array;
}

jobject CreateNativeStartRoundResult(JNIEnv* env, const bulltrack::AndroidStartRoundResult& result) {
    jclass result_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativeStartRoundResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "([Lio/github/thomasff/bulltrack/core/vision/NativeDebugImageResult;Ljava/lang/String;IFFZI)V");
    jobjectArray debug_images = CreateNativeDebugImageArray(env, result.debug_images);
    jstring error_message = result.error_message.empty() ? nullptr : env->NewStringUTF(result.error_message.c_str());
    jobject obj = env->NewObject(
        result_class,
        constructor,
        debug_images,
        error_message,
        static_cast<jint>(result.start_dart_count),
        static_cast<jfloat>(result.left_right_half_ratio),
        static_cast<jfloat>(result.board_height_share),
        static_cast<jboolean>(result.board_in_square),
        static_cast<jint>(result.model_square_top));
    env->DeleteLocalRef(debug_images);
    if (error_message != nullptr) {
        env->DeleteLocalRef(error_message);
    }
    return obj;
}

jobject CreateNativeFrameProcessResult(JNIEnv* env, const bulltrack::AndroidFrameProcessResult& result) {
    jclass result_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativeFrameProcessResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "(ZLjava/lang/String;[Lio/github/thomasff/bulltrack/core/vision/NativePointResult;[Z[Lio/github/thomasff/bulltrack/core/vision/NativeDebugImageResult;[Lio/github/thomasff/bulltrack/core/vision/NativeDebugImageResult;)V");
    jstring reason = env->NewStringUTF(result.gate_reason.c_str());
    // One element per confirmed dart; null when the dart has no tip point.
    jclass point_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativePointResult");
    jmethodID point_constructor = env->GetMethodID(point_class, "<init>", "(FF)V");
    jobjectArray detected_points = env->NewObjectArray(static_cast<jsize>(result.detected_points.size()), point_class, nullptr);
    for (size_t i = 0; i < result.detected_points.size(); ++i) {
        if (!result.detected_points[i].has_value()) {
            continue;
        }
        jobject point_obj = env->NewObject(point_class, point_constructor, result.detected_points[i]->x, result.detected_points[i]->y);
        env->SetObjectArrayElement(detected_points, static_cast<jsize>(i), point_obj);
        env->DeleteLocalRef(point_obj);
    }
    std::vector<jboolean> by_fallback_values;
    for (bool value : result.detected_by_fallback) {
        by_fallback_values.push_back(value ? JNI_TRUE : JNI_FALSE);
    }
    jbooleanArray detected_by_fallback = env->NewBooleanArray(static_cast<jsize>(by_fallback_values.size()));
    env->SetBooleanArrayRegion(
        detected_by_fallback,
        0,
        static_cast<jsize>(by_fallback_values.size()),
        by_fallback_values.data());
    jobjectArray gate_debug_images = CreateNativeDebugImageArray(env, result.gate_debug_images);
    jobjectArray precise_debug_images = CreateNativeDebugImageArray(env, result.precise_debug_images);
    jobject obj = env->NewObject(
        result_class,
        constructor,
        static_cast<jboolean>(result.gate_triggered),
        reason,
        detected_points,
        detected_by_fallback,
        gate_debug_images,
        precise_debug_images);
    env->DeleteLocalRef(reason);
    env->DeleteLocalRef(detected_points);
    env->DeleteLocalRef(detected_by_fallback);
    env->DeleteLocalRef(gate_debug_images);
    env->DeleteLocalRef(precise_debug_images);
    return obj;
}

jobjectArray CreateNativePointArray(JNIEnv* env, const std::vector<cv::Point2f>& points) {
    jclass point_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativePointResult");
    jmethodID constructor = env->GetMethodID(point_class, "<init>", "(FF)V");
    jobjectArray array = env->NewObjectArray(static_cast<jsize>(points.size()), point_class, nullptr);
    for (size_t i = 0; i < points.size(); ++i) {
        jobject point_obj = env->NewObject(
            point_class,
            constructor,
            points[i].x,
            points[i].y);
        env->SetObjectArrayElement(array, static_cast<jsize>(i), point_obj);
        env->DeleteLocalRef(point_obj);
    }
    return array;
}

jobject CreateNativeRedetectResult(JNIEnv* env, const bulltrack::AndroidRedetectResult& result) {
    jclass result_class = env->FindClass("io/github/thomasff/bulltrack/core/vision/NativeRedetectResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "([Lio/github/thomasff/bulltrack/core/vision/NativePointResult;[Lio/github/thomasff/bulltrack/core/vision/NativeDebugImageResult;Ljava/lang/String;)V");
    jobjectArray points = CreateNativePointArray(env, result.points);
    jobjectArray debug_images = CreateNativeDebugImageArray(env, result.debug_images);
    jstring yolo_status = env->NewStringUTF(result.yolo_status.c_str());
    jobject obj = env->NewObject(result_class, constructor, points, debug_images, yolo_status);
    env->DeleteLocalRef(points);
    env->DeleteLocalRef(debug_images);
    env->DeleteLocalRef(yolo_status);
    return obj;
}

}  // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz,
    jobject asset_manager) {
    (void)thiz;
    AAssetManager* native_asset_manager = AAssetManager_fromJava(env, asset_manager);
    bulltrack::SetNcnnAssetManager(native_asset_manager);
    LOGI("Native v2 detector initialized");
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeRelease(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
    LOGI("Native v2 detector released");
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeWarmUp(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
    try {
        bulltrack::WarmUpYoloObjects();
        LOGI("Native v2 detector warm-up completed");
    } catch (const std::exception& error) {
        LOGE("nativeWarmUp failed: %s", error.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeSetDebugImagesEnabled(
    JNIEnv* env,
    jobject thiz,
    jboolean enabled) {
    (void)env;
    (void)thiz;
    bulltrack::SetDebugImagesActive(enabled == JNI_TRUE);
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeSetYoloForceCpu(
    JNIEnv* env,
    jobject thiz,
    jboolean force_cpu) {
    (void)env;
    (void)thiz;
    bulltrack::SetYoloForceCpu(force_cpu == JNI_TRUE);
}

JNIEXPORT jlong JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeCreateSession(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
    auto* session = new bulltrack::AndroidBullTrackSession();
    return reinterpret_cast<jlong>(session);
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeDestroySession(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)env;
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    delete session;
}

JNIEXPORT jobject JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeStartRound(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jobject frame,
    jint rotation_degrees,
    jboolean soft_board) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "session_invalid");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = BitmapToBgrMat(env, frame, rotation_degrees);
        bulltrack::AndroidStartRoundResult result = session->StartRound(frame_bgr, soft_board == JNI_TRUE);
        return CreateNativeStartRoundResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeStartRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeProcessFrame(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jobject frame,
    jint rotation_degrees) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "session_invalid");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = BitmapToBgrMat(env, frame, rotation_degrees);
        bulltrack::AndroidFrameProcessResult result = session->ProcessFrame(frame_bgr);
        return CreateNativeFrameProcessResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeProcessFrame failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeRedetectRound(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jobject frame,
    jint rotation_degrees) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "session_invalid");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = BitmapToBgrMat(env, frame, rotation_degrees);
        bulltrack::AndroidRedetectResult result = session->RedetectRound(frame_bgr);
        return CreateNativeRedetectResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeRedetectRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeFindMissedDarts(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "session_invalid");
        return nullptr;
    }
    try {
        return CreateNativeRedetectResult(env, session->FindMissedDartsAtEnd());
    } catch (const std::exception& error) {
        LOGE("nativeFindMissedDarts failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jstring JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeDescribeFrameStageTimes(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        return env->NewStringUTF("no session");
    }
    return env->NewStringUTF(session->DescribeFrameStageTimes().c_str());
}

// Copies the round's photo material out of the session, so it outlives it; release it with
// nativeReleasePhotoSource.
JNIEXPORT jlong JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeTakePhotoSource(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "session_invalid");
        return 0;
    }
    try {
        return reinterpret_cast<jlong>(new bulltrack::RoundPhotoSource(session->TakePhotoSource()));
    } catch (const std::exception& error) {
        LOGE("nativeTakePhotoSource failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return 0;
    }
}

JNIEXPORT void JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeReleasePhotoSource(
    JNIEnv* env,
    jobject thiz,
    jlong source_id) {
    (void)env;
    (void)thiz;
    delete reinterpret_cast<bulltrack::RoundPhotoSource*>(source_id);
}

// Returns two JPEGs: the round board photo and the close-up (empty when there is none).
JNIEXPORT jobjectArray JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeRenderPhotos(
    JNIEnv* env,
    jobject thiz,
    jlong source_id) {
    (void)thiz;
    auto* source = reinterpret_cast<bulltrack::RoundPhotoSource*>(source_id);
    if (source == nullptr) {
        ThrowJavaRuntimeException(env, "no_round_photo");
        return nullptr;
    }
    try {
        const bulltrack::RoundPhotoJpegs photos = bulltrack::RenderRoundPhotos(*source);
        jclass byte_array_class = env->FindClass("[B");
        jobjectArray parts = env->NewObjectArray(2, byte_array_class, nullptr);
        const std::vector<std::uint8_t>* jpegs[] = {&photos.full, &photos.close};
        for (jsize i = 0; i < 2; ++i) {
            jbyteArray bytes = env->NewByteArray(static_cast<jsize>(jpegs[i]->size()));
            env->SetByteArrayRegion(
                bytes,
                0,
                static_cast<jsize>(jpegs[i]->size()),
                reinterpret_cast<const jbyte*>(jpegs[i]->data()));
            env->SetObjectArrayElement(parts, i, bytes);
            env->DeleteLocalRef(bytes);
        }
        env->DeleteLocalRef(byte_array_class);
        return parts;
    } catch (const std::exception& error) {
        LOGE("nativeRenderPhotos failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

// Returns frame width and height, band top and height, then 1 and the board box (x, y, width,
// height) when a board was found, or 0 and four zeros; then the dart count and each dart's tip
// (x, y).
JNIEXPORT jintArray JNICALL
Java_io_github_thomasff_bulltrack_core_vision_NativeDartDetector_nativeDetectPrepBoard(
    JNIEnv* env,
    jobject thiz,
    jobject frame,
    jint rotation_degrees) {
    (void)thiz;
    try {
        const cv::Mat frame_bgr = BitmapToBgrMat(env, frame, rotation_degrees);
        const bulltrack::PrepBoardGuide guide = bulltrack::DetectPrepBoard(frame_bgr);
        const cv::Rect box = guide.board_box.value_or(cv::Rect());
        std::vector<jint> values{
            frame_bgr.cols,
            frame_bgr.rows,
            guide.band.y,
            guide.band.height,
            guide.board_box.has_value() ? 1 : 0,
            box.x,
            box.y,
            box.width,
            box.height,
            static_cast<jint>(guide.dart_tips.size()),
        };
        for (const cv::Point& tip : guide.dart_tips) {
            values.push_back(tip.x);
            values.push_back(tip.y);
        }
        const jsize size = static_cast<jsize>(values.size());
        jintArray array = env->NewIntArray(size);
        env->SetIntArrayRegion(array, 0, size, values.data());
        return array;
    } catch (const std::exception& error) {
        LOGE("nativeDetectPrepBoard failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

}  // extern "C"
