package io.github.thomasff.bulltrack.core.vision

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Point
import android.graphics.Rect
import io.github.thomasff.bulltrack.core.domain.model.DartPosition
import io.github.thomasff.bulltrack.core.domain.model.ThrowResult
import io.github.thomasff.bulltrack.core.domain.scoring.VirtualBoardScorer
import java.io.File

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
    private external fun nativeSetYoloForceCpu(forceCpu: Boolean)
    private external fun nativeSetGpuCheckGuard(path: String, key: String)
    private external fun nativeCreateSession(): Long
    private external fun nativeDestroySession(sessionId: Long)
    private external fun nativeStartRound(
        sessionId: Long,
        frame: Bitmap,
        rotationDegrees: Int,
        softBoard: Boolean
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
    private external fun nativeDescribeFrameStageTimes(sessionId: Long): String
    private external fun nativeDetectPrepBoard(frame: Bitmap, rotationDegrees: Int): IntArray
    private external fun nativeTakePhotoSource(sessionId: Long): Long
    private external fun nativeReleasePhotoSource(sourceId: Long)
    private external fun nativeRenderPhotos(sourceId: Long): Array<ByteArray>

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

    /** Developer setting: run YOLO on the CPU even when the GPU works. */
    fun setYoloForceCpu(forceCpu: Boolean) {
        nativeSetYoloForceCpu(forceCpu)
    }

    /**
     * Lets the GPU check survive a driver that crashes or hangs: [file] counts checks that never
     * finished, and after two in a row for the same [key] (this app install and system build) YOLO
     * stays on the CPU. Call before the first detection.
     */
    fun setGpuCheckGuard(file: File, key: String) {
        nativeSetGpuCheckGuard(file.absolutePath, key)
    }

    override fun createSession(): Long = nativeCreateSession()

    override fun destroySession(sessionId: Long) {
        if (sessionId != 0L) {
            nativeDestroySession(sessionId)
        }
    }

    override fun startRound(
        sessionId: Long,
        firstFrame: Bitmap,
        rotationDegrees: Int,
        softBoard: Boolean
    ): StartRoundDetectionUpdate {
        val result = nativeStartRound(sessionId, argb8888(firstFrame), rotationDegrees, softBoard)
        return StartRoundDetectionUpdate(
            debugImages = result.debugImages.orEmpty().map(::toDebugImageArtifact),
            errorMessage = result.errorMessage,
            startDartCount = result.startDartCount,
            leftRightHalfRatio = result.leftRightHalfRatio,
            boardHeightShare = result.boardHeightShare,
            boardInSquare = result.boardInSquare,
            modelSquareTop = result.modelSquareTop
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

    /** Average and slowest per-frame time of the round's YOLO, alignment and debug JPEG stages. */
    fun describeFrameStageTimes(sessionId: Long): String = nativeDescribeFrameStageTimes(sessionId)

    /** Copies the round's share photo material out of the session; release it when done. */
    fun takePhotoSource(sessionId: Long): Long = nativeTakePhotoSource(sessionId)

    fun releasePhotoSource(sourceId: Long) {
        if (sourceId != 0L) {
            nativeReleasePhotoSource(sourceId)
        }
    }

    /** Share card photos as JPEGs: the round board, and the close-up around the darts (null when none). */
    fun renderPhotos(sourceId: Long): Pair<ByteArray, ByteArray?> {
        val parts = nativeRenderPhotos(sourceId)
        return parts[0] to parts[1].takeIf { it.isNotEmpty() }
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

    /** Where the board is before a round, for the auto zoom and the aiming arrow. */
    fun detectPrepBoard(frame: Bitmap, rotationDegrees: Int): PrepBoardGuide {
        val values = nativeDetectPrepBoard(argb8888(frame), rotationDegrees)
        return PrepBoardGuide(
            frameWidth = values[0],
            frameHeight = values[1],
            bandTop = values[2],
            bandHeight = values[3],
            boardBox = if (values[4] == 1) {
                Rect(values[5], values[6], values[5] + values[7], values[6] + values[8])
            } else {
                null
            },
            dartTips = List(values[9]) { index ->
                Point(values[10 + index * 2], values[11 + index * 2])
            }
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

/**
 * The upright frame's size, the band of it the model saw (as wide as the frame) and the board box
 * in frame coordinates, null when no board was found, and the tips of darts still in the board.
 */
data class PrepBoardGuide(
    val frameWidth: Int,
    val frameHeight: Int,
    val bandTop: Int,
    val bandHeight: Int,
    val boardBox: Rect?,
    val dartTips: List<Point>
)
