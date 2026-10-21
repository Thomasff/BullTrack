package com.zheng.bulltrack.vision

data class NativeFrameProcessResult(
    val gateTriggered: Boolean,
    val gateReason: String,
    // One entry per dart confirmed on this frame; null when that dart has no tip point.
    val detectedPoints: Array<NativePointResult?>?,
    val gateDebugImages: Array<NativeDebugImageResult>?,
    val preciseDebugImages: Array<NativeDebugImageResult>?
)
