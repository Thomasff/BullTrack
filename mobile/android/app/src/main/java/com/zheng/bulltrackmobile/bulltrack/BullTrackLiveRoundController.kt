package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Matrix
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.zheng.bulltrack.camera.CameraLockPhase
import com.zheng.bulltrack.camera.CameraState
import com.zheng.bulltrack.camera.CameraXManager
import com.zheng.bulltrack.camera.CapturedFrame
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.NativeDartDetector
import com.zheng.bulltrack.vision.StartRoundDetectionUpdate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs

class BullTrackLiveRoundController(
    private val reactContext: ReactApplicationContext
) {

    private val appContext = reactContext.applicationContext
    private val detector = NativeDartDetector(appContext.assets)
    private val artifactStore = BullTrackArtifactStore(reactContext)
    private val frameRecorder = BullTrackFrameRecorder(reactContext)
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
    // Debug images of the current round also get its log lines saved next to them.
    private var roundDebugImages = false
    private var roundYoloOnCpu = false
    private var roundStartedAtMs = 0L

    @Volatile
    private var detectorInitialized = false

    @Volatile
    private var stopRequested = false

    @Volatile
    private var warmUpStarted = false

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
        warmUpDetector()
        return currentCameraReadyState("原生相机负责预览与连续检测").apply {
            putBackCameraInfo(this)
        }
    }

    // What the Game screen needs before the preview opens: whether there is a back camera, and its
    // zoom limit. CameraX's default back camera is the first one listed facing back.
    private fun putBackCameraInfo(map: WritableMap) {
        val systemCameras = appContext.getSystemService(CameraManager::class.java)
        val characteristics = runCatching {
            systemCameras.cameraIdList.asSequence()
                .map(systemCameras::getCameraCharacteristics)
                .firstOrNull {
                    it.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
                }
        }.onFailure { Log.w(TAG, "Back camera lookup failed", it) }.getOrNull()
        val zoomRange = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            characteristics?.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.upper
        } else {
            null
        }
        val maxZoomRatio = zoomRange
            ?: characteristics?.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)
            ?: 1f
        map.putBoolean("hasBackCamera", characteristics != null)
        map.putDouble("maxZoomRatio", maxZoomRatio.toDouble())
    }

    // Loads the model and builds its GPU programs once per process while the player is still
    // aiming, so the first round does not wait for them. The model then stays loaded until the
    // process ends; a round started before this finishes simply waits for it inside the detector.
    private fun warmUpDetector() {
        if (warmUpStarted || isProbablyEmulator()) {
            return
        }
        warmUpStarted = true
        scope.launch(Dispatchers.Default) {
            val startNs = SystemClock.elapsedRealtimeNanos()
            runCatching {
                ensureDetectorInitialized()
                detector.warmUp()
            }.onFailure { Log.w(TAG, "Detector warm-up failed", it) }
            Log.i(TAG, "Detector warm-up took ${elapsedMs(startNs)} ms")
        }
    }

    suspend fun setZoomRatio(zoomRatio: Double): WritableMap {
        this.zoomRatio = zoomRatio.toFloat()
        cameraManager.setZoomRatio(this.zoomRatio)
        return currentCameraReadyState("已更新原生 round zoom")
    }

    // Live zoom from the preview's slider; applied to the preview, and kept for the next round.
    fun setPreviewZoomRatio(zoomRatio: Float) {
        this.zoomRatio = zoomRatio
        cameraManager.setZoomRatio(zoomRatio)
    }

    // The idle preview goes through the same CameraXManager as the round, so one owner holds the
    // camera. Called on the main thread by BullTrackPreviewView.
    fun attachPreview(previewView: PreviewView) {
        val lifecycleOwner = reactContext.currentActivity as? LifecycleOwner
        if (lifecycleOwner == null) {
            Log.w(TAG, "Preview not bound: no current activity")
            return
        }
        cameraManager.bindPreview(lifecycleOwner, previewView)
    }

    fun detachPreview(previewView: PreviewView) {
        cameraManager.detachPreview(previewView)
    }

    // Where the board is before a round, for RN's auto zoom and aiming arrow: a still of the whole
    // frame (the preview shows only its middle) through the model. "available" is false while a
    // round holds the camera; "found" false when no board was seen. Coordinates are frame pixels.
    suspend fun detectPrepBoard(yoloOnCpu: Boolean): WritableMap {
        val result = Arguments.createMap()
        if (isProbablyEmulator() || roundJob?.isActive == true || currentSession != null) {
            result.putBoolean("available", false)
            return result
        }
        ensureDetectorInitialized()
        val startNs = SystemClock.elapsedRealtimeNanos()
        val zoomAtCapture = cameraManager.getZoomRatio()
        val frame = withContext(Dispatchers.Main.immediate) { cameraManager.capturePrepFrame() }
        if (frame == null) {
            result.putBoolean("available", false)
            return result
        }
        val captureMs = elapsedMs(startNs)
        val guide = try {
            withContext(Dispatchers.Default) {
                detector.setYoloForceCpu(yoloOnCpu)
                detector.detectPrepBoard(frame.bitmap, frame.rotationDegrees)
            }
        } finally {
            frame.bitmap.recycle()
        }
        val box = guide.boardBox
        Log.d(
            TAG,
            "Prep board guide: capture $captureMs ms, total ${elapsedMs(startNs)} ms, " +
                "zoom ${"%.2f".format(zoomAtCapture)}, board ${box ?: "none"}"
        )
        result.putBoolean("available", true)
        result.putBoolean("found", box != null)
        result.putDouble("zoomRatio", zoomAtCapture.toDouble())
        result.putInt("frameWidth", guide.frameWidth)
        result.putInt("frameHeight", guide.frameHeight)
        result.putInt("bandTop", guide.bandTop)
        result.putInt("bandHeight", guide.bandHeight)
        if (box != null) {
            result.putInt("boardLeft", box.left)
            result.putInt("boardTop", box.top)
            result.putInt("boardWidth", box.width())
            result.putInt("boardHeight", box.height())
        }
        return result
    }

    fun startLiveRound(debugImages: Boolean, recordFrames: Boolean, yoloOnCpu: Boolean): WritableMap {
        val requestedNs = SystemClock.elapsedRealtimeNanos()
        ensureSupportedRuntime()
        ensureDetectorInitialized()
        if (roundJob?.isActive == true || currentSession != null) {
            error("A live round is already running or awaiting confirmation.")
        }
        detector.setDebugImagesEnabled(debugImages)
        detector.setYoloForceCpu(yoloOnCpu)
        roundYoloOnCpu = yoloOnCpu
        artifactStore.pruneOldRounds()
        roundDebugImages = debugImages
        roundStartedAtMs = System.currentTimeMillis()
        stopRequested = false
        val roundId = createRoundId()
        if (recordFrames) {
            frameRecorder.startRound(roundId)
        } else {
            frameRecorder.stop()
        }
        roundJob = scope.launch(bridgeDispatcher) {
            runCatching {
                runContinuousRound(roundId, requestedNs)
            }.onFailure { error ->
                cleanupCurrentSession(destroySession = true)
                releaseRoundOwnershipOnMain()
                Log.e(TAG, "Live round failed", error)
                frameRecorder.recordFailure(error.message ?: "unknown")
                saveRoundLog(roundId)
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
            frameRecorder.recordRedetectFrame(
                session.consumedFrameCount + 1,
                redetectFrame.bitmap,
                redetectFrame.rotationDegrees,
            )
            val update = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.redetect(session.nativeSessionId, redetectFrame.bitmap, redetectFrame.rotationDegrees)
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

    // confirmed is false when RN only releases the round; editedThrows is set when the player
    // corrected the darts.
    suspend fun finishRound(roundId: String, confirmed: Boolean, editedThrows: JSONArray?): WritableMap {
        val session = currentSession ?: error("Round session not found: $roundId")
        if (session.roundId != roundId) {
            error("Round session mismatch: $roundId")
        }
        if (confirmed && frameRecorder.isRecording(roundId)) {
            frameRecorder.recordResult(
                detected = JSONArray(session.throws.toWritableThrows(roundId).toArrayList()),
                edited = editedThrows,
            )
        }
        currentSession = null
        detector.destroySession(session.nativeSessionId)
        releaseRoundOwnershipOnMain()
        saveRoundLog(roundId)
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

    fun listDebugRounds(): WritableArray = artifactStore.listRoundsArray()

    fun exportDebugRound(roundId: String): File {
        // A round still awaiting confirmation has no saved log yet.
        if (roundId == currentSession?.roundId) {
            artifactStore.saveRoundLog(roundId, roundStartedAtMs)
        }
        return artifactStore.exportRound(roundId)
    }

    private fun saveRoundLog(roundId: String) {
        if (!roundDebugImages) {
            return
        }
        val startedAtMs = roundStartedAtMs
        scope.launch(Dispatchers.IO) {
            artifactStore.saveRoundLog(roundId, startedAtMs)
        }
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

    private suspend fun runContinuousRound(roundId: String, requestedNs: Long) {
        emitRoundState(
            phase = "starting",
            roundId = roundId,
            statusMessage = "原生相机接管中，准备拍摄首帧",
            throws = emptyList(),
            canRedetect = false,
        )

        var stepStartNs = SystemClock.elapsedRealtimeNanos()
        bindNativeCaptureOnly()
        val bindMs = elapsedMs(stepStartNs)
        // Per board-setup attempt: first frame (metering and capture) and board setup times.
        val attemptTimings = mutableListOf<String>()
        clearLiveFrames()
        // Building the board from the empty-board frame sometimes fails on one frame and works on
        // the next, so retry with fresh frames before giving up instead of making the player
        // walk back to the phone.
        var sessionId = 0L
        var firstFrameCapturedNs = 0L
        var firstFrameStatus: String? = null
        var boardSetup: StartRoundDetectionUpdate? = null
        for (attempt in 1..START_ROUND_ATTEMPTS) {
            stepStartNs = SystemClock.elapsedRealtimeNanos()
            val firstFrame = cameraManager.captureFirstFrameForRound()
            firstFrameCapturedNs = SystemClock.elapsedRealtimeNanos()
            val firstFrameMs = elapsedMs(stepStartNs)
            firstFrameStatus = firstFrame.cameraConfig?.statusMessage
            publishLiveFrame(roundId, firstFrame.bitmap, firstFrame.rotationDegrees)
            val attemptSessionId = withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.createSession()
                }
            }

            stepStartNs = SystemClock.elapsedRealtimeNanos()
            val startUpdate = runCatching {
                withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                    withContext(Dispatchers.Default) {
                        detector.startRound(attemptSessionId, firstFrame.bitmap, firstFrame.rotationDegrees)
                    }
                }
            }.also {
                attemptTimings += "first frame $firstFrameMs ms + board setup ${elapsedMs(stepStartNs)} ms"
            }.getOrElse { error ->
                frameRecorder.recordStartFrame(
                    attempt,
                    firstFrame.bitmap,
                    firstFrame.rotationDegrees,
                    "board setup failed: ${error.message}",
                )
                detector.destroySession(attemptSessionId)
                Log.w(TAG, "Board setup attempt $attempt failed", error)
                // "No board found" arrives as an exception; timeouts and cancellation do not retry.
                if (attempt == START_ROUND_ATTEMPTS || stopRequested || error is CancellationException) {
                    logStartTiming(requestedNs, bindMs, attemptTimings, "failed")
                    throw error
                }
                null
            } ?: continue
            artifactStore.saveArtifacts(roundId, startUpdate.debugImages)
            val errorMessage = startUpdate.errorMessage
            frameRecorder.recordStartFrame(
                attempt,
                firstFrame.bitmap,
                firstFrame.rotationDegrees,
                errorMessage ?: "board setup ok model_square_top=${startUpdate.modelSquareTop}",
            )
            if (errorMessage == null) {
                sessionId = attemptSessionId
                boardSetup = startUpdate
                break
            }
            Log.w(TAG, "Board setup attempt $attempt failed: $errorMessage")
            detector.destroySession(attemptSessionId)
            if (attempt == START_ROUND_ATTEMPTS || stopRequested) {
                logStartTiming(requestedNs, bindMs, attemptTimings, "failed")
                error(errorMessage)
            }
        }
        logStartTiming(requestedNs, bindMs, attemptTimings, "ok")

        // From the right, dart tails stick out to the left of the board where the search area has
        // no room and darts get lost, so such a round is not started at all. The board setup still
        // ran, so the player gets the same quick failure as when no board is found.
        val sideRatio = boardSetup?.leftRightHalfRatio ?: 0f
        if (sideRatio > 0f && sideRatio < RIGHT_SIDE_MAX_RATIO) {
            detector.destroySession(sessionId)
            Log.w(TAG, "Round refused: phone right of the board (left/right half ratio $sideRatio)")
            error(PHONE_RIGHT_OF_BOARD_ERROR)
        }
        // The model sees only a square of the frame (centred on the board up and down) and was
        // trained on boards taking 0.55-0.9 of its height, so a board outside that range or still
        // running into the square's edge is not started either. Just above the lower limit RN
        // only shows a hint.
        val boardShare = boardSetup?.boardHeightShare ?: 0f
        val boardRefusal = when {
            boardSetup == null || boardShare <= 0f -> null
            boardShare > BOARD_SHARE_MAX -> BOARD_TOO_LARGE_ERROR
            boardSetup?.boardInSquare == false -> BOARD_OFF_CENTRE_ERROR
            boardShare < BOARD_SHARE_MIN -> BOARD_TOO_SMALL_ERROR
            else -> null
        }
        if (boardRefusal != null) {
            detector.destroySession(sessionId)
            Log.w(TAG, "Round refused: $boardRefusal (board height share $boardShare, in square ${boardSetup?.boardInSquare})")
            error(boardRefusal)
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
            boardSetup = boardSetup,
        )

        var frameIndex = 2
        var loggedExposure = cameraManager.describeExposure()
        Log.i(TAG, "Round camera: $loggedExposure")
        val frameTimings = FrameTimings()
        // The next still is taken while the current one is detected, so the camera (about 0.5 s a
        // still) and the detector work at the same time instead of in turn. A still left in
        // flight when the loop ends is dropped; coroutineScope waits for it after the result is
        // out, so the camera is not released under a running capture.
        coroutineScope {
            // With debug info on, the battery is read once a second to compare power use (YOLO on
            // the CPU or the GPU, say); only the app can read the current, adb cannot.
            val batteryMeter = if (roundDebugImages) BatteryMeter(appContext) else null
            val batteryJob = batteryMeter?.let { meter ->
                launch(Dispatchers.Default) {
                    while (true) {
                        meter.sample()
                        delay(BATTERY_SAMPLE_INTERVAL_MS)
                    }
                }
            }
            var nextCapture = startFrameCapture(this, firstFrameCapturedNs)
            while (!stopRequested) {
                val captured = nextCapture.await()?.getOrThrow() ?: break
                val frame = captured.frame
                nextCapture = startFrameCapture(this, captured.startNs)
                publishLiveFrame(roundId, frame.bitmap, frame.rotationDegrees)
                // Exposure is locked for the round; a change here means the lock did not hold.
                val exposure = cameraManager.describeExposure()
                if (exposure != loggedExposure) {
                    Log.i(TAG, "Frame $frameIndex camera: $exposure")
                    loggedExposure = exposure
                }
                stepStartNs = SystemClock.elapsedRealtimeNanos()
                val decision = processNextFrame(
                    frameIndex = frameIndex,
                    frameBitmap = frame.bitmap,
                    rotationDegrees = frame.rotationDegrees,
                )
                frameTimings.add(captured.startNs, captured.captureMs, frame.decodeMs, elapsedMs(stepStartNs))
                frameRecorder.recordFrame(
                    frameIndex,
                    frame.bitmap,
                    frame.rotationDegrees,
                    captured.startNs,
                    decision.gateReason,
                )
                if (decision.shouldStop) {
                    break
                }
                frameIndex += 1
            }
            Log.i(TAG, "Round frame timing: $frameTimings")
            batteryJob?.cancel()
            batteryMeter?.let { Log.i(TAG, "Round battery (YOLO on ${if (roundYoloOnCpu) "CPU" else "GPU"}): $it") }

            frameRecorder.finishCapture()
            finalizeRound(manualStop = stopRequested)
        }
        stopRequested = false
        // The result is already emitted; a camera release failure must not fail the round.
        releaseRoundOwnershipOnMain()
    }

    // CameraX unbind/bind calls must run on the main thread; the round loop runs on bridgeDispatcher.
    // Always unbind (never endRoundCapture, which rebinds use cases) so the camera closes
    // and the preview can take it back.
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
            cameraManager.bindCaptureForRound(lifecycleOwner)
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

    // Takes the next still once the frame window since the previous one has passed, timed with our
    // own clock: the sensor timestamp is not guaranteed to share the elapsedRealtime time base, and
    // a mismatch removed all waiting. A failure comes back as a Result, so a still dropped at the
    // end of the loop cannot fail the round; null when a stop came during the wait.
    private fun startFrameCapture(
        scope: CoroutineScope,
        previousStartNs: Long,
    ): Deferred<Result<RoundCapture>?> = scope.async {
        waitUntilNextFrameWindow(previousStartNs)
        if (stopRequested) {
            return@async null
        }
        val startNs = SystemClock.elapsedRealtimeNanos()
        runCatching {
            val frame = cameraManager.captureNextFrameForRound()
            RoundCapture(frame, startNs, elapsedMs(startNs))
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
        rotationDegrees: Int,
    ): FrameLoopDecision {
        val session = currentSession ?: return FrameLoopDecision(shouldStop = true)
        session.consumedFrameCount = frameIndex

        val frameUpdate = runCatching {
            withTimeout(NATIVE_CALL_TIMEOUT_MS) {
                withContext(Dispatchers.Default) {
                    detector.processFrame(session.nativeSessionId, frameBitmap, rotationDegrees)
                }
            }
        }.getOrElse { error ->
            emitThrowsUpdated(
                roundId = session.roundId,
                throws = session.throws,
                statusMessage = "第 $frameIndex 张图片处理失败: ${error.message}",
                canRedetect = false,
            )
            return FrameLoopDecision(shouldStop = false, gateReason = "process_failed: ${error.message}")
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
                gateReason = frameUpdate.gateReason,
            )
        }

        // The native gate only triggers once it confirmed new darts (usually one, two when a dart
        // was thrown before the previous one was confirmed), so every entry adds a dart. Without a
        // tip point it becomes a miss the player can correct, keeping the count in step with the
        // native session.
        frameUpdate.newThrows.forEach { newThrow ->
            if (session.throws.size < MAX_DARTS) {
                // A confirmed dart without a tip point is a guess; flag it for the player.
                session.throws += newThrow ?: createMissThrow(session.throws.size).copy(needsCheck = true)
                if (session.throws.last().needsCheck) {
                    Log.i(TAG, "Frame $frameIndex: dart ${session.throws.size} flagged for checking")
                }
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
        return FrameLoopDecision(
            shouldStop = session.throws.size >= MAX_DARTS,
            gateReason = frameUpdate.gateReason,
        )
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
    // The frame may still need its clockwise turn; scaling and turning happen in one small copy.
    private fun publishLiveFrame(roundId: String, frame: Bitmap, rotationDegrees: Int) {
        val scaled = runCatching {
            val quarterTurn = rotationDegrees == 90 || rotationDegrees == 270
            val uprightWidth = if (quarterTurn) frame.height else frame.width
            val scale = LIVE_FRAME_WIDTH.toFloat() / uprightWidth
            val matrix = Matrix().apply {
                postScale(scale, scale)
                postRotate(rotationDegrees.toFloat())
            }
            Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, matrix, true)
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

    // One line per round start: tap to ready, and where the time went.
    private fun logStartTiming(
        requestedNs: Long,
        bindMs: Long,
        attemptTimings: List<String>,
        outcome: String,
    ) {
        Log.i(
            TAG,
            "Round start timing ($outcome): total ${elapsedMs(requestedNs)} ms = " +
                "camera bind $bindMs ms + " +
                attemptTimings.joinToString(" + ") { "[$it]" },
        )
    }

    private fun elapsedMs(startNs: Long): Long = (SystemClock.elapsedRealtimeNanos() - startNs) / NANOS_PER_MILLISECOND

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
        // Only on "capturing": what the first frame showed, for RN's setup hints.
        boardSetup: StartRoundDetectionUpdate? = null,
    ) {
        emit(
            EVENT_ROUND_STATE_CHANGED,
            Arguments.createMap().apply {
                putString("phase", phase)
                putString("roundId", roundId)
                putString("statusMessage", statusMessage)
                putArray("throws", throws.toWritableThrows(roundId))
                putBoolean("canRedetect", canRedetect)
                boardSetup?.let { setup ->
                    putInt("startDartCount", setup.startDartCount)
                    putDouble("leftRightHalfRatio", setup.leftRightHalfRatio.toDouble())
                    putDouble("boardHeightShare", setup.boardHeightShare.toDouble())
                }
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
                    putBoolean("needsCheck", throwResult.needsCheck)
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
        // For the frame recorder, which keeps frames where the gate saw something.
        val gateReason: String = "",
    )

    private class RoundCapture(val frame: CapturedFrame, val startNs: Long, val captureMs: Long)

    // Average and worst capture (with decode) and detection time of a round's frames, and the
    // average time between frame starts (what the player waits for a frame).
    private class FrameTimings {
        private var count = 0
        private var firstStartNs = 0L
        private var lastStartNs = 0L
        private var captureTotalMs = 0L
        private var captureMaxMs = 0L
        private var decodeTotalMs = 0L
        private var detectTotalMs = 0L
        private var detectMaxMs = 0L

        fun add(startNs: Long, captureMs: Long, decodeMs: Long, detectMs: Long) {
            if (count == 0) {
                firstStartNs = startNs
            }
            lastStartNs = startNs
            count += 1
            captureTotalMs += captureMs
            captureMaxMs = maxOf(captureMaxMs, captureMs)
            decodeTotalMs += decodeMs
            detectTotalMs += detectMs
            detectMaxMs = maxOf(detectMaxMs, detectMs)
        }

        override fun toString(): String {
            if (count == 0) {
                return "no frames"
            }
            val interval = if (count > 1) {
                "${(lastStartNs - firstStartNs) / NANOS_PER_MILLISECOND / (count - 1)} ms"
            } else {
                "?"
            }
            return "$count frames, one every $interval, " +
                "capture avg ${captureTotalMs / count} ms (decode ${decodeTotalMs / count} ms) " +
                "max $captureMaxMs ms, detect avg ${detectTotalMs / count} ms max $detectMaxMs ms"
        }
    }

    // Battery current, power and temperature over a round. BATTERY_PROPERTY_CURRENT_NOW should be in
    // microamperes (negative while discharging), but some phones report milliamperes or flip the
    // sign, so the size decides the unit and only the magnitude is used. Rounds played while
    // charging are marked: their current is not the phone's use.
    private class BatteryMeter(private val context: Context) {
        private val batteryManager = context.getSystemService(BatteryManager::class.java)
        private var count = 0
        private var currentSumMa = 0.0
        private var powerSumW = 0.0
        private var startTenthsC = Int.MIN_VALUE
        private var endTenthsC = Int.MIN_VALUE
        private var charging = false

        @Synchronized
        fun sample() {
            val raw = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) ?: return
            if (raw == 0 || raw == Int.MIN_VALUE) {
                return
            }
            val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
            val currentMa = abs(raw).toDouble().let { if (it > MICROAMP_READING_MIN) it / 1000.0 else it }
            val voltageV = status.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) / 1000.0
            val tenthsC = status.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            charging = charging || status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
            if (count == 0) {
                startTenthsC = tenthsC
            }
            endTenthsC = tenthsC
            count += 1
            currentSumMa += currentMa
            powerSumW += currentMa / 1000.0 * voltageV
        }

        @Synchronized
        override fun toString(): String {
            if (count == 0) {
                return "no readings"
            }
            return "$count readings, current avg ${"%.0f".format(currentSumMa / count)} mA, " +
                "power avg ${"%.2f".format(powerSumW / count)} W, " +
                "battery ${startTenthsC / 10.0} -> ${endTenthsC / 10.0} °C" +
                if (charging) " (charging, not comparable)" else ""
        }
    }

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
        // Two stills a second (user's choice, for power): a still takes about 0.25 s, so this
        // paces the loop rather than the camera.
        private const val FRAME_INTERVAL_MS = 500L
        private const val START_ROUND_ATTEMPTS = 3
        // Board's left half over its right half in the image; below 1 the phone is right of the
        // board's centre line (user-tested 2026-10-26: front-left 1.04-1.11, right 0.92-0.96).
        private const val RIGHT_SIDE_MAX_RATIO = 1.0f
        // Matched by RN's nativeErrorText.
        private const val PHONE_RIGHT_OF_BOARD_ERROR = "phone right of the board"
        // Board box height over the side of the square the model sees (the model was trained
        // on 0.55-0.9). Matched by RN's nativeErrorText.
        private const val BOARD_SHARE_MIN = 0.55f
        private const val BOARD_SHARE_MAX = 0.9f
        private const val BOARD_TOO_SMALL_ERROR = "board too small in frame"
        private const val BOARD_TOO_LARGE_ERROR = "board too large in frame"
        private const val BOARD_OFF_CENTRE_ERROR = "board off the frame centre"
        private const val TAG = "BullTrackRound"
        private const val FRAME_WAIT_SLICE_MS = 50L
        private const val BATTERY_SAMPLE_INTERVAL_MS = 1_000L
        // A phone's battery current is far below 20 A, so a larger reading is in microamperes.
        private const val MICROAMP_READING_MIN = 20_000.0
        private const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
