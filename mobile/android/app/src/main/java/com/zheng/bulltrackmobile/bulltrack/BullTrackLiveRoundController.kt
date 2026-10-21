package com.zheng.bulltrackmobile.bulltrack

import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.zheng.bulltrack.camera.CameraLockPhase
import com.zheng.bulltrack.camera.CameraState
import com.zheng.bulltrack.camera.CameraXManager
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.NativeDartDetector
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

class BullTrackLiveRoundController(
    private val reactContext: ReactApplicationContext
) {

    private val appContext = reactContext.applicationContext
    private val detector = NativeDartDetector(appContext.assets)
    private val artifactStore = BullTrackArtifactStore(reactContext)
    private val cameraManager = CameraXManager()
    private val bridgeDispatcher: CoroutineDispatcher =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var roundJob: Job? = null
    private var currentSession: RoundSession? = null
    private var zoomRatio: Float = 1f
    private val liveFrameDir: File by lazy {
        File(reactContext.cacheDir, "BullTrackLive").apply { mkdirs() }
    }
    private var liveFrameCounter = 0L

    @Volatile
    private var detectorInitialized = false

    @Volatile
    private var stopRequested = false

    init {
        cameraManager.initialize(appContext)
        scope.launch {
            cameraManager.cameraState.collect { state ->
                when (state) {
                    CameraState.Idle -> emitCameraStatus(
                        isReady = false,
                        isPreviewBound = false,
                        zoomRatio = zoomRatio,
                        statusMessage = "原生相机未初始化",
                        lockPhase = CameraLockPhase.IDLE,
                        lockReason = null,
                    )

                    is CameraState.Ready -> emitCameraStatus(
                        isReady = true,
                        isPreviewBound = state.isPreviewBound,
                        zoomRatio = state.zoomRatio,
                        statusMessage = state.statusMessage,
                        lockPhase = state.lockPhase,
                        lockReason = null,
                    )

                    is CameraState.Capturing -> emitCameraStatus(
                        isReady = false,
                        isPreviewBound = false,
                        zoomRatio = state.zoomRatio,
                        statusMessage = state.statusMessage,
                        lockPhase = state.lockPhase,
                        lockReason = state.statusMessage,
                    )

                    is CameraState.Error -> emitCameraStatus(
                        isReady = false,
                        isPreviewBound = false,
                        zoomRatio = cameraManager.getZoomRatio(),
                        statusMessage = state.message,
                        lockPhase = CameraLockPhase.FALLBACK,
                        lockReason = state.message,
                    )
                }
            }
        }
    }

    suspend fun prepareRoundCamera(): WritableMap {
        cameraManager.initialize(appContext)
        return currentCameraReadyState("预览由 VisionCamera 管理，原生连续检测待命")
    }

    suspend fun setZoomRatio(zoomRatio: Double): WritableMap {
        this.zoomRatio = zoomRatio.toFloat()
        cameraManager.setZoomRatio(this.zoomRatio)
        return currentCameraReadyState("已更新原生 round zoom")
    }

    fun startLiveRound(debugImages: Boolean): WritableMap {
        ensureSupportedRuntime()
        ensureDetectorInitialized()
        if (roundJob?.isActive == true || currentSession != null) {
            error("A live round is already running or awaiting confirmation.")
        }
        detector.setDebugImagesEnabled(debugImages)
        artifactStore.pruneOldRounds()
        stopRequested = false
        val roundId = createRoundId()
        roundJob = scope.launch(bridgeDispatcher) {
            runCatching {
                runContinuousRound(roundId)
            }.onFailure { error ->
                cleanupCurrentSession(destroySession = true)
                releaseRoundOwnershipOnMain()
                Log.e(TAG, "Live round failed", error)
                emitNativeError("BT_LIVE_ROUND_FAILED", error.message ?: "Unknown native round error")
                emitRoundState(
                    phase = "finished",
                    roundId = roundId,
                    statusMessage = "本轮失败，已返回等待状态",
                    throws = emptyList(),
                    canRedetect = false,
                )
            }.also {
                roundJob = null
            }
        }
        return accepted("Native live round accepted.")
    }

    fun stopLiveRound(): WritableMap {
        stopRequested = true
        return accepted("Manual stop requested for current round.")
    }

    suspend fun redetectCurrentRound(roundId: String): WritableMap {
        ensureSupportedRuntime()
        ensureDetectorInitialized()
        val session = currentSession ?: error("Round session not found: $roundId")
        if (session.roundId != roundId) {
            error("Round session mismatch: $roundId")
        }

        emitRoundState(
            phase = "starting",
            roundId = roundId,
            statusMessage = "使用首帧与新拍图片重新识别",
            throws = session.throws,
            canRedetect = false,
        )

        return runCatching {
            bindNativeCaptureOnly()
            val redetectFrame = cameraManager.captureNextFrameForRound()
            val update = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.redetect(session.nativeSessionId, redetectFrame.bitmap)
                }
            }
            artifactStore.saveArtifacts(roundId, update.debugImages)
            session.consumedFrameCount += 1
            val normalized = update.throws.take(MAX_DARTS).toMutableList()
            session.throws.clear()
            session.throws.addAll(normalized)
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
                    "重新识别完成，可重检或确认结果"
                },
                throws = session.throws,
                canRedetect = true,
            )
            accepted("Redetect requested.").apply {
                putArray("debugArtifacts", artifactStore.listArtifactsArray(roundId))
            }
        }.getOrElse { error ->
            emitRoundState(
                phase = "showingResult",
                roundId = roundId,
                statusMessage = "重新识别失败，已保留当前结果",
                throws = session.throws,
                canRedetect = true,
            )
            emitNativeError("BT_REDETECT_FAILED", error.message ?: "Unknown redetect error")
            accepted("Redetect failed but session kept.")
        }.also {
            releaseRoundOwnershipOnMain()
        }
    }

    suspend fun finishRound(roundId: String): WritableMap {
        val session = currentSession ?: error("Round session not found: $roundId")
        if (session.roundId != roundId) {
            error("Round session mismatch: $roundId")
        }
        currentSession = null
        detector.destroySession(session.nativeSessionId)
        releaseRoundOwnershipOnMain()
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
        cleanupCurrentSession(destroySession = true)
        runCatching { cameraManager.release() }
        runCatching {
            if (detectorInitialized) {
                detector.release()
            }
        }
    }

    private suspend fun runContinuousRound(roundId: String) {
        emitRoundState(
            phase = "starting",
            roundId = roundId,
            statusMessage = "原生相机接管中，准备拍摄首帧",
            throws = emptyList(),
            canRedetect = false,
        )

        bindNativeCaptureOnly()
        clearLiveFrames()
        // Building the board from the empty-board frame sometimes fails on one frame and works on
        // the next, so retry with fresh frames before giving up instead of making the player
        // walk back to the phone.
        var sessionId = 0L
        var firstFrameCapturedNs = 0L
        var firstFrameStatus: String? = null
        for (attempt in 1..START_ROUND_ATTEMPTS) {
            val firstFrame = cameraManager.captureFirstFrameForRound()
            firstFrameCapturedNs = SystemClock.elapsedRealtimeNanos()
            firstFrameStatus = firstFrame.cameraConfig?.statusMessage
            publishLiveFrame(roundId, firstFrame.bitmap)
            val attemptSessionId = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.createSession()
                }
            }

            val startUpdate = runCatching {
                withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                    withContext(Dispatchers.Default) {
                        detector.startRound(attemptSessionId, firstFrame.bitmap)
                    }
                }
            }.getOrElse { error ->
                detector.destroySession(attemptSessionId)
                Log.w(TAG, "Board setup attempt $attempt failed", error)
                // "No board found" arrives as an exception; timeouts and cancellation do not retry.
                if (attempt == START_ROUND_ATTEMPTS || stopRequested || error is CancellationException) {
                    throw error
                }
                null
            } ?: continue
            artifactStore.saveArtifacts(roundId, startUpdate.debugImages)
            val errorMessage = startUpdate.errorMessage
            if (errorMessage == null) {
                sessionId = attemptSessionId
                break
            }
            Log.w(TAG, "Board setup attempt $attempt failed: $errorMessage")
            detector.destroySession(attemptSessionId)
            if (attempt == START_ROUND_ATTEMPTS || stopRequested) {
                error(errorMessage)
            }
        }

        val session = RoundSession(
            roundId = roundId,
            nativeSessionId = sessionId,
            throws = mutableListOf(),
            consumedFrameCount = 1,
        )
        currentSession = session

        emitRoundState(
            phase = "capturing",
            roundId = roundId,
            statusMessage = firstFrameStatus ?: "已拍摄第 1 张图片，开始连续检测",
            throws = emptyList(),
            canRedetect = false,
        )

        var frameIndex = 2
        // Pace with our own clock taken right before each capture: the sensor timestamp is not
        // guaranteed to share the elapsedRealtime time base, and a mismatch removed all waiting.
        var lastCaptureStartNs = firstFrameCapturedNs
        var captureNextImmediately = false
        while (!stopRequested) {
            if (!captureNextImmediately) {
                waitUntilNextFrameWindow(lastCaptureStartNs)
            }
            if (stopRequested) {
                break
            }
            lastCaptureStartNs = SystemClock.elapsedRealtimeNanos()
            val frame = cameraManager.captureNextFrameForRound()
            publishLiveFrame(roundId, frame.bitmap)
            val decision = processNextFrame(frameIndex = frameIndex, frameBitmap = frame.bitmap)
            captureNextImmediately = decision.captureNextImmediately
            if (decision.shouldStop) {
                break
            }
            frameIndex += 1
        }

        finalizeRound(manualStop = stopRequested)
        stopRequested = false
        // The result is already emitted; a camera release failure must not fail the round.
        releaseRoundOwnershipOnMain()
    }

    // CameraX unbind/bind calls must run on the main thread; the round loop runs on bridgeDispatcher.
    // Always unbind (never endRoundCapture, which rebinds use cases) so the camera closes
    // and VisionCamera can take it back.
    private suspend fun releaseRoundOwnershipOnMain() {
        runCatching {
            withContext(Dispatchers.Main.immediate) {
                cameraManager.releaseRoundOwnership()
            }
        }
    }

    private suspend fun bindNativeCaptureOnly() {
        val lifecycleOwner = reactContext.currentActivity as? LifecycleOwner
            ?: error("Current activity is not available for native camera capture.")
        withContext(Dispatchers.Main.immediate) {
            cameraManager.bindCaptureOnly(lifecycleOwner)
        }
        val readyState = withTimeout(CAMERA_READY_TIMEOUT_MS) {
            cameraManager.cameraState.first { state ->
                state is CameraState.Ready || state is CameraState.Error
            }
        }
        if (readyState is CameraState.Error) {
            error(readyState.message)
        }
    }

    private suspend fun waitUntilNextFrameWindow(lastCaptureStartNs: Long) {
        val nowNs = SystemClock.elapsedRealtimeNanos()
        val elapsedNs = nowNs - lastCaptureStartNs
        if (elapsedNs < 0L) {
            return
        }
        var remainingMs = FRAME_INTERVAL_MS - (elapsedNs / NANOS_PER_MILLISECOND)
        while (!stopRequested && remainingMs > 0) {
            val stepMs = remainingMs.coerceAtMost(FRAME_WAIT_SLICE_MS)
            delay(stepMs)
            remainingMs -= stepMs
        }
    }

    private suspend fun processNextFrame(
        frameIndex: Int,
        frameBitmap: android.graphics.Bitmap,
    ): FrameLoopDecision {
        val session = currentSession ?: return FrameLoopDecision(shouldStop = true)
        session.consumedFrameCount = frameIndex

        val frameUpdate = runCatching {
            withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.processFrame(session.nativeSessionId, frameBitmap)
                }
            }
        }.getOrElse { error ->
            emitThrowsUpdated(
                roundId = session.roundId,
                throws = session.throws,
                statusMessage = "第 $frameIndex 张图片处理失败: ${error.message}",
                canRedetect = false,
            )
            return FrameLoopDecision(shouldStop = false)
        }

        artifactStore.saveArtifacts(session.roundId, frameUpdate.gateDebugImages)
        artifactStore.saveArtifacts(session.roundId, frameUpdate.preciseDebugImages)

        if (frameUpdate.gateReason != "yolo_count_not_increased") {
            // Every gate decision besides "nothing new", to trace slow or wrong confirmations.
            Log.i(TAG, "Frame $frameIndex: ${frameUpdate.gateReason}")
        }
        if (!frameUpdate.gateTriggered) {
            emitThrowsUpdated(
                roundId = session.roundId,
                throws = session.throws,
                statusMessage = "第 $frameIndex 张图片未触发精检: ${describeGateReason(frameUpdate.gateReason)}",
                canRedetect = false,
            )
            return FrameLoopDecision(
                shouldStop = false,
                captureNextImmediately = frameUpdate.gateReason == "yolo_count_increased_wait_next_frame" ||
                    frameUpdate.gateReason == "new_box_moved" ||
                    frameUpdate.gateReason.startsWith("alignment_low"),
            )
        }

        // The native gate only triggers once it confirmed new darts (usually one, two when a dart
        // was thrown before the previous one was confirmed), so every entry adds a dart. Without a
        // tip point it becomes a miss the player can correct, keeping the count in step with the
        // native session.
        frameUpdate.newThrows.forEach { newThrow ->
            if (session.throws.size < MAX_DARTS) {
                session.throws += newThrow ?: createMissThrow(session.throws.size)
            }
        }
        val statusMessage = if (frameUpdate.newThrows.all { it == null }) {
            "第 $frameIndex 张图片触发精检，但未找到镖尖，先记为脱靶: ${frameUpdate.gateReason}"
        } else {
            "第 $frameIndex 张图片识别到新飞镖，当前共 ${session.throws.size} 支"
        }
        emitThrowsUpdated(
            roundId = session.roundId,
            throws = session.throws,
            statusMessage = statusMessage,
            canRedetect = false,
        )
        return FrameLoopDecision(shouldStop = session.throws.size >= MAX_DARTS)
    }

    private fun finalizeRound(manualStop: Boolean) {
        val session = currentSession ?: return
        val finalThrows = session.throws.toMutableList()
        if (manualStop && finalThrows.size < MAX_DARTS) {
            // A dart YOLO never saw is still on the board; look for it before padding misses.
            runCatching { detector.findMissedDarts(session.nativeSessionId) }
                .onSuccess { update ->
                    artifactStore.saveArtifacts(session.roundId, update.debugImages)
                    update.throws.take(MAX_DARTS - finalThrows.size).forEach { finalThrows += it }
                }
                .onFailure { Log.w(TAG, "Missed dart scan failed", it) }
        }
        if (manualStop) {
            while (finalThrows.size < MAX_DARTS) {
                finalThrows += createMissThrow(finalThrows.size)
            }
        }
        session.throws.clear()
        session.throws.addAll(finalThrows)
        emitThrowsUpdated(
            roundId = session.roundId,
            throws = session.throws,
            statusMessage = if (manualStop) "本轮已手动结束" else "本轮检测结束",
            canRedetect = true,
        )
        emitRoundState(
            phase = "showingResult",
            roundId = session.roundId,
            statusMessage = when {
                manualStop -> "本轮已手动结束"
                finalThrows.size >= MAX_DARTS -> "已识别满 3 支飞镖，自动结束"
                else -> "本轮检测结束"
            },
            throws = finalThrows,
            canRedetect = true,
        )
    }

    // Small JPEG of a frame the round already captured, so RN can show a near-live view
    // without a second camera stream. Files rotate; only the latest few are kept.
    private fun publishLiveFrame(roundId: String, frame: Bitmap) {
        val scaled = runCatching {
            val height = frame.height * LIVE_FRAME_WIDTH / frame.width
            Bitmap.createScaledBitmap(frame, LIVE_FRAME_WIDTH, height, true)
        }.getOrNull() ?: return
        val index = liveFrameCounter++
        scope.launch(Dispatchers.IO) {
            runCatching {
                val file = File(liveFrameDir, "frame_$index.jpg")
                FileOutputStream(file).use { stream ->
                    scaled.compress(Bitmap.CompressFormat.JPEG, LIVE_FRAME_QUALITY, stream)
                }
                File(liveFrameDir, "frame_${index - LIVE_FRAMES_KEPT}.jpg").delete()
                emit(
                    EVENT_LIVE_FRAME,
                    Arguments.createMap().apply {
                        putString("roundId", roundId)
                        putString("uri", "file://${file.absolutePath}")
                    },
                )
            }
            scaled.recycle()
        }
    }

    private fun clearLiveFrames() {
        runCatching {
            liveFrameDir.listFiles()?.forEach { it.delete() }
        }
    }

    private fun cleanupCurrentSession(destroySession: Boolean) {
        currentSession?.let { session ->
            if (destroySession) {
                runCatching { detector.destroySession(session.nativeSessionId) }
            }
        }
        currentSession = null
        stopRequested = false
    }

    private fun currentCameraReadyState(statusMessage: String): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("isReady", true)
            putBoolean("isPreviewBound", false)
            putDouble("zoomRatio", zoomRatio.toDouble())
            putString("statusMessage", statusMessage)
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
            },
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
            },
        )
    }

    private fun emitNativeError(code: String, message: String) {
        emit(
            EVENT_NATIVE_ERROR,
            Arguments.createMap().apply {
                putString("code", code)
                putString("message", message)
            },
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
            },
        )
    }

    private fun emit(eventName: String, payload: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    private fun accepted(statusMessage: String): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("accepted", true)
            putString("statusMessage", statusMessage)
        }
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

    private fun createMissThrow(index: Int): ThrowResult {
        val position = when (index) {
            0 -> DartPosition(1.08f, 0f)
            1 -> DartPosition(-1.08f, 0.08f)
            else -> DartPosition(0f, -1.08f)
        }
        return ThrowResult(
            sector = 0,
            ring = RingType.MISS,
            score = 0,
            position = position,
        )
    }

    private fun describeGateReason(gateReason: String): String {
        return when {
            gateReason == "yolo_count_not_increased" -> "YOLO 飞镖数量未增加"
            gateReason == "yolo_count_increased_wait_next_frame" -> "YOLO 飞镖数量增加，等待下一张确认"
            gateReason == "yolo_count_not_stable" -> "YOLO 飞镖数量未稳定"
            gateReason == "yolo_phantom_box_ignored" -> "多出的框已确认不是新镖，忽略"
            gateReason.startsWith("yolo_count_increased_no_board_change") ->
                "YOLO 多出一个框，但靶上没有新变化，已忽略（${gateReason.substringAfter(" ", "")}）"
            gateReason.startsWith("yolo_detect_failed:") -> "YOLO 检测失败"
            gateReason.startsWith("alignment_low") -> "画面晃动或被遮挡，等下一张"
            gateReason == "new_box_moved" -> "新镖还在移动（飞行或掉落），等下一张"
            gateReason.startsWith("lost_box_") -> "YOLO 这张没认出新镖，图像对比也未确认"
            gateReason.isBlank() -> "未知原因"
            else -> gateReason
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
                },
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
                    "Use a physical Android device for JNI/C++/YOLO validation.",
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
            "google_sdk" == Build.PRODUCT ||
            // Newer Google emulator images (e.g. sdk_gphone64_x86_64 on ranchu).
            Build.PRODUCT.startsWith("sdk_gphone") ||
            Build.HARDWARE == "ranchu" ||
            Build.HARDWARE == "goldfish"
    }

    private data class FrameLoopDecision(
        val shouldStop: Boolean,
        val captureNextImmediately: Boolean = false,
    )

    private data class RoundSession(
        val roundId: String,
        val nativeSessionId: Long,
        val throws: MutableList<ThrowResult>,
        var consumedFrameCount: Int,
    )

    companion object {
        const val EVENT_ROUND_STATE_CHANGED = "onRoundStateChanged"
        const val EVENT_THROWS_UPDATED = "onThrowsUpdated"
        const val EVENT_CAMERA_STATUS_CHANGED = "onCameraStatusChanged"
        const val EVENT_NATIVE_ERROR = "onNativeError"
        const val EVENT_LIVE_FRAME = "onLiveFrame"
        private const val LIVE_FRAME_WIDTH = 360
        private const val LIVE_FRAME_QUALITY = 70
        private const val LIVE_FRAMES_KEPT = 3
        private const val MAX_DARTS = 3
        private const val NATIVE_CALL_TIMEOUT_MS = 12_000L
        private const val CAMERA_READY_TIMEOUT_MS = 4_000L
        private const val FRAME_INTERVAL_MS = 333L
        private const val START_ROUND_ATTEMPTS = 3
        private const val TAG = "BullTrackRound"
        private const val FRAME_WAIT_SLICE_MS = 50L
        private const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
