package com.zheng.bulltrack.vision

import android.graphics.Bitmap
import com.zheng.bulltrack.domain.model.ThrowResult

interface DartDetector {
    fun init()
    fun createSession(): Long
    fun destroySession(sessionId: Long)
    fun startRound(sessionId: Long, firstFrame: Bitmap): StartRoundDetectionUpdate
    fun processFrame(sessionId: Long, frame: Bitmap): FrameDetectionUpdate
    fun redetect(sessionId: Long, frame: Bitmap): List<ThrowResult>
}
