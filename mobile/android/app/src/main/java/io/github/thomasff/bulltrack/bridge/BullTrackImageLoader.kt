package io.github.thomasff.bulltrack.bridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.File

class BullTrackImageLoader(
    context: Context
) {

    private val appContext = context.applicationContext

    fun loadBitmap(frameRef: String): Bitmap {
        return when {
            frameRef.startsWith(ASSET_PREFIX) -> {
                val assetPath = frameRef.removePrefix(ASSET_PREFIX)
                val bitmap = appContext.assets.open(assetPath).use(BitmapFactory::decodeStream)
                    ?: error("Unable to decode asset bitmap: $frameRef")
                bitmap
            }

            frameRef.startsWith(FILE_PREFIX) -> {
                val uri = Uri.parse(frameRef)
                loadBitmapFromUri(uri, frameRef)
            }

            else -> {
                val file = File(frameRef)
                if (!file.exists()) {
                    error("Frame file does not exist: $frameRef")
                }
                loadBitmapFromFile(file, frameRef)
            }
        }
    }

    private fun loadBitmapFromUri(uri: Uri, frameRef: String): Bitmap {
        val bitmap = appContext.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
            ?: error("Unable to open file uri: $frameRef")
        val rotationDegrees = when (uri.scheme) {
            "file" -> {
                val path = uri.path ?: return bitmap
                readRotationDegrees(ExifInterface(path))
            }

            else -> {
                appContext.contentResolver.openInputStream(uri)?.use { stream ->
                    readRotationDegrees(ExifInterface(stream))
                } ?: 0
            }
        }
        return applyRotationIfNeeded(bitmap, rotationDegrees)
    }

    private fun loadBitmapFromFile(file: File, frameRef: String): Bitmap {
        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
            ?: error("Unable to decode file bitmap: $frameRef")
        val rotationDegrees = readRotationDegrees(ExifInterface(file.absolutePath))
        return applyRotationIfNeeded(bitmap, rotationDegrees)
    }

    private fun readRotationDegrees(exif: ExifInterface): Int {
        return when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    }

    private fun applyRotationIfNeeded(bitmap: Bitmap, rotationDegrees: Int): Bitmap {
        if (rotationDegrees == 0) {
            return bitmap
        }
        val matrix = Matrix().apply {
            postRotate(rotationDegrees.toFloat())
        }
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated != bitmap) {
            bitmap.recycle()
        }
        return rotated
    }

    companion object {
        private const val ASSET_PREFIX = "asset://"
        private const val FILE_PREFIX = "file://"
    }
}
