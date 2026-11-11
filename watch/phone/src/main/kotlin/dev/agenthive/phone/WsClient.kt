package dev.agenthive.phone

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * App websocket — mirrors the web client's /ws connection.
 * Delivers raw event JSONObjects to onEvent (message, voice, typing…).
 * Auto-reconnects with backoff while `authed` stays true.
 */
class WsClient(
    private val scope: CoroutineScope,
    private val onEvent: (JSONObject) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)     // ws must never time out on read
        .pingInterval(20, TimeUnit.SECONDS)   // keep NAT/mesh tunnels warm
        .build()

    @Volatile private var ws: WebSocket? = null
    @Volatile private var authed = false
    @Volatile private var wsUrl: String = ""
    // onClosed AND onFailure can both schedule a retry; if they wake together
    // we'd newWebSocket twice — two live sockets + duplicate events. `dialing`
    // makes the connect attempt atomic.
    @Volatile private var dialing = false
    private var attempt = 0

    fun connect(httpBase: String, token: String) {
        wsUrl = httpBase.trimEnd('/')
            .replace("http://", "ws://").replace("https://", "wss://") +
            "/ws?token=" + java.net.URLEncoder.encode(token, "UTF-8")
        authed = true
        attempt = 0
        dial()
    }

    private fun dial() {
        if (!authed || dialing || ws != null) return
        dialing = true
        try {
            val req = Request.Builder().url(wsUrl).build()
            client.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    dialing = false
                    ws = webSocket
                    attempt = 0
                    onEvent(JSONObject().put("type", "ws:open"))
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching { JSONObject(text) }.getOrNull()?.let(onEvent)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    dialing = false
                    ws = null
                    retry()
                }
                override fun onFailure(
                    webSocket: WebSocket, t: Throwable, response: Response?,
                ) {
                    dialing = false
                    Log.w("WsClient", "ws failure: ${t.message}")
                    ws = null
                    retry()
                }
            })
        } catch (e: Exception) {
            dialing = false
            throw e
        }
    }

    private fun retry() {
        if (!authed) return
        val delayMs = (1000L shl attempt.coerceAtMost(4))
        attempt++
        scope.launch(Dispatchers.IO) {
            delay(delayMs)
            if (authed && ws == null) dial()
        }
    }

    fun send(obj: JSONObject) {
        ws?.send(obj.toString())
    }

    fun close() {
        authed = false
        ws?.close(1000, "bye")
        ws = null
    }
}
