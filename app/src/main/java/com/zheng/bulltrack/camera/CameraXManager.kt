package com.zheng.bulltrack.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Handler
import android.os.Looper
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.util.Log
import android.util.Size
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class CameraXManager : CameraManager {

    companion object {
        private const val TAG = "CameraXManager"
        private const val TARGET_WIDTH = 1080
        private const val TARGET_HEIGHT = 1920
        private const val ROUND_ZOOM_SETTLE_MS = 120L
        private const val AF_AE_TIMEOUT_MS = 800L
        private const val AF_AE_POLL_INTERVAL_MS = 50L
        private const val AF_AE_STABLE_REQUIRED_COUNT = 2
        private const val AUTO_FOCUS_SIZE = 0.2f
        private const val PREVIEW_STREAM_RETRY_DELAY_MS = 600L
        private const val MAX_PREVIEW_RETRY_COUNT = 1
    }

    private val _cameraState = MutableStateFlow<CameraState>(CameraState.Idle)
    override val cameraState: StateFlow<CameraState> = _cameraState.asStateFlow()

    private var appContext: Context? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var previewUseCase: Preview? = null
    private var imageCapture: ImageCapture? = null
    private var boundCamera: Camera? = null
    private var cameraExecutor: ExecutorService? = null
    private var previewLifecycleOwner: LifecycleOwner? = null
    private var previewView: PreviewView? = null
    private var previewStreamObserver: Observer<PreviewView.StreamState>? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingPreviewRetry: Runnable? = null
    private var previewRetryCount: Int = 0
    private var currentZoomRatio: Float = 1f
    private var lockedZoomRatioForRound: Float? = null

    private var currentRoundConfig: RoundCameraConfig? = null
    private var lockPhase: CameraLockPhase = CameraLockPhase.IDLE
    private var lockReason: String? = null

    @Volatile
    private var latestAeState: Int? = null

    @Volatile
    private var latestAfState: Int? = null

    @Volatile
    private var aeStableCount: Int = 0

    @Volatile
    private var afStableCount: Int = 0

    private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
        override fun onCaptureCompleted(
            session: CameraCaptureSession,
            request: CaptureRequest,
            result: TotalCaptureResult
        ) {
            latestAeState = result.get(CaptureResult.CONTROL_AE_STATE)
            latestAfState = result.get(CaptureResult.CONTROL_AF_STATE)

            if (isAeStable(latestAeState)) {
                aeStableCount += 1
            } else {
                aeStableCount = 0
            }

            if (isAfStable(latestAfState)) {
                afStableCount += 1
            } else {
                afStableCount = 0
            }
        }
    }

    override fun initialize(context: Context) {
        if (appContext != null) {
            return
        }

        appContext = context.applicationContext
        cameraExecutor = Executors.newSingleThreadExecutor()

        val providerFuture = ProcessCameraProvider.getInstance(appContext!!)
        providerFuture.addListener({
            try {
                cameraProvider = providerFuture.get()
                Log.d(TAG, "Camera provider initialized. previewAttached=${previewView != null}")
                if (previewLifecycleOwner != null && previewView != null) {
                    bindCameraUseCases(bindPreview = true)
                } else {
                    _cameraState.value = readyState(
                        isPreviewBound = false,
                        statusMessage = "相机已初始化，等待预览"
                    )
                }
            } catch (error: Exception) {
                Log.e(TAG, "Failed to initialize camera", error)
                _cameraState.value = CameraState.Error(error.message ?: "相机初始化失败")
            }
        }, ContextCompat.getMainExecutor(appContext!!))
    }

    override fun bindPreview(lifecycleOwner: LifecycleOwner, previewView: PreviewView) {
        previewLifecycleOwner = lifecycleOwner
        this.previewView = previewView
        observePreviewStream(lifecycleOwner, previewView)
        Log.d(TAG, "bindPreview requested. providerReady=${cameraProvider != null}")
        bindCameraUseCases(bindPreview = true)
    }

    override fun unbindPreview() {
        val provider = cameraProvider ?: return
        Log.d(TAG, "unbindPreview requested.")
        clearPreviewStreamObserver()
        previewUseCase?.let { provider.unbind(it) }
        previewUseCase = null
        previewRetryCount = 0
        _cameraState.value = readyState(
            isPreviewBound = false,
            statusMessage = currentRoundConfig?.statusMessage ?: "预览已关闭"
        )
    }

    override fun setZoomRatio(zoomRatio: Float) {
        val camera = boundCamera ?: return
        val zoomState = camera.cameraInfo.zoomState.value ?: return
        val clamped = zoomRatio.coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
        currentZoomRatio = clamped
        camera.cameraControl.setZoomRatio(clamped)
        _cameraState.value = readyState(
            isPreviewBound = previewUseCase != null,
            statusMessage = currentRoundConfig?.statusMessage ?: "相机就绪"
        )
    }

    override fun getZoomRatio(): Float = currentZoomRatio

    override suspend fun captureFirstFrameForRound(): CapturedFrame {
        lockedZoomRatioForRound = currentZoomRatio
        lockPhase = CameraLockPhase.METERING
        lockReason = "本轮使用自动对焦/测光稳定后拍摄"
        prepareAutoCapture()
        val capturedFrame = takePicture()
        val roundConfig = buildRoundCameraConfig(capturedFrame.bitmap)
        currentRoundConfig = roundConfig
        unbindPreview()
        _cameraState.value = readyState(
            isPreviewBound = false,
            statusMessage = roundConfig.statusMessage
        )
        return capturedFrame.copy(cameraConfig = roundConfig)
    }

    override suspend fun captureNextFrameForRound(): CapturedFrame {
        lockPhase = CameraLockPhase.LOCKED
        lockReason = "沿用首帧已稳定的 zoom 与自动对焦/测光状态直接快拍"
        val capturedFrame = takePicture()
        val config = currentRoundConfig ?: buildRoundCameraConfig(capturedFrame.bitmap).also {
            currentRoundConfig = it
        }
        return capturedFrame.copy(cameraConfig = config)
    }

    override fun endRoundCapture() {
        currentRoundConfig = null
        lockedZoomRatioForRound = null
        lockPhase = CameraLockPhase.IDLE
        lockReason = null
        reset3AState()
        if (previewLifecycleOwner != null && previewView != null) {
            bindCameraUseCases(bindPreview = true)
        } else {
            bindCameraUseCases(bindPreview = false)
        }
    }

    override fun release() {
        cameraProvider?.unbindAll()
        cameraExecutor?.shutdown()
        cameraProvider = null
        previewUseCase = null
        imageCapture = null
        boundCamera = null
        cameraExecutor = null
        previewLifecycleOwner = null
        previewView = null
        clearPreviewStreamObserver()
        previewRetryCount = 0
        currentRoundConfig = null
        lockedZoomRatioForRound = null
        lockPhase = CameraLockPhase.IDLE
        lockReason = null
        reset3AState()
        _cameraState.value = CameraState.Idle
    }

    private fun bindCameraUseCases(bindPreview: Boolean) {
        val provider = cameraProvider ?: return
        val lifecycleOwner = previewLifecycleOwner
        if (bindPreview && lifecycleOwner == null) {
            Log.d(TAG, "bindCameraUseCases skipped because lifecycleOwner is null.")
            return
        }
        Log.d(TAG, "bindCameraUseCases(bindPreview=$bindPreview) start.")

        val preview = if (bindPreview) {
            buildPreview().also { useCase ->
                previewView?.let { view ->
                    useCase.setSurfaceProvider(view.surfaceProvider)
                }
            }
        } else {
            null
        }

        val imageCaptureUseCase = buildImageCapture()

        try {
            provider.unbindAll()
            val selector = CameraSelector.DEFAULT_BACK_CAMERA
            boundCamera = if (preview != null && lifecycleOwner != null) {
                provider.bindToLifecycle(lifecycleOwner, selector, preview, imageCaptureUseCase)
            } else if (lifecycleOwner != null) {
                provider.bindToLifecycle(lifecycleOwner, selector, imageCaptureUseCase)
            } else {
                null
            }
            previewUseCase = preview
            imageCapture = imageCaptureUseCase
            applyZoom()
            _cameraState.value = readyState(
                isPreviewBound = false,
                statusMessage = currentRoundConfig?.statusMessage
                    ?: if (preview != null) "预览连接中" else "相机就绪"
            )
            Log.d(TAG, "bindCameraUseCases success. previewBound=${preview != null}")
        } catch (error: Exception) {
            Log.e(TAG, "Failed to bind camera use cases", error)
            _cameraState.value = CameraState.Error(error.message ?: "绑定相机失败")
        }
    }

    private fun buildPreview(): Preview {
        val builder = Preview.Builder()
            .setTargetResolution(Size(TARGET_WIDTH, TARGET_HEIGHT))
        val extender = Camera2Interop.Extender(builder)
        extender.setSessionCaptureCallback(captureCallback)
        extender.setCaptureRequestOption(
            CaptureRequest.CONTROL_AE_MODE,
            CaptureRequest.CONTROL_AE_MODE_ON
        )
        extender.setCaptureRequestOption(
            CaptureRequest.CONTROL_AF_MODE,
            CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
        )
        return builder.build()
    }

    private fun buildImageCapture(): ImageCapture {
        val builder = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setTargetResolution(Size(TARGET_WIDTH, TARGET_HEIGHT))
        val extender = Camera2Interop.Extender(builder)
        extender.setSessionCaptureCallback(captureCallback)
        extender.setCaptureRequestOption(
            CaptureRequest.CONTROL_AE_MODE,
            CaptureRequest.CONTROL_AE_MODE_ON
        )
        extender.setCaptureRequestOption(
            CaptureRequest.CONTROL_AF_MODE,
            CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
        )

        return builder.build()
    }

    private fun applyZoom() {
        val camera = boundCamera ?: return
        val zoomState = camera.cameraInfo.zoomState.value ?: return
        val targetZoom = (lockedZoomRatioForRound ?: currentZoomRatio).coerceIn(
            zoomState.minZoomRatio,
            zoomState.maxZoomRatio
        )
        camera.cameraControl.setZoomRatio(targetZoom)
        if (lockedZoomRatioForRound != null) {
            lockedZoomRatioForRound = targetZoom
        }
        currentZoomRatio = targetZoom
    }

    private suspend fun prepareAutoCapture() {
        reset3AState()
        applyRoundZoomBeforeCapture()
        triggerCenterFocusAndMetering()
        val stabilized = waitForAutoStateStable()
        lockPhase = if (stabilized) {
            CameraLockPhase.LOCKED
        } else {
            CameraLockPhase.FALLBACK
        }
        lockReason = if (stabilized) {
            "zoom、生效后的自动对焦与测光已稳定"
        } else {
            "自动对焦/测光等待超时，按当前状态拍摄"
        }
    }

    private suspend fun applyRoundZoomBeforeCapture() {
        val lockedZoom = lockedZoomRatioForRound ?: return
        val camera = boundCamera ?: return
        val zoomState = camera.cameraInfo.zoomState.value ?: return
        val clampedZoom = lockedZoom.coerceIn(
            zoomState.minZoomRatio,
            zoomState.maxZoomRatio
        )
        lockedZoomRatioForRound = clampedZoom
        currentZoomRatio = clampedZoom
        camera.cameraControl.setZoomRatio(clampedZoom).await()
        delay(ROUND_ZOOM_SETTLE_MS)
    }

    private suspend fun triggerCenterFocusAndMetering() {
        val camera = boundCamera ?: return
        val point = SurfaceOrientedMeteringPointFactory(1f, 1f)
            .createPoint(0.5f, 0.5f, AUTO_FOCUS_SIZE)
        val action = FocusMeteringAction.Builder(
            point,
            FocusMeteringAction.FLAG_AF or
                FocusMeteringAction.FLAG_AE or
                FocusMeteringAction.FLAG_AWB
        ).setAutoCancelDuration(2, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        runCatching {
            camera.cameraControl.startFocusAndMetering(action).await()
        }.onFailure { error ->
            Log.w(TAG, "Focus and metering trigger failed", error)
        }
    }

    private suspend fun waitForAutoStateStable(): Boolean {
        return withTimeoutOrNull(AF_AE_TIMEOUT_MS) {
            while (true) {
                if (aeStableCount >= AF_AE_STABLE_REQUIRED_COUNT &&
                    afStableCount >= AF_AE_STABLE_REQUIRED_COUNT
                ) {
                    return@withTimeoutOrNull true
                }
                delay(AF_AE_POLL_INTERVAL_MS)
            }
            false
        } ?: false
    }

    private fun reset3AState() {
        latestAeState = null
        latestAfState = null
        aeStableCount = 0
        afStableCount = 0
    }

    private fun isAeStable(aeState: Int?): Boolean {
        return aeState == CaptureResult.CONTROL_AE_STATE_CONVERGED ||
            aeState == CaptureResult.CONTROL_AE_STATE_LOCKED
    }

    private fun isAfStable(afState: Int?): Boolean {
        return afState == CaptureResult.CONTROL_AF_STATE_FOCUSED_LOCKED ||
            afState == CaptureResult.CONTROL_AF_STATE_PASSIVE_FOCUSED ||
            afState == CaptureResult.CONTROL_AF_STATE_PASSIVE_UNFOCUSED ||
            afState == CaptureResult.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED
    }

    private suspend fun takePicture(): CapturedFrame = suspendCancellableCoroutine { continuation ->
        val capture = imageCapture
        val executor = cameraExecutor
        if (capture == null || executor == null) {
            continuation.resumeWithException(IllegalStateException("相机尚未就绪"))
            return@suspendCancellableCoroutine
        }

        _cameraState.value = CameraState.Capturing(
            zoomRatio = currentZoomRatio,
            lockPhase = lockPhase,
            statusMessage = when (lockPhase) {
                CameraLockPhase.METERING -> "正在等待 zoom、生效后的自动对焦和测光"
                CameraLockPhase.LOCKED -> lockReason ?: "沿用当前稳定状态直接拍摄"
                CameraLockPhase.FALLBACK -> lockReason ?: "自动对焦/测光未完全稳定，按当前状态拍摄"
                CameraLockPhase.IDLE -> "相机拍摄中"
            }
        )

        capture.takePicture(
            executor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val bitmap = imageProxyToBitmap(image)
                        val timestampNs = image.imageInfo.timestamp
                        image.close()
                        continuation.resume(
                            CapturedFrame(
                                bitmap = bitmap,
                                timestampNs = timestampNs
                            )
                        )
                    } catch (error: Exception) {
                        image.close()
                        continuation.resumeWithException(error)
                    } finally {
                        _cameraState.value = readyState(
                            isPreviewBound = previewUseCase != null,
                            statusMessage = currentRoundConfig?.statusMessage
                                ?: "相机就绪"
                        )
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e(TAG, "Image capture failed", exception)
                    _cameraState.value = CameraState.Error(
                        exception.message ?: "拍摄失败"
                    )
                    continuation.resumeWithException(exception)
                }
            }
        )
    }

    private fun buildRoundCameraConfig(bitmap: Bitmap): RoundCameraConfig {
        val roundZoomRatio = lockedZoomRatioForRound ?: currentZoomRatio
        val statusMessage = "本轮固定 zoom ${formatZoom(roundZoomRatio)}x，首帧已完成自动对焦/测光稳定，后续连续拍摄直接快拍"
        return RoundCameraConfig(
            width = bitmap.width,
            height = bitmap.height,
            rotationDegrees = 0,
            zoomRatio = roundZoomRatio,
            lockReason = lockReason,
            statusMessage = statusMessage
        )
    }

    private fun readyState(
        isPreviewBound: Boolean,
        statusMessage: String
    ): CameraState.Ready {
        return CameraState.Ready(
            zoomRatio = currentZoomRatio,
            isPreviewBound = isPreviewBound,
            lockPhase = lockPhase,
            statusMessage = statusMessage
        )
    }

    private fun observePreviewStream(
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView
    ) {
        clearPreviewStreamObserver()
        val observer = Observer<PreviewView.StreamState> { streamState ->
            Log.d(TAG, "previewStreamState=$streamState")
            when (streamState) {
                PreviewView.StreamState.STREAMING -> {
                    cancelPendingPreviewRetry()
                    _cameraState.value = readyState(
                        isPreviewBound = true,
                        statusMessage = currentRoundConfig?.statusMessage ?: "相机预览中"
                    )
                }

                PreviewView.StreamState.IDLE -> {
                    _cameraState.value = readyState(
                        isPreviewBound = false,
                        statusMessage = currentRoundConfig?.statusMessage ?: "预览流等待中"
                    )
                    schedulePreviewRetry()
                }
            }
        }
        previewStreamObserver = observer
        previewView.previewStreamState.observe(lifecycleOwner, observer)
    }

    private fun clearPreviewStreamObserver() {
        cancelPendingPreviewRetry()
        val view = previewView
        val observer = previewStreamObserver
        if (view != null && observer != null) {
            view.previewStreamState.removeObserver(observer)
        }
        previewStreamObserver = null
    }

    private fun schedulePreviewRetry() {
        if (currentRoundConfig != null || previewUseCase == null) {
            return
        }
        if (previewRetryCount >= MAX_PREVIEW_RETRY_COUNT) {
            return
        }
        if (pendingPreviewRetry != null) {
            return
        }
        val owner = previewLifecycleOwner ?: return
        val view = previewView ?: return
        val retry = Runnable {
            pendingPreviewRetry = null
            if (previewUseCase == null || currentRoundConfig != null) {
                return@Runnable
            }
            if (!view.isAttachedToWindow || view.width <= 0 || view.height <= 0) {
                return@Runnable
            }
            previewRetryCount += 1
            Log.w(TAG, "Preview stream stayed IDLE. Rebinding preview use case once.")
            observePreviewStream(owner, view)
            bindCameraUseCases(bindPreview = true)
        }
        pendingPreviewRetry = retry
        mainHandler.postDelayed(retry, PREVIEW_STREAM_RETRY_DELAY_MS)
    }

    private fun cancelPendingPreviewRetry() {
        pendingPreviewRetry?.let(mainHandler::removeCallbacks)
        pendingPreviewRetry = null
    }

    private suspend fun <T> ListenableFuture<T>.await(): T {
        return suspendCancellableCoroutine { continuation ->
            val context = appContext
            if (context == null) {
                continuation.resumeWithException(IllegalStateException("相机上下文尚未初始化"))
                return@suspendCancellableCoroutine
            }
            addListener(
                {
                    try {
                        continuation.resume(get())
                    } catch (error: Exception) {
                        continuation.resumeWithException(error)
                    }
                },
                ContextCompat.getMainExecutor(context)
            )
            continuation.invokeOnCancellation {
                cancel(true)
            }
        }
    }

    private fun imageProxyToBitmap(image: ImageProxy): Bitmap {
        val bitmap = when (image.format) {
            ImageFormat.JPEG -> {
                val buffer = image.planes[0].buffer
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }

            ImageFormat.YUV_420_888 -> {
                val nv21 = yuv420888ToNv21(image)
                val yuvImage = YuvImage(
                    nv21,
                    ImageFormat.NV21,
                    image.width,
                    image.height,
                    null
                )
                val out = ByteArrayOutputStream()
                yuvImage.compressToJpeg(
                    Rect(0, 0, image.width, image.height),
                    95,
                    out
                )
                val bytes = out.toByteArray()
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }

            else -> throw IllegalArgumentException("不支持的图像格式: ${image.format}")
        } ?: throw IllegalStateException("无法解码相机图像")

        val rotated = rotateBitmap(bitmap, image.imageInfo.rotationDegrees.toFloat())
        return centerCropToTarget(rotated, TARGET_WIDTH, TARGET_HEIGHT)
    }

    private fun rotateBitmap(bitmap: Bitmap, rotationDegrees: Float): Bitmap {
        if (rotationDegrees == 0f) {
            return bitmap.copy(Bitmap.Config.ARGB_8888, false)
        }
        val matrix = Matrix().apply { postRotate(rotationDegrees) }
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true
        ).copy(Bitmap.Config.ARGB_8888, false)
    }

    private fun centerCropToTarget(bitmap: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap {
        val scale = maxOf(
            targetWidth.toFloat() / bitmap.width.toFloat(),
            targetHeight.toFloat() / bitmap.height.toFloat()
        )
        val scaledWidth = (bitmap.width * scale).toInt()
        val scaledHeight = (bitmap.height * scale).toInt()
        val scaled = Bitmap.createScaledBitmap(bitmap, scaledWidth, scaledHeight, true)
        val left = ((scaledWidth - targetWidth) / 2).coerceAtLeast(0)
        val top = ((scaledHeight - targetHeight) / 2).coerceAtLeast(0)
        return Bitmap.createBitmap(
            scaled,
            left,
            top,
            targetWidth.coerceAtMost(scaled.width - left),
            targetHeight.coerceAtMost(scaled.height - top)
        ).copy(Bitmap.Config.ARGB_8888, false)
    }

    private fun yuv420888ToNv21(image: ImageProxy): ByteArray {
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()
        val nv21 = ByteArray(ySize + uSize + vSize)

        yBuffer.get(nv21, 0, ySize)

        val chromaRowStride = image.planes[1].rowStride
        val chromaPixelStride = image.planes[1].pixelStride
        val width = image.width
        val height = image.height
        var outputOffset = ySize

        val vBytes = ByteArray(vSize)
        val uBytes = ByteArray(uSize)
        vBuffer.get(vBytes)
        uBuffer.get(uBytes)

        for (row in 0 until height / 2) {
            var inputOffset = row * chromaRowStride
            for (col in 0 until width / 2) {
                nv21[outputOffset++] = vBytes[inputOffset]
                nv21[outputOffset++] = uBytes[inputOffset]
                inputOffset += chromaPixelStride
            }
        }

        return nv21
    }

    private fun formatZoom(zoomRatio: Float): String {
        return String.format("%.2f", zoomRatio)
    }
}
