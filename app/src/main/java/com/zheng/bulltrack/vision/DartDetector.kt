package com.zheng.bulltrack.vision

import android.graphics.Bitmap

interface DartDetector {
    fun init()
    fun warmUp()
    fun createSession(): Long
    fun destroySession(sessionId: Long)
    // rotationDegrees: how far the frame still has to turn clockwise to be upright.
    fun startRound(sessionId: Long, firstFrame: Bitmap, rotationDegrees: Int = 0): StartRoundDetectionUpdate
    fun processFrame(sessionId: Long, frame: Bitmap, rotationDegrees: Int = 0): FrameDetectionUpdate
    fun redetect(sessionId: Long, frame: Bitmap, rotationDegrees: Int = 0): RedetectDetectionUpdate
    // On a manual end: darts the session never confirmed, found by comparing its last frame with
    // the frame of the last confirmation.
    fun findMissedDarts(sessionId: Long): RedetectDetectionUpdate
}
