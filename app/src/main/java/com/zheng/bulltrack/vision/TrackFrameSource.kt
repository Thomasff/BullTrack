package com.zheng.bulltrack.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory

class TrackFrameSource(
    private val context: Context
) {
    fun loadFrames(): List<Bitmap> {
        return (1..10).mapNotNull { index ->
            context.assets.open("track/$index.jpg").use { inputStream ->
                BitmapFactory.decodeStream(inputStream)?.copy(Bitmap.Config.ARGB_8888, false)
            }
        }
    }
}
