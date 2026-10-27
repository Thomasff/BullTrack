package com.zheng.bulltrackmobile.bulltrack

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

// Rendered through the new architecture's interop layer (requireNativeComponent on the JS side).
class BullTrackPreviewViewManager : SimpleViewManager<BullTrackPreviewView>() {

    override fun getName(): String = REACT_NAME

    override fun createViewInstance(reactContext: ThemedReactContext): BullTrackPreviewView {
        return BullTrackPreviewView(reactContext)
    }

    @ReactProp(name = "zoomRatio", defaultFloat = 1f)
    fun setZoomRatio(view: BullTrackPreviewView, zoomRatio: Float) {
        view.setZoomRatio(zoomRatio)
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
        return mapOf(
            PreviewStateChangeEvent.EVENT_NAME to mapOf("registrationName" to "onPreviewStateChange")
        )
    }

    companion object {
        const val REACT_NAME = "BullTrackPreview"
    }
}
