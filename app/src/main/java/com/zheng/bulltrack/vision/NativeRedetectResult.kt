package com.zheng.bulltrack.vision

data class NativeRedetectResult(
    val points: Array<NativePointResult>?,
    val debugImages: Array<NativeDebugImageResult>?,
    val yoloStatus: String?
)
