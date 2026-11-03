package com.zheng.bulltrack.vision

data class NativeStartRoundResult(
    val debugImages: Array<NativeDebugImageResult>?,
    val errorMessage: String?,
    val startDartCount: Int,
    val leftRightHalfRatio: Float,
    val boardHeightShare: Float,
    val boardInSquare: Boolean,
    val modelSquareTop: Int
)
