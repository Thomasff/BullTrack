package com.zheng.bulltrack.vision

import com.zheng.bulltrack.domain.model.ThrowResult

data class FrameDetectionUpdate(
    val gateTriggered: Boolean,
    val gateReason: String,
    // Darts confirmed on this frame (usually one); null when a dart has no tip point (a miss).
    val newThrows: List<ThrowResult?> = emptyList(),
    val gateDebugImages: List<DebugImageArtifact> = emptyList(),
    val preciseDebugImages: List<DebugImageArtifact> = emptyList(),
    val errorMessage: String? = null
)
