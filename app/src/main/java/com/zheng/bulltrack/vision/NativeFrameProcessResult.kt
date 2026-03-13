package com.zheng.bulltrack.vision

data class NativeFrameProcessResult(
    val gateTriggered: Boolean,
    val gateReason: String,
    val hasDetection: Boolean,
    val normalizedX: Float,
    val normalizedY: Float,
    val gateDebugImages: Array<NativeDebugImageResult>?,
    val preciseDebugImages: Array<NativeDebugImageResult>?
)
