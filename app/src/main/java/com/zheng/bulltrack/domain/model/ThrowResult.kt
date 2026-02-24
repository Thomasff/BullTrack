package com.zheng.bulltrack.domain.model

data class ThrowResult(
    val sector: Int,
    val ring: RingType,
    val score: Int,
    val position: DartPosition? = null
)
