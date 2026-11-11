package dev.agenthive.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Phone → watch senders. Mirrors the watch's PhoneBridge: node discovery
 * plus fire-and-forget paths the watch's WatchWearService answers.
 */
object WatchBridge {
    /** connectedNodes is a GMS binder query — caching it 30s skips a
     *  round trip on every notification/companion push (watch parity).
     *  A failed send drops the cache so a re-tether is seen at once. */
    @Volatile private var nodeCache: Pair<Long, String>? = null

    suspend fun send(ctx: Context, path: String, data: ByteArray = ByteArray(0)): Boolean =
        withContext(Dispatchers.IO) {
            val now = android.os.SystemClock.elapsedRealtime()
            val nodeId = nodeCache?.takeIf { now - it.first < 30_000 }?.second
                ?: Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                    .firstOrNull()?.id?.also { nodeCache = now to it }
                ?: return@withContext false
            runCatching {
                Tasks.await(Wearable.getMessageClient(ctx).sendMessage(nodeId, path, data))
            }.onFailure { nodeCache = null }.isSuccess
        }

    suspend fun notifyWatch(ctx: Context, text: String) =
        send(ctx, "/hive/notify", text.toByteArray())

    suspend fun ringWatch(ctx: Context) = send(ctx, "/hive/find/start")
    suspend fun stopWatch(ctx: Context) = send(ctx, "/hive/find/stop")

    /** One in-flight request per reply path — same shape as the watch side. */
    private val pending =
        java.util.concurrent.ConcurrentHashMap<String,
            kotlinx.coroutines.CompletableDeferred<String>>()

    fun onReply(path: String, data: ByteArray) {
        pending[path]?.complete(String(data))
    }

    /** Ask the watch for its status — battery/charging JSON on /reply.
     *  Serialized: two concurrent callers share one reply path and would
     *  clobber each other's deferred (same fix as the watch's PhoneBridge). */
    private val statusMutex = kotlinx.coroutines.sync.Mutex()
    suspend fun watchStatus(ctx: Context): String = statusMutex.withLock {
        val replyPath = "/hive/status/reply"
        val d = kotlinx.coroutines.CompletableDeferred<String>()
        pending[replyPath] = d
        val ok = send(ctx, "/hive/status")
        if (!ok) { pending.remove(replyPath); return "" }
        val raw = kotlinx.coroutines.withTimeoutOrNull(6_000) { d.await() }
        pending.remove(replyPath)
        raw ?: ""
    }
}

/**
 * Proactive cross-device push — when the phone dips to low battery the
 * watch surfaces it (the Google-style "your phone needs charging" nudge).
 */
class PhoneBatteryReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BATTERY_LOW) return
        val level = intent.getIntExtra("battery_level", -1)
        val msg = if (level >= 0) "Phone battery low ($level%)" else "Phone battery low"
        val pending = goAsync()
        GlobalScope.launch {
            runCatching { WatchBridge.notifyWatch(ctx, msg) }
            pending.finish()
        }
    }
}
