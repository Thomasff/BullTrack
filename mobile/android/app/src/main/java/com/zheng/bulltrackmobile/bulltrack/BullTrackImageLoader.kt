package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File

class BullTrackImageLoader(
    context: Context
) {

    private val appContext = context.applicationContext

    fun loadBitmap(frameRef: String): Bitmap {
        return when {
            frameRef.startsWith(ASSET_PREFIX) -> {
                val assetPath = frameRef.removePrefix(ASSET_PREFIX)
                appContext.assets.open(assetPath).use(BitmapFactory::decodeStream)
                    ?: error("Unable to decode asset bitmap: $frameRef")
            }

            frameRef.startsWith(FILE_PREFIX) -> {
                val uri = Uri.parse(frameRef)
                appContext.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
                    ?: error("Unable to open file uri: $frameRef")
            }

            else -> {
                val file = File(frameRef)
                if (!file.exists()) {
                    error("Frame file does not exist: $frameRef")
                }
                BitmapFactory.decodeFile(file.absolutePath)
                    ?: error("Unable to decode file bitmap: $frameRef")
            }
        }
    }

    companion object {
        private const val ASSET_PREFIX = "asset://"
        private const val FILE_PREFIX = "file://"
    }
}
