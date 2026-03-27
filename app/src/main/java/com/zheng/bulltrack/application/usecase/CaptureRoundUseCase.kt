package com.zheng.bulltrack.application.usecase

import android.os.SystemClock
import android.graphics.Bitmap
import com.zheng.bulltrack.BuildConfig
import com.zheng.bulltrack.application.statemachine.GameStateMachine
import com.zheng.bulltrack.camera.RoundFrameSource
import com.zheng.bulltrack.debug.DebugImageSaver
import com.zheng.bulltrack.domain.model.DartPosition
import com.zheng.bulltrack.domain.model.RingType
import com.zheng.bulltrack.domain.model.ThrowResult
import com.zheng.bulltrack.vision.DartDetector
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.hypot

class CaptureRoundUseCase(
    private val stateMachine: GameStateMachine,
    private val dartDetector: DartDetector,
    private val frameSource: RoundFrameSource,
    private val debugImageSaver: DebugImageSaver
) {
    private data class FrameLoopDecision(
        val shouldStop: Boolean,
        val captureNextImmediately: Boolean = false
    )

    private data class RoundSession(
        val nativeSessionId: Long,
        val roundId: String,
        val throws: MutableList<ThrowResult> = mutableListOf(),
        var consumedFrameCount: Int = 1
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
        val startUpdate = runCatching {
            withContext(Dispatchers.Default) {
                dartDetector.startRound(nativeSessionId, firstFrame.bitmap)
            }
        }.getOrElse { error ->
            dartDetector.destroySession(nativeSessionId)
            frameSource.finishRound()
            throw error
        }
        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            withContext(Dispatchers.IO) {
                debugImageSaver.saveArtifacts(roundId, startUpdate.debugImages)
            }
        }
        currentSession = RoundSession(
            nativeSessionId = nativeSessionId,
            roundId = roundId
        )
        val startMessage = firstFrame.cameraConfig?.statusMessage ?: "已拍摄第 1 张图片，开始连续检测"
        stateMachine.startRound(startMessage)

        var sourceExhausted = false
        var frameIndex = 2
        var lastCaptureTimestampNs = firstFrame.timestampNs
        var captureNextImmediately = false
        while (!stopRequested) {
            if (!captureNextImmediately) {
                waitUntilNextFrameWindow(lastCaptureTimestampNs)
            }
            val frame = frameSource.captureNextFrame()
            if (frame == null) {
                sourceExhausted = true
                break
            }
            lastCaptureTimestampNs = frame.timestampNs
            val decision = processNextFrame(frameIndex = frameIndex, frame = frame.bitmap)
            captureNextImmediately = decision.captureNextImmediately
            if (decision.shouldStop) {
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
        val redetectUpdate = runCatching {
            withContext(Dispatchers.Default) {
                dartDetector.redetect(session.nativeSessionId, redetectFrame.bitmap)
            }
        }.getOrElse {
            stateMachine.showDetectedResult(
                throws = session.throws.toList(),
                statusMessage = "重新识别失败，已保留当前结果",
                canRedetect = true
            )
            return session.throws.toList()
        }

        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            withContext(Dispatchers.IO) {
                debugImageSaver.saveArtifacts(session.roundId, redetectUpdate.debugImages)
            }
        }

        val normalized = redetectUpdate.throws.take(MAX_DARTS).toMutableList()
        session.throws.clear()
        session.throws.addAll(normalized)
        stateMachine.showDetectedResult(
            throws = normalized,
            statusMessage = buildString {
                append("已使用第一张与新拍图片重新识别")
                if (!redetectUpdate.yoloStatus.isNullOrBlank()) {
                    append("（YOLO: ${redetectUpdate.yoloStatus}）")
                }
            },
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

    private suspend fun waitUntilNextFrameWindow(lastCaptureTimestampNs: Long) {
        val nowNs = SystemClock.elapsedRealtimeNanos()
        val elapsedNs = nowNs - lastCaptureTimestampNs
        if (elapsedNs < 0L) {
            return
        }
        var remainingMs = FRAME_INTERVAL_MS - (elapsedNs / NANOS_PER_MILLISECOND)
        while (!stopRequested && remainingMs > 0) {
            val stepMs = remainingMs.coerceAtMost(FRAME_WAIT_SLICE_MS)
            delay(stepMs)
            remainingMs -= stepMs
        }
    }

    private suspend fun processNextFrame(frameIndex: Int, frame: Bitmap): FrameLoopDecision {
        val session = currentSession ?: return FrameLoopDecision(shouldStop = true)
        session.consumedFrameCount = frameIndex

        val frameUpdate = runCatching {
            withContext(Dispatchers.Default) {
                dartDetector.processFrame(session.nativeSessionId, frame)
            }
        }.getOrElse {
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                "第 $frameIndex 张图片处理失败: ${it.message}"
            )
            return FrameLoopDecision(shouldStop = false)
        }

        if (BuildConfig.ENABLE_DEBUG_IMAGES) {
            withContext(Dispatchers.IO) {
                debugImageSaver.saveArtifacts(session.roundId, frameUpdate.gateDebugImages)
                debugImageSaver.saveArtifacts(session.roundId, frameUpdate.preciseDebugImages)
            }
        }

        if (!frameUpdate.gateTriggered) {
            val gateMessage = "第 $frameIndex 张图片未触发精检: ${describeGateReason(frameUpdate.gateReason)}"
            stateMachine.updateRoundProgress(
                session.throws.toList(),
                gateMessage
            )
            return FrameLoopDecision(
                shouldStop = false,
                captureNextImmediately = frameUpdate.gateReason == "yolo_count_increased_wait_next_frame"
            )
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
        stateMachine.updateRoundProgress(session.throws.toList(), statusMessage)
        return FrameLoopDecision(shouldStop = session.throws.size >= MAX_DARTS)
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

    private fun describeGateReason(gateReason: String): String {
        return when {
            gateReason == "yolo_count_not_increased" -> "YOLO 飞镖数量未增加"
            gateReason == "yolo_count_increased_wait_next_frame" -> "YOLO 飞镖数量增加，等待下一张确认"
            gateReason == "yolo_count_not_stable" -> "YOLO 飞镖数量未稳定"
            gateReason == "yolo_new_dart_box_not_resolved" -> "YOLO 未能唯一确定新增飞镖框"
            gateReason.startsWith("yolo_detect_failed:") -> "YOLO 检测失败"
            gateReason.isBlank() -> "未知原因"
            else -> gateReason
        }
    }

    companion object {
        private const val FRAME_INTERVAL_MS = 333L
        private const val FRAME_WAIT_SLICE_MS = 50L
        private const val NANOS_PER_MILLISECOND = 1_000_000L
        private const val MAX_DARTS = 3
        private const val DUPLICATE_DISTANCE_THRESHOLD = 0.08
        private val ROUND_ID_FORMAT = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
    }

    private fun createRoundId(): String = ROUND_ID_FORMAT.format(Date())

    private fun buildFileName(roundId: String, frameIndex: Int, stage: String): String {
        return "bt_${roundId}_f${frameIndex.toString().padStart(3, '0')}_$stage.jpg"
    }
}
