package com.zheng.bulltrackmobile.bulltrack

import android.util.Log
import android.view.View
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.viewmanagers.BullTrackCameraPreviewManagerDelegate
import com.facebook.react.viewmanagers.BullTrackCameraPreviewManagerInterface

class BullTrackCameraPreviewViewManager :
    SimpleViewManager<BullTrackCameraPreviewHostView>(),
    BullTrackCameraPreviewManagerInterface<BullTrackCameraPreviewHostView> {

    private val delegate: ViewManagerDelegate<BullTrackCameraPreviewHostView> =
        BullTrackCameraPreviewManagerDelegate(this)

    override fun getName(): String = REACT_NAME

    override fun getDelegate(): ViewManagerDelegate<BullTrackCameraPreviewHostView> = delegate

    override fun createViewInstance(reactContext: ThemedReactContext): BullTrackCameraPreviewHostView {
        Log.e(REACT_NAME, "createViewInstance")
        BullTrackPreviewDiagnostics.createViewInstanceCount += 1
        BullTrackPreviewDiagnostics.mark("viewManager.createViewInstance")
        return BullTrackCameraPreviewHostView(reactContext).also { hostView ->
            hostView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(view: View) {
                    Log.e(REACT_NAME, "onViewAttachedToWindow")
                    BullTrackPreviewDiagnostics.viewAttachedCount += 1
                    BullTrackPreviewDiagnostics.mark("viewManager.onViewAttachedToWindow")
                    hostView.attachFragment(reactContext)
                }

                override fun onViewDetachedFromWindow(view: View) {
                    Log.e(REACT_NAME, "onViewDetachedFromWindow")
                    hostView.detachFragment(reactContext)
                }
            })
            hostView.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                val width = right - left
                val height = bottom - top
                if (width > 0 && height > 0 && hostView.isAttachedToWindow) {
                    Log.e(REACT_NAME, "onLayout width=$width height=$height")
                    BullTrackPreviewDiagnostics.mark("viewManager.onLayout")
                    hostView.attachFragment(reactContext)
                }
            }
        }
    }

    override fun onDropViewInstance(view: BullTrackCameraPreviewHostView) {
        if (view.context is ThemedReactContext) {
            view.detachFragment(view.context as ThemedReactContext)
        }
        super.onDropViewInstance(view)
    }

    companion object {
        const val REACT_NAME = "BullTrackCameraPreview"
    }
}
