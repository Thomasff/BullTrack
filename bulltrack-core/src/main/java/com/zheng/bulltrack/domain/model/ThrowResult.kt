package com.zheng.bulltrack.domain.model

data class ThrowResult(
    val sector: Int,
    val ring: RingType,
    val score: Int,
    val position: DartPosition? = null,
    // Detection is unsure about this dart (fallback path, no tip found, tip on a line); the
    // player should glance at it.
    val needsCheck: Boolean = false
)
