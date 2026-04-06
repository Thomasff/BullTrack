package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.zheng.bulltrack.vision.DebugImageArtifact
import java.io.File
import java.util.Locale

class BullTrackArtifactStore(
    context: Context
) {

    private val appContext = context.applicationContext
    private val baseDir = File(appContext.filesDir, "BullTrackDebug")

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

    fun listArtifacts(roundId: String): List<WritableMap> {
        val roundDir = File(baseDir, roundId)
        if (!roundDir.exists() || !roundDir.isDirectory) {
            return emptyList()
        }
        return roundDir
            .listFiles()
            .orEmpty()
            .filter { it.isFile }
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
}
