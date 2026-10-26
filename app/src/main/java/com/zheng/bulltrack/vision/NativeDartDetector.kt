package com.zheng.bulltrack.vision

import android.content.res.AssetManager
import android.graphics.Bitmap
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.domain.scoring.VirtualBoardScorer
import java.nio.ByteBuffer

class NativeDartDetector(
    private val assetManager: AssetManager? = null
) : DartDetector {

    init {
        System.loadLibrary("bulltrack")
    }

    private external fun nativeInit(assetManager: AssetManager?)
    private external fun nativeRelease()
    private external fun nativeWarmUp()
    private external fun nativeSetDebugImagesEnabled(enabled: Boolean)
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
    private external fun nativeFindMissedDarts(sessionId: Long): NativeRedetectResult

    override fun init() {
        nativeInit(assetManager)
    }

    override fun warmUp() {
        nativeWarmUp()
    }

    fun release() {
        nativeRelease()
    }

    /** Debug images cost drawing and JPEG encoding on every frame, so they are opt-in. */
    fun setDebugImagesEnabled(enabled: Boolean) {
        nativeSetDebugImagesEnabled(enabled)
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
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact),
            errorMessage = result.errorMessage,
            startDartCount = result.startDartCount,
            leftRightHalfRatio = result.leftRightHalfRatio
        )
    }

    override fun processFrame(sessionId: Long, frame: Bitmap): FrameDetectionUpdate {
        val result = nativeProcessFrame(
            sessionId = sessionId,
            frameData = bitmapToByteArray(frame),
            width = frame.width,
            height = frame.height
        )
        val newThrows = result.detectedPoints.orEmpty().mapIndexed { index, point ->
            point?.let {
                toThrowResult(
                    it.normalizedX,
                    it.normalizedY,
                    byFallback = result.detectedByFallback?.getOrNull(index) == true
                )
            }
        }
        return FrameDetectionUpdate(
            gateTriggered = result.gateTriggered,
            gateReason = result.gateReason,
            newThrows = newThrows,
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

    override fun findMissedDarts(sessionId: Long): RedetectDetectionUpdate {
        val result = nativeFindMissedDarts(sessionId)
        return RedetectDetectionUpdate(
            throws = result.points.orEmpty().map { point ->
                toThrowResult(point.normalizedX, point.normalizedY, byFallback = true)
            },
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact),
            yoloStatus = result.yoloStatus
        )
    }

    // ARGB_8888 pixels sit in memory as R, G, B, A bytes, which is the RGBA layout the native side
    // expects, so one bulk copy replaces a per-pixel loop and an extra int array per frame.
    // Camera frames are opaque, so premultiplied alpha does not change the colors.
    private fun bitmapToByteArray(bitmap: Bitmap): ByteArray {
        val source = if (bitmap.config == Bitmap.Config.ARGB_8888) {
            bitmap
        } else {
            bitmap.copy(Bitmap.Config.ARGB_8888, false)
        }
        val byteArray = ByteArray(source.width * source.height * 4)
        source.copyPixelsToBuffer(ByteBuffer.wrap(byteArray))
        if (source !== bitmap) {
            source.recycle()
        }
        return byteArray
    }

    private fun toDebugImageArtifact(result: NativeDebugImageResult): DebugImageArtifact {
        return DebugImageArtifact(
            fileName = result.fileName,
            jpegBytes = result.jpegBytes
        )
    }

    private fun toThrowResult(normalizedX: Float, normalizedY: Float, byFallback: Boolean = false): ThrowResult {
        val realPosition = DartPosition(normalizedX, normalizedY)
        return VirtualBoardScorer.calculateScore(VirtualBoardScorer.fromRealBoard(realPosition)).copy(
            needsCheck = byFallback || VirtualBoardScorer.isNearLine(realPosition)
        )
    }
}
