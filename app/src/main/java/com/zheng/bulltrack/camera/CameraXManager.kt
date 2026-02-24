package com.zheng.bulltrack.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraXManager(
    private val lifecycleOwner: LifecycleOwner
) : CameraManager {
    
    companion object {
        private const val TAG = "CameraXManager"
    }
    
    private val _cameraState = MutableStateFlow<CameraState>(CameraState.Idle)
    override val cameraState: StateFlow<CameraState> = _cameraState.asStateFlow()
    
    private var cameraProvider: ProcessCameraProvider? = null
    private var imageCapture: ImageCapture? = null
    private var cameraExecutor: ExecutorService? = null
    private var context: Context? = null
    
    override fun initialize(context: Context) {
        this.context = context
        cameraExecutor = Executors.newSingleThreadExecutor()
        
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        
        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()
                
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()
                
                _cameraState.value = CameraState.Ready
                Log.d(TAG, "Camera initialized successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize camera", e)
                _cameraState.value = CameraState.Error(e.message ?: "Unknown error")
            }
        }, ContextCompat.getMainExecutor(context))
    }
    
    fun startPreview(preview: Preview) {
        val provider = cameraProvider ?: return
        val capture = imageCapture ?: return
        
        try {
            provider.unbindAll()
            
            val cameraSelector = CameraSelector.Builder()
                .requireLensFacing(CameraSelector.LENS_FACING_BACK)
                .build()
            
            provider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                capture
            )
            
            Log.d(TAG, "Preview started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start preview", e)
            _cameraState.value = CameraState.Error(e.message ?: "Failed to start preview")
        }
    }
    
    override fun captureImage(onResult: (Bitmap?) -> Unit) {
        val capture = imageCapture ?: run {
            onResult(null)
            return
        }
        
        val executor = cameraExecutor ?: run {
            onResult(null)
            return
        }
        
        _cameraState.value = CameraState.Capturing
        
        capture.takePicture(
            executor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val bitmap = imageProxyToBitmap(image)
                    image.close()
                    _cameraState.value = CameraState.Ready
                    onResult(bitmap)
                }
                
                override fun onError(exception: ImageCaptureException) {
                    Log.e(TAG, "Image capture failed", exception)
                    _cameraState.value = CameraState.Error(exception.message ?: "Capture failed")
                    onResult(null)
                }
            }
        )
    }
    
    private fun imageProxyToBitmap(image: ImageProxy): Bitmap? {
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }
    
    override fun release() {
        cameraProvider?.unbindAll()
        cameraExecutor?.shutdown()
        cameraProvider = null
        imageCapture = null
        cameraExecutor = null
        _cameraState.value = CameraState.Idle
    }
}
