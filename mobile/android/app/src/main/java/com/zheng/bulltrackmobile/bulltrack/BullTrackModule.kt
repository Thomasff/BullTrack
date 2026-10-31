package com.zheng.bulltrackmobile.bulltrack

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.BaseActivityEventListener
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
import java.io.File

@ReactModule(name = BullTrackModule.NAME)
class BullTrackModule(
    reactContext: ReactApplicationContext
) : NativeBullTrackModuleSpec(reactContext) {

    private val controller = BullTrackRuntime.get(reactContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val soundCues = BullTrackSoundCues(reactContext)
    private val haptics = BullTrackHaptics(reactContext)
    private var pendingPick: Promise? = null

    private val pickResultListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != PICK_TEXT_FILE_REQUEST) {
                return
            }
            val promise = pendingPick ?: return
            pendingPick = null
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) {
                promise.resolve("")
                return
            }
            resolveSuspendPromise(promise) {
                withContext(Dispatchers.IO) {
                    reactApplicationContext.contentResolver.openInputStream(uri)
                        ?.use { stream -> stream.bufferedReader().readText() }
                        ?: error("Cannot open the picked file")
                }
            }
        }
    }

    init {
        reactContext.addActivityEventListener(pickResultListener)
    }

    override fun prepareRoundCamera(promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.prepareRoundCamera()
        }
    }

    override fun startLiveRound(request: ReadableMap, promise: Promise) {
        resolvePromise(promise) {
            val debugImages = request.hasKey("debugImages") && request.getBoolean("debugImages")
            val recordFrames = request.hasKey("recordFrames") && request.getBoolean("recordFrames")
            val yoloOnCpu = request.hasKey("yoloOnCpu") && request.getBoolean("yoloOnCpu")
            controller.startLiveRound(debugImages, recordFrames, yoloOnCpu)
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
            shareFile(activity, bundle, "application/zip", "分享调试包")
            bundle.name
        }
    }

    // Writes the text (e.g. a history backup) to the export cache and opens the share sheet.
    override fun shareTextFile(fileName: String, content: String, promise: Promise) {
        resolveSuspendPromise(promise) {
            val activity = reactApplicationContext.currentActivity ?: error("No activity to share from")
            val file = withContext(Dispatchers.IO) {
                val exportDir = File(reactApplicationContext.cacheDir, BullTrackArtifactStore.EXPORT_DIR_NAME)
                exportDir.mkdirs()
                File(exportDir, File(fileName).name).apply { writeText(content) }
            }
            shareFile(activity, file, "application/json", "分享备份")
            file.name
        }
    }

    // Opens the system file picker; resolves with the picked file's text, or "" when cancelled.
    override fun pickTextFile(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("BT_NATIVE_FAILED", "No activity to pick from")
            return
        }
        pendingPick?.resolve("")
        pendingPick = promise
        val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            // Shared .json files often arrive with a generic type, so any file can be picked.
            type = "*/*"
        }
        activity.startActivityForResult(pick, PICK_TEXT_FILE_REQUEST)
    }

    private fun shareFile(activity: Activity, file: File, mimeType: String, title: String) {
        val uri = FileProvider.getUriForFile(
            reactApplicationContext,
            "${reactApplicationContext.packageName}.debugexport",
            file,
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(send, title))
    }

    override fun setZoomRatio(zoomRatio: Double, promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.setZoomRatio(zoomRatio)
        }
    }

    override fun detectPrepBoard(yoloOnCpu: Boolean, promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.detectPrepBoard(yoloOnCpu)
        }
    }

    override fun preloadSoundCues() {
        soundCues.preload()
    }

    override fun playSoundCue(cue: String) {
        soundCues.play(cue)
    }

    override fun hapticTick() {
        haptics.tick()
    }

    override fun addListener(eventName: String) = Unit

    override fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        reactApplicationContext.removeActivityEventListener(pickResultListener)
        pendingPick?.resolve("")
        pendingPick = null
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
        private const val PICK_TEXT_FILE_REQUEST = 4721
    }
}
