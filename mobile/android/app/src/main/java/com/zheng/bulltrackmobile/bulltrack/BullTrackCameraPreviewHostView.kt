package com.zheng.bulltrackmobile.bulltrack

import android.content.Context
import android.graphics.Color
import android.util.Log
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentContainerView
import com.facebook.react.uimanager.ThemedReactContext

class BullTrackCameraPreviewHostView(
    context: Context
) : FrameLayout(context) {

    private var fragmentTag: String = "BullTrackCameraPreviewFragment:${ViewId.next()}"
    private var registeredActivity: FragmentActivity? = null
    private val fragmentContainerId = ViewId.next()
    private val fragmentContainerView =
        FragmentContainerView(context).apply {
            id = fragmentContainerId
            layoutParams = LayoutParams(
                LayoutParams.MATCH_PARENT,
                LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.BLACK)
        }

    init {
        id = ViewId.next()
        setBackgroundColor(Color.BLACK)
        layoutParams = LayoutParams(
            LayoutParams.MATCH_PARENT,
            LayoutParams.MATCH_PARENT,
        )
        addView(fragmentContainerView)
        Log.e(TAG, "host view created. id=$id")
    }

    fun attachFragment(reactContext: ThemedReactContext) {
        BullTrackPreviewDiagnostics.hostAttachFragmentCount += 1
        BullTrackPreviewDiagnostics.mark("hostView.attachFragment")
        if (!isAttachedToWindow) {
            Log.e(TAG, "attachFragment skipped because host is not attached. id=$id")
            return
        }
        val activity = reactContext.currentActivity as? FragmentActivity
            ?: reactContext.reactApplicationContext.currentActivity as? FragmentActivity
        if (activity == null) {
            BullTrackRuntime.get(reactContext).markPreviewUnavailable(
                statusMessage = "预览宿主未就绪，等待 Activity 绑定",
                lockReason = "FragmentActivity unavailable",
            )
            return
        }
        Log.e(
            TAG,
            "attachFragment start. id=$id activity=${activity.javaClass.simpleName} size=${width}x$height"
        )
        registeredActivity = activity
        BullTrackReactContextRegistry.register(activity, reactContext)
        BullTrackReactContextRegistry.registerHostView(id, reactContext)
        post {
            if (!isAttachedToWindow) {
                Log.e(TAG, "attachFragment post skipped because host detached. id=$id")
                return@post
            }
            val manager = activity.supportFragmentManager
            val existing = manager.findFragmentByTag(fragmentTag) as? BullTrackCameraPreviewFragment
            if (existing != null && existing.hostViewId == id) {
                Log.e(TAG, "attachFragment reused fragment. id=$id")
                existing.bindPreviewIfPossible()
                return@post
            }
            if (manager.isStateSaved) {
                BullTrackRuntime.get(reactContext).markPreviewUnavailable(
                    statusMessage = "预览宿主状态已保存，等待页面恢复",
                    lockReason = "FragmentManager state is saved",
                )
                return@post
            }
            Log.e(TAG, "attachFragment commit fragment. id=$id tag=$fragmentTag")
            manager.beginTransaction()
                .replace(fragmentContainerId, BullTrackCameraPreviewFragment.newInstance(id), fragmentTag)
                .commitNowAllowingStateLoss()
            requestLayout()
            invalidate()
        }
    }

    fun detachFragment(reactContext: ThemedReactContext) {
        val activity = reactContext.currentActivity as? FragmentActivity
            ?: reactContext.reactApplicationContext.currentActivity as? FragmentActivity
        if (activity == null) {
            Log.e(TAG, "detachFragment without activity. id=$id")
            BullTrackRuntime.get(reactContext).detachPreview()
            return
        }
        val manager = activity.supportFragmentManager
        val fragment = manager.findFragmentByTag(fragmentTag) as? BullTrackCameraPreviewFragment
        Log.e(TAG, "detachFragment. id=$id fragmentFound=${fragment != null}")
        fragment?.detachPreviewIfBound()
        registeredActivity?.let { BullTrackReactContextRegistry.unregister(it, reactContext) }
        BullTrackReactContextRegistry.unregisterHostView(id, reactContext)
        registeredActivity = null
        if (manager.isStateSaved || fragment == null) {
            return
        }
        manager.beginTransaction()
            .remove(fragment)
            .commitNowAllowingStateLoss()
    }

    companion object {
        private const val TAG = "BullTrackPreviewHost"
    }
}

private object ViewId {
    private var nextId = 1_000_000

    @Synchronized
    fun next(): Int {
        return nextId++
    }
}
