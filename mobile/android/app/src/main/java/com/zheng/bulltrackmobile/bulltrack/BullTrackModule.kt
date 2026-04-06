package com.zheng.bulltrackmobile.bulltrack

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.NativeDartDetector
import com.zheng.bulltrackmobile.specs.NativeBullTrackModuleSpec
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.hypot

@ReactModule(name = BullTrackModule.NAME)
class BullTrackModule(
    reactContext: ReactApplicationContext
) : NativeBullTrackModuleSpec(reactContext) {

    private val detector = NativeDartDetector(reactContext.applicationContext.assets)
    private val bridgeExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val nativeCallExecutor: ExecutorService = Executors.newCachedThreadPool()
    private val imageLoader = BullTrackImageLoader(reactContext)
    private val artifactStore = BullTrackArtifactStore(reactContext)
    private val sessions = LinkedHashMap<String, RoundSession>()
    @Volatile
    private var detectorInitialized = false

    override fun startRound(request: ReadableMap, promise: Promise) {
        runOnBridgeExecutor(promise, "BT_START_ROUND_FAILED") {
            ensureSupportedRuntime()
            ensureDetectorInitialized()
            val frameRef = request.requireString("frameRef")
            val roundId = request.getOptionalString("roundId") ?: createRoundId()
            val bitmap = imageLoader.loadBitmap(frameRef)
            var sessionId = 0L
            try {
                sessionId = runNativeWithTimeout("createSession") {
                    detector.createSession()
                }
                val update = runNativeWithTimeout("startRound") {
                    detector.startRound(sessionId, bitmap)
                }
                update.errorMessage?.let { error(it) }

                val debugArtifacts = artifactStore.saveArtifacts(roundId, update.debugImages)
                sessions[roundId]?.let { detector.destroySession(it.nativeSessionId) }
                sessions[roundId] = RoundSession(
                    roundId = roundId,
                    nativeSessionId = sessionId,
                    throws = mutableListOf()
                )

                Arguments.createMap().apply {
                    putString("roundId", roundId)
                    putString("status", "ready")
                    putString("statusMessage", "Native round started with $frameRef")
                    putArray("debugArtifacts", debugArtifacts.toWritableArray())
                }
            } catch (error: Throwable) {
                if (sessionId != 0L) {
                    runCatching { detector.destroySession(sessionId) }
                }
                throw error
            }
        }
    }

    override fun processFrame(request: ReadableMap, promise: Promise) {
        runOnBridgeExecutor(promise, "BT_PROCESS_FRAME_FAILED") {
            ensureSupportedRuntime()
            ensureDetectorInitialized()
            val roundId = request.requireString("roundId")
            val frameRef = request.requireString("frameRef")
            val session = sessions[roundId] ?: error("Round session not found: $roundId")
            val bitmap = imageLoader.loadBitmap(frameRef)
            val update = runNativeWithTimeout("processFrame") {
                detector.processFrame(session.nativeSessionId, bitmap)
            }

            val debugArtifacts = mutableListOf<WritableMap>()
            debugArtifacts += artifactStore.saveArtifacts(roundId, update.gateDebugImages)
            debugArtifacts += artifactStore.saveArtifacts(roundId, update.preciseDebugImages)

            val addedThrow = update.newThrow?.takeIf { mergeThrow(session.throws, it) }
            val statusMessage = when {
                update.errorMessage != null -> update.errorMessage
                addedThrow != null -> "Native processFrame detected ${session.throws.size} throw(s)."
                update.gateTriggered -> "Native processFrame ran precise detection with no new throw."
                else -> "Native processFrame gate did not trigger precise detection."
            }

            Arguments.createMap().apply {
                putString("roundId", roundId)
                putString("status", "resultReady")
                putString("statusMessage", statusMessage)
                putBoolean("gateTriggered", update.gateTriggered)
                putString("gateReason", update.gateReason)
                if (addedThrow != null) {
                    putMap("newThrow", toWritableThrow("$roundId:new", addedThrow))
                } else {
                    putNull("newThrow")
                }
                putArray("throws", session.throws.toWritableThrows(roundId))
                putArray("debugArtifacts", debugArtifacts.distinctBy { it.getString("id") }.toWritableArray())
            }
        }
    }

    override fun redetectRound(request: ReadableMap, promise: Promise) {
        runOnBridgeExecutor(promise, "BT_REDETECT_FAILED") {
            ensureSupportedRuntime()
            ensureDetectorInitialized()
            val roundId = request.requireString("roundId")
            val frameRef = request.requireString("frameRef")
            val session = sessions[roundId] ?: error("Round session not found: $roundId")
            val bitmap = imageLoader.loadBitmap(frameRef)
            val update = runNativeWithTimeout("redetectRound") {
                detector.redetect(session.nativeSessionId, bitmap)
            }
            session.throws.clear()
            session.throws += update.throws.take(MAX_DARTS)

            val debugArtifacts = artifactStore.saveArtifacts(roundId, update.debugImages)
            Arguments.createMap().apply {
                putString("roundId", roundId)
                putString("status", "resultReady")
                putString(
                    "statusMessage",
                    "Native redetect completed${update.yoloStatus?.let { " ($it)" } ?: ""}.",
                )
                putString("yoloStatus", update.yoloStatus)
                putArray("throws", session.throws.toWritableThrows(roundId))
                putArray("debugArtifacts", debugArtifacts.toWritableArray())
            }
        }
    }

    override fun finishRound(request: ReadableMap, promise: Promise) {
        runOnBridgeExecutor(promise, "BT_FINISH_ROUND_FAILED") {
            val roundId = request.requireString("roundId")
            val session = sessions.remove(roundId) ?: error("Round session not found: $roundId")
            detector.destroySession(session.nativeSessionId)
            Arguments.createMap().apply {
                putString("roundId", roundId)
                putString("status", "finished")
                putString("statusMessage", "Native round finished.")
                putArray("throws", session.throws.toWritableThrows(roundId))
            }
        }
    }

    override fun loadDebugArtifacts(roundId: String, promise: Promise) {
        runOnBridgeExecutor(promise, "BT_LOAD_ARTIFACTS_FAILED") {
            artifactStore.listArtifactsArray(roundId)
        }
    }

    override fun invalidate() {
        runCatching {
            sessions.values.forEach { detector.destroySession(it.nativeSessionId) }
            sessions.clear()
            if (detectorInitialized) {
                detector.release()
            }
        }
        bridgeExecutor.shutdownNow()
        nativeCallExecutor.shutdownNow()
        super.invalidate()
    }

    override fun getName(): String = NAME

    private fun mergeThrow(existing: MutableList<ThrowResult>, detected: ThrowResult): Boolean {
        if (existing.size >= MAX_DARTS) {
            return false
        }
        val position = detected.position ?: return false
        val duplicate = existing.any { current ->
            val currentPosition = current.position ?: return@any false
            hypot(
                (currentPosition.x - position.x).toDouble(),
                (currentPosition.y - position.y).toDouble(),
            ) < DUPLICATE_DISTANCE_THRESHOLD
        }
        if (duplicate) {
            return false
        }
        existing += detected
        return true
    }

    private fun List<ThrowResult>.toWritableThrows(roundId: String): WritableArray {
        val array = Arguments.createArray()
        forEachIndexed { index, throwResult ->
            array.pushMap(toWritableThrow("$roundId:$index", throwResult))
        }
        return array
    }

    private fun List<WritableMap>.toWritableArray(): WritableArray {
        val array = Arguments.createArray()
        forEach(array::pushMap)
        return array
    }

    private fun toWritableThrow(id: String, throwResult: ThrowResult): WritableMap {
        val point = throwResult.position ?: DartPosition(0f, 0f)
        return Arguments.createMap().apply {
            putString("id", id)
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

    private fun createRoundId(): String = "rn-${UUID.randomUUID()}"

    private fun <T> runNativeWithTimeout(step: String, block: () -> T): T {
        val future = nativeCallExecutor.submit<T> { block() }
        return try {
            future.get(NATIVE_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (timeout: TimeoutException) {
            future.cancel(true)
            error("$step timed out after ${NATIVE_CALL_TIMEOUT_SECONDS}s")
        }
    }

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

    private fun <T> runOnBridgeExecutor(
        promise: Promise,
        errorCode: String,
        work: () -> T
    ) {
        bridgeExecutor.execute {
            runCatching(work)
                .onSuccess(promise::resolve)
                .onFailure { error -> promise.reject(errorCode, error.message, error) }
        }
    }

    private data class RoundSession(
        val roundId: String,
        val nativeSessionId: Long,
        val throws: MutableList<ThrowResult>
    )

    companion object {
        const val NAME = "BullTrackModule"
        private const val MAX_DARTS = 3
        private const val DUPLICATE_DISTANCE_THRESHOLD = 0.08
        private const val NATIVE_CALL_TIMEOUT_SECONDS = 12L
    }
}

private fun ReadableMap.requireString(key: String): String {
    return getString(key) ?: error("Missing required string field: $key")
}

private fun ReadableMap.getOptionalString(key: String): String? {
    if (!hasKey(key) || isNull(key)) {
        return null
    }
    return getString(key)
}
