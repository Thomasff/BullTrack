package com.zheng.bulltrack.vision

import com.zheng.bulltrack.domain.model.ThrowResult

data class RedetectDetectionUpdate(
    val throws: List<ThrowResult> = emptyList(),
    val debugImages: List<DebugImageArtifact> = emptyList()
)
