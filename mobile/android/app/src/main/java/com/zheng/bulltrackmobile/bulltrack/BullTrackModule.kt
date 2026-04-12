package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.zheng.bulltrackmobile.specs.NativeBullTrackModuleSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@ReactModule(name = BullTrackModule.NAME)
class BullTrackModule(
    reactContext: ReactApplicationContext
) : NativeBullTrackModuleSpec(reactContext) {

    private val controller = BullTrackRuntime.get(reactContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun prepareRoundCamera(promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.prepareRoundCamera()
        }
    }

    override fun startLiveRound(request: ReadableMap, promise: Promise) {
        resolvePromise(promise) {
            controller.startLiveRound()
        }
    }

    override fun stopLiveRound(promise: Promise) {
        resolvePromise(promise) {
            controller.stopLiveRound()
        }
    }

    override fun redetectCurrentRound(request: ReadableMap, promise: Promise) {
        scope.launch {
            runCatching {
                val roundId = request.getString("roundId")
                    ?: error("Missing required string field: roundId")
                controller.redetectCurrentRound(roundId)
            }.onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_REDETECT_FAILED", error.message, error) }
        }
    }

    override fun finishRound(request: ReadableMap, promise: Promise) {
        resolveSuspendPromise(promise) {
            val roundId = request.getString("roundId")
                ?: error("Missing required string field: roundId")
            controller.finishRound(roundId)
        }
    }

    override fun loadDebugArtifacts(roundId: String, promise: Promise) {
        resolvePromise(promise) {
            controller.loadDebugArtifacts(roundId)
        }
    }

    override fun setZoomRatio(zoomRatio: Double, promise: Promise) {
        resolveSuspendPromise(promise) {
            controller.setZoomRatio(zoomRatio)
        }
    }

    override fun getPreviewDiagnostics(promise: Promise) {
        promise.resolve(BullTrackPreviewDiagnostics.toWritableMap())
    }

    override fun addListener(eventName: String) = Unit

    override fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        controller.invalidate()
        super.invalidate()
    }

    override fun getName(): String = NAME

    private fun resolvePromise(promise: Promise, work: () -> Any) {
        scope.launch {
            runCatching(work)
                .onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_NATIVE_FAILED", error.message, error) }
        }
    }

    private fun resolveSuspendPromise(promise: Promise, work: suspend () -> Any) {
        scope.launch {
            runCatching { work() }
                .onSuccess(promise::resolve)
                .onFailure { error -> promise.reject("BT_NATIVE_FAILED", error.message, error) }
        }
    }

    companion object {
        const val NAME = "BullTrackModule"
    }
}
