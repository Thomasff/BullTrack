package com.zheng.bulltrack.vision

data class StartRoundDetectionUpdate(
    val debugImages: List<DebugImageArtifact> = emptyList(),
    val errorMessage: String? = null,
    // Darts already on the board in the first frame.
    val startDartCount: Int = 0,
    // Board's left half over its right half in the image; above 1 means the phone is left of
    // the board, 0 when unknown.
    val leftRightHalfRatio: Float = 0f
)
