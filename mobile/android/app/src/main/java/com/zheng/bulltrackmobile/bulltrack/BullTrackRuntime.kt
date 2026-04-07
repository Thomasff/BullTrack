package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ThemedReactContext

object BullTrackRuntime {

    @Volatile
    private var controller: BullTrackLiveRoundController? = null

    fun get(reactContext: ReactApplicationContext): BullTrackLiveRoundController {
        return controller ?: synchronized(this) {
            controller ?: BullTrackLiveRoundController(reactContext).also {
                controller = it
            }
        }
    }

    fun get(themedReactContext: ThemedReactContext): BullTrackLiveRoundController {
        val appContext = themedReactContext.reactApplicationContext
        return get(appContext)
    }
}
