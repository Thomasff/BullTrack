package com.zheng.bulltrack.vision

data class DetectionResult(
    val x: Float,
    val y: Float,
    val normalizedX: Float,
    val normalizedY: Float,
    val sector: Int,
    val ringType: Int,
    val score: Int
)
