package com.zheng.bulltrack.vision

import com.zheng.bulltrack.domain.model.ThrowResult

data class FrameDetectionUpdate(
    val gateTriggered: Boolean,
    val gateReason: String,
    val newThrow: ThrowResult? = null,
    val errorMessage: String? = null
)

