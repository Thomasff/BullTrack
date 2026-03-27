package com.zheng.bulltrack.vision

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Color
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.domain.scoring.VirtualBoardScorer

class NativeDartDetector(
    private val assetManager: AssetManager? = null
) : DartDetector {

    init {
        System.loadLibrary("bulltrack")
    }

    private external fun nativeInit(assetManager: AssetManager?)
    private external fun nativeRelease()
    private external fun nativeWarmUp()
    private external fun nativeCreateSession(): Long
    private external fun nativeDestroySession(sessionId: Long)
    private external fun nativeStartRound(
        sessionId: Long,
        frameData: ByteArray,
        width: Int,
        height: Int
    ): NativeStartRoundResult
    private external fun nativeProcessFrame(
        sessionId: Long,
        frameData: ByteArray,
        width: Int,
        height: Int
    ): NativeFrameProcessResult
    private external fun nativeRedetectRound(
        sessionId: Long,
        frameData: ByteArray,
        width: Int,
        height: Int
    ): NativeRedetectResult

    override fun init() {
        nativeInit(assetManager)
    }

    override fun warmUp() {
        nativeWarmUp()
    }

    fun release() {
        nativeRelease()
    }

    override fun createSession(): Long = nativeCreateSession()

    override fun destroySession(sessionId: Long) {
        if (sessionId != 0L) {
            nativeDestroySession(sessionId)
        }
    }

    override fun startRound(sessionId: Long, firstFrame: Bitmap): StartRoundDetectionUpdate {
        val frameData = bitmapToByteArray(firstFrame)
        val result = nativeStartRound(sessionId, frameData, firstFrame.width, firstFrame.height)
        return StartRoundDetectionUpdate(
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact)
        )
    }

    override fun processFrame(sessionId: Long, frame: Bitmap): FrameDetectionUpdate {
        val result = nativeProcessFrame(
            sessionId = sessionId,
            frameData = bitmapToByteArray(frame),
            width = frame.width,
            height = frame.height
        )
        val newThrow = if (result.hasDetection) {
            toThrowResult(result.normalizedX, result.normalizedY)
        } else {
            null
        }
        return FrameDetectionUpdate(
            gateTriggered = result.gateTriggered,
            gateReason = result.gateReason,
            newThrow = newThrow,
            gateDebugImages = result.gateDebugImages.orEmpty().map(::toDebugImageArtifact),
            preciseDebugImages = result.preciseDebugImages.orEmpty().map(::toDebugImageArtifact)
        )
    }

    override fun redetect(sessionId: Long, frame: Bitmap): RedetectDetectionUpdate {
        val result = nativeRedetectRound(
            sessionId = sessionId,
            frameData = bitmapToByteArray(frame),
            width = frame.width,
            height = frame.height
        )
        return RedetectDetectionUpdate(
            throws = result.points.orEmpty().map { point ->
                toThrowResult(point.normalizedX, point.normalizedY)
            },
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact),
            yoloStatus = result.yoloStatus
        )
    }

    private fun bitmapToByteArray(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        val byteArray = ByteArray(width * height * 4)
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val offset = i * 4
            byteArray[offset] = Color.red(pixel).toByte()
            byteArray[offset + 1] = Color.green(pixel).toByte()
            byteArray[offset + 2] = Color.blue(pixel).toByte()
            byteArray[offset + 3] = Color.alpha(pixel).toByte()
        }
        return byteArray
    }

    private fun toDebugImageArtifact(result: NativeDebugImageResult): DebugImageArtifact {
        return DebugImageArtifact(
            fileName = result.fileName,
            jpegBytes = result.jpegBytes
        )
    }

    private fun toThrowResult(normalizedX: Float, normalizedY: Float): ThrowResult {
        return VirtualBoardScorer.calculateScore(DartPosition(normalizedX, normalizedY))
    }
}
