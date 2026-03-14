package com.zheng.bulltrack.application.usecase

import android.graphics.Bitmap
import com.zheng.bulltrack.BuildConfig
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.camera.RoundFrameSource
import com.zheng.bulltrack.debug.DebugImageSaver
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.DartDetector
import kotlinx.coroutines.delay
import kotlin.math.hypot
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CaptureRoundUseCase(
    private val stateMachine: GameStateMachine,
    private val dartDetector: DartDetector,
    private val frameSource: RoundFrameSource,
    private val debugImageSaver: DebugImageSaver
) {
    private data class RoundSession(
        val nativeSessionId: Long,
        val roundId: String,
        val throws: MutableList<ThrowResult> = mutableListOf(),
        var consumedFrameCount: Int = 1,
        var isDevelopmentExposureFallback: Boolean = false
    )

    private var currentSession: RoundSession? = null
    @Volatile
    private var stopRequested: Boolean = false

    suspend fun startRound(): List<ThrowResult> {
        stopRequested = false
        frameSource.prepareRound()
        val firstFrame = frameSource.captureFirstFrame()
        val nativeSessionId = dartDetector.createSession()
        val roundId = createRoundId()
        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            debugImageSaver.saveRawBitmap(
                roundId = roundId,
                fileName = buildFileName(roundId, 1, "s00_raw_first"),
                bitmap = firstFrame.bitmap
            )
        }
        val startUpdate = runCatching {
            dartDetector.startRound(nativeSessionId, firstFrame.bitmap)
        }.getOrElse { error ->
            dartDetector.destroySession(nativeSessionId)
            frameSource.finishRound()
            throw error
        }
        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            debugImageSaver.saveArtifacts(roundId, startUpdate.debugImages)
        }
        currentSession = RoundSession(
            nativeSessionId = nativeSessionId,
            roundId = roundId,
            isDevelopmentExposureFallback = firstFrame.cameraConfig?.isDevelopmentExposureFallback == true
        )
        val startMessage = firstFrame.cameraConfig?.statusMessage ?: "已拍摄第 1 张图片，开始连续检测"
        stateMachine.startRound(startMessage)

        var sourceExhausted = false
        var frameIndex = 2
        while (!stopRequested) {
            delay(FRAME_INTERVAL_MS)
            val frame = frameSource.captureNextFrame()
            if (frame == null) {
                sourceExhausted = true
                break
            }

            if (BuildConfig.ENABLE_DEBUG_IMAGES) {
                debugImageSaver.saveRawBitmap(
                    roundId = roundId,
                    fileName = buildFileName(roundId, frameIndex, "s00_raw_frame"),
                    bitmap = frame.bitmap
                )
            }
            val shouldStop = processNextFrame(frameIndex = frameIndex, frame = frame.bitmap)
            if (shouldStop) {
                break
            }
            frameIndex += 1
        }

        return finalizeRound(
            manualStop = stopRequested,
            sourceExhausted = sourceExhausted
        )
    }

    fun stopRound() {
        stopRequested = true
    }

    suspend fun redetectRound(): List<ThrowResult> {
        val session = currentSession ?: return emptyList()
        stateMachine.beginProcessing("使用首帧与新拍图片重新识别")

        val redetectFrame = runCatching {
            frameSource.captureRedetectFrame()
        }.getOrElse {
            stateMachine.showDetectedResult(
                throws = session.throws.toList(),
                statusMessage = "重新识别拍照失败，已保留当前结果",
                canRedetect = true
            )
            return session.throws.toList()
        }

        session.consumedFrameCount += 1
        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            debugImageSaver.saveRawBitmap(
                roundId = session.roundId,
                fileName = buildFileName(session.roundId, session.consumedFrameCount, "s00_raw_redetect"),
                bitmap = redetectFrame.bitmap
            )
        }

        val redetected = runCatching {
            dartDetector.redetect(session.nativeSessionId, redetectFrame.bitmap)
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
            statusMessage = "已使用第一张与新拍图片重新识别",
            canRedetect = true
        )
        return normalized
    }

    fun clearRound() {
        currentSession?.let { dartDetector.destroySession(it.nativeSessionId) }
        currentSession = null
        stopRequested = false
        frameSource.finishRound()
    }

    private suspend fun processNextFrame(frameIndex: Int, frame: Bitmap): Boolean {
        val session = currentSession ?: return true
        session.consumedFrameCount = frameIndex

        val frameUpdate = runCatching {
            dartDetector.processFrame(session.nativeSessionId, frame)
        }.getOrElse {
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                "第 $frameIndex 张图片处理失败: ${it.message}"
            )
            return false
        }

        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            debugImageSaver.saveArtifacts(session.roundId, frameUpdate.gateDebugImages)
            debugImageSaver.saveArtifacts(session.roundId, frameUpdate.preciseDebugImages)
        }

        if (!frameUpdate.gateTriggered) {
            val gateMessage = buildString {
                append("第 $frameIndex 张图片未触发精检: ${frameUpdate.gateReason}")
                if (session.isDevelopmentExposureFallback) {
                    append("（开发降级模式）")
                }
            }
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                gateMessage
            )
            return false
        }

        val addedCount = mergeNewThrows(
            existing = session.throws,
            detected = listOfNotNull(frameUpdate.newThrow)
        )
        val statusMessage = if (frameUpdate.newThrow == null) {
            "第 $frameIndex 张图片触发精检，但未识别到新飞镖: ${frameUpdate.gateReason}"
        } else if (addedCount > 0) {
            "第 $frameIndex 张图片识别到新飞镖，当前共 ${session.throws.size} 支"
        } else {
            "第 $frameIndex 张图片触发精检，但结果与已有飞镖重复"
        }
        val finalStatusMessage = if (session.isDevelopmentExposureFallback) {
            "$statusMessage（开发降级模式）"
        } else {
            statusMessage
        }
        stateMachine.updateRoundProgress(session.throws.toList(), finalStatusMessage)
        return session.throws.size >= MAX_DARTS
    }

    private fun finalizeRound(manualStop: Boolean, sourceExhausted: Boolean): List<ThrowResult> {
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
            sourceExhausted -> "帧源已结束，返回当前结果"
            else -> "本轮检测结束"
        }
        val finalStatusMessage = if (session.isDevelopmentExposureFallback) {
            "$statusMessage（开发降级模式）"
        } else {
            statusMessage
        }
        stateMachine.showDetectedResult(finalThrows, finalStatusMessage, canRedetect = true)
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
        private const val DUPLICATE_DISTANCE_THRESHOLD = 0.08
        private val ROUND_ID_FORMAT = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
    }

    private fun createRoundId(): String = ROUND_ID_FORMAT.format(Date())

    private fun buildFileName(roundId: String, frameIndex: Int, stage: String): String {
        return "bt_${roundId}_f${frameIndex.toString().padStart(3, '0')}_$stage.jpg"
    }
}
