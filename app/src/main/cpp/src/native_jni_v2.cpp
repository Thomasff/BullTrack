#include <jni.h>
#include <opencv2/opencv.hpp>
#include <android/log.h>
#include <android/asset_manager_jni.h>

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

cv::Mat ByteArrayToBgrMat(JNIEnv* env, jbyteArray frame_data, jint width, jint height) {
    if (frame_data == nullptr) {
        throw std::runtime_error("图像数据为空");
    }
    if (width <= 0 || height <= 0) {
        throw std::runtime_error("图像尺寸无效");
    }

    const jsize expected_size = width * height * 4;
    const jsize actual_size = env->GetArrayLength(frame_data);
    if (actual_size != expected_size) {
        throw std::runtime_error("图像数据长度不匹配");
    }

    jbyte* data_ptr = env->GetByteArrayElements(frame_data, nullptr);
    if (data_ptr == nullptr) {
        throw std::runtime_error("无法读取图像数据");
    }

    cv::Mat rgba(height, width, CV_8UC4, data_ptr);
    cv::Mat bgr;
    cv::cvtColor(rgba, bgr, cv::COLOR_RGBA2BGR);
    env->ReleaseByteArrayElements(frame_data, data_ptr, JNI_ABORT);
    return bgr;
}

void ThrowJavaRuntimeException(JNIEnv* env, const std::string& message) {
    jclass exception_class = env->FindClass("java/lang/RuntimeException");
    if (exception_class != nullptr) {
        env->ThrowNew(exception_class, message.c_str());
    }
}

jobject CreateNativeDebugImageResult(JNIEnv* env, const bulltrack::DebugImageArtifact& artifact) {
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeDebugImageResult");
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
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeDebugImageResult");
    jobjectArray array = env->NewObjectArray(static_cast<jsize>(artifacts.size()), result_class, nullptr);
    for (size_t i = 0; i < artifacts.size(); ++i) {
        jobject obj = CreateNativeDebugImageResult(env, artifacts[i]);
        env->SetObjectArrayElement(array, static_cast<jsize>(i), obj);
        env->DeleteLocalRef(obj);
    }
    return array;
}

jobject CreateNativeStartRoundResult(JNIEnv* env, const bulltrack::AndroidStartRoundResult& result) {
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeStartRoundResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "([Lcom/zheng/bulltrack/vision/NativeDebugImageResult;Ljava/lang/String;IF)V");
    jobjectArray debug_images = CreateNativeDebugImageArray(env, result.debug_images);
    jstring error_message = result.error_message.empty() ? nullptr : env->NewStringUTF(result.error_message.c_str());
    jobject obj = env->NewObject(
        result_class,
        constructor,
        debug_images,
        error_message,
        static_cast<jint>(result.start_dart_count),
        static_cast<jfloat>(result.left_right_half_ratio));
    env->DeleteLocalRef(debug_images);
    if (error_message != nullptr) {
        env->DeleteLocalRef(error_message);
    }
    return obj;
}

jobject CreateNativeFrameProcessResult(JNIEnv* env, const bulltrack::AndroidFrameProcessResult& result) {
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeFrameProcessResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "(ZLjava/lang/String;[Lcom/zheng/bulltrack/vision/NativePointResult;[Z[Lcom/zheng/bulltrack/vision/NativeDebugImageResult;[Lcom/zheng/bulltrack/vision/NativeDebugImageResult;)V");
    jstring reason = env->NewStringUTF(result.gate_reason.c_str());
    // One element per confirmed dart; null when the dart has no tip point.
    jclass point_class = env->FindClass("com/zheng/bulltrack/vision/NativePointResult");
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
    jclass point_class = env->FindClass("com/zheng/bulltrack/vision/NativePointResult");
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
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeRedetectResult");
    jmethodID constructor = env->GetMethodID(
        result_class,
        "<init>",
        "([Lcom/zheng/bulltrack/vision/NativePointResult;[Lcom/zheng/bulltrack/vision/NativeDebugImageResult;Ljava/lang/String;)V");
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
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz,
    jobject asset_manager) {
    (void)thiz;
    AAssetManager* native_asset_manager = AAssetManager_fromJava(env, asset_manager);
    bulltrack::SetNcnnAssetManager(native_asset_manager);
    LOGI("Native v2 detector initialized");
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeRelease(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
    LOGI("Native v2 detector released");
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeWarmUp(
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
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeSetDebugImagesEnabled(
    JNIEnv* env,
    jobject thiz,
    jboolean enabled) {
    (void)env;
    (void)thiz;
    bulltrack::SetDebugImagesActive(enabled == JNI_TRUE);
}

JNIEXPORT jlong JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeCreateSession(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
    auto* session = new bulltrack::AndroidBullTrackSession();
    return reinterpret_cast<jlong>(session);
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeDestroySession(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)env;
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    delete session;
}

JNIEXPORT jobject JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeStartRound(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jbyteArray frame_data,
    jint width,
    jint height) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "native session 无效");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = ByteArrayToBgrMat(env, frame_data, width, height);
        bulltrack::AndroidStartRoundResult result = session->StartRound(frame_bgr);
        return CreateNativeStartRoundResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeStartRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeProcessFrame(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jbyteArray frame_data,
    jint width,
    jint height) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "native session 无效");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = ByteArrayToBgrMat(env, frame_data, width, height);
        bulltrack::AndroidFrameProcessResult result = session->ProcessFrame(frame_bgr);
        return CreateNativeFrameProcessResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeProcessFrame failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeRedetectRound(
    JNIEnv* env,
    jobject thiz,
    jlong session_id,
    jbyteArray frame_data,
    jint width,
    jint height) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "native session 无效");
        return nullptr;
    }
    try {
        cv::Mat frame_bgr = ByteArrayToBgrMat(env, frame_data, width, height);
        bulltrack::AndroidRedetectResult result = session->RedetectRound(frame_bgr);
        return CreateNativeRedetectResult(env, result);
    } catch (const std::exception& error) {
        LOGE("nativeRedetectRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeFindMissedDarts(
    JNIEnv* env,
    jobject thiz,
    jlong session_id) {
    (void)thiz;
    auto* session = reinterpret_cast<bulltrack::AndroidBullTrackSession*>(session_id);
    if (session == nullptr) {
        ThrowJavaRuntimeException(env, "native session 无效");
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

}  // extern "C"
