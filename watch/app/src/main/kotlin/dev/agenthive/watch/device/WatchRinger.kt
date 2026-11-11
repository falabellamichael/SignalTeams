package dev.agenthive.watch.device

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.launch

/**
 * The watch-side twin of PhoneRinger — the phone pings /hive/find/start
 * and the watch rings + buzzes so it can be found under a cushion.
 * /hive/notify reuses the channel for phone-pushed alerts.
 */
object WatchRinger {
    private const val CHANNEL = "find_watch"
    private const val NOTIF_ID = 4208
    private const val TIMEOUT_MS = 30_000L

    private val handler = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null

    @Synchronized
    fun start(ctx: Context) {
        if (ringtone != null) return
        val appCtx = ctx.applicationContext
        ringtone = (
            RingtoneManager.getRingtone(appCtx,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
                ?: RingtoneManager.getRingtone(appCtx,
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            )?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM).build()
                isLooping = true
            }
        ringtone?.play()
        runCatching {
            appCtx.getSystemService(Vibrator::class.java)?.vibrate(
                VibrationEffect.createWaveform(
                    longArrayOf(0, 500, 300, 500), 0))
        }
        handler.postDelayed({ stop(appCtx) }, TIMEOUT_MS)
        post(appCtx, "Your phone is looking for this watch", true)
    }

    @Synchronized
    fun stop(ctx: Context) {
        handler.removeCallbacksAndMessages(null)
        runCatching { ringtone?.stop() }
        ringtone = null
        runCatching {
            ctx.getSystemService(Vibrator::class.java)?.cancel()
        }
        ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID)
    }

    /** One-shot phone-pushed alert — heads-up text, no ringing.
     *  Mirrored phone notifications arrive as "sbnKeyline" — the
     *  key powers an "Open on phone" action (Gemini's open-on-phone). */
    fun notify(ctx: Context, text: String) {
        val parts = text.split('', limit = 2)
        if (parts.size == 2)
            post(ctx.applicationContext, parts[1], false,
                key = parts[0], id = NOTIF_ID + 1 + (parts[0].hashCode() and 0x0f))
        else post(ctx.applicationContext, text, false)
    }

    @Volatile private var channelReady = false

    private fun post(ctx: Context, text: String, withStop: Boolean,
                     key: String? = null, id: Int = NOTIF_ID) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (!channelReady) {
            channelReady = true
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Watch alerts",
                    NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(ctx, 0,
            Intent(ctx, dev.agenthive.watch.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Nexus Watch")
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(open)
            .setAutoCancel(true)
        if (withStop) {
            b.setOngoing(true)
            b.addAction(0, "Stop", PendingIntent.getBroadcast(ctx, 0,
                Intent(WatchStopReceiver.ACTION_STOP).setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        if (key != null) {
            b.addAction(0, "Open on phone", PendingIntent.getBroadcast(ctx,
                id, Intent(WatchNotifReceiver.ACTION_OPEN_PHONE)
                    .setPackage(ctx.packageName).putExtra("key", key),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            // voice/canned reply — Wear's own RemoteInput UI captures it
            val ri = androidx.core.app.RemoteInput.Builder("reply_text")
                .setLabel("Reply").build()
            b.addAction(NotificationCompat.Action.Builder(0, "Reply",
                PendingIntent.getBroadcast(ctx, id + 40_000,
                    Intent(WatchNotifReceiver.ACTION_REPLY)
                        .setPackage(ctx.packageName).putExtra("key", key),
                    PendingIntent.FLAG_UPDATE_CURRENT
                        or PendingIntent.FLAG_MUTABLE))
                .addRemoteInput(ri).build())
            // swipe-away on the watch clears the phone shade too
            b.setDeleteIntent(PendingIntent.getBroadcast(ctx, id + 80_000,
                Intent(WatchNotifReceiver.ACTION_DISMISS_PHONE)
                    .setPackage(ctx.packageName).putExtra("key", key),
                PendingIntent.FLAG_UPDATE_CURRENT
                    or PendingIntent.FLAG_IMMUTABLE))
        }
        nm.notify(id, b.build())
    }
}

/** "Open on phone" on a mirrored notification → tells the phone to fire
 *  the original notification's contentIntent. */
class WatchNotifReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION_OPEN_PHONE &&
                intent.action != ACTION_REPLY &&
                intent.action != ACTION_DISMISS_PHONE) return
        val key = intent.getStringExtra("key") ?: return
        val spec = if (intent.action == ACTION_REPLY) {
            val text = androidx.core.app.RemoteInput
                .getResultsFromIntent(intent)
                ?.getCharSequence("reply_text")?.toString()
            if (text.isNullOrBlank()) return
            "reply$key$text"
        } else if (intent.action == ACTION_DISMISS_PHONE)
            "dismiss$key"
        else "open$key"
        val async = goAsync()
        kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try { PhoneBridge.phoneAction(ctx, spec) }
            finally { async.finish() }
        }
    }

    companion object {
        const val ACTION_OPEN_PHONE = "dev.agenthive.watch.OPEN_ON_PHONE"
        const val ACTION_REPLY = "dev.agenthive.watch.REPLY_NOTIF"
        const val ACTION_DISMISS_PHONE = "dev.agenthive.watch.DISMISS_NOTIF"
    }
}

class WatchStopReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == ACTION_STOP) WatchRinger.stop(ctx)
    }

    companion object {
        const val ACTION_STOP = "dev.agenthive.watch.STOP_FIND"
    }
}
