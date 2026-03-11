package com.zheng.bulltrack.camera

class CameraRoundFrameSource(
    private val cameraManager: CameraManager
) : RoundFrameSource {

    override suspend fun prepareRound() {
        // Preview and readiness are managed outside the use case.
    }

    override suspend fun captureFirstFrame(): CapturedFrame {
        return cameraManager.captureFirstFrameForRound()
    }

    override suspend fun captureNextFrame(): CapturedFrame {
        return cameraManager.captureNextFrameForRound()
    }

    override fun finishRound() {
        cameraManager.endRoundCapture()
    }

    override fun release() {
        cameraManager.release()
    }
}
