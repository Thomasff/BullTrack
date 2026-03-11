package com.zheng.bulltrack.application.usecase

import android.graphics.Bitmap
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.DartDetector
import com.zheng.bulltrack.vision.TrackFrameSource
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.hypot

class CaptureRoundUseCase(
    private val stateMachine: GameStateMachine,
    private val dartDetector: DartDetector,
    private val trackFrameSource: TrackFrameSource
) {
    private data class RoundSession(
        val firstFrame: Bitmap,
        var latestFrame: Bitmap,
        val throws: MutableList<ThrowResult> = mutableListOf(),
        var consumedFrameCount: Int = 1
    )

    private var currentSession: RoundSession? = null
    @Volatile
    private var stopRequested: Boolean = false

    suspend fun startRound(): List<ThrowResult> {
        val frames = trackFrameSource.loadFrames()
        if (frames.isEmpty()) {
            throw IllegalStateException("track 目录中没有可用图片")
        }

        stopRequested = false
        currentSession = RoundSession(
            firstFrame = frames.first(),
            latestFrame = frames.first()
        )
        stateMachine.startRound("已加载第 1 张图片，开始连续检测")

        for ((index, frame) in frames.drop(1).withIndex()) {
            if (stopRequested) {
                break
            }

            delay(FRAME_INTERVAL_MS)
            val shouldStop = processNextFrame(frameIndex = index + 2, frame = frame)
            if (shouldStop) {
                break
            }
        }

        return finalizeRound(manualStop = stopRequested)
    }

    fun stopRound() {
        stopRequested = true
    }

    suspend fun redetectRound(): List<ThrowResult> {
        val session = currentSession ?: return emptyList()
        stateMachine.beginProcessing("使用首尾帧执行重新识别")

        val redetected = runCatching {
            dartDetector.detect(session.firstFrame, session.latestFrame)
        }.getOrElse {
            stateMachine.showDetectedResult(
                throws = session.throws.toList(),
                statusMessage = "重新识别失败，已保留当前结果",
                canRedetect = true
            )
            return session.throws.toList()
        }

        val normalized = redetected.take(MAX_DARTS).toMutableList()
        session.throws.clear()
        session.throws.addAll(normalized)
        stateMachine.showDetectedResult(
            throws = normalized,
            statusMessage = "已使用第一张与最后一张图片重新识别",
            canRedetect = true
        )
        return normalized
    }

    fun clearRound() {
        currentSession = null
        stopRequested = false
    }

    private fun processNextFrame(frameIndex: Int, frame: Bitmap): Boolean {
        val session = currentSession ?: return true
        val previousFrame = session.latestFrame
        session.latestFrame = frame
        session.consumedFrameCount = frameIndex

        if (!shouldTriggerPreciseDetection(previousFrame, frame)) {
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                "第 $frameIndex 张图片未触发精检，继续等待下一帧"
            )
            return false
        }

        val preciseResults = runCatching {
            dartDetector.detect(previousFrame, frame)
        }.getOrElse {
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                "第 $frameIndex 张图片触发精检，但检测失败"
            )
            return false
        }

        val addedCount = mergeNewThrows(session.throws, preciseResults)
        val statusMessage = if (addedCount > 0) {
            "第 $frameIndex 张图片识别到新飞镖，当前共 ${session.throws.size} 支"
        } else {
            "第 $frameIndex 张图片触发精检，但没有新增结果"
        }
        stateMachine.updateRoundProgress(session.throws.toList(), statusMessage)
        return session.throws.size >= MAX_DARTS
    }

    private fun finalizeRound(manualStop: Boolean): List<ThrowResult> {
        val session = currentSession ?: return emptyList()
        val finalThrows = session.throws.toMutableList()
        if (manualStop) {
            while (finalThrows.size < MAX_DARTS) {
                finalThrows += createMissThrow(finalThrows.size)
            }
        }
        session.throws.clear()
        session.throws.addAll(finalThrows)

        val statusMessage = when {
            manualStop -> "本轮已手动结束"
            finalThrows.size >= MAX_DARTS -> "已识别满 3 支飞镖，自动结束"
            session.consumedFrameCount >= TRACK_FRAME_COUNT -> "10 张图片已用完，返回当前结果"
            else -> "本轮检测结束"
        }
        stateMachine.showDetectedResult(finalThrows, statusMessage, canRedetect = true)
        return finalThrows
    }

    private fun mergeNewThrows(
        existing: MutableList<ThrowResult>,
        detected: List<ThrowResult>
    ): Int {
        var added = 0
        detected.forEach { throwResult ->
            if (existing.size >= MAX_DARTS) {
                return@forEach
            }
            val position = throwResult.position ?: return@forEach
            val duplicate = existing.any { existingThrow ->
                val existingPosition = existingThrow.position ?: return@any false
                hypot(
                    (existingPosition.x - position.x).toDouble(),
                    (existingPosition.y - position.y).toDouble()
                ) < DUPLICATE_DISTANCE_THRESHOLD
            }
            if (!duplicate) {
                existing += throwResult
                added += 1
            }
        }
        return added
    }

    private fun shouldTriggerPreciseDetection(before: Bitmap, after: Bitmap): Boolean {
        val sampleWidth = 64
        val sampleHeight = 64
        val scaledBefore = Bitmap.createScaledBitmap(before, sampleWidth, sampleHeight, true)
        val scaledAfter = Bitmap.createScaledBitmap(after, sampleWidth, sampleHeight, true)
        val beforePixels = IntArray(sampleWidth * sampleHeight)
        val afterPixels = IntArray(sampleWidth * sampleHeight)
        scaledBefore.getPixels(beforePixels, 0, sampleWidth, 0, 0, sampleWidth, sampleHeight)
        scaledAfter.getPixels(afterPixels, 0, sampleWidth, 0, 0, sampleWidth, sampleHeight)

        var diffSum = 0L
        for (i in beforePixels.indices) {
            diffSum += abs(luma(beforePixels[i]) - luma(afterPixels[i]))
        }
        val averageDiff = diffSum.toDouble() / beforePixels.size.toDouble()
        return averageDiff >= GATE_DIFF_THRESHOLD
    }

    private fun luma(pixel: Int): Int {
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        return (r * 299 + g * 587 + b * 114) / 1000
    }

    private fun createMissThrow(index: Int): ThrowResult {
        val position = when (index) {
            0 -> DartPosition(1.08f, 0f)
            1 -> DartPosition(-1.08f, 0.08f)
            else -> DartPosition(0f, -1.08f)
        }
        return ThrowResult(
            sector = 0,
            ring = RingType.MISS,
            score = 0,
            position = position
        )
    }

    companion object {
        private const val FRAME_INTERVAL_MS = 1000L
        private const val MAX_DARTS = 3
        private const val TRACK_FRAME_COUNT = 10
        private const val GATE_DIFF_THRESHOLD = 7.5
        private const val DUPLICATE_DISTANCE_THRESHOLD = 0.08
    }
}
