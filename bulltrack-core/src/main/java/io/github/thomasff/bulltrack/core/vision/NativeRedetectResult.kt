package io.github.thomasff.bulltrack.core.vision

data class NativeRedetectResult(
    val points: Array<NativePointResult>?,
    val debugImages: Array<NativeDebugImageResult>?,
    val yoloStatus: String?
)
