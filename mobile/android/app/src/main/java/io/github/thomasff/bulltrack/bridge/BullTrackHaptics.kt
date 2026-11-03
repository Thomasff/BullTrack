package io.github.thomasff.bulltrack.bridge

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

// Light tick while a dart marker is dragged into a new board region.
class BullTrackHaptics(context: Context) {

    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    fun tick() {
        val target = vibrator?.takeIf { it.hasVibrator() } ?: return
        val effect =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
            } else {
                VibrationEffect.createOneShot(TICK_MS, TICK_AMPLITUDE)
            }
        target.vibrate(effect)
    }

    private companion object {
        const val TICK_MS = 12L
        const val TICK_AMPLITUDE = 60
    }
}
