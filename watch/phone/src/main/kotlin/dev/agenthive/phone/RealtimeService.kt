package dev.agenthive.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.json.JSONObject

/**
 * Keeps the realtime socket alive while the app is backgrounded — Discord's
 * push layer. Foreground service so Android won't kill the WS; posts heads-up
 * notifications for DMs and @-mentions (regular channel msgs stay silent).
 */
class RealtimeService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var ws: WsClient? = null
    private var meId = 0
    private var meName = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        val app = application as PhoneApp
        val base = app.store.serverUrl
        val token = app.store.token
        if (base.isBlank() || token.isBlank()) { stopSelf(); return START_NOT_STICKY }
        meId = intent?.getIntExtra("me_id", 0) ?: 0
        meName = intent?.getStringExtra("me_name") ?: ""
        startForeground(NOTIF_ID, ongoing())
        if (ws == null)
            ws = WsClient(scope) { onEvent(it) }.also { it.connect(base, token) }
        return START_STICKY
    }

    private fun onEvent(evt: JSONObject) {
        when (evt.optString("type")) {
            "message" -> {
                val m = evt.optJSONObject("message") ?: return
                val author = m.optJSONObject("author") ?: return
                if (author.optInt("id") == meId) return
                val content = m.optString("content")
                val pinged = meName.isNotBlank() &&
                    (content.contains("@$meName", true) ||
                     content.contains("@everyone") ||
                     content.contains("@here"))
                val dm = m.optJSONObject("channel_kind")
                    ?.optString("") == "dm" ||
                    evt.optBoolean("dm") ||
                    m.optInt("server_id", -1) == 0
                // Discord pushes: DMs always, channels only on mention
                if (dm || pinged) notify(
                    author.optString("display_name",
                        author.optString("username", "message")),
                    content.ifBlank { "sent an attachment" },
                    pinged,
                    evt.optInt("channel_id"))
            }
            "buzz" -> notify("Nexus Watch", "you have new activity", true, -1)
        }
    }

    private fun notify(title: String, text: String, mention: Boolean, cid: Int) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager
        ensureChannels(nm)
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this,
                if (mention) CH_MENTIONS else CH_MESSAGES)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(text.take(160))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(if (mention) NotificationCompat.PRIORITY_HIGH
                         else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        // per-channel id: each conversation gets ONE shade entry that
        // updates in place — a message burst used to stack a new
        // notification per message (timestamp-keyed ids)
        val notifId = if (cid > 0) NOTIF_BASE + cid else NOTIF_BUZZ
        nm.notify(notifId, n)
    }

    @Volatile private var channelsReady = false

    private fun ensureChannels(nm: NotificationManager) {
        if (channelsReady) return
        channelsReady = true
        nm.createNotificationChannel(NotificationChannel(
            CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(
            CH_MENTIONS, "Mentions", NotificationManager.IMPORTANCE_HIGH))
    }

    private fun ongoing(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager
        nm.createNotificationChannel(NotificationChannel(
            CH_SERVICE, "Connection", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Nexus Watch connected")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        ws?.close(); ws = null
        super.onDestroy()
    }

    companion object {
        private const val CH_MESSAGES = "messages"
        private const val CH_MENTIONS = "mentions"
        private const val CH_SERVICE = "realtime"
        private const val NOTIF_ID = 42
        private const val NOTIF_BASE = 10_000
        private const val NOTIF_BUZZ = 1
        const val ACTION_STOP = "dev.agenthive.phone.STOP_REALTIME"

        fun start(ctx: Context, meId: Int, meName: String) {
            val i = Intent(ctx, RealtimeService::class.java)
                .putExtra("me_id", meId).putExtra("me_name", meName)
            if (Build.VERSION.SDK_INT >= 26)
                ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, RealtimeService::class.java)
                .setAction(ACTION_STOP))
        }
    }
}
