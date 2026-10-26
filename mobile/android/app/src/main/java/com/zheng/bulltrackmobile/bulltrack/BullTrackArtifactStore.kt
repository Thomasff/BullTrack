package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import android.os.Build
import android.os.Process
import android.util.Log
import androidx.core.content.pm.PackageInfoCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.zheng.bulltrack.vision.DebugImageArtifact
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class BullTrackArtifactStore(
    context: Context
) {

    private val appContext = context.applicationContext
    // App-specific external storage: no permission needed, removed with the app, and readable over
    // adb from a release build (Android/data/<package>/files), so test rounds can be pulled for analysis.
    private val baseDir = File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "BullTrackDebug")

    fun saveArtifacts(roundId: String, artifacts: List<DebugImageArtifact>): List<WritableMap> {
        if (artifacts.isEmpty()) {
            return emptyList()
        }
        val roundDir = File(baseDir, roundId).apply { mkdirs() }
        artifacts.forEach { artifact ->
            File(roundDir, artifact.fileName).writeBytes(artifact.jpegBytes)
        }
        return listArtifacts(roundId)
    }

    /** Keeps only the newest rounds' debug images so app storage does not grow without bound. */
    fun pruneOldRounds(keep: Int = KEEP_ROUNDS) {
        // Rounds saved before debug images moved to external storage.
        File(appContext.filesDir, "BullTrackDebug").takeIf { it != baseDir }?.deleteRecursively()
        roundDirs()
            .drop(keep)
            .forEach { it.deleteRecursively() }
    }

    private fun roundDirs(): List<File> =
        baseDir
            .listFiles()
            .orEmpty()
            .filter { it.isDirectory }
            .sortedByDescending { it.lastModified() }

    private fun imageFiles(roundDir: File): List<File> =
        roundDir.listFiles().orEmpty().filter { it.isFile && it.name != LOG_NAME }

    private fun buildInfo(roundId: String, savedAt: Date): String {
        val packageInfo = appContext.packageManager.getPackageInfo(appContext.packageName, 0)
        return listOf(
            "BullTrack debug bundle",
            "App: ${packageInfo.versionName} (${PackageInfoCompat.getLongVersionCode(packageInfo)})",
            "Device: ${Build.MANUFACTURER} ${Build.MODEL}",
            "Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            "Round: $roundId",
            "Saved: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(savedAt)}",
        ).joinToString("\n", postfix = "\n")
    }

    /**
     * Saves this app's log lines since the round started next to the round's debug images, so a
     * debug bundle exported later still has them after the system log buffer has rotated.
     */
    fun saveRoundLog(roundId: String, startedAtMs: Long) {
        runCatching {
            val since = String.format(Locale.US, "%d.%03d", startedAtMs / 1000, startedAtMs % 1000)
            val process = ProcessBuilder(
                "logcat", "-t", since, "-v", "threadtime", "--pid=${Process.myPid()}", "*:I"
            ).redirectErrorStream(true).start()
            val text = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor()
            File(baseDir, roundId).apply { mkdirs() }.resolve(LOG_NAME).writeText(text)
        }.onFailure { Log.w(TAG, "Round log save failed", it) }
    }

    /** Saved rounds, newest first. */
    fun listRoundsArray(): WritableArray {
        val array = Arguments.createArray()
        roundDirs().forEach { dir ->
            array.pushMap(Arguments.createMap().apply {
                putString("roundId", dir.name)
                putDouble("savedAt", dir.lastModified().toDouble())
                putInt("imageCount", imageFiles(dir).size)
            })
        }
        return array
    }

    /** Zips one round's debug images and log with app and device info, for sharing. */
    fun exportRound(roundId: String): File {
        val roundDir = File(baseDir, roundId)
        require(roundDir.isDirectory) { "Debug round not found: $roundId" }
        val exportDir = File(appContext.cacheDir, EXPORT_DIR_NAME)
        // Only the latest bundle is kept; older ones were already shared or abandoned.
        exportDir.deleteRecursively()
        exportDir.mkdirs()
        val savedAt = Date(roundDir.lastModified())
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(savedAt)
        val zipFile = File(exportDir, "BullTrack-debug-$stamp.zip")
        ZipOutputStream(zipFile.outputStream().buffered()).use { zip ->
            zip.putNextEntry(ZipEntry(INFO_NAME))
            zip.write(buildInfo(roundId, savedAt).toByteArray())
            zip.closeEntry()
            roundDir.listFiles().orEmpty().filter { it.isFile }.sortedBy { it.name }.forEach { file ->
                zip.putNextEntry(ZipEntry(file.name))
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        return zipFile
    }

    fun listArtifacts(roundId: String): List<WritableMap> {
        val roundDir = File(baseDir, roundId)
        if (!roundDir.exists() || !roundDir.isDirectory) {
            return emptyList()
        }
        return imageFiles(roundDir)
            .sortedBy { it.name.lowercase(Locale.US) }
            .map { file ->
                val descriptor = describeArtifact(file)
                Arguments.createMap().apply {
                    putString("id", "$roundId:${file.name}")
                    putString("roundId", roundId)
                    putString("kind", descriptor.kind)
                    putString("title", descriptor.title)
                    putString("path", file.toURI().toString())
                    putString("note", descriptor.note)
                }
            }
    }

    fun listArtifactsArray(roundId: String): WritableArray {
        val array = Arguments.createArray()
        listArtifacts(roundId).forEach(array::pushMap)
        return array
    }

    private fun describeArtifact(file: File): ArtifactDescriptor {
        val lower = file.name.lowercase(Locale.US)
        return when {
            "rectified" in lower -> ArtifactDescriptor(
                kind = "boardRectifiedPreview",
                title = "Board Rectified Preview",
                note = "Saved from Android native start-round output."
            )

            "adaptive" in lower -> ArtifactDescriptor(
                kind = "adaptiveRedSamplePoints",
                title = "Adaptive Red Sample Points",
                note = "Saved from Android native gate or precise debug output."
            )

            "yolo" in lower -> ArtifactDescriptor(
                kind = "yoloRedetectOverlay",
                title = "YOLO Redetect Overlay",
                note = "Saved from Android native redetect output."
            )

            else -> ArtifactDescriptor(
                kind = "localDiff",
                title = file.nameWithoutExtension,
                note = "Saved from Android native debug output."
            )
        }
    }

    private data class ArtifactDescriptor(
        val kind: String,
        val title: String,
        val note: String
    )

    private companion object {
        const val KEEP_ROUNDS = 10
        const val LOG_NAME = "log.txt"
        const val INFO_NAME = "info.txt"
        const val TAG = "BullTrackRound"
        // Shared through the FileProvider declared in AndroidManifest.xml (res/xml/export_paths.xml).
        const val EXPORT_DIR_NAME = "BullTrackExport"
    }
}
