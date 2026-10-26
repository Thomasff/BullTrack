package com.zheng.bulltrackmobile.bulltrack

import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.zheng.bulltrackmobile.specs.NativeBullTrackModuleSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

@ReactModule(name = BullTrackModule.NAME)
class BullTrackModule(
    reactContext: ReactApplicationContext
) : NativeBullTrackModuleSpec(reactContext) {

    private val controller = BullTrackRuntime.get(reactContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val soundCues = BullTrackSoundCues(reactContext)

    override fun prepareRoundCamera(promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.prepareRoundCamera()
        }
    }

    override fun startLiveRound(request: ReadableMap, promise: Promise) {
        resolvePromise(promise) {
            val debugImages = request.hasKey("debugImages") && request.getBoolean("debugImages")
            val recordFrames = request.hasKey("recordFrames") && request.getBoolean("recordFrames")
            controller.startLiveRound(debugImages, recordFrames)
        }
    }

    override fun stopLiveRound(promise: Promise) {
        resolvePromise(promise) {
            controller.stopLiveRound()
        }
    }

    override fun redetectCurrentRound(request: ReadableMap, promise: Promise) {
        scope.launch {
            runCatching {
                val roundId = request.getString("roundId")
                    ?: error("Missing required string field: roundId")
                controller.redetectCurrentRound(roundId)
            }.onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_REDETECT_FAILED", error.message, error) }
        }
    }

    override fun finishRound(request: ReadableMap, promise: Promise) {
        resolveSuspendPromise(promise) {
            val roundId = request.getString("roundId")
                ?: error("Missing required string field: roundId")
            val confirmed = request.hasKey("confirmed") && request.getBoolean("confirmed")
            val editedThrows = if (request.hasKey("editedThrows") && !request.isNull("editedThrows")) {
                request.getArray("editedThrows")?.let { JSONArray(it.toArrayList()) }
            } else {
                null
            }
            controller.finishRound(roundId, confirmed, editedThrows)
        }
    }

    override fun loadDebugArtifacts(roundId: String, promise: Promise) {
        resolvePromise(promise) {
            controller.loadDebugArtifacts(roundId)
        }
    }

    override fun listDebugRounds(promise: Promise) {
        resolvePromise(promise) {
            controller.listDebugRounds()
        }
    }

    // Zips the round off the main thread, then opens the system share sheet for the bundle.
    override fun shareDebugRound(roundId: String, promise: Promise) {
        resolveSuspendPromise(promise) {
            val activity = reactApplicationContext.currentActivity ?: error("No activity to share from")
            val bundle = withContext(Dispatchers.IO) { controller.exportDebugRound(roundId) }
            val uri = FileProvider.getUriForFile(
                reactApplicationContext,
                "${reactApplicationContext.packageName}.debugexport",
                bundle,
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(bundle.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, "分享调试包"))
            bundle.name
        }
    }

    override fun setZoomRatio(zoomRatio: Double, promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.setZoomRatio(zoomRatio)
        }
    }

    override fun preloadSoundCues() {
        soundCues.preload()
    }

    override fun playSoundCue(cue: String) {
        soundCues.play(cue)
    }

    override fun addListener(eventName: String) = Unit

    override fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        controller.invalidate()
        soundCues.release()
        super.invalidate()
    }

    override fun getName(): String = NAME

    private fun resolvePromise(promise: Promise, work: () -> Any) {
        scope.launch {
            runCatching(work)
                .onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_NATIVE_FAILED", error.message, error) }
        }
    }

    private fun resolveSuspendPromise(promise: Promise, work: suspend () -> Any) {
        scope.launch {
            runCatching { work() }
                .onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_NATIVE_FAILED", error.message, error) }
        }
    }

    companion object {
        const val NAME = "BullTrackModule"
    }
}
