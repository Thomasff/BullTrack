package io.github.thomasff.bulltrack.core.domain.scoring

import io.github.thomasff.bulltrack.core.domain.model.DartPosition
import io.github.thomasff.bulltrack.core.domain.model.RingType
import io.github.thomasff.bulltrack.core.domain.model.ThrowResult
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
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

    // Ring edges of the real board, normalized so 1 is the native rectification scale (the outer
    // edge of the red double segments as the board setup finds them). Measured on the rectified
    // first frames of 7 rounds on the soft-tip board used for development (spread under 0.005);
    // its triple and double rings are wider than a steel-tip board's (0.582-0.629, 0.953-1.0).
    private val REAL_RING_EDGES = floatArrayOf(0f, 0.035f, 0.122f, 0.560f, 0.635f, 0.933f, 0.990f)
    private val VIRTUAL_RING_EDGES = floatArrayOf(
        0f, INNER_BULL_END, OUTER_BULL_END, INNER_SINGLE_END, TRIPLE_END, OUTER_SINGLE_END, DOUBLE_END
    )
    // Real radius 1.15 lands on the virtual board edge; anything further is clamped.
    private const val REAL_MISS_SPAN = 0.15f
    // A tip closer than this to a ring edge or sector line (real board units, about 1 mm) may
    // belong to the neighbouring region, since a small tip error changes the score there. Kept
    // tight at first so only clear cases are flagged (2 mm flagged about a quarter of all darts).
    private const val NEAR_LINE_DISTANCE = 0.006f

    /**
     * Maps a native point (real board proportions) onto the widened virtual board used for
     * scoring and drawing, keeping its angle and moving its radius ring by ring.
     */
    fun fromRealBoard(position: DartPosition): DartPosition {
        val realRadius = radius(position)
        if (realRadius == 0f) return position
        val virtualRadius = if (realRadius >= REAL_RING_EDGES.last()) {
            DOUBLE_END + (realRadius - REAL_RING_EDGES.last()) / REAL_MISS_SPAN * (BOARD_OUTER_END - DOUBLE_END)
        } else {
            val ring = (1 until REAL_RING_EDGES.size).first { realRadius < REAL_RING_EDGES[it] }
            val t = (realRadius - REAL_RING_EDGES[ring - 1]) / (REAL_RING_EDGES[ring] - REAL_RING_EDGES[ring - 1])
            VIRTUAL_RING_EDGES[ring - 1] + t * (VIRTUAL_RING_EDGES[ring] - VIRTUAL_RING_EDGES[ring - 1])
        }
        val scale = virtualRadius / realRadius
        return DartPosition(position.x * scale, position.y * scale)
    }

    /** Whether a native point (real board proportions) lies on or next to a scoring line. */
    fun isNearLine(position: DartPosition): Boolean {
        val r = radius(position)
        if ((1 until REAL_RING_EDGES.size).any { abs(r - REAL_RING_EDGES[it]) < NEAR_LINE_DISTANCE }) {
            return true
        }
        // Sector lines run from the outer bull to the outer double edge.
        if (r <= REAL_RING_EDGES[2] || r >= REAL_RING_EDGES.last()) {
            return false
        }
        val fromLine = normalizeRadians((PI.toFloat() / 2f) - normalizedTheta(position) + HALF_SECTOR_RADIANS) %
            SECTOR_SWEEP_RADIANS
        return r * sin(min(fromLine, SECTOR_SWEEP_RADIANS - fromLine)) < NEAR_LINE_DISTANCE
    }

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
