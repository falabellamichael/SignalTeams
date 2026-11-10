package dev.agenthive.watch

import android.media.MediaPlayer
import android.util.Log
import dev.agenthive.watch.data.HiveApi
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Speaks assistant replies through the watch speaker — fetches synthesized
 * audio from the hive's TTS model (kokoro via /api/llm/tts) and plays it.
 * Everything fails soft: no TTS model, no audio, or a dead bridge → the
 * reply just stays text.
 */
class Speaker(private val api: HiveApi) {

    @Volatile
    var enabled: Boolean = false

    private var player: MediaPlayer? = null

    /** True while synthesized audio is actually playing — the dock shows Stop. */
    val speaking = MutableStateFlow(false)

    /** Human-speakable text: strip markdown/tool scaffolding, cap length. */
    private fun speakable(raw: String): String {
        var t = raw
        t = t.replace(Regex("```[\\s\\S]*?```"), " code ")
        t = t.replace(Regex("`([^`]*)`"), "$1")
        t = t.replace(Regex("https?://\\S+"), "link")
        t = t.replace(Regex("[*_#>|]"), " ")
        t = t.replace(Regex("\\[([^]]*)]\\([^)]*\\)"), "$1")
        t = t.replace(Regex("\\s+"), " ").trim()
        return t.take(800)
    }

    fun stop() {
        runCatching { player?.takeIf { it.isPlaying }?.stop() }
        runCatching { player?.release() }
        player = null
        speaking.value = false
    }

    suspend fun speak(text: String) {
        if (!enabled) return
        val say = speakable(text)
        if (say.length < 2) return
        val bytes = api.ttsBytes(say) ?: return      // no TTS → text only
        try {
            stop()
            val f = File.createTempFile("hive_tts", ".mp3")
            f.writeBytes(bytes)
            player = MediaPlayer().apply {
                setDataSource(f.absolutePath)
                prepare()
                setOnCompletionListener { speaking.value = false }
                start()
            }
            speaking.value = true
            f.delete()
        } catch (e: Exception) {
            Log.w("HiveSpeaker", "playback failed: ${e.message}")
        }
    }
}
