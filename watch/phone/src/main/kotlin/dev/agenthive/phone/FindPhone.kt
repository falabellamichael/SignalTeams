package dev.agenthive.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * "Find my phone" — the watch sends /hive/find/start over the Wear data
 * layer; we blast the alarm ringtone at max STREAM_ALARM volume (even when
 * the phone is silenced — that's the whole point) and post a heads-up
 * notification whose Stop action quiets it. Auto-stops after 45s.
 */
class FindPhoneService : WearableListenerService() {
    private val main = Handler(Looper.getMainLooper())

    override fun onMessageReceived(ev: MessageEvent) {
        val path = ev.path
        val data = ev.data
        val src = ev.sourceNodeId

        // Network proxy routes run in IO coroutines (not UI thread)
        when (path) {
            PATH_PROBE -> {
                handleProxyProbe(src)
                return
            }
            PATH_PROXY_REQ -> {
                handleProxyReq(src, data)
                return
            }
            PATH_STREAM_START -> {
                handleProxyStream(src, data)
                return
            }
        }

        // binder thread → everything below touches UI/audio/volume APIs
        main.post {
            when (path) {
                PATH_START -> PhoneRinger.start(this)
                PATH_STOP -> PhoneRinger.stop(this)
                PATH_STATUS -> replyStatus(src)
                PATH_VOLUME -> {
                    val dir = String(data)
                    getSystemService(AudioManager::class.java)
                        ?.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                            if (dir == "up") AudioManager.ADJUST_RAISE
                            else AudioManager.ADJUST_LOWER,
                            AudioManager.FLAG_SHOW_UI)
                }
                PATH_INTENT -> launchSpec(String(data))
                PATH_MEDIA -> {
                    if (!PhoneNotifService.isEnabled(this)) notifAccessPage()
                    else if (!PhoneNotifService.transport(this, String(data)))
                        toast("Nothing playing on the phone")
                }
                PATH_PLAYING -> replyPlaying(src)
                PATH_NOTIF -> replyNotifs(src)
                PATH_NOTIFACT -> {
                    val r = PhoneNotifService.act(this, String(data))
                    Wearable.getMessageClient(this).sendMessage(
                        src, "$PATH_NOTIFACT/reply", r.toByteArray())
                }
                // watch's answers to our reverse-direction queries
                "$PATH_STATUS/reply" -> WatchBridge.onReply(path, data)
            }
        }
    }

    /** Notification-access settings — the same fallback the ringer uses. */
    private fun notifAccessPage() = runCatching {
        startActivity(Intent(
            "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun replyPlaying(nodeId: String) {
        val line = if (!PhoneNotifService.isEnabled(this)) ""
        else PhoneNotifService.nowPlaying(this).orEmpty()
        Wearable.getMessageClient(this).sendMessage(
            nodeId, "$PATH_PLAYING/reply",
            "{\"now\":${org.json.JSONObject.quote(line)}}".toByteArray())
    }

    private fun replyNotifs(nodeId: String) {
        val lines = if (!PhoneNotifService.isEnabled(this)) emptyList()
        else PhoneNotifService.latest(this, 5)
        Wearable.getMessageClient(this).sendMessage(
            nodeId, "$PATH_NOTIF/reply",
            org.json.JSONArray(lines).toString().toByteArray())
    }

    private fun launchSpec(spec: String) = PhoneActions.launchSpec(this, spec)

    private fun toast(msg: String) = android.widget.Toast
        .makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()

    /** Watch asked for phone status → answer on /hive/status/reply. */
    private fun replyStatus(nodeId: String) {
        val bm = getSystemService(android.os.BatteryManager::class.java)
        val batt = bm?.getIntProperty(
            android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        val charging = bm?.isCharging == true
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        val net = cm?.activeNetwork?.let { an ->
            cm.getNetworkCapabilities(an)?.let { nc ->
                when {
                    nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "cell"
                    else -> ""
                }
            }
        } ?: "offline"
        val dnd = getSystemService(android.app.NotificationManager::class.java)
            ?.currentInterruptionFilter?.let {
                it != android.app.NotificationManager.INTERRUPTION_FILTER_ALL } == true
        val payload = ("{\"batt\":$batt,\"charging\":$charging," +
            "\"net\":\"$net\",\"dnd\":$dnd}").toByteArray()
        Wearable.getMessageClient(this)
            .sendMessage(nodeId, "$PATH_STATUS/reply", payload)
    }

    private fun handleProxyProbe(nodeId: String) {
        val app = application as PhoneApp
        val base = app.store.meshUrl.ifBlank { app.api.baseUrl }
        CoroutineScope(Dispatchers.IO).launch {
            // ok only when the bridge actually answers — a stored URL with a
            // wedged tunnel is how the watch gets told "linked" to nothing.
            var ok = app.nexus.state == dev.agenthive.watch.nexus.NexusState.RUNNING &&
                base.isNotBlank()
            if (ok) {
                ok = runCatching {
                    val req = Request.Builder()
                        .url(base.trimEnd('/') + "/api/auth/config").build()
                    probeClient.newCall(req).execute().use { it.isSuccessful }
                }.getOrDefault(false)
            }
            if (!ok) PhoneMeshService.start(this@FindPhoneService)   // kick the keep-alive
            val rep = JSONObject().apply {
                put("ok", ok)
                put("baseUrl", base)
                put("user", app.store.username)
                put("hiveIp", app.store.meshTargetIp)
            }
            Wearable.getMessageClient(this@FindPhoneService).sendMessage(
                nodeId, PATH_PROBE_REPLY, rep.toString().toByteArray()
            )
        }
    }

    private fun handleProxyReq(nodeId: String, data: ByteArray) {
        val app = application as PhoneApp
        val raw = String(data)
        val j = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = j.optString("id")
        val method = j.optString("method", "GET").uppercase()
        val reqPath = j.optString("path", "")
        val reqBody = j.optString("body", "")
        val reqToken = j.optString("token", "").ifBlank { app.store.token }
        val base = app.store.meshUrl.ifBlank { app.api.baseUrl }

        CoroutineScope(Dispatchers.IO).launch {
            if (base.isBlank()) {
                val err = JSONObject().put("id", id).put("code", 503).put("body", "Phone mesh not connected")
                Wearable.getMessageClient(this@FindPhoneService).sendMessage(
                    nodeId, PATH_PROXY_REPLY, err.toString().toByteArray()
                )
                return@launch
            }
            runCatching {
                val url = base.trimEnd('/') + reqPath
                val rb = Request.Builder().url(url)
                if (reqToken.isNotBlank()) rb.header("Authorization", "Bearer $reqToken")
                val jsonType = "application/json; charset=utf-8".toMediaType()
                when (method) {
                    "POST" -> rb.post(reqBody.toRequestBody(jsonType))
                    "PATCH" -> rb.patch(reqBody.toRequestBody(jsonType))
                    "PUT" -> rb.put(reqBody.toRequestBody(jsonType))
                    "DELETE" -> if (reqBody.isNotBlank()) rb.delete(reqBody.toRequestBody(jsonType)) else rb.delete()
                    else -> rb.get()
                }
                proxyClient.newCall(rb.build()).execute().use { resp ->
                    val code = resp.code
                    val text = resp.body?.string() ?: ""
                    val out = JSONObject().put("id", id).put("code", code).put("body", text)
                    sendProxyReply(nodeId, out)
                }
            }.onFailure { e ->
                val err = JSONObject().put("id", id).put("code", 502).put("body", e.message ?: "proxy error")
                sendProxyReply(nodeId, err)
            }
        }
    }

    /** Send a proxy reply, splitting when it would exceed Wear's ~100KB
     *  message cap. An oversized sendMessage fails outright — the watch
     *  waited out the full timeout and then marked the channel dead for
     *  60s, killing notifications over a fat JSON body. Parts carry
     *  {id,part,of,data} — the watch reassembles the serialized reply. */
    private fun sendProxyReply(nodeId: String, payload: JSONObject) {
        val mc = Wearable.getMessageClient(this@FindPhoneService)
        val full = payload.toString()
        if (full.toByteArray(Charsets.UTF_8).size <= 88_000) {
            mc.sendMessage(nodeId, PATH_PROXY_REPLY, full.toByteArray(Charsets.UTF_8))
            return
        }
        // 20K UTF-16 chars ≤ 80KB UTF-8 even in the worst case (4B/char),
        // so every part stays comfortably under the cap with no per-part
        // encode-and-shrink loop.
        val parts = mutableListOf<String>()
        var off = 0
        while (off < full.length) {
            val end = minOf(full.length, off + 20_000)
            parts.add(full.substring(off, end)); off = end
        }
        parts.forEachIndexed { i, slice ->
            val msg = JSONObject().put("id", payload.optString("id"))
                .put("part", i).put("of", parts.size).put("data", slice)
            mc.sendMessage(nodeId, PATH_PROXY_REPLY, msg.toString().toByteArray(Charsets.UTF_8))
        }
    }

    private fun handleProxyStream(nodeId: String, data: ByteArray) {
        val app = application as PhoneApp
        val raw = String(data)
        val j = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = j.optString("id")
        val aid = j.optInt("agentId")
        val msg = j.optString("message")
        val model = j.optString("model").takeIf { it.isNotBlank() }
        val histArr = j.optJSONArray("history") ?: JSONArray()
        val hist = (0 until histArr.length()).map { i ->
            val o = histArr.getJSONObject(i)
            o.optString("role") to o.optString("content")
        }
        CoroutineScope(Dispatchers.IO).launch {
            // Per-stream seq in every event: the watch dedupes inbound Wear
            // messages on (node, path, contentHash) — identical token chunks
            // ("ha" ×4 within 1.5s) used to hash equal and get dropped as a
            // phantom redelivery. A seq makes each real event's payload
            // unique while true redeliveries still collide.
            var seq = 0
            fun send(payload: JSONObject) {
                payload.put("s", seq++)
                Wearable.getMessageClient(this@FindPhoneService).sendMessage(
                    nodeId, PATH_STREAM_EVENT, payload.toString().toByteArray())
            }
            // Tokens stream one-per-binder-call otherwise — a proxied reply
            // is 50-100 GMS round trips. Coalesce ~150ms of tokens per
            // message; non-token events (meta, tool, done) still go instantly.
            val tokenBuf = StringBuilder()
            var lastFlush = android.os.SystemClock.elapsedRealtime()
            fun flushTokens() {
                if (tokenBuf.isEmpty()) return
                send(JSONObject().put("id", id).put("t", "token")
                    .put("c", tokenBuf.toString()))
                tokenBuf.clear()
            }
            runCatching {
                app.api.tryStream(aid, msg, hist, model).collect { ev ->
                    if (ev is dev.agenthive.watch.data.HiveApi.StreamEvent.Token) {
                        tokenBuf.append(ev.text)
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastFlush >= 150) {
                            flushTokens(); lastFlush = now
                        }
                    } else {
                        flushTokens()
                        val evJson = JSONObject().put("id", id)
                        when (ev) {
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Meta ->
                                evJson.put("t", "meta").put("provider", ev.provider).put("model", ev.model)
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Thinking ->
                                evJson.put("t", "thinking").put("n", ev.n)
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Tool ->
                                evJson.put("t", "tool").put("name", ev.name).put("ok", ev.ok)
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Replace ->
                                evJson.put("t", "replace").put("c", ev.text)
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Error ->
                                evJson.put("t", "error").put("message", ev.message)
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Done ->
                                evJson.put("t", "done")
                            else -> {}
                        }
                        send(evJson)
                    }
                }
                flushTokens()
            }.onFailure { e ->
                val err = JSONObject().put("id", id).put("t", "error").put("message", e.message ?: "stream error")
                send(err)
            }
        }
    }

    companion object {
        const val PATH_START = "/hive/find/start"
        const val PATH_STOP = "/hive/find/stop"
        const val PATH_STATUS = "/hive/status"
        const val PATH_VOLUME = "/hive/volume"
        const val PATH_INTENT = "/hive/intent"
        const val PATH_MEDIA = "/hive/media"
        const val PATH_PLAYING = "/hive/playing"
        const val PATH_NOTIF = "/hive/notif"
        const val PATH_NOTIFACT = "/hive/notifact"
        const val PATH_PROBE = "/hive/proxy/probe"
        const val PATH_PROBE_REPLY = "/hive/proxy/probe/reply"
        const val PATH_PROXY_REQ = "/hive/proxy/req"
        const val PATH_PROXY_REPLY = "/hive/proxy/reply"
        const val PATH_STREAM_START = "/hive/proxy/stream/start"
        const val PATH_STREAM_EVENT = "/hive/proxy/stream/event"

        /** Shared clients — a fresh OkHttpClient per proxied call allocated
         *  its own dispatcher + thread pool and threw the keep-alive pool
         *  away, on every single watch→phone→hive hop. */
        private val probeClient = OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .build()
        private val proxyClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
    }
}

/** Device-action specs shared by FindPhoneService (/hive/intent) and the
 *  AppFunctions surface — same verbs, String results for assistant replies. */
object PhoneActions {
    fun launchSpec(ctx: Context, spec: String) {
        runCatching {
            when {
                spec == "music:" -> runCatching {
                    ctx.startActivity(
                        Intent("com.google.android.googlequicksearchbox.MUSIC_SEARCH")
                            .setPackage("com.google.android.googlequicksearchbox")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                spec.startsWith("call:") ->
                    contactDial(ctx, spec.drop(5), sms = false)
                spec.startsWith("sms:") ->
                    contactDial(ctx, spec.drop(4), sms = true)
                spec.startsWith("wa:") ->
                    contactDial(ctx, spec.drop(3), sms = false, wa = true)
                spec.startsWith("torch:") ->
                    phoneTorch(ctx, spec.drop(6) == "on")
                spec.startsWith("ringer:") -> phoneRinger(ctx, spec.drop(7))
                spec.startsWith("cap:") -> {
                    ctx.startActivity(Intent(
                        android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                spec.startsWith("uri:") -> {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse(spec.drop(4)))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                spec.startsWith("app:") -> openAppByLabel(ctx, spec.drop(4))
            }
        }
    }

    fun openAppByLabel(ctx: Context, label: String): String {
        val want = label.lowercase()
        val main = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
        val hit = ctx.packageManager.queryIntentActivities(main, 0)
            .firstOrNull {
                it.loadLabel(ctx.packageManager)
                    ?.toString()?.lowercase()?.contains(want) == true
            } ?: return "No app matching \"$label\""
        return ctx.packageManager
            .getLaunchIntentForPackage(hit.activityInfo.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?.let { ctx.startActivity(it); "Opened ${hit.loadLabel(ctx.packageManager)}" }
            ?: "Couldn't launch $label"
    }

    /** "call:<who>"/"sms:<who>"/"wa:<who>" — resolve names through the
     *  phone's real contacts, then fire the dialer/composer. */
    fun contactDial(ctx: Context, who: String, sms: Boolean,
                    wa: Boolean = false): String {
        val num = if (who.any { it.isDigit() }) who else resolveContact(ctx, who)
            ?: return "No number found for \"$who\""
        val digits = num.filter { it.isDigit() || it == '+' }
        val uri = android.net.Uri.parse(
            if (wa) "https://api.whatsapp.com/send?phone=$digits"
            else (if (sms) "smsto:" else "tel:") + android.net.Uri.encode(num))
        runCatching {
            ctx.startActivity(Intent(
                if (sms || wa) Intent.ACTION_VIEW else Intent.ACTION_DIAL,
                uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return if (wa) "Opening WhatsApp chat with $who"
            else if (sms) "Opening messages to $who" else "Calling $who"
    }

    fun resolveContact(ctx: Context, name: String): String? = runCatching {
        ctx.contentResolver.query(
            android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$name%"), null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull()

    /** "torch:on|off" — the phone has a real LED; the watch doesn't. */
    fun phoneTorch(ctx: Context, on: Boolean): String = runCatching {
        val cm = ctx.getSystemService(
            android.hardware.camera2.CameraManager::class.java)
        cm?.setTorchMode(cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it)
                .get(android.hardware.camera2.CameraCharacteristics
                    .FLASH_INFO_AVAILABLE) == true
        } ?: cm.cameraIdList.first(), on)
        "Flashlight ${if (on) "on" else "off"}"
    }.getOrElse { "Couldn't reach the flashlight" }

    /** "ringer:silent|vibrate|normal" — needs DND policy access; if the
     *  grant is missing, open the settings page instead. */
    fun phoneRinger(ctx: Context, mode: String): String {
        val target = when (mode) {
            "silent" -> AudioManager.RINGER_MODE_SILENT
            "vibrate" -> AudioManager.RINGER_MODE_VIBRATE
            else -> AudioManager.RINGER_MODE_NORMAL
        }
        return runCatching {
            ctx.getSystemService(AudioManager::class.java)?.ringerMode = target
            "Ringer set to $mode"
        }.getOrElse {
            runCatching {
                ctx.startActivity(Intent(
                    android.provider.Settings
                        .ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            "No ringer-mode permission — opened the settings page"
        }
    }
}

/** Broadcast target for the notification's Stop action (same-app only). */
class FindStopReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == ACTION_STOP) PhoneRinger.stop(ctx)
    }

    companion object {
        const val ACTION_STOP = "dev.agenthive.phone.STOP_FIND"
    }
}

object PhoneRinger {
    private const val CHANNEL = "find_phone"
    private const val NOTIF_ID = 4207
    private const val TIMEOUT_MS = 45_000L

    private val handler = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null
    private var savedVol = -1

    @Synchronized
    fun start(ctx: Context) {
        if (ringtone != null) return
        val am = ctx.getSystemService(AudioManager::class.java)
        if (am != null && savedVol < 0) {
            savedVol = am.getStreamVolume(AudioManager.STREAM_ALARM)
            runCatching {
                am.setStreamVolume(
                    AudioManager.STREAM_ALARM,
                    am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            }
        }
        val appCtx = ctx.applicationContext
        ringtone = (
            RingtoneManager.getRingtone(appCtx,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
                ?: RingtoneManager.getRingtone(appCtx,
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            )?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM).build()
                isLooping = true
            }
        ringtone?.play()
        handler.postDelayed({ stop(appCtx) }, TIMEOUT_MS)
        postNotification(appCtx)
    }

    @Synchronized
    fun stop(ctx: Context) {
        handler.removeCallbacksAndMessages(null)
        runCatching { ringtone?.stop() }
        ringtone = null
        if (savedVol >= 0) {
            runCatching {
                ctx.getSystemService(AudioManager::class.java)
                    ?.setStreamVolume(AudioManager.STREAM_ALARM, savedVol, 0)
            }
            savedVol = -1
        }
        ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID)
    }

    private fun postNotification(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Find phone", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Alarm triggered from your AgentHive watch" })
        val stopPi = PendingIntent.getBroadcast(
            ctx, 0, Intent(FindStopReceiver.ACTION_STOP).setPackage(ctx.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        nm.notify(NOTIF_ID, NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("AgentHive is ringing this phone")
            .setContentText("Requested from your watch")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .addAction(0, "Stop", stopPi)
            .build())
    }
}
