#ifndef NATIVE_JNI_H
#define NATIVE_JNI_H

#include <jni.h>

#ifdef __cplusplus
extern "C" {
#endif

JNIEXPORT jobjectArray JNICALL
Java_com_zheng_bulltrack_vision_NativeDartDetector_nativeDetect(
    JNIEnv* env,
    jobject thiz,
    jbyteArray beforeData,
    jbyteArray afterData,
    jint width,
    jint height
);

JNIEXPORT void JNICALL
Java_com_xheng_bulltrack_vision_NativeDartDetector_nativeInit(
    JNIEnv* env,
    jobject thiz
);

#ifdef __cplusplus
}
#endif

#endif
