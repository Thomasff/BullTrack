package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class BullTrackPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == BullTrackModule.NAME) {
            BullTrackModule(reactContext)
        } else {
            null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            val reactModule = checkNotNull(
                BullTrackModule::class.java.getAnnotation(ReactModule::class.java)
            ) { "BullTrackModule is missing @ReactModule metadata." }
            mapOf(
                BullTrackModule.NAME to ReactModuleInfo(
                    reactModule.name,
                    BullTrackModule::class.java.name,
                    reactModule.canOverrideExistingModule,
                    reactModule.needsEagerInit,
                    reactModule.isCxxModule,
                    true,
                ),
            )
        }
    }
}
