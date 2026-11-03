package io.github.thomasff.bulltrack.core.vision

data class NativeFrameProcessResult(
    val gateTriggered: Boolean,
    val gateReason: String,
    // One entry per dart confirmed on this frame; null when that dart has no tip point.
    val detectedPoints: Array<NativePointResult?>?,
    // Per detected point: found by a fallback path, so the player should check it.
    val detectedByFallback: BooleanArray?,
    val gateDebugImages: Array<NativeDebugImageResult>?,
    val preciseDebugImages: Array<NativeDebugImageResult>?
)
