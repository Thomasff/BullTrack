package com.zheng.bulltrack.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.zheng.bulltrack.camera.CapturedFrame
import com.zheng.bulltrack.camera.RoundFrameSource

class TrackFrameSource(
    private val context: Context
) : RoundFrameSource {

    private var frames: List<Bitmap> = emptyList()
    private var nextIndex: Int = 0

    override suspend fun prepareRound() {
        frames = (1..10).mapNotNull { index ->
            context.assets.open("track/$index.jpg").use { inputStream ->
                BitmapFactory.decodeStream(inputStream)?.copy(Bitmap.Config.ARGB_8888, false)
            }
        }
        nextIndex = 0
    }

    override suspend fun captureFirstFrame(): CapturedFrame {
        if (frames.isEmpty()) {
            prepareRound()
        }
        return frames.getOrNull(nextIndex)?.let { bitmap ->
            nextIndex += 1
            CapturedFrame(bitmap = bitmap)
        } ?: throw IllegalStateException("track 目录中没有可用图片")
    }

    override suspend fun captureNextFrame(): CapturedFrame? {
        return frames.getOrNull(nextIndex)?.let { bitmap ->
            nextIndex += 1
            CapturedFrame(bitmap = bitmap)
        }
    }

    override suspend fun captureRedetectFrame(): CapturedFrame {
        return frames.getOrNull(nextIndex)?.let { bitmap ->
            nextIndex += 1
            CapturedFrame(bitmap = bitmap)
        } ?: throw IllegalStateException("没有可用于重新识别的新图片")
    }

    override fun finishRound() {
        nextIndex = 0
    }

    override fun release() {
        frames = emptyList()
        nextIndex = 0
    }
}
