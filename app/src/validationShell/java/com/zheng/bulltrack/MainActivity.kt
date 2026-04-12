package com.zheng.bulltrack

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.zheng.bulltrack.vision.NativeDartDetector
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var detector: NativeDartDetector? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContentView())
    }

    override fun onDestroy() {
        detector?.release()
        detector = null
        super.onDestroy()
    }

    private fun buildContentView(): ScrollView {
        val density = resources.displayMetrics.density
        val padding = (20 * density).toInt()
        val spacing = (12 * density).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val titleView = TextView(this).apply {
            text = "BullTrack Android Validation Shell"
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
        }
        container.addView(titleView)

        val summaryView = TextView(this).apply {
            text =
                "第四阶段后，正式产品 UI 主路径已固定为 mobile/ 下的 React Native 工程。" +
                    "\n当前根目录 app/ 仅保留为最小 Android 验证壳，用于检查 bulltrack-core、JNI/C++ 与基础宿主是否可初始化。"
            textSize = 15f
            setPadding(0, spacing, 0, spacing)
        }
        container.addView(summaryView)

        val statusView = TextView(this).apply {
            text = "状态：尚未执行 native smoke test"
            textSize = 15f
            setPadding(0, 0, 0, spacing)
        }
        container.addView(statusView)

        val actionButton = Button(this).apply {
            text = "初始化并预热 Native Detector"
            isAllCaps = false
            gravity = Gravity.CENTER
            setOnClickListener {
                isEnabled = false
                statusView.text = "状态：正在初始化并预热 native detector..."
                thread(name = "bulltrack-validation-warmup") {
                    val result = runCatching {
                        detector?.release()
                        val nextDetector = NativeDartDetector(assets)
                        nextDetector.init()
                        nextDetector.warmUp()
                        detector = nextDetector
                        "状态：native detector 初始化与预热成功，可继续用 mobile/ 作为正式入口验证完整流程。"
                    }.getOrElse { error ->
                        detector = null
                        "状态：native smoke test 失败：${error.message ?: error.javaClass.simpleName}"
                    }
                    mainHandler.post {
                        statusView.text = result
                        isEnabled = true
                    }
                }
            }
        }
        container.addView(actionButton)

        val noteView = TextView(this).apply {
            text =
                "\n说明：" +
                    "\n1. 这里不再承载旧 Compose 游戏流程。" +
                    "\n2. 要验证完整 live round，请运行 mobile/ 下的 RN 宿主。" +
                    "\n3. 这个壳只用于确认原生库、资源和宿主初始化仍然可用。"
            textSize = 14f
        }
        container.addView(noteView)

        return ScrollView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            addView(container)
        }
    }
}
