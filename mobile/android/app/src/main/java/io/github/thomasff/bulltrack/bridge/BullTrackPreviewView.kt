package io.github.thomasff.bulltrack.bridge

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

// The Game screen's idle camera preview. It binds the shared native camera while attached and
// lets go of it when detached, so the camera is closed whenever the preview is not on screen.
// No Fragment is involved: the PreviewView sits directly inside this React-managed view.
@SuppressLint("ViewConstructor")
class BullTrackPreviewView(
    private val reactContext: ThemedReactContext
) : FrameLayout(reactContext) {

    private val previewView = PreviewView(reactContext).apply {
        // A TextureView scrolls and clips with the page like any other view.
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }
    private var streaming = false
    private val streamObserver = Observer<PreviewView.StreamState> { state ->
        val isStreaming = state == PreviewView.StreamState.STREAMING
        if (isStreaming != streaming) {
            streaming = isStreaming
            dispatchStreamingChange(isStreaming)
        }
    }

    init {
        setBackgroundColor(Color.BLACK)
        installHierarchyFitter()
        previewView.installHierarchyFitter()
        addView(previewView)
    }

    fun setZoomRatio(zoomRatio: Float) {
        BullTrackRuntime.get(reactContext).setPreviewZoomRatio(zoomRatio)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        (reactContext.currentActivity as? LifecycleOwner)?.let { owner ->
            previewView.previewStreamState.observe(owner, streamObserver)
        }
        BullTrackRuntime.get(reactContext).attachPreview(previewView)
    }

    override fun onDetachedFromWindow() {
        previewView.previewStreamState.removeObserver(streamObserver)
        BullTrackRuntime.get(reactContext).detachPreview(previewView)
        if (streaming) {
            streaming = false
            dispatchStreamingChange(false)
        }
        super.onDetachedFromWindow()
    }

    private fun dispatchStreamingChange(isStreaming: Boolean) {
        val event = PreviewStateChangeEvent(UIManagerHelper.getSurfaceId(this), id, isStreaming)
        UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(event)
    }
}

class PreviewStateChangeEvent(
    surfaceId: Int,
    viewId: Int,
    private val streaming: Boolean,
) : Event<PreviewStateChangeEvent>(surfaceId, viewId) {
    override fun getEventName() = EVENT_NAME

    override fun getEventData(): WritableMap = Arguments.createMap().apply {
        putBoolean("streaming", streaming)
    }

    companion object {
        const val EVENT_NAME = "topPreviewStateChange"
    }
}

// React Native only lays out the views it created, so a child added natively (the PreviewView here,
// and the TextureView the PreviewView adds once the camera starts) would keep a zero size and show
// nothing. Measure and lay out the parent again whenever a child is added.
private fun ViewGroup.installHierarchyFitter() {
    setOnHierarchyChangeListener(object : ViewGroup.OnHierarchyChangeListener {
        override fun onChildViewRemoved(parent: View?, child: View?) = Unit

        override fun onChildViewAdded(parent: View?, child: View?) {
            parent?.measure(
                View.MeasureSpec.makeMeasureSpec(measuredWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(measuredHeight, View.MeasureSpec.EXACTLY)
            )
            parent?.layout(0, 0, parent.measuredWidth, parent.measuredHeight)
        }
    })
}
