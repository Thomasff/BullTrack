package com.zheng.bulltrack.vision

import android.graphics.Bitmap
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult

interface DartDetector {
    fun detect(before: Bitmap, after: Bitmap): List<ThrowResult>
    fun init()
}
