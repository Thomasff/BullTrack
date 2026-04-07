package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BullTrackPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(BullTrackModule(reactContext))
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> {
        BullTrackPreviewDiagnostics.createViewManagersCount += 1
        BullTrackPreviewDiagnostics.mark("package.createViewManagers")
        return listOf(BullTrackCameraPreviewViewManager())
    }
}
