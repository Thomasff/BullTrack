package com.zheng.bulltrackmobile.bulltrack

import android.os.Build
import androidx.camera.view.PreviewView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ThemedReactContext
import com.zheng.bulltrack.camera.CameraLockPhase
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.NativeDartDetector
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.Executors

class BullTrackLiveRoundController(
    private val reactContext: ReactApplicationContext
) {

    private val appContext = reactContext.applicationContext
    private val detector = NativeDartDetector(appContext.assets)
    private val imageLoader = BullTrackImageLoader(appContext)
    private val artifactStore = BullTrackArtifactStore(reactContext)
    private val bridgeDispatcher: CoroutineDispatcher =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val sessions = LinkedHashMap<String, RoundSession>()
    private var roundJob: Job? = null
    private var zoomRatio: Float = 1f
    @Volatile
    private var detectorInitialized = false

    suspend fun prepareRoundCamera(): WritableMap {
        return currentCameraReadyState()
    }

    suspend fun setZoomRatio(zoomRatio: Double): WritableMap {
        this.zoomRatio = zoomRatio.toFloat()
        return currentCameraReadyState()
    }

    fun attachPreview(view: PreviewView, themedContext: ThemedReactContext) {
        BullTrackPreviewDiagnostics.controllerAttachPreviewCount += 1
        BullTrackPreviewDiagnostics.mark("controller.attachPreview.legacyNoop")
        emitCameraStatus(
            isReady = false,
            isPreviewBound = false,
            zoomRatio = zoomRatio,
            statusMessage = "预览已切换到 VisionCamera，原生 Preview 宿主已停用",
            lockPhase = CameraLockPhase.IDLE,
            lockReason = "Legacy PreviewView host disabled",
        )
    }

    fun detachPreview(view: PreviewView? = null) = Unit

    fun markPreviewUnavailable(statusMessage: String, lockReason: String? = null) {
        emitCameraStatus(
            isReady = false,
            isPreviewBound = false,
            zoomRatio = zoomRatio,
            statusMessage = statusMessage,
            lockPhase = CameraLockPhase.IDLE,
            lockReason = lockReason,
        )
    }

    fun startLiveRound(imagePath: String): WritableMap {
        ensureSupportedRuntime()
        ensureDetectorInitialized()
        if (roundJob?.isActive == true || sessions.isNotEmpty()) {
            error("A live round is already running.")
        }
        val roundId = createRoundId()
        roundJob = scope.launch(bridgeDispatcher) {
            runCatching {
                runSingleImageRound(roundId, imagePath)
            }.onFailure { error ->
                cleanupRound(roundId, destroySession = true)
                emitNativeError("BT_LIVE_ROUND_FAILED", error.message ?: "Unknown native round error")
                emitRoundState(
                    phase = "finished",
                    roundId = roundId,
                    statusMessage = "本轮失败，已返回等待状态",
                    throws = emptyList(),
                    canRedetect = false,
                )
            }
        }
        return Arguments.createMap().apply {
            putBoolean("accepted", true)
            putString("statusMessage", "Single-photo round accepted.")
        }
    }

    fun stopLiveRound(): WritableMap {
        roundJob?.cancel()
        roundJob = null
        return Arguments.createMap().apply {
            putBoolean("accepted", true)
            putString("statusMessage", "Stop requested for current round.")
        }
    }

    suspend fun redetectCurrentRound(roundId: String, imagePath: String): WritableMap {
        ensureSupportedRuntime()
        ensureDetectorInitialized()
        val session = sessions[roundId] ?: error("Round session not found: $roundId")
        val bitmap = withContext(Dispatchers.IO) {
            imageLoader.loadBitmap(imagePath)
        }
        val update = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
            withContext(Dispatchers.Default) {
                detector.redetect(session.nativeSessionId, bitmap)
            }
        }
        session.throws.clear()
        session.throws += update.throws.take(MAX_DARTS)
        session.lastImagePath = imagePath
        val artifacts = artifactStore.saveArtifacts(roundId, update.debugImages)
        emitThrowsUpdated(
            roundId = roundId,
            throws = session.throws,
            statusMessage = buildRedetectStatusMessage(session.throws, update.yoloStatus),
            canRedetect = true,
        )
        emitRoundState(
            phase = "showingResult",
            roundId = roundId,
            statusMessage = if (session.throws.isEmpty()) {
                "重新识别失败，未识别到有效飞镖"
            } else {
                "重新识别完成"
            },
            throws = session.throws,
            canRedetect = true,
        )
        return Arguments.createMap().apply {
            putBoolean("accepted", true)
            putString("statusMessage", "Redetect requested.")
            putArray("debugArtifacts", artifacts.toWritableArray())
        }
    }

    suspend fun finishRound(roundId: String): WritableMap {
        val session = sessions.remove(roundId) ?: error("Round session not found: $roundId")
        detector.destroySession(session.nativeSessionId)
        val artifacts = artifactStore.listArtifacts(roundId)
        emitRoundState(
            phase = "finished",
            roundId = roundId,
            statusMessage = "本轮已确认，可开始下一轮",
            throws = session.throws,
            canRedetect = false,
        )
        return Arguments.createMap().apply {
            putString("roundId", roundId)
            putString("status", "finished")
            putString("statusMessage", "Native round finished.")
            putArray("throws", session.throws.toWritableThrows(roundId))
            putArray("debugArtifacts", artifacts.toWritableArray())
        }
    }

    fun loadDebugArtifacts(roundId: String): WritableArray {
        return artifactStore.listArtifactsArray(roundId)
    }

    fun invalidate() {
        roundJob?.cancel()
        sessions.values.forEach { session ->
            runCatching { detector.destroySession(session.nativeSessionId) }
        }
        sessions.clear()
        runCatching {
            if (detectorInitialized) {
                detector.release()
            }
        }
    }

    private suspend fun runSingleImageRound(roundId: String, imagePath: String) {
        emitRoundState(
            phase = "starting",
            roundId = roundId,
            statusMessage = "准备处理拍摄图片",
            throws = emptyList(),
            canRedetect = false,
        )

        val bitmap = withContext(Dispatchers.IO) {
            imageLoader.loadBitmap(imagePath)
        }
        val sessionId = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
            withContext(Dispatchers.Default) {
                detector.createSession()
            }
        }

        val startUpdate = runCatching {
            withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.startRound(sessionId, bitmap)
                }
            }
        }.getOrElse { error ->
            detector.destroySession(sessionId)
            throw error
        }
        artifactStore.saveArtifacts(roundId, startUpdate.debugImages)
        startUpdate.errorMessage?.let { errorMessage ->
            detector.destroySession(sessionId)
            error(errorMessage)
        }

        val session = RoundSession(
            roundId = roundId,
            nativeSessionId = sessionId,
            throws = mutableListOf(),
            lastImagePath = imagePath,
        )
        sessions[roundId] = session

        emitRoundState(
            phase = "capturing",
            roundId = roundId,
            statusMessage = "首张图片已拍摄，正在识别飞镖",
            throws = emptyList(),
            canRedetect = false,
        )

        val redetectUpdate = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
            withContext(Dispatchers.Default) {
                detector.redetect(session.nativeSessionId, bitmap)
            }
        }
        artifactStore.saveArtifacts(roundId, redetectUpdate.debugImages)
        session.throws += redetectUpdate.throws.take(MAX_DARTS)

        emitThrowsUpdated(
            roundId = roundId,
            throws = session.throws,
            statusMessage = buildRedetectStatusMessage(session.throws, redetectUpdate.yoloStatus),
            canRedetect = true,
        )
        emitRoundState(
            phase = "showingResult",
            roundId = roundId,
            statusMessage = if (session.throws.isEmpty()) {
                "识别失败，未识别到有效飞镖，可重新识别"
            } else {
                "识别完成，可重检或确认结果"
            },
            throws = session.throws,
            canRedetect = true,
        )
        roundJob = null
    }

    private suspend fun cleanupRound(
        roundId: String,
        destroySession: Boolean,
    ) {
        sessions.remove(roundId)?.let { session ->
            if (destroySession) {
                runCatching { detector.destroySession(session.nativeSessionId) }
            }
        }
        roundJob = null
    }

    private fun currentCameraReadyState(): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("isReady", false)
            putBoolean("isPreviewBound", false)
            putDouble("zoomRatio", zoomRatio.toDouble())
            putString("statusMessage", "预览由 VisionCamera 管理，原生检测待命")
            putString("lockPhase", CameraLockPhase.IDLE.name)
            putString("lockReason", null)
        }
    }

    private fun emitRoundState(
        phase: String,
        roundId: String,
        statusMessage: String,
        throws: List<ThrowResult>,
        canRedetect: Boolean,
    ) {
        emit(
            EVENT_ROUND_STATE_CHANGED,
            Arguments.createMap().apply {
                putString("phase", phase)
                putString("roundId", roundId)
                putString("statusMessage", statusMessage)
                putArray("throws", throws.toWritableThrows(roundId))
                putBoolean("canRedetect", canRedetect)
            }
        )
    }

    private fun emitThrowsUpdated(
        roundId: String,
        throws: List<ThrowResult>,
        statusMessage: String,
        canRedetect: Boolean,
    ) {
        emit(
            EVENT_THROWS_UPDATED,
            Arguments.createMap().apply {
                putString("roundId", roundId)
                putString("statusMessage", statusMessage)
                putArray("throws", throws.toWritableThrows(roundId))
                putBoolean("canRedetect", canRedetect)
            }
        )
    }

    private fun emitNativeError(code: String, message: String) {
        emit(
            EVENT_NATIVE_ERROR,
            Arguments.createMap().apply {
                putString("code", code)
                putString("message", message)
            }
        )
    }

    private fun emitCameraStatus(
        isReady: Boolean,
        isPreviewBound: Boolean,
        zoomRatio: Float,
        statusMessage: String,
        lockPhase: CameraLockPhase,
        lockReason: String?,
    ) {
        emit(
            EVENT_CAMERA_STATUS_CHANGED,
            Arguments.createMap().apply {
                putBoolean("isReady", isReady)
                putBoolean("isPreviewBound", isPreviewBound)
                putDouble("zoomRatio", zoomRatio.toDouble())
                putString("statusMessage", statusMessage)
                putString("lockPhase", lockPhase.name)
                putString("lockReason", lockReason)
            }
        )
    }

    private fun emit(eventName: String, payload: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    private fun buildRedetectStatusMessage(
        throws: List<ThrowResult>,
        yoloStatus: String?,
    ): String {
        val baseMessage = if (throws.isEmpty()) {
            "未识别到有效飞镖"
        } else {
            "识别到 ${throws.size} 支飞镖"
        }
        return if (yoloStatus.isNullOrBlank()) {
            baseMessage
        } else {
            "$baseMessage（YOLO: $yoloStatus）"
        }
    }

    private fun List<ThrowResult>.toWritableThrows(roundId: String): WritableArray {
        val array = Arguments.createArray()
        forEachIndexed { index, throwResult ->
            array.pushMap(
                Arguments.createMap().apply {
                    val point = throwResult.position ?: DartPosition(0f, 0f)
                    putString("id", "$roundId:$index")
                    putString("label", buildThrowLabel(throwResult))
                    putInt("score", throwResult.score)
                    putString("ring", toRingName(throwResult.ring))
                    putMap(
                        "pointNorm",
                        Arguments.createMap().apply {
                            putDouble("x", point.x.toDouble())
                            putDouble("y", point.y.toDouble())
                        },
                    )
                }
            )
        }
        return array
    }

    private fun List<WritableMap>.toWritableArray(): WritableArray {
        val array = Arguments.createArray()
        forEach(array::pushMap)
        return array
    }

    private fun buildThrowLabel(throwResult: ThrowResult): String {
        return when (throwResult.ring) {
            RingType.DOUBLE -> "D${throwResult.sector}"
            RingType.TRIPLE -> "T${throwResult.sector}"
            RingType.OUTER_BULL -> "OB"
            RingType.INNER_BULL -> "IB"
            RingType.MISS -> "MISS"
            RingType.OUTER_SINGLE, RingType.INNER_SINGLE -> "S${throwResult.sector}"
        }
    }

    private fun toRingName(ringType: RingType): String {
        return when (ringType) {
            RingType.DOUBLE -> "double"
            RingType.TRIPLE -> "triple"
            RingType.OUTER_BULL -> "outerBull"
            RingType.INNER_BULL -> "innerBull"
            RingType.MISS -> "miss"
            RingType.OUTER_SINGLE, RingType.INNER_SINGLE -> "single"
        }
    }

    private fun createRoundId(): String = "rn-live-${UUID.randomUUID()}"

    private fun ensureDetectorInitialized() {
        if (detectorInitialized) {
            return
        }
        synchronized(detector) {
            if (!detectorInitialized) {
                detector.init()
                detectorInitialized = true
            }
        }
    }

    private fun ensureSupportedRuntime() {
        if (isProbablyEmulator()) {
            error(
                "Real BullTrack native detection is disabled on Android emulators. " +
                    "Use a physical Android device for JNI/C++/YOLO validation."
            )
        }
    }

    private fun isProbablyEmulator(): Boolean {
        return Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.lowercase().contains("emulator") ||
            Build.MODEL.contains("Emulator") ||
            Build.MODEL.contains("Android SDK built for") ||
            Build.MANUFACTURER.contains("Genymotion") ||
            Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic") ||
            "google_sdk" == Build.PRODUCT
    }

    private data class RoundSession(
        val roundId: String,
        val nativeSessionId: Long,
        val throws: MutableList<ThrowResult>,
        var lastImagePath: String,
    )

    companion object {
        const val EVENT_ROUND_STATE_CHANGED = "onRoundStateChanged"
        const val EVENT_THROWS_UPDATED = "onThrowsUpdated"
        const val EVENT_CAMERA_STATUS_CHANGED = "onCameraStatusChanged"
        const val EVENT_NATIVE_ERROR = "onNativeError"
        private const val MAX_DARTS = 3
        private const val NATIVE_CALL_TIMEOUT_MS = 12_000L
    }
}
