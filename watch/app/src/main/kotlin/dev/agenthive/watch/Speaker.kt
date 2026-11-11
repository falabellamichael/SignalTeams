package dev.agenthive.watch

import android.content.Context
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import dev.agenthive.watch.data.HiveApi
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Speaks assistant replies through the watch speaker — fetches synthesized
 * audio from the hive's TTS model (kokoro via /api/llm/tts) and plays it,
 * falling back to the on-device TextToSpeech engine (com.google.android.tts
 * ships on every Wear watch) so replies still speak when the mesh is down —
 * the same offline-voice path the built-in assistant uses.
 *
 * Chunks queue onto a serialized pump: the stream feeds complete sentences as
 * they land (Gemini-style early voice — first audio while the tail is still
 * generating), and playback order is preserved across the backend-TTS and
 * on-device-engine paths alike.
 */
class Speaker(private val api: HiveApi, private val ctx: Context) {

    @Volatile
    var enabled: Boolean = false

    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    /** True while synthesized audio is actually playing — the dock shows Stop. */
    val speaking = MutableStateFlow(false)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val queue = Channel<String>(Channel.UNLIMITED)
    private var pump: Job? = null
    private val pumpLock = Any()

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
        while (queue.tryReceive().isSuccess) {}
        pump?.cancel()
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

    /** One-shot utterance that interrupts whatever is queued/playing — for
     *  notifications and device replies, not the streaming feed. */
    fun speak(text: String) {
        if (!enabled) return
        stop()
        feed(text)
    }

    /** Queue a chunk for spoken playback — complete sentences fed in while
     *  the reply streams; ordering is preserved by the pump. */
    fun feed(text: String) {
        if (!enabled) return
        if (speakable(text).length < 2) return
        queue.trySend(text)
        synchronized(pumpLock) {
            if (pump?.isActive == true) return
            pump = scope.launch {
                try {
                    for (chunk in queue) {
                        if (!isActive) break
                        if (!enabled) continue
                        val say = speakable(chunk)
                        if (say.length < 2) continue
                        speaking.value = true
                        playChunk(say)
                        // The pump suspends on receive() once the queue drains
                        // — without this, `speaking` (the UI's stop control)
                        // stays stuck true after the last utterance ends.
                        if (queue.isEmpty) speaking.value = false
                    }
                } finally {
                    speaking.value = false
                }
            }
        }
    }

    /** One queued chunk: backend synthesis when the endpoint has a TTS model,
     *  the on-device engine otherwise. The fetch is timeboxed — a slow mesh
     *  path must not stall the whole speech queue for 90s. */
    private suspend fun playChunk(say: String) {
        val bytes = kotlinx.coroutines.withTimeoutOrNull(12_000) {
            api.ttsBytes(say)
        }
        if (bytes != null) { playMp3(bytes); return }
        val engine = ensureTts() ?: return
        speakOnDevice(engine, say)
    }

    private suspend fun playMp3(bytes: ByteArray) {
        val f = File.createTempFile("hive_tts", ".mp3")
        f.writeBytes(bytes)
        suspendCancellableCoroutine<Unit> { cont ->
            val mp = MediaPlayer()
            player = mp
            fun finish() {
                if (player === mp) player = null
                runCatching { mp.release() }
                runCatching { f.delete() }
                if (cont.isActive) cont.resume(Unit)
            }
            mp.setOnCompletionListener { finish() }
            mp.setOnErrorListener { _, _, _ -> finish(); true }
            runCatching {
                mp.setDataSource(f.absolutePath)
                mp.prepare()
                mp.start()
            }.onFailure {
                Log.w("HiveSpeaker", "playback failed: ${it.message}")
                finish()
            }
            cont.invokeOnCancellation {
                runCatching { mp.stop() }
                finish()
            }
        }
    }

    private suspend fun speakOnDevice(engine: TextToSpeech, say: String) {
        suspendCancellableCoroutine<Unit> { cont ->
            val id = "hive-${System.nanoTime()}"
            engine.setOnUtteranceProgressListener(
                object : UtteranceProgressListener() {
                    override fun onStart(u: String?) {}
                    override fun onDone(u: String?) {
                        if (u == id && cont.isActive) cont.resume(Unit)
                    }
                    @Deprecated("deprecated")
                    override fun onError(u: String?) {
                        if (u == id && cont.isActive) cont.resume(Unit)
                    }
                })
            engine.speak(say, TextToSpeech.QUEUE_FLUSH, null, id)
            cont.invokeOnCancellation { engine.stop() }
        }
    }
}
