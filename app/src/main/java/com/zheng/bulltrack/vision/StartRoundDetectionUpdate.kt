package com.zheng.bulltrack.vision

data class StartRoundDetectionUpdate(
    val debugImages: List<DebugImageArtifact> = emptyList(),
    val errorMessage: String? = null
)
