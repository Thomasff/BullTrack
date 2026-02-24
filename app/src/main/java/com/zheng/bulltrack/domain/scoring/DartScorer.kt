package com.zheng.bulltrack.domain.scoring

import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import kotlin.math.atan2
import kotlin.math.sqrt

object DartScorer {
    
    private const val DOUBLE_START = 0.935
    private const val OUTER_SINGLE_START = 0.645
    private const val TRIPLE_START = 0.57
    private const val INNER_SINGLE_END = 0.57
    private const val BULL_END = 0.14
    
    private val SECTOR_SCORES = intArrayOf(20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
    
    private const val CENTER_BULL_SCORE = 50
    private const val OUTER_BULL_SCORE = 25
    
    fun calculateScore(position: DartPosition): ThrowResult {
        val r = sqrt(position.x * position.x + position.y * position.y)
        val theta = atan2(-position.y, position.x)
        
        val ringType = determineRingType(r)
        val sector = determineSector(theta)
        val score = calculateScoreValue(r, sector)
        
        return ThrowResult(
            sector = sector,
            ring = ringType,
            score = score,
            position = position
        )
    }
    
    private fun determineRingType(r: Float): RingType {
        return when {
            r < BULL_END -> RingType.INNER_BULL
            r < INNER_SINGLE_END -> RingType.OUTER_BULL
            r < TRIPLE_START -> RingType.INNER_SINGLE
            r < OUTER_SINGLE_START -> RingType.TRIPLE
            r < DOUBLE_START -> RingType.OUTER_SINGLE
            else -> RingType.MISS
        }
    }
    
    private fun determineSector(theta: Float): Int {
        var angle = theta
        if (angle < 0) angle += (2 * kotlin.math.PI).toFloat()
        
        val sectorAngle = (2 * kotlin.math.PI / 20).toFloat()
        val adjustedTheta = ((kotlin.math.PI / 2) - angle).toFloat() % (2 * kotlin.math.PI).toFloat()
        if (adjustedTheta < 0) adjustedTheta + (2 * kotlin.math.PI).toFloat()
        
        val sectorIndex = (adjustedTheta / sectorAngle).toInt() % 20
        return SECTOR_SCORES[if (sectorIndex < 0) sectorIndex + 20 else sectorIndex]
    }
    
    private fun calculateScoreValue(r: Float, sector: Int): Int {
        return when {
            r < BULL_END -> CENTER_BULL_SCORE
            r < INNER_SINGLE_END -> OUTER_BULL_SCORE
            r < TRIPLE_START -> sector
            r < OUTER_SINGLE_START -> sector * 3
            r < DOUBLE_START -> sector * 2
            else -> 0
        }
    }
    
    fun cartesianToPolar(x: Float, y: Float): Pair<Float, Float> {
        val r = sqrt(x * x + y * y)
        var theta = atan2(-y, x)
        if (theta < 0) theta += (2 * kotlin.math.PI).toFloat()
        return Pair(r, theta)
    }
}
