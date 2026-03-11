#include <jni.h>
#include <opencv2/opencv.hpp>
#include <android/log.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "AndroidBullTrackSession.h"

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

jobject CreateNativeFrameProcessResult(JNIEnv* env, const bulltrack::AndroidFrameProcessResult& result) {
    jclass result_class = env->FindClass("com/zheng/bulltrack/vision/NativeFrameProcessResult");
    jmethodID constructor = env->GetMethodID(result_class, "<init>", "(ZLjava/lang/String;ZFF)V");
    jstring reason = env->NewStringUTF(result.gate_reason.c_str());
    const float normalized_x = result.detected_point_norm.has_value() ? result.detected_point_norm->x : 0.0f;
    const float normalized_y = result.detected_point_norm.has_value() ? result.detected_point_norm->y : 0.0f;
    jobject obj = env->NewObject(
        result_class,
        constructor,
        static_cast<jboolean>(result.gate_triggered),
        reason,
        static_cast<jboolean>(result.has_detection),
        normalized_x,
        normalized_y);
    env->DeleteLocalRef(reason);
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

}  // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz) {
    (void)env;
    (void)thiz;
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

JNIEXPORT void JNICALL
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
        return;
    }
    try {
        cv::Mat frame_bgr = ByteArrayToBgrMat(env, frame_data, width, height);
        session->StartRound(frame_bgr);
    } catch (const std::exception& error) {
        LOGE("nativeStartRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
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

JNIEXPORT jobjectArray JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeRedetectRound(
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
        std::vector<cv::Point2f> points = session->RedetectRound();
        return CreateNativePointArray(env, points);
    } catch (const std::exception& error) {
        LOGE("nativeRedetectRound failed: %s", error.what());
        ThrowJavaRuntimeException(env, error.what());
        return nullptr;
    }
}

}  // extern "C"
