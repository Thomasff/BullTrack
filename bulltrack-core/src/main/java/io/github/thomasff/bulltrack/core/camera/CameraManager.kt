package io.github.thomasff.bulltrack.core.camera

import android.content.Context
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.StateFlow

// Status messages, lock reasons and error messages are codes (optionally "code: detail") that the
// RN app translates into its language.
sealed class CameraState {
    object Idle : CameraState()

    data class Ready(
        val zoomRatio: Float = 1f,
        val isPreviewBound: Boolean = false,
        val lockPhase: CameraLockPhase = CameraLockPhase.IDLE,
        val statusMessage: String = "camera_ready"
    ) : CameraState()

    data class Capturing(
        val zoomRatio: Float,
        val lockPhase: CameraLockPhase = CameraLockPhase.IDLE,
        val statusMessage: String
    ) : CameraState()

    data class Error(val message: String) : CameraState()
}

enum class CameraLockPhase {
    IDLE,
    METERING,
    LOCKED,
    FALLBACK
}

data class RoundCameraConfig(
    val width: Int,
    val height: Int,
    val rotationDegrees: Int,
    val zoomRatio: Float,
    val lockReason: String?,
    val statusMessage: String
)

data class CapturedFrame(
    val bitmap: android.graphics.Bitmap,
    val timestampNs: Long,
    val cameraConfig: RoundCameraConfig? = null,
    // Clockwise turn still needed to make the bitmap upright; detection applies it natively.
    val rotationDegrees: Int = 0,
    // Time spent turning the camera image into the bitmap, for the round timing log.
    val decodeMs: Long = 0
)

interface CameraManager {
    val cameraState: StateFlow<CameraState>

    fun initialize(context: Context)

    fun bindPreview(lifecycleOwner: LifecycleOwner, previewView: PreviewView)

    fun unbindPreview()

    fun setZoomRatio(zoomRatio: Float)

    fun getZoomRatio(): Float

    suspend fun captureFirstFrameForRound(): CapturedFrame

    suspend fun captureNextFrameForRound(): CapturedFrame

    fun endRoundCapture()

    fun release()
}
