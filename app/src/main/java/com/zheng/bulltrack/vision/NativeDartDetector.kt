package com.zheng.bulltrack.vision

import android.graphics.Bitmap
import android.graphics.Color
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult

class NativeDartDetector : DartDetector {
    
    init {
        System.loadLibrary("bulltrack")
    }
    
    private external fun nativeInit()
    private external fun nativeRelease()
    private external fun nativeDetect(
        beforeData: ByteArray,
        afterData: ByteArray,
        width: Int,
        height: Int
    ): Array<DetectionResult>?
    private external fun nativeReset()
    private external fun nativeSetParams(minArea: Double, minAspectRatio: Double)
    
    override fun init() {
        nativeInit()
    }
    
    fun release() {
        nativeRelease()
    }
    
    fun reset() {
        nativeReset()
    }
    
    fun setParams(minArea: Double = 200.0, minAspectRatio: Double = 1.5) {
        nativeSetParams(minArea, minAspectRatio)
    }
    
    override fun detect(before: Bitmap, after: Bitmap): List<ThrowResult> {
        if (before.width != after.width || before.height != after.height) {
            throw IllegalArgumentException("Before and after images must have the same dimensions")
        }
        
        val width = before.width
        val height = before.height
        
        val beforeData = bitmapToByteArray(before)
        val afterData = bitmapToByteArray(after)
        
        val results = nativeDetect(beforeData, afterData, width, height)
            ?: return emptyList()
        
        return results.map { result ->
            ThrowResult(
                sector = result.sector,
                ring = mapRingType(result.ringType),
                score = result.score,
                position = DartPosition(result.normalizedX, result.normalizedY)
            )
        }
    }
    
    private fun bitmapToByteArray(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        
        val byteArray = ByteArray(width * height * 4)
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val offset = i * 4
            byteArray[offset] = Color.red(pixel).toByte()
            byteArray[offset + 1] = Color.green(pixel).toByte()
            byteArray[offset + 2] = Color.blue(pixel).toByte()
            byteArray[offset + 3] = Color.alpha(pixel).toByte()
        }
        return byteArray
    }
    
    private fun mapRingType(ringType: Int): RingType {
        return when (ringType) {
            0 -> RingType.MISS
            1 -> RingType.DOUBLE
            2 -> RingType.TRIPLE
            3 -> RingType.INNER_SINGLE
            4 -> RingType.OUTER_BULL
            5 -> RingType.INNER_BULL
            else -> RingType.OUTER_SINGLE
        }
    }
}
