package io.github.thomasff.bulltrack.core.vision

import android.graphics.Bitmap

interface DartDetector {
    fun init()
    fun warmUp()
    fun createSession(): Long
    fun destroySession(sessionId: Long)
    // rotationDegrees: how far the frame still has to turn clockwise to be upright. softBoard: the
    // player's board is a soft-tip (red-blue) one, which widens the scoring rings.
    fun startRound(
        sessionId: Long,
        firstFrame: Bitmap,
        rotationDegrees: Int = 0,
        softBoard: Boolean = false
    ): StartRoundDetectionUpdate
    fun processFrame(sessionId: Long, frame: Bitmap, rotationDegrees: Int = 0): FrameDetectionUpdate
    fun redetect(sessionId: Long, frame: Bitmap, rotationDegrees: Int = 0): RedetectDetectionUpdate
    // On a manual end: darts the session never confirmed, found by comparing its last frame with
    // the frame of the last confirmation.
    fun findMissedDarts(sessionId: Long): RedetectDetectionUpdate
}
