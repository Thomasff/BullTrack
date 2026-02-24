package com.zheng.bulltrack.vision

import android.graphics.Bitmap
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.domain.scoring.DartScorer

class MockDartDetector : DartDetector {
    
    override fun init() {
    }
    
    override fun detect(before: Bitmap, after: Bitmap): List<ThrowResult> {
        val mockPositions = listOf(
            DartPosition(0.3f, 0.2f),
            DartPosition(-0.5f, 0.4f),
            DartPosition(0.1f, -0.3f)
        )
        
        return mockPositions.map { position ->
            DartScorer.calculateScore(position)
        }
    }
}
