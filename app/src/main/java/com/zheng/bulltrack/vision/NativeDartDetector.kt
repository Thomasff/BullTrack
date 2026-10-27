package com.zheng.bulltrack.vision

import android.content.res.AssetManager
import android.graphics.Bitmap
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
    private external fun nativeSetDebugImagesEnabled(enabled: Boolean)
    private external fun nativeCreateSession(): Long
    private external fun nativeDestroySession(sessionId: Long)
    private external fun nativeStartRound(
        sessionId: Long,
        frame: Bitmap,
        rotationDegrees: Int
    ): NativeStartRoundResult
    private external fun nativeProcessFrame(
        sessionId: Long,
        frame: Bitmap,
        rotationDegrees: Int
    ): NativeFrameProcessResult
    private external fun nativeRedetectRound(
        sessionId: Long,
        frame: Bitmap,
        rotationDegrees: Int
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

    override fun startRound(sessionId: Long, firstFrame: Bitmap, rotationDegrees: Int): StartRoundDetectionUpdate {
        val result = nativeStartRound(sessionId, argb8888(firstFrame), rotationDegrees)
        return StartRoundDetectionUpdate(
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact),
            errorMessage = result.errorMessage,
            startDartCount = result.startDartCount,
            leftRightHalfRatio = result.leftRightHalfRatio
        )
    }

    override fun processFrame(sessionId: Long, frame: Bitmap, rotationDegrees: Int): FrameDetectionUpdate {
        val result = nativeProcessFrame(sessionId, argb8888(frame), rotationDegrees)
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

    override fun redetect(sessionId: Long, frame: Bitmap, rotationDegrees: Int): RedetectDetectionUpdate {
        val result = nativeRedetectRound(sessionId, argb8888(frame), rotationDegrees)
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

    // The native side reads ARGB_8888 pixels in place as RGBA bytes (no per-frame Java copy).
    // Camera frames are opaque, so premultiplied alpha does not change the colors.
    private fun argb8888(bitmap: Bitmap): Bitmap {
        return if (bitmap.config == Bitmap.Config.ARGB_8888) {
            bitmap
        } else {
            bitmap.copy(Bitmap.Config.ARGB_8888, false)
        }
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
