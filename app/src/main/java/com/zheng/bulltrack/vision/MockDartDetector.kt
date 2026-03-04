package com.zheng.bulltrack.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.zheng.bulltrack.domain.model.ThrowResult

class MockDartDetector(
    private val context: Context,
    private val delegate: NativeDartDetector = NativeDartDetector()
) : DartDetector {

    private var debugBeforeBitmap: Bitmap? = null
    private var debugAfterBitmap: Bitmap? = null

    override fun init() {
        delegate.init()
        loadDebugBitmapsIfNeeded()
    }

    override fun detect(before: Bitmap, after: Bitmap): List<ThrowResult> {
        loadDebugBitmapsIfNeeded()
        val debugBefore = debugBeforeBitmap
        val debugAfter = debugAfterBitmap
        return if (debugBefore != null && debugAfter != null) {
            delegate.detect(debugBefore, debugAfter)
        } else {
            delegate.detect(before, after)
        }
    }

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
