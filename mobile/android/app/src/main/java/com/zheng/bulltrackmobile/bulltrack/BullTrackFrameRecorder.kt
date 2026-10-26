package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Developer recording mode: saves a round's raw camera frames so detection can be replayed
 * offline after an algorithm change. To save storage only frames that matter are written:
 * board-setup frames, frames where the gate saw something (with up to two unsaved frames before
 * them), one idle frame per second, the last frame and redetect frames. frames.csv lists every
 * frame with its gate reason, saved or not; result.json holds the player-confirmed darts.
 */
class BullTrackFrameRecorder(
    context: Context
) {

    private val appContext = context.applicationContext
    // Same place as the debug images: no permission needed and pullable over adb.
    private val baseDir = File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "BullTrackRecordings")
    // One writer keeps csv lines in order and JPEG encoding off the round loop.
    private val writer = Executors.newSingleThreadExecutor()
    private var roundId: String? = null
    private var roundDir: File? = null
    private var roundStartNs = 0L
    private var lastSavedNs = 0L
    private val unsaved = ArrayDeque<PendingFrame>()

    fun isRecording(roundId: String): Boolean = this.roundId == roundId

    /** A round without recording; later calls do nothing. */
    fun stop() {
        roundId = null
        roundDir = null
        unsaved.clear()
    }

    fun startRound(roundId: String) {
        val dir = File(baseDir, roundId)
        this.roundId = roundId
        roundDir = dir
        roundStartNs = SystemClock.elapsedRealtimeNanos()
        lastSavedNs = 0L
        unsaved.clear()
        writer.execute {
            runCatching {
                pruneOldRounds()
                dir.mkdirs()
                File(dir, CSV_NAME).writeText("frame,ms,saved,reason\n")
            }.onFailure { Log.w(TAG, "Recording start failed", it) }
        }
    }

    /** A board-setup frame; every attempt is kept, also failed ones. */
    fun recordStartFrame(attempt: Int, bitmap: Bitmap, outcome: String) {
        save("start_$attempt", bitmap, SystemClock.elapsedRealtimeNanos(), outcome)
    }

    fun recordFrame(frameIndex: Int, bitmap: Bitmap, capturedNs: Long, gateReason: String) {
        val name = String.format(Locale.US, "frame_%04d", frameIndex)
        val idle = gateReason == IDLE_GATE_REASON
        when {
            !idle -> {
                // Something happened: keep what led up to it too.
                unsaved.forEach { save(it.name, it.bitmap, it.capturedNs, it.reason) }
                unsaved.clear()
                save(name, bitmap, capturedNs, gateReason)
            }
            capturedNs - lastSavedNs >= IDLE_FRAME_INTERVAL_NS -> {
                unsaved.forEach(::logSkipped)
                unsaved.clear()
                save(name, bitmap, capturedNs, gateReason)
            }
            else -> {
                unsaved.addLast(PendingFrame(name, bitmap, capturedNs, gateReason))
                if (unsaved.size > FRAMES_KEPT_BEFORE_EVENT) {
                    unsaved.removeFirst().also { logSkipped(it) }
                }
            }
        }
    }

    /** The round loop ended; the last frame shows every dart on the board. */
    fun finishCapture() {
        val last = unsaved.removeLastOrNull()
        unsaved.forEach(::logSkipped)
        unsaved.clear()
        last?.let { save(it.name, it.bitmap, it.capturedNs, it.reason) }
    }

    fun recordRedetectFrame(index: Int, bitmap: Bitmap) {
        save("redetect_$index", bitmap, SystemClock.elapsedRealtimeNanos(), "redetect")
    }

    fun recordFailure(message: String) {
        appendCsv("failed,${elapsedMs(SystemClock.elapsedRealtimeNanos())},0,${csvText(message)}")
    }

    /** What detection said and what the player confirmed (null when the darts were not edited). */
    fun recordResult(detected: JSONArray, edited: JSONArray?) {
        val dir = roundDir ?: return
        val result = JSONObject().apply {
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("android", Build.VERSION.RELEASE)
            put("edited", edited != null)
            put("detected", detected)
            put("confirmed", edited ?: detected)
        }
        writer.execute {
            runCatching { File(dir, RESULT_NAME).writeText(result.toString(2)) }
                .onFailure { Log.w(TAG, "Recording result failed", it) }
        }
    }

    private fun save(name: String, bitmap: Bitmap, capturedNs: Long, reason: String) {
        val dir = roundDir ?: return
        lastSavedNs = capturedNs
        val line = "$name,${elapsedMs(capturedNs)},1,${csvText(reason)}"
        writer.execute {
            runCatching {
                FileOutputStream(File(dir, "$name.jpg")).use { stream ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)
                }
                File(dir, CSV_NAME).appendText(line + "\n")
            }.onFailure { Log.w(TAG, "Recording frame $name failed", it) }
        }
    }

    private fun logSkipped(frame: PendingFrame) {
        appendCsv("${frame.name},${elapsedMs(frame.capturedNs)},0,${csvText(frame.reason)}")
    }

    private fun appendCsv(line: String) {
        val dir = roundDir ?: return
        writer.execute {
            runCatching { File(dir, CSV_NAME).appendText(line + "\n") }
        }
    }

    private fun pruneOldRounds() {
        baseDir
            .listFiles()
            .orEmpty()
            .filter { it.isDirectory }
            .sortedByDescending { it.lastModified() }
            .drop(KEEP_ROUNDS - 1)
            .forEach { it.deleteRecursively() }
    }

    private fun elapsedMs(ns: Long): Long = (ns - roundStartNs) / 1_000_000L

    private fun csvText(text: String): String = text.replace(',', ';').replace('\n', ' ')

    private data class PendingFrame(
        val name: String,
        val bitmap: Bitmap,
        val capturedNs: Long,
        val reason: String,
    )

    private companion object {
        const val TAG = "BullTrackRound"
        const val CSV_NAME = "frames.csv"
        const val RESULT_NAME = "result.json"
        // The gate's "nothing new" answer; any other reason means the frame is worth keeping.
        const val IDLE_GATE_REASON = "yolo_count_not_increased"
        const val IDLE_FRAME_INTERVAL_NS = 1_000_000_000L
        const val FRAMES_KEPT_BEFORE_EVENT = 2
        // Full resolution and high quality: tip detection works on fine pixel differences.
        const val JPEG_QUALITY = 90
        const val KEEP_ROUNDS = 30
    }
}
