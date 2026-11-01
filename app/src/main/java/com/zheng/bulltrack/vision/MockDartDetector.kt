package com.zheng.bulltrack.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
class MockDartDetector(
    private val context: Context,
    private val delegate: NativeDartDetector = NativeDartDetector(context.assets)
) : DartDetector {

    private var debugBeforeBitmap: Bitmap? = null
    private var debugAfterBitmap: Bitmap? = null
    private var debugProcessCount: Int = 0

    override fun init() {
        delegate.init()
        // This smoke-test shell exists to inspect the native chain, so it always wants debug images.
        delegate.setDebugImagesEnabled(true)
        loadDebugBitmapsIfNeeded()
    }

    override fun warmUp() {
        delegate.warmUp()
    }

    override fun createSession(): Long {
        debugProcessCount = 0
        return delegate.createSession()
    }

    override fun destroySession(sessionId: Long) {
        delegate.destroySession(sessionId)
    }

    override fun startRound(
        sessionId: Long,
        firstFrame: Bitmap,
        rotationDegrees: Int,
        softBoard: Boolean
    ): StartRoundDetectionUpdate {
        loadDebugBitmapsIfNeeded()
        val debugBefore = debugBeforeBitmap
        return if (debugBefore != null) {
            delegate.startRound(sessionId, debugBefore, softBoard = softBoard)
        } else {
            delegate.startRound(sessionId, firstFrame, rotationDegrees, softBoard)
        }
    }

    override fun processFrame(sessionId: Long, frame: Bitmap, rotationDegrees: Int): FrameDetectionUpdate {
        loadDebugBitmapsIfNeeded()
        debugProcessCount += 1
        val debugAfter = if (debugProcessCount == 1) debugAfterBitmap else null
        return if (debugAfter != null) {
            delegate.processFrame(sessionId, debugAfter)
        } else {
            delegate.processFrame(sessionId, frame, rotationDegrees)
        }
    }

    override fun redetect(sessionId: Long, frame: Bitmap, rotationDegrees: Int): RedetectDetectionUpdate {
        loadDebugBitmapsIfNeeded()
        val debugAfter = debugAfterBitmap
        return if (debugAfter != null) {
            delegate.redetect(sessionId, debugAfter)
        } else {
            delegate.redetect(sessionId, frame, rotationDegrees)
        }
    }

    override fun findMissedDarts(sessionId: Long): RedetectDetectionUpdate =
        delegate.findMissedDarts(sessionId)

    private fun loadDebugBitmapsIfNeeded() {
        if (debugBeforeBitmap != null && debugAfterBitmap != null) {
            return
        }

        debugBeforeBitmap = runCatching {
            context.assets.open("before.jpg").use(BitmapFactory::decodeStream)
        }.getOrNull()

        debugAfterBitmap = runCatching {
            context.assets.open("after.jpg").use(BitmapFactory::decodeStream)
        }.getOrNull()
    }
}
