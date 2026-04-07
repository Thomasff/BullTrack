package com.zheng.bulltrackmobile.bulltrack

import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import androidx.camera.view.PreviewView
import androidx.fragment.app.Fragment

class BullTrackCameraPreviewFragment : Fragment() {

    private var previewView: PreviewView? = null
    private var attachedPreview = false
    private var waitingForFirstLayout = false
    private var bindRetryPosted = false
    val hostViewId: Int
        get() = requireArguments().getInt(ARG_HOST_VIEW_ID)

    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        BullTrackPreviewDiagnostics.fragmentCreateViewCount += 1
        BullTrackPreviewDiagnostics.mark("fragment.onCreateView")
        Log.e(TAG, "onCreateView hostViewId=$hostViewId")
        return FrameLayout(requireContext()).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            previewView = PreviewView(context).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                )
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            addView(previewView)
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        BullTrackPreviewDiagnostics.fragmentViewCreatedCount += 1
        BullTrackPreviewDiagnostics.mark("fragment.onViewCreated")
        Log.e(TAG, "onViewCreated hostViewId=$hostViewId size=${view.width}x${view.height}")
        view.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
            val width = right - left
            val height = bottom - top
            if (width > 0 && height > 0) {
                Log.e(TAG, "onLayout hostViewId=$hostViewId size=${width}x$height")
                bindPreviewIfPossible()
            }
        }
        waitForMeasuredView(view)
        view.post {
            if (view === this.view) {
                Log.e(TAG, "postLayout hostViewId=$hostViewId size=${view.width}x${view.height}")
                bindPreviewIfPossible()
            }
        }
        bindPreviewIfPossible()
    }

    override fun onStart() {
        super.onStart()
        BullTrackPreviewDiagnostics.fragmentStartCount += 1
        BullTrackPreviewDiagnostics.mark("fragment.onStart")
        Log.e(TAG, "onStart hostViewId=$hostViewId")
        bindPreviewIfPossible()
    }

    override fun onDestroyView() {
        Log.e(TAG, "onDestroyView hostViewId=$hostViewId")
        waitingForFirstLayout = false
        bindRetryPosted = false
        detachPreviewIfBound()
        previewView = null
        super.onDestroyView()
    }

    fun bindPreviewIfPossible() {
        val rootView = view ?: return
        val preview = previewView ?: return
        val isValidView = isAdded && rootView.isAttachedToWindow && rootView.width > 0 && rootView.height > 0
        if (!isValidView) {
            BullTrackPreviewDiagnostics.mark("fragment.bindPreview.skipped.invalidView")
            Log.e(
                TAG,
                "bindPreviewIfPossible skipped. added=$isAdded attached=${rootView.isAttachedToWindow} size=${rootView.width}x${rootView.height}"
            )
            if (!bindRetryPosted) {
                bindRetryPosted = true
                rootView.post {
                    bindRetryPosted = false
                    if (view === rootView) {
                        bindPreviewIfPossible()
                    }
                }
            }
            return
        }
        val reactContext = BullTrackReactContextRegistry.get(hostViewId)
            ?: activity?.let(BullTrackReactContextRegistry::get)
        if (reactContext == null) {
            BullTrackPreviewDiagnostics.mark("fragment.bindPreview.skipped.noReactContext")
            Log.e(TAG, "bindPreviewIfPossible skipped because React context is unavailable.")
            return
        }
        BullTrackPreviewDiagnostics.mark("fragment.bindPreview.attachPreview")
        Log.e(TAG, "bindPreviewIfPossible attachPreview hostViewId=$hostViewId")
        BullTrackRuntime.get(reactContext).attachPreview(preview, reactContext)
        attachedPreview = true
    }

    private fun waitForMeasuredView(rootView: View) {
        if (waitingForFirstLayout) {
            return
        }
        waitingForFirstLayout = true
        val observer = rootView.viewTreeObserver
        observer.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (!rootView.viewTreeObserver.isAlive) {
                    waitingForFirstLayout = false
                    return true
                }
                if (rootView.width <= 0 || rootView.height <= 0) {
                    return true
                }
                rootView.viewTreeObserver.removeOnPreDrawListener(this)
                waitingForFirstLayout = false
                Log.e(TAG, "onPreDraw hostViewId=$hostViewId size=${rootView.width}x${rootView.height}")
                bindPreviewIfPossible()
                return true
            }
        })
    }

    fun detachPreviewIfBound() {
        if (!attachedPreview) {
            return
        }
        val activity = activity ?: return
        val reactContext = BullTrackReactContextRegistry.get(activity) ?: return
        Log.e(TAG, "detachPreviewIfBound hostViewId=$hostViewId")
        BullTrackRuntime.get(reactContext).detachPreview(previewView)
        attachedPreview = false
    }

    companion object {
        private const val TAG = "BullTrackPreviewFrag"
        private const val ARG_HOST_VIEW_ID = "hostViewId"

        fun newInstance(hostViewId: Int): BullTrackCameraPreviewFragment {
            return BullTrackCameraPreviewFragment().apply {
                arguments = Bundle().apply {
                    putInt(ARG_HOST_VIEW_ID, hostViewId)
                }
            }
        }
    }
}
