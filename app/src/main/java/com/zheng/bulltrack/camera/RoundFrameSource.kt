package com.zheng.bulltrack.camera

interface RoundFrameSource {
    suspend fun prepareRound()

    suspend fun captureFirstFrame(): CapturedFrame

    suspend fun captureNextFrame(): CapturedFrame?

    suspend fun captureRedetectFrame(): CapturedFrame

    fun finishRound()

    fun release()
}
