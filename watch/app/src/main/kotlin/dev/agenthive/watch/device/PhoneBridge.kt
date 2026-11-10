package dev.agenthive.watch.device

import android.content.Context
import android.content.Intent
import com.google.android.gms.tasks.Task
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import org.json.JSONObject

/**
 * Receives the phone's replies over the Wear data layer (status answers).
 */
class WatchWearService : WearableListenerService() {
    override fun onMessageReceived(ev: MessageEvent) =
        handleMessage(this, ev)

    companion object {
        /** Shared by the manifest listener and the runtime
         *  MessageClient.addListener in MeshService — Wear OS refuses
         *  manifest delivery to sideloaded apps (trusted-peer gate)
         *  but runtime listeners ride a live binder and work. */
        fun handleMessage(ctx: android.content.Context, ev: MessageEvent) {
            android.util.Log.i("WatchWearService",
                "msg ${ev.path} (${ev.data.size}B) from ${ev.sourceNodeId}")
            ctx.apply {
        when {
            ev.path == PhoneBridge.PATH_STATUS_REPLY ->
                PhoneBridge.onReply(PhoneBridge.PATH_STATUS_REPLY, ev.data)
            ev.path == PhoneBridge.PATH_PLAYING_REPLY ->
                PhoneBridge.onReply(PhoneBridge.PATH_PLAYING_REPLY, ev.data)
            ev.path == PhoneBridge.PATH_NOTIF_REPLY ->
                PhoneBridge.onReply(PhoneBridge.PATH_NOTIF_REPLY, ev.data)
            // the phone asking OUR status — symmetric with what it answers
            ev.path == "/hive/status" -> {
                val bm = getSystemService(android.os.BatteryManager::class.java)
                val j = JSONObject().apply {
                    put("batt", bm?.getIntProperty(
                        android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1)
                    put("charging", bm?.isCharging == true)
                    put("device", "watch")
                }
                Wearable.getMessageClient(this).sendMessage(
                    ev.sourceNodeId, PhoneBridge.PATH_STATUS_REPLY,
                    j.toString().toByteArray())
            }
            // find-my-watch: phone rings us — vibrate + heads-up note
            ev.path == "/hive/find/start" -> WatchRinger.start(this)
            ev.path == "/hive/find/stop" -> WatchRinger.stop(this)
            // phone → watch alert channel: payload text becomes a notification
            ev.path == "/hive/notify" -> {
                val text = String(ev.data)
                if (text.isNotBlank()) WatchRinger.notify(this, text)
            }
            // phone → watch automation: run a prompt or open an app here
            ev.path == "/hive/ask" -> {
                val q = String(ev.data)
                if (q.isNotBlank())
                    startActivity(Intent(this,
                        dev.agenthive.watch.MainActivity::class.java)
                        .putExtra("ask", q)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            ev.path == "/hive/launch" -> {
                val name = String(ev.data)
                if (name.isNotBlank())
                    DeviceCommands.handle(this, "open $name")
            }
        }
            }
        }
    }
}

/**
 * Watch → phone over the Wear data layer — independent of the Nexus mesh
 * (rides the OS's own BT/cloud node graph, so it works wherever the pair
 * is in range of each other). Find-my-phone, phone status, phone volume.
 */
object PhoneBridge {
    const val PATH_STATUS_REPLY = "/hive/status/reply"
    const val PATH_PLAYING_REPLY = "/hive/playing/reply"
    const val PATH_NOTIF_REPLY = "/hive/notif/reply"

    /** One in-flight request per reply path. */
    private val pending = mutableMapOf<String, CompletableDeferred<String>>()

    fun onReply(path: String, data: ByteArray) {
        pending[path]?.complete(String(data))
    }

    private suspend fun <T> Task<T>.awaitResult(): T? =
        suspendCancellableCoroutine { cont ->
            addOnCompleteListener { t ->
                cont.resume(if (t.isSuccessful) t.result else null)
            }
            addOnFailureListener { cont.resume(null) }
        }

    private suspend fun connectedNodes(ctx: Context): List<Node> =
        withContext(Dispatchers.IO) {
            withTimeoutOrNull(4_000) {
                Wearable.getNodeClient(ctx).connectedNodes.awaitResult()
            } ?: emptyList()
        }

    /** Send `path` (+payload) to the paired phone; "" on success, else error text. */
    private suspend fun send(ctx: Context, path: String,
                             data: ByteArray = ByteArray(0)): String {
        val nodes = connectedNodes(ctx)
        // prefer the Bluetooth-nearby node (the paired phone in range)
        val node = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
            ?: return "No Wear-paired device found — is the phone paired to this watch?"
        val ok = withContext(Dispatchers.IO) {
            withTimeoutOrNull(4_000) {
                Wearable.getMessageClient(ctx)
                    .sendMessage(node.id, path, data).awaitResult()
            }
        }
        return if (ok != null) "" else "Couldn't reach ${node.displayName}."
    }

    suspend fun findPhone(ctx: Context): String {
        val err = send(ctx, "/hive/find/start")
        return if (err.isEmpty())
            "Ringing your phone — it'll blast its alarm for 45s even if it's silenced."
        else err
    }

    /** Fire-and-forget action on a mirrored phone notification —
     *  "openkey" → phone fires that notification's contentIntent. */
    suspend fun phoneAction(ctx: Context, spec: String): String {
        val err = send(ctx, "/hive/notifact", spec.toByteArray())
        return err.ifEmpty { "Opening on your phone…" }
    }

    suspend fun stopPhone(ctx: Context): String {
        val err = send(ctx, "/hive/find/stop")
        return if (err.isEmpty()) "Phone alarm stopped." else err
    }

    /** Request/reply round-trip → (payload, errorText). Only one is non-empty. */
    private suspend fun request(ctx: Context, path: String,
                                replyPath: String): Pair<String, String> {
        val d = CompletableDeferred<String>()
        pending[replyPath] = d
        val err = send(ctx, path)
        if (err.isNotEmpty()) { pending.remove(replyPath); return "" to err }
        val raw = withTimeoutOrNull(6_000) { d.await() }
        pending.remove(replyPath)
        return (raw ?: "") to
            if (raw == null) "The phone didn't answer — is AgentHive running on it?"
            else ""
    }

    /** Ask the phone for its live status (battery/charging) and await the reply. */
    suspend fun phoneStatus(ctx: Context): String {
        val (raw, err) = request(ctx, "/hive/status", PATH_STATUS_REPLY)
        if (raw.isEmpty()) return err
        val j = runCatching { JSONObject(raw) }.getOrNull()
            ?: return "The phone answered oddly."
        val batt = j.optInt("batt", -1)
        val bits = buildList {
            if (batt >= 0) add("at $batt%")
            if (j.optBoolean("charging")) add("charging")
            when (j.optString("net")) {
                "wifi" -> add("on Wi-Fi"); "cell" -> add("on cellular")
                "offline" -> add("offline") }
            if (j.optBoolean("dnd")) add("in do-not-disturb")
        }
        return if (bits.isEmpty()) "Your phone answered."
            else "Your phone is " + bits.joinToString(", ") + "."
    }

    suspend fun phoneVolume(ctx: Context, up: Boolean): String {
        val err = send(ctx, "/hive/volume", (if (up) "up" else "down").toByteArray())
        return if (err.isEmpty())
            "Turned the phone's media volume ${if (up) "up" else "down"}."
        else err
    }

    /** Forward an intent spec to the phone: "app:<label>" or "uri:<uri>". */
    suspend fun phoneIntent(ctx: Context, spec: String, what: String): String {
        val err = send(ctx, "/hive/intent", spec.toByteArray())
        return if (err.isEmpty()) what else err
    }

    /** Media transport on the phone — fire and forget. */
    suspend fun phoneMedia(ctx: Context, verb: String): String {
        val err = send(ctx, "/hive/media", verb.toByteArray())
        return if (err.isEmpty())
            "Told the phone to $verb." else err
    }

    /** What's playing on the phone (needs phone notification access). */
    suspend fun phonePlaying(ctx: Context): String {
        val (raw, err) = request(ctx, "/hive/playing", PATH_PLAYING_REPLY)
        if (raw.isEmpty()) return err
        val now = runCatching { JSONObject(raw).optString("now") }
            .getOrDefault("")
        return if (now.isBlank())
            "Nothing's playing on the phone — or it needs notification access."
        else "On your phone: $now."
    }

    /** Latest phone notifications, read aloud. */
    suspend fun phoneNotifs(ctx: Context): String {
        val (raw, err) = request(ctx, "/hive/notif", PATH_NOTIF_REPLY)
        if (raw.isEmpty()) return err
        val arr = runCatching { org.json.JSONArray(raw) }.getOrNull()
            ?: return "The phone answered oddly."
        if (arr.length() == 0)
            return "No notifications on the phone — or it needs notification access."
        val lines = (0 until arr.length()).map { arr.optString(it) }
        return "Your phone's latest: " + lines.joinToString(". ") + "."
    }
}
