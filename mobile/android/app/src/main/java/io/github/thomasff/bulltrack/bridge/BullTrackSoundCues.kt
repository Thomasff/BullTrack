package io.github.thomasff.bulltrack.bridge

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import io.github.thomasff.bulltrack.R

// Short game cues for a player standing at the board. SoundPool keeps the few small
// clips decoded in memory, so playing one is cheap and has no start-up delay.
class BullTrackSoundCues(private val context: Context) {

    private var soundPool: SoundPool? = null
    private val soundIds = mutableMapOf<String, Int>()
    private val loadedIds = mutableSetOf<Int>()
    // A cue requested before its clip finished loading; played once it is ready.
    private var pendingSoundId: Int? = null

    // SoundPool decodes asynchronously; load ahead of the first cue to avoid a delay.
    @Synchronized
    fun preload() {
        if (soundPool == null) {
            soundPool = createPool()
        }
    }

    @Synchronized
    fun play(cue: String) {
        val pool = soundPool ?: createPool().also { soundPool = it }
        val soundId = soundIds[cue] ?: return
        if (soundId in loadedIds) {
            pool.play(soundId, 1f, 1f, 1, 0, 1f)
        } else {
            pendingSoundId = soundId
        }
    }

    @Synchronized
    fun release() {
        soundPool?.release()
        soundPool = null
        soundIds.clear()
        loadedIds.clear()
        pendingSoundId = null
    }

    @Synchronized
    private fun onLoaded(pool: SoundPool, soundId: Int) {
        if (pool !== soundPool) {
            return
        }
        loadedIds += soundId
        if (pendingSoundId == soundId) {
            pendingSoundId = null
            pool.play(soundId, 1f, 1f, 1, 0, 1f)
        }
    }

    private fun createPool(): SoundPool {
        val pool = SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .build()
        pool.setOnLoadCompleteListener { loadedPool, soundId, status ->
            if (status == 0) {
                onLoaded(loadedPool, soundId)
            }
        }
        CUE_RESOURCES.forEach { (cue, resId) ->
            soundIds[cue] = pool.load(context, resId, 1)
        }
        return pool
    }

    companion object {
        private val CUE_RESOURCES = mapOf(
            "ready" to R.raw.cue_ready,
            "dart" to R.raw.cue_dart,
            "error" to R.raw.cue_error,
            "double" to R.raw.cue_double,
            "triple" to R.raw.cue_triple,
            "outerBull" to R.raw.cue_outer_bull,
            "innerBull" to R.raw.cue_inner_bull,
        )
    }
}
