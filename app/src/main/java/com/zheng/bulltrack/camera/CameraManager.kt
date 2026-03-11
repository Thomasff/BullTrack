package com.zheng.bulltrack.camera

import android.content.Context
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.StateFlow

sealed class CameraState {
    object Idle : CameraState()

    data class Ready(
        val zoomRatio: Float = 1f,
        val isPreviewBound: Boolean = false,
        val isStrictExposureLocked: Boolean = false,
        val isDevelopmentExposureFallback: Boolean = false,
        val lockedIso: Int? = null,
        val lockPhase: CameraLockPhase = CameraLockPhase.IDLE,
        val statusMessage: String = "相机就绪"
    ) : CameraState()

    data class Capturing(
        val zoomRatio: Float,
        val isStrictExposureLocked: Boolean,
        val isDevelopmentExposureFallback: Boolean,
        val lockedIso: Int? = null,
        val lockPhase: CameraLockPhase = CameraLockPhase.IDLE,
        val statusMessage: String
    ) : CameraState()

    data class Error(val message: String) : CameraState()
}

enum class IsoSource {
    AE_MEASURED,
    FALLBACK
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
    val exposureTimeNs: Long?,
    val iso: Int?,
    val isoSource: IsoSource,
    val lockReason: String?,
    val isStrictExposureLocked: Boolean,
    val isDevelopmentExposureFallback: Boolean,
    val statusMessage: String
)

data class CapturedFrame(
    val bitmap: android.graphics.Bitmap,
    val cameraConfig: RoundCameraConfig? = null
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
