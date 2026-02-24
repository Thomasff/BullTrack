#include "native_jni.h"
#include "dart_tip_detector.h"
#include "board_detector.h"
#include "aruco_detector.h"
#include "scoring.h"
#include "image_processor.h"

#include <opencv2/opencv.hpp>
#include <android/log.h>
#include <vector>

#define LOG_TAG "BullTrackNative"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {
    bulltrack::DartTipDetector g_tipDetector;
    bulltrack::BoardDetector g_boardDetector;
    bulltrack::ArucoDetector g_arucoDetector;
    bool g_initialized = false;
}

extern "C" {

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz
) {
    if (!g_initialized) {
        g_tipDetector.setMinArea(200);
        g_tipDetector.setMinAspectRatio(3.0f);
        g_initialized = true;
        LOGD("Native detector initialized");
    }
}

JNIEXPORT jobjectArray JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeDetect(
    JNIEnv* env,
    jobject thiz,
    jbyteArray beforeData,
    jbyteArray afterData,
    jint width,
    jint height
) {
    if (!g_initialized) {
        LOGE("Detector not initialized");
        return nullptr;
    }
    
    if (beforeData == nullptr || afterData == nullptr) {
        LOGE("Null image data");
        return nullptr;
    }
    
    jbyte* beforePtr = env->GetByteArrayElements(beforeData, nullptr);
    jbyte* afterPtr = env->GetByteArrayElements(afterData, nullptr);
    
    if (beforePtr == nullptr || afterPtr == nullptr) {
        LOGE("Failed to get byte array elements");
        if (beforePtr) env->ReleaseByteArrayElements(beforeData, beforePtr, JNI_ABORT);
        if (afterPtr) env->ReleaseByteArrayElements(afterData, afterPtr, JNI_ABORT);
        return nullptr;
    }
    
    cv::Mat beforeMat(height, width, CV_8UC4, beforePtr);
    cv::Mat afterMat(height, width, CV_8UC4, afterPtr);
    
    cv::Mat beforeBgr, afterBgr;
    cv::cvtColor(beforeMat, beforeBgr, cv::COLOR_RGBA2BGR);
    cv::cvtColor(afterMat, afterBgr, cv::COLOR_RGBA2BGR);
    
    auto arucoResult = g_arucoDetector.detect(beforeBgr);
    
    cv::Mat beforeWarped = beforeBgr;
    cv::Mat afterWarped = afterBgr;
    
    if (arucoResult.success) {
        beforeWarped = g_arucoDetector.warpToBoard(beforeBgr, arucoResult.corners);
        afterWarped = g_arucoDetector.warpToBoard(afterBgr, arucoResult.corners);
    }
    
    auto boardInfo = g_boardDetector.detect(beforeWarped);
    
    if (!boardInfo.detected) {
        LOGE("Failed to detect board");
        env->ReleaseByteArrayElements(beforeData, beforePtr, JNI_ABORT);
        env->ReleaseByteArrayElements(afterData, afterPtr, JNI_ABORT);
        return nullptr;
    }
    
    auto tips = g_tipDetector.detect(
        beforeWarped, afterWarped,
        boardInfo.centerX, boardInfo.centerY, boardInfo.radius,
        3
    );
    
    env->ReleaseByteArrayElements(beforeData, beforePtr, JNI_ABORT);
    env->ReleaseByteArrayElements(afterData, afterPtr, JNI_ABORT);
    
    if (tips.empty()) {
        LOGD("No darts detected");
        return nullptr;
    }
    
    jclass resultClass = env->FindClass("com/zheng/bulltrack/vision/DetectionResult");
    if (resultClass == nullptr) {
        LOGE("Failed to find DetectionResult class");
        return nullptr;
    }
    
    jmethodID constructor = env->GetMethodID(resultClass, "<init>", "(FFFFIII)V");
    if (constructor == nullptr) {
        LOGE("Failed to find constructor");
        return nullptr;
    }
    
    jobjectArray results = env->NewObjectArray(tips.size(), resultClass, nullptr);
    
    for (size_t i = 0; i < tips.size(); i++) {
        const auto& tip = tips[i];
        auto scoreResult = bulltrack::Scoring::calculateScore(tip.normalizedX, tip.normalizedY);
        
        jobject resultObj = env->NewObject(
            resultClass,
            constructor,
            tip.x,
            tip.y,
            tip.normalizedX,
            tip.normalizedY,
            scoreResult.sector,
            scoreResult.ringType,
            scoreResult.score
        );
        
        env->SetObjectArrayElement(results, i, resultObj);
        env->DeleteLocalRef(resultObj);
    }
    
    return results;
}

}
