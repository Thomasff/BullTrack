package com.zheng.bulltrack.camera

import android.content.Context
import android.graphics.Bitmap
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageProxy
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed class CameraState {
    object Idle : CameraState()
    object Ready : CameraState()
    object Capturing : CameraState()
    data class Error(val message: String) : CameraState()
}

interface CameraManager {
    val cameraState: StateFlow<CameraState>
    fun initialize(context: Context)
    fun captureImage(onResult: (Bitmap?) -> Unit)
    fun release()
}
