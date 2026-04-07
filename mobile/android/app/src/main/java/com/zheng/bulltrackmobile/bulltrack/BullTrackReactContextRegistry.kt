package com.zheng.bulltrackmobile.bulltrack

import androidx.fragment.app.FragmentActivity
import com.facebook.react.uimanager.ThemedReactContext
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

object BullTrackReactContextRegistry {

    private val contexts = ConcurrentHashMap<Int, WeakReference<ThemedReactContext>>()
    private val hostViewContexts = ConcurrentHashMap<Int, WeakReference<ThemedReactContext>>()

    fun register(activity: FragmentActivity, reactContext: ThemedReactContext) {
        contexts[activity.hashCode()] = WeakReference(reactContext)
    }

    fun registerHostView(hostViewId: Int, reactContext: ThemedReactContext) {
        hostViewContexts[hostViewId] = WeakReference(reactContext)
    }

    fun unregister(activity: FragmentActivity, reactContext: ThemedReactContext) {
        val key = activity.hashCode()
        val current = contexts[key]?.get()
        if (current == reactContext) {
            contexts.remove(key)
        }
    }

    fun unregisterHostView(hostViewId: Int, reactContext: ThemedReactContext) {
        val current = hostViewContexts[hostViewId]?.get()
        if (current == reactContext) {
            hostViewContexts.remove(hostViewId)
        }
    }

    fun get(activity: FragmentActivity): ThemedReactContext? {
        val key = activity.hashCode()
        val context = contexts[key]?.get()
        if (context == null) {
            contexts.remove(key)
        }
        return context
    }

    fun get(hostViewId: Int): ThemedReactContext? {
        val context = hostViewContexts[hostViewId]?.get()
        if (context == null) {
            hostViewContexts.remove(hostViewId)
        }
        return context
    }
}
