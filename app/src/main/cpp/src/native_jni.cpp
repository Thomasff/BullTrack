#include <jni.h>
#include <opencv2/opencv.hpp>
#include <android/log.h>
#include <vector>
#include <cmath>

#include "ImagePreprocessor.h"
#include "ArucoDetector.h"
#include "HomographyWarper.h"
#include "BoardCircleDetector.h"
#include "DartDetector.h"
#include "DartScorer.h"

#define LOG_TAG "BullTrackNative"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

namespace {
    ArucoDetector* g_arucoDetector = nullptr;
    BoardCircleDetector* g_boardDetector = nullptr;
    DartDetector* g_dartDetector = nullptr;
    DartScorer* g_scorer = nullptr;
    CircleResult g_circleResult;
    bool g_initialized = false;
    bool g_arucoDetected = false;
    bool g_circleDetected = false;
}

static std::pair<double, double> normalizeCoordinates(int tip_x, int tip_y, int cx, int cy, int R) {
    double x_norm = static_cast<double>(tip_x - cx) / static_cast<double>(R);
    double y_norm = static_cast<double>(tip_y - cy) / static_cast<double>(R);
    return {x_norm, y_norm};
}

extern "C" {

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz
) {
    if (!g_initialized) {
        g_arucoDetector = new ArucoDetector();
        g_boardDetector = new BoardCircleDetector();
        g_dartDetector = new DartDetector(200, 1.5);
        g_scorer = new DartScorer();
        g_initialized = true;
        g_arucoDetected = false;
        g_circleDetected = false;
        LOGI("Native detector initialized");
    }
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeRelease(
    JNIEnv* env,
    jobject thiz
) {
    if (g_initialized) {
        delete g_arucoDetector;
        delete g_boardDetector;
        delete g_dartDetector;
        delete g_scorer;
        g_arucoDetector = nullptr;
        g_boardDetector = nullptr;
        g_dartDetector = nullptr;
        g_scorer = nullptr;
        g_initialized = false;
        g_arucoDetected = false;
        g_circleDetected = false;
        LOGI("Native detector released");
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
    
    cv::Mat beforeWarped = beforeBgr;
    cv::Mat afterWarped = afterBgr;
    
    try {
        if (!g_arucoDetected) {
            LOGD("Detecting ArUco markers...");
            g_arucoDetector->detectMarkers(beforeBgr);
            g_arucoDetected = true;
            LOGI("ArUco markers detected successfully");
        }
        
        if (g_arucoDetector->hasHomography()) {
            beforeWarped = g_arucoDetector->warp(beforeBgr);
            afterWarped = g_arucoDetector->warp(afterBgr);
            LOGD("Images warped successfully");
        }
        
        if (!g_circleDetected) {
            LOGD("Detecting board circle...");
            g_circleResult = g_boardDetector->detect(beforeWarped);
            g_circleDetected = true;
            LOGI("Board circle detected: center=(%d,%d), radius=%d", 
                 g_circleResult.cx, g_circleResult.cy, g_circleResult.radius);
        }
        
        LOGD("Detecting darts...");
        std::vector<cv::Point> tips = g_dartDetector->detect(beforeWarped, afterWarped);
        LOGI("Detected %zu darts", tips.size());
        
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
        
        std::vector<std::pair<double, double>> normalized_positions;
        for (const auto& tip : tips) {
            auto [x_norm, y_norm] = normalizeCoordinates(
                tip.x, tip.y, 
                g_circleResult.cx, g_circleResult.cy, g_circleResult.radius
            );
            normalized_positions.push_back({x_norm, y_norm});
        }
        
        std::vector<DartScorer::ScoreResult> scoreResults = g_scorer->scoreDarts(normalized_positions);
        
        for (size_t i = 0; i < tips.size(); i++) {
            const auto& scoreResult = scoreResults[i];
            
            jobject resultObj = env->NewObject(
                resultClass,
                constructor,
                static_cast<float>(tips[i].x),
                static_cast<float>(tips[i].y),
                static_cast<float>(scoreResult.x_norm),
                static_cast<float>(scoreResult.y_norm),
                scoreResult.sector,
                scoreResult.ringType,
                scoreResult.score
            );
            
            env->SetObjectArrayElement(results, i, resultObj);
            env->DeleteLocalRef(resultObj);
            
            LOGD("Dart %zu: pos=(%d,%d), norm=(%.3f,%.3f), score=%d, zone=%s",
                 i + 1, tips[i].x, tips[i].y, 
                 scoreResult.x_norm, scoreResult.y_norm,
                 scoreResult.score, scoreResult.zone.c_str());
        }
        
        return results;
        
    } catch (const std::exception& e) {
        LOGE("Detection error: %s", e.what());
        env->ReleaseByteArrayElements(beforeData, beforePtr, JNI_ABORT);
        env->ReleaseByteArrayElements(afterData, afterPtr, JNI_ABORT);
        return nullptr;
    }
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeReset(
    JNIEnv* env,
    jobject thiz
) {
    g_arucoDetected = false;
    g_circleDetected = false;
    LOGI("Native detector state reset");
}

JNIEXPORT void JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeSetParams(
    JNIEnv* env,
    jobject thiz,
    jdouble minArea,
    jdouble minAspectRatio
) {
    if (g_dartDetector) {
        g_dartDetector->setParams(minArea, minAspectRatio);
        LOGI("Detection params set: minArea=%.1f, minAspectRatio=%.2f", minArea, minAspectRatio);
    }
}

}
