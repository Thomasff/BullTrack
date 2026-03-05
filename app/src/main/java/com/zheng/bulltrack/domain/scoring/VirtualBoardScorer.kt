package com.zheng.bulltrack.domain.scoring

import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object VirtualBoardScorer {

    const val INNER_BULL_END = 0.10f
    const val OUTER_BULL_END = 0.20f
    const val INNER_SINGLE_END = 0.45f
    const val TRIPLE_END = 0.60f
    const val OUTER_SINGLE_END = 0.80f
    const val DOUBLE_END = 0.92f
    const val BOARD_OUTER_END = 1.00f

    const val SECTOR_SWEEP_DEGREES = 18f
    const val HALF_SECTOR_DEGREES = SECTOR_SWEEP_DEGREES / 2f
    const val DRAW_START_ANGLE_DEGREES = -90f - HALF_SECTOR_DEGREES

    private val SECTOR_SWEEP_RADIANS = (2f * PI.toFloat()) / 20f
    private val HALF_SECTOR_RADIANS = SECTOR_SWEEP_RADIANS / 2f

    private val SECTOR_SCORES = intArrayOf(
        20, 1, 18, 4, 13, 6, 10, 15, 2, 17,
        3, 19, 7, 16, 8, 11, 14, 9, 12, 5
    )

    fun calculateScore(position: DartPosition): ThrowResult {
        val clamped = clampToBoard(position)
        val r = radius(clamped)
        val theta = normalizedTheta(clamped)
        val ring = determineRing(r)
        val sector = when (ring) {
            RingType.INNER_BULL, RingType.OUTER_BULL -> 25
            RingType.MISS -> 0
            else -> determineSector(theta)
        }
        val score = calculateScoreValue(ring, sector)
        return ThrowResult(
            sector = sector,
            ring = ring,
            score = score,
            position = clamped
        )
    }

    fun clampToBoard(position: DartPosition): DartPosition {
        val r = radius(position)
        if (r <= BOARD_OUTER_END || r == 0f) return position
        val scale = BOARD_OUTER_END / r
        return DartPosition(position.x * scale, position.y * scale)
    }

    fun snapToRegionCenter(position: DartPosition): DartPosition {
        val clamped = clampToBoard(position)
        val scored = calculateScore(clamped)

        if (scored.ring == RingType.INNER_BULL) {
            return DartPosition(0f, 0f)
        }

        // 外牛眼保持当前松手点，不强制吸附到环中心，避免看起来“跳动”。
        if (scored.ring == RingType.OUTER_BULL) {
            return clamped
        }

        val r = when (scored.ring) {
            RingType.INNER_BULL -> 0f
            RingType.OUTER_BULL -> radius(clamped)
            RingType.INNER_SINGLE -> (OUTER_BULL_END + INNER_SINGLE_END) / 2f
            RingType.TRIPLE -> (INNER_SINGLE_END + TRIPLE_END) / 2f
            RingType.OUTER_SINGLE -> (TRIPLE_END + OUTER_SINGLE_END) / 2f
            RingType.DOUBLE -> (OUTER_SINGLE_END + DOUBLE_END) / 2f
            RingType.MISS -> (DOUBLE_END + BOARD_OUTER_END) / 2f
        }

        val angleDeg = when (scored.ring) {
            RingType.MISS -> Math.toDegrees(atan2(clamped.y.toDouble(), clamped.x.toDouble())).toFloat()
            else -> {
                val sectorIndex = sectorIndexForScore(scored.sector)
                DRAW_START_ANGLE_DEGREES +
                    sectorIndex * SECTOR_SWEEP_DEGREES +
                    HALF_SECTOR_DEGREES
            }
        }

        val angleRad = Math.toRadians(angleDeg.toDouble())
        val x = (r * cos(angleRad)).toFloat()
        val y = (r * sin(angleRad)).toFloat()
        return DartPosition(x, y)
    }

    fun sectorIndexForScore(sector: Int): Int = SECTOR_SCORES.indexOf(sector).coerceAtLeast(0)

    private fun determineRing(r: Float): RingType {
        return when {
            r < INNER_BULL_END -> RingType.INNER_BULL
            r < OUTER_BULL_END -> RingType.OUTER_BULL
            r < INNER_SINGLE_END -> RingType.INNER_SINGLE
            r < TRIPLE_END -> RingType.TRIPLE
            r < OUTER_SINGLE_END -> RingType.OUTER_SINGLE
            r <= DOUBLE_END -> RingType.DOUBLE
            else -> RingType.MISS
        }
    }

    private fun determineSector(theta: Float): Int {
        val adjusted = normalizeRadians((PI.toFloat() / 2f) - theta + HALF_SECTOR_RADIANS)
        val sectorIndex = (adjusted / SECTOR_SWEEP_RADIANS).toInt().mod(20)
        return SECTOR_SCORES[sectorIndex]
    }

    private fun calculateScoreValue(ring: RingType, sector: Int): Int {
        return when (ring) {
            RingType.INNER_BULL -> 50
            RingType.OUTER_BULL -> 25
            RingType.INNER_SINGLE, RingType.OUTER_SINGLE -> sector
            RingType.TRIPLE -> sector * 3
            RingType.DOUBLE -> sector * 2
            RingType.MISS -> 0
        }
    }

    private fun radius(position: DartPosition): Float {
        return sqrt(position.x * position.x + position.y * position.y)
    }

    private fun normalizedTheta(position: DartPosition): Float {
        return normalizeRadians(atan2(-position.y, position.x))
    }

    private fun normalizeRadians(angle: Float): Float {
        val twoPi = (2f * PI.toFloat())
        var result = angle % twoPi
        if (result < 0f) result += twoPi
        return result
    }
}
