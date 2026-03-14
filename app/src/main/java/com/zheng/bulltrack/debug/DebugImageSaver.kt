package com.zheng.bulltrack.debug

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.zheng.bulltrack.BuildConfig
import com.zheng.bulltrack.vision.DebugImageArtifact
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

class DebugImageSaver(
    context: Context
) {

    companion object {
        private const val TAG = "DebugImageSaver"
        private const val MIME_TYPE_JPEG = "image/jpeg"
        private const val QUALITY_JPEG = 95
    }

    private val appContext = context.applicationContext

    suspend fun saveRawBitmap(
        roundId: String,
        fileName: String,
        bitmap: Bitmap
    ) {
        if (!BuildConfig.ENABLE_DEBUG_IMAGES) {
            return
        }
        saveJpegBytes(roundId, fileName, bitmap.toJpegBytes())
    }

    suspend fun saveArtifacts(
        roundId: String,
        artifacts: List<DebugImageArtifact>
    ) {
        if (!BuildConfig.ENABLE_DEBUG_IMAGES) {
            return
        }
        for (artifact in artifacts) {
            saveJpegBytes(roundId, artifact.fileName, artifact.jpegBytes)
        }
    }

    private suspend fun saveJpegBytes(
        roundId: String,
        fileName: String,
        jpegBytes: ByteArray
    ) = withContext(Dispatchers.IO) {
        runCatching {
            val relativePath = "${Environment.DIRECTORY_PICTURES}/BullTrackDebug/$roundId"
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, MIME_TYPE_JPEG)
                put(MediaStore.Images.Media.RELATIVE_PATH, relativePath)
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val resolver = appContext.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: error("无法创建 MediaStore 项")
            resolver.openOutputStream(uri)?.use { output ->
                output.write(jpegBytes)
                output.flush()
            } ?: error("无法打开相册输出流")
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }.onFailure { error ->
            Log.e(TAG, "Failed to save debug image $fileName", error)
        }
    }

    private fun Bitmap.toJpegBytes(): ByteArray {
        val output = ByteArrayOutputStream()
        compress(Bitmap.CompressFormat.JPEG, QUALITY_JPEG, output)
        return output.toByteArray()
    }
}
