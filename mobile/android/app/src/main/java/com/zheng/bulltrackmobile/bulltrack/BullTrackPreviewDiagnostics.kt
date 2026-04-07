package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

object BullTrackPreviewDiagnostics {
    @Volatile var createViewManagersCount: Int = 0
    @Volatile var createViewInstanceCount: Int = 0
    @Volatile var viewAttachedCount: Int = 0
    @Volatile var hostAttachFragmentCount: Int = 0
    @Volatile var fragmentCreateViewCount: Int = 0
    @Volatile var fragmentViewCreatedCount: Int = 0
    @Volatile var fragmentStartCount: Int = 0
    @Volatile var controllerAttachPreviewCount: Int = 0
    @Volatile var lastStep: String = "idle"

    fun mark(step: String) {
        lastStep = step
    }

    fun toWritableMap(): WritableMap {
        return Arguments.createMap().apply {
            putInt("createViewManagersCount", createViewManagersCount)
            putInt("createViewInstanceCount", createViewInstanceCount)
            putInt("viewAttachedCount", viewAttachedCount)
            putInt("hostAttachFragmentCount", hostAttachFragmentCount)
            putInt("fragmentCreateViewCount", fragmentCreateViewCount)
            putInt("fragmentViewCreatedCount", fragmentViewCreatedCount)
            putInt("fragmentStartCount", fragmentStartCount)
            putInt("controllerAttachPreviewCount", controllerAttachPreviewCount)
            putString("lastStep", lastStep)
        }
    }
}
