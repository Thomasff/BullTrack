package com.zheng.bulltrack.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
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
        private const val TARGET_EXPOSURE_TIME_NS = 10_000_000L
        private const val AE_METERING_TIMEOUT_MS = 1200L
        private const val AE_POLL_INTERVAL_MS = 60L
        private const val AE_STABLE_REQUIRED_COUNT = 3
    }

    private enum class ExposureBindMode {
        PREVIEW_AUTO,
        METERING_AUTO_SHUTTER_FIXED,
        MANUAL_LOCKED,
        CAPTURE_AUTO
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
    private var currentZoomRatio: Float = 1f

    private var currentRoundConfig: RoundCameraConfig? = null
    private var strictExposureSupported: Boolean = false
    private var strictExposureLocked: Boolean = false
    private var lockedIsoForRound: Int? = null
    private var lockPhase: CameraLockPhase = CameraLockPhase.IDLE
    private var lockReason: String? = null

    private var exposureRange: Range<Long>? = null
    private var sensitivityRange: Range<Int>? = null

    @Volatile
    private var latestAeIso: Int? = null

    @Volatile
    private var latestAeState: Int? = null

    @Volatile
    private var latestAeExposureTimeNs: Long? = null

    @Volatile
    private var aeStableCount: Int = 0

    private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
        override fun onCaptureCompleted(
            session: CameraCaptureSession,
            request: CaptureRequest,
            result: TotalCaptureResult
        ) {
            latestAeIso = result.get(CaptureResult.SENSOR_SENSITIVITY)
            latestAeState = result.get(CaptureResult.CONTROL_AE_STATE)
            latestAeExposureTimeNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)

            if (isAeStable(latestAeState)) {
                aeStableCount += 1
            } else {
                aeStableCount = 0
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
                _cameraState.value = readyState(
                    isPreviewBound = false,
                    statusMessage = "相机已初始化，等待预览"
                )
            } catch (error: Exception) {
                Log.e(TAG, "Failed to initialize camera", error)
                _cameraState.value = CameraState.Error(error.message ?: "相机初始化失败")
            }
        }, ContextCompat.getMainExecutor(appContext!!))
    }

    override fun bindPreview(lifecycleOwner: LifecycleOwner, previewView: PreviewView) {
        previewLifecycleOwner = lifecycleOwner
        this.previewView = previewView
        bindCameraUseCases(
            mode = ExposureBindMode.PREVIEW_AUTO,
            bindPreview = true
        )
    }

    override fun unbindPreview() {
        val provider = cameraProvider ?: return
        previewUseCase?.let { provider.unbind(it) }
        previewUseCase = null
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
        strictExposureSupported = detectStrictExposureSupport()
        strictExposureLocked = false
        lockedIsoForRound = null
        lockReason = null
        lockPhase = CameraLockPhase.METERING
        resetAeTracking()

        if (!strictExposureSupported) {
            lockPhase = CameraLockPhase.FALLBACK
            lockReason = "设备不支持固定1/100+手动ISO"
            bindCameraUseCases(
                mode = ExposureBindMode.CAPTURE_AUTO,
                bindPreview = true
            )
            val bitmap = takePicture()
            val roundConfig = buildRoundCameraConfig(bitmap)
            currentRoundConfig = roundConfig
            unbindPreview()
            _cameraState.value = readyState(
                isPreviewBound = false,
                statusMessage = roundConfig.statusMessage
            )
            return CapturedFrame(bitmap = bitmap, cameraConfig = roundConfig)
        }

        bindCameraUseCases(
            mode = ExposureBindMode.METERING_AUTO_SHUTTER_FIXED,
            bindPreview = true
        )
        val measuredIso = waitForAeIso()
        if (measuredIso == null) {
            lockPhase = CameraLockPhase.FALLBACK
            lockReason = "AE测光超时，无法读取ISO"
            lockedIsoForRound = sensitivityRange?.lower
        } else {
            lockPhase = CameraLockPhase.LOCKED
            lockReason = "AE测光完成并锁定ISO"
            lockedIsoForRound = measuredIso
        }

        bindCameraUseCases(
            mode = if (lockedIsoForRound != null) {
                ExposureBindMode.MANUAL_LOCKED
            } else {
                ExposureBindMode.CAPTURE_AUTO
            },
            bindPreview = true
        )
        strictExposureLocked = lockedIsoForRound != null

        val bitmap = takePicture()
        val roundConfig = buildRoundCameraConfig(bitmap)
        currentRoundConfig = roundConfig
        unbindPreview()
        _cameraState.value = readyState(
            isPreviewBound = false,
            statusMessage = roundConfig.statusMessage
        )
        return CapturedFrame(bitmap = bitmap, cameraConfig = roundConfig)
    }

    override suspend fun captureNextFrameForRound(): CapturedFrame {
        val bitmap = takePicture()
        val config = currentRoundConfig ?: buildRoundCameraConfig(bitmap).also {
            currentRoundConfig = it
        }
        return CapturedFrame(bitmap = bitmap, cameraConfig = config)
    }

    override fun endRoundCapture() {
        currentRoundConfig = null
        strictExposureLocked = false
        strictExposureSupported = false
        lockedIsoForRound = null
        lockPhase = CameraLockPhase.IDLE
        lockReason = null
        resetAeTracking()
        if (previewLifecycleOwner != null && previewView != null) {
            bindCameraUseCases(
                mode = ExposureBindMode.PREVIEW_AUTO,
                bindPreview = true
            )
        } else {
            bindCameraUseCases(
                mode = ExposureBindMode.CAPTURE_AUTO,
                bindPreview = false
            )
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
        currentRoundConfig = null
        strictExposureLocked = false
        strictExposureSupported = false
        lockedIsoForRound = null
        lockPhase = CameraLockPhase.IDLE
        lockReason = null
        resetAeTracking()
        _cameraState.value = CameraState.Idle
    }

    private fun bindCameraUseCases(mode: ExposureBindMode, bindPreview: Boolean) {
        val provider = cameraProvider ?: return
        val lifecycleOwner = previewLifecycleOwner
        if (bindPreview && lifecycleOwner == null) {
            return
        }

        val preview = if (bindPreview) {
            buildPreview(mode).also { useCase ->
                previewView?.let { view ->
                    useCase.setSurfaceProvider(view.surfaceProvider)
                }
            }
        } else {
            null
        }

        val imageCaptureUseCase = buildImageCapture(mode)

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
            cacheCameraCharacteristics()
            _cameraState.value = readyState(
                isPreviewBound = preview != null,
                statusMessage = currentRoundConfig?.statusMessage ?: "相机就绪"
            )
        } catch (error: Exception) {
            Log.e(TAG, "Failed to bind camera use cases", error)
            _cameraState.value = CameraState.Error(error.message ?: "绑定相机失败")
        }
    }

    private fun buildPreview(mode: ExposureBindMode): Preview {
        val builder = Preview.Builder()
            .setTargetResolution(Size(TARGET_WIDTH, TARGET_HEIGHT))
        val extender = Camera2Interop.Extender(builder)
        extender.setSessionCaptureCallback(captureCallback)
        when (mode) {
            ExposureBindMode.METERING_AUTO_SHUTTER_FIXED -> {
                extender.setCaptureRequestOption(
                    CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_ON
                )
                extender.setCaptureRequestOption(
                    CaptureRequest.SENSOR_EXPOSURE_TIME,
                    TARGET_EXPOSURE_TIME_NS
                )
            }

            ExposureBindMode.MANUAL_LOCKED -> {
                lockedIsoForRound?.let { iso ->
                    extender.setCaptureRequestOption(
                        CaptureRequest.CONTROL_AE_MODE,
                        CaptureRequest.CONTROL_AE_MODE_OFF
                    )
                    extender.setCaptureRequestOption(
                        CaptureRequest.SENSOR_EXPOSURE_TIME,
                        TARGET_EXPOSURE_TIME_NS
                    )
                    extender.setCaptureRequestOption(
                        CaptureRequest.SENSOR_SENSITIVITY,
                        iso
                    )
                }
            }

            ExposureBindMode.PREVIEW_AUTO,
            ExposureBindMode.CAPTURE_AUTO -> {
                extender.setCaptureRequestOption(
                    CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_ON
                )
            }
        }
        return builder.build()
    }

    private fun buildImageCapture(mode: ExposureBindMode): ImageCapture {
        val builder = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setTargetResolution(Size(TARGET_WIDTH, TARGET_HEIGHT))
        val extender = Camera2Interop.Extender(builder)
        extender.setSessionCaptureCallback(captureCallback)

        when (mode) {
            ExposureBindMode.METERING_AUTO_SHUTTER_FIXED -> {
                extender.setCaptureRequestOption(
                    CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_ON
                )
                extender.setCaptureRequestOption(
                    CaptureRequest.SENSOR_EXPOSURE_TIME,
                    TARGET_EXPOSURE_TIME_NS
                )
            }

            ExposureBindMode.MANUAL_LOCKED -> {
                val lockedIso = lockedIsoForRound
                if (lockedIso != null) {
                    extender.setCaptureRequestOption(
                        CaptureRequest.CONTROL_AE_MODE,
                        CaptureRequest.CONTROL_AE_MODE_OFF
                    )
                    extender.setCaptureRequestOption(
                        CaptureRequest.SENSOR_EXPOSURE_TIME,
                        TARGET_EXPOSURE_TIME_NS
                    )
                    extender.setCaptureRequestOption(
                        CaptureRequest.SENSOR_SENSITIVITY,
                        lockedIso
                    )
                }
            }

            ExposureBindMode.PREVIEW_AUTO,
            ExposureBindMode.CAPTURE_AUTO -> {
                extender.setCaptureRequestOption(
                    CaptureRequest.CONTROL_AE_MODE,
                    CaptureRequest.CONTROL_AE_MODE_ON
                )
            }
        }

        return builder.build()
    }

    private suspend fun waitForAeIso(): Int? {
        val isoRange = sensitivityRange ?: return null
        val measuredIso = withTimeoutOrNull(AE_METERING_TIMEOUT_MS) {
            var isoResult: Int? = null
            while (isoResult == null) {
                val iso = latestAeIso
                if (iso != null && aeStableCount >= AE_STABLE_REQUIRED_COUNT) {
                    isoResult = iso.coerceIn(isoRange.lower, isoRange.upper)
                    break
                }
                delay(AE_POLL_INTERVAL_MS)
            }
            isoResult
        }
        return measuredIso ?: latestAeIso?.coerceIn(isoRange.lower, isoRange.upper)
    }

    private fun detectStrictExposureSupport(): Boolean {
        cacheCameraCharacteristics()
        val supportsExposure = exposureRange?.contains(TARGET_EXPOSURE_TIME_NS) == true
        val supportsIso = sensitivityRange != null
        return supportsExposure && supportsIso
    }

    private fun cacheCameraCharacteristics() {
        val cameraInfo = boundCamera?.cameraInfo ?: return
        val camera2Info = Camera2CameraInfo.from(cameraInfo)
        exposureRange = camera2Info.getCameraCharacteristic(
            CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE
        )
        sensitivityRange = camera2Info.getCameraCharacteristic(
            CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE
        )
    }

    private fun applyZoom() {
        val camera = boundCamera ?: return
        val zoomState = camera.cameraInfo.zoomState.value ?: return
        currentZoomRatio = currentZoomRatio.coerceIn(
            zoomState.minZoomRatio,
            zoomState.maxZoomRatio
        )
        camera.cameraControl.setZoomRatio(currentZoomRatio)
    }

    private fun resetAeTracking() {
        latestAeIso = null
        latestAeState = null
        latestAeExposureTimeNs = null
        aeStableCount = 0
    }

    private fun isAeStable(aeState: Int?): Boolean {
        return aeState == CaptureResult.CONTROL_AE_STATE_CONVERGED ||
            aeState == CaptureResult.CONTROL_AE_STATE_LOCKED
    }

    private suspend fun takePicture(): Bitmap = suspendCancellableCoroutine { continuation ->
        val capture = imageCapture
        val executor = cameraExecutor
        if (capture == null || executor == null) {
            continuation.resumeWithException(IllegalStateException("相机尚未就绪"))
            return@suspendCancellableCoroutine
        }

        _cameraState.value = CameraState.Capturing(
            zoomRatio = currentZoomRatio,
            isStrictExposureLocked = strictExposureLocked,
            isDevelopmentExposureFallback = !strictExposureLocked,
            lockedIso = lockedIsoForRound,
            lockPhase = lockPhase,
            statusMessage = when (lockPhase) {
                CameraLockPhase.METERING -> "固定 1/100s，正在测光推断 ISO"
                CameraLockPhase.LOCKED -> "使用固定 1/100s + ISO ${lockedIsoForRound ?: "-"} 拍摄"
                CameraLockPhase.FALLBACK -> "开发降级模式：${
                    lockReason ?: "未能锁定ISO"
                }"

                CameraLockPhase.IDLE -> "相机拍摄中"
            }
        )

        capture.takePicture(
            executor,
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val bitmap = imageProxyToBitmap(image)
                        image.close()
                        continuation.resume(bitmap)
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
        val strict = strictExposureLocked && lockedIsoForRound != null
        val isoSource = if (strict) {
            IsoSource.AE_MEASURED
        } else {
            IsoSource.FALLBACK
        }
        val statusMessage = if (strict) {
            "参数锁定：1/100s，ISO ${lockedIsoForRound}, zoom ${formatZoom(currentZoomRatio)}x"
        } else {
            "开发降级模式：${
                lockReason ?: "未严格锁定1/100+ISO"
            }，zoom ${formatZoom(currentZoomRatio)}x"
        }
        return RoundCameraConfig(
            width = bitmap.width,
            height = bitmap.height,
            rotationDegrees = 0,
            zoomRatio = currentZoomRatio,
            exposureTimeNs = if (strict) TARGET_EXPOSURE_TIME_NS else null,
            iso = lockedIsoForRound,
            isoSource = isoSource,
            lockReason = lockReason,
            isStrictExposureLocked = strict,
            isDevelopmentExposureFallback = !strict,
            statusMessage = statusMessage
        )
    }

    private fun readyState(
        isPreviewBound: Boolean,
        statusMessage: String
    ): CameraState.Ready {
        val strict = currentRoundConfig?.isStrictExposureLocked == true
        val fallback = currentRoundConfig?.isDevelopmentExposureFallback == true
        return CameraState.Ready(
            zoomRatio = currentZoomRatio,
            isPreviewBound = isPreviewBound,
            isStrictExposureLocked = strict,
            isDevelopmentExposureFallback = fallback,
            lockedIso = currentRoundConfig?.iso ?: lockedIsoForRound,
            lockPhase = lockPhase,
            statusMessage = statusMessage
        )
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
