package dev.agenthive.watch

import android.content.Context
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import dev.agenthive.watch.data.HiveApi
import java.io.File
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Speaks assistant replies through the watch speaker — fetches synthesized
 * audio from the hive's TTS model (kokoro via /api/llm/tts) and plays it,
 * falling back to the on-device TextToSpeech engine (com.google.android.tts
 * ships on every Wear watch) so replies still speak when the mesh is down —
 * the same offline-voice path the built-in assistant uses.
 */
class Speaker(private val api: HiveApi, private val ctx: Context) {

    @Volatile
    var enabled: Boolean = false

    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

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
        runCatching { tts?.stop() }
        speaking.value = false
    }

    /** Lazily bring up the system TTS engine — init is async, await it. */
    private suspend fun ensureTts(): TextToSpeech? {
        if (ttsReady) return tts
        return suspendCancellableCoroutine { cont ->
            runCatching {
                tts = TextToSpeech(ctx.applicationContext) { status ->
                    ttsReady = true
                    if (status == TextToSpeech.SUCCESS) {
                        tts?.setSpeechRate(1.05f)
                        tts?.setOnUtteranceProgressListener(
                            object : UtteranceProgressListener() {
                                override fun onStart(id: String?) {}
                                override fun onDone(id: String?) {
                                    speaking.value = false
                                }
                                @Deprecated("deprecated")
                                override fun onError(id: String?) {
                                    speaking.value = false
                                }
                            })
                    } else {
                        Log.w("HiveSpeaker", "on-device TTS init failed: $status")
                        tts = null
                    }
                    if (cont.isActive) cont.resume(tts)
                }
            }.onFailure {
                ttsReady = true
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    suspend fun speak(text: String) {
        if (!enabled) return
        val say = speakable(text)
        if (say.length < 2) return
        val bytes = api.ttsBytes(say)
        if (bytes != null) {
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
                return
            } catch (e: Exception) {
                Log.w("HiveSpeaker", "playback failed: ${e.message}")
            }
        }
        // backend TTS unavailable (mesh down / no model) → on-device engine
        val engine = ensureTts() ?: return
        stop()
        val err = engine.speak(say, TextToSpeech.QUEUE_FLUSH, null, "hive")
        if (err == TextToSpeech.SUCCESS) speaking.value = true
        else Log.w("HiveSpeaker", "on-device speak failed: $err")
    }
}
