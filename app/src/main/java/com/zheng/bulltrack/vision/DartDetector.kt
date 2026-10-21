package com.zheng.bulltrack.vision

import android.graphics.Bitmap

interface DartDetector {
    fun init()
    fun warmUp()
    fun createSession(): Long
    fun destroySession(sessionId: Long)
    fun startRound(sessionId: Long, firstFrame: Bitmap): StartRoundDetectionUpdate
    fun processFrame(sessionId: Long, frame: Bitmap): FrameDetectionUpdate
    fun redetect(sessionId: Long, frame: Bitmap): RedetectDetectionUpdate
    // On a manual end: darts the session never confirmed, found by comparing its last frame with
    // the frame of the last confirmation.
    fun findMissedDarts(sessionId: Long): RedetectDetectionUpdate
}
