package io.github.thomasff.bulltrack.core.vision

import io.github.thomasff.bulltrack.core.domain.model.ThrowResult

data class RedetectDetectionUpdate(
    val throws: List<ThrowResult> = emptyList(),
    val debugImages: List<DebugImageArtifact> = emptyList(),
    val yoloStatus: String? = null
)
