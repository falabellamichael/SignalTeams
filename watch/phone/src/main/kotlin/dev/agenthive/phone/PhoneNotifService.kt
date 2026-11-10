package dev.agenthive.phone

import android.content.ComponentName
import android.content.Context
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Phone-side notification listener — mirrors HiveNotifService on the watch.
 * Its real jobs: unlock MediaSessionManager (media transport for
 * "pause on my phone"), read the shade for "read my phone's notifications",
 * and power inline-reply later if needed. Same one-time grant flow.
 */
class PhoneNotifService : NotificationListenerService() {

    private val scope = kotlinx.coroutines.CoroutineScope(
        kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)
    private val seen = mutableMapOf<String, Long>()

    override fun onListenerConnected() { instance = this }
    override fun onListenerDisconnected() { if (instance === this) instance = null }
    override fun onDestroy() {
        if (instance === this) instance = null
        scope.cancel(); super.onDestroy()
    }

    /** Mirror a posted alert to the watch — Gemini's proactive-nudge
     *  direction. Skips ongoing/low-value noise; dedupes updates. */
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        if (sbn.packageName == packageName || sbn.isOngoing) return
        if (n.flags and android.app.Notification.FLAG_GROUP_SUMMARY != 0) return
        if (n.category in setOf(
                android.app.Notification.CATEGORY_SERVICE,
                android.app.Notification.CATEGORY_PROGRESS,
                android.app.Notification.CATEGORY_TRANSPORT,
                android.app.Notification.CATEGORY_NAVIGATION)) return
        val e = n.extras
        val title = e.getCharSequence(
            android.app.Notification.EXTRA_TITLE)?.toString() ?: return
        val now = System.currentTimeMillis()
        synchronized(seen) {
            seen.entries.removeIf { now - it.value > 60_000 }
            if (seen.put(sbn.key, now) != null) return
        }
        val text = e.getCharSequence(
            android.app.Notification.EXTRA_TEXT)?.toString()
        val app = sbn.packageName.substringAfterLast('.')
        val line = if (text.isNullOrBlank()) "$app: $title"
            else "$app: $title — ${text.take(120)}"
        scope.launch {
            val ok = WatchBridge.send(this@PhoneNotifService,
                "/hive/notify", "${sbn.key}$line".toByteArray())
            android.util.Log.i("PhoneNotifService",
                "mirror → watch: ${if (ok) "sent" else "no node"} — $line")
        }
    }

    companion object {
        @Volatile private var instance: PhoneNotifService? = null

        fun isEnabled(ctx: Context): Boolean =
            androidx.core.app.NotificationManagerCompat
                .getEnabledListenerPackages(ctx).contains(ctx.packageName)

        private fun activeControllers(ctx: Context): List<MediaController> =
            runCatching {
                (ctx.getSystemService(Context.MEDIA_SESSION_SERVICE)
                    as MediaSessionManager)
                    .getActiveSessions(ComponentName(ctx, PhoneNotifService::class.java))
            }.getOrDefault(emptyList())

        /** Send a transport verb to the most recent session. */
        fun transport(ctx: Context, verb: String): Boolean {
            val ctrls = activeControllers(ctx)
            for (c in ctrls) {
                val t = c.transportControls ?: continue
                val hit = runCatching {
                    when (verb) {
                        "play" -> t.play(); "pause" -> t.pause(); "stop" -> t.stop()
                        "next" -> t.skipToNext(); "prev" -> t.skipToPrevious()
                        else -> false
                    }
                }.isSuccess
                if (hit) return true
            }
            return false
        }

        /** What's playing on the phone — metadata for "…on my phone". */
        fun nowPlaying(ctx: Context): String? {
            for (c in activeControllers(ctx)) {
                val md = c.metadata ?: continue
                val title = md.getString(android.media.MediaMetadata.METADATA_KEY_TITLE) ?: continue
                val artist = md.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST).orEmpty()
                val playing = c.playbackState?.state ==
                    android.media.session.PlaybackState.STATE_PLAYING
                return buildString {
                    append(title)
                    if (artist.isNotBlank()) append(" — ").append(artist)
                    if (!playing) append(" (paused)")
                }
            }
            return null
        }

        /** "verbkey" — act on a mirrored notification: fire its
         *  contentIntent (open) or drop it from the shade (dismiss). */
        fun act(ctx: Context, spec: String): String {
            val svc = instance ?: return "notification listener off"
            val parts = spec.split('', limit = 3)
            if (parts.size < 2) return "bad spec"
            val (verb, key) = parts
            // "#N" → Nth newest active notification (for callers that
            // can't know raw sbn keys, e.g. AppFunctions consumers)
            val sbn = if (key.startsWith("#"))
                svc.activeNotifications
                    .sortedByDescending { it.postTime }
                    .getOrNull(
                        (key.drop(1).toIntOrNull() ?: 0) - 1)
            else svc.activeNotifications
                .firstOrNull { it.key == key }
            sbn ?: return "gone"
            return when (verb) {
                "open" -> runCatching {
                    sbn.notification.contentIntent?.send()
                        ?: return@runCatching null
                }.getOrNull()?.let { "opened" } ?: "no intent"
                "dismiss" -> { svc.cancelNotification(key); "dismissed" }
                "reply" -> replyTo(ctx, sbn,
                    parts.getOrNull(2) ?: return "no text")
                else -> "unknown verb"
            }
        }

        /** Fill the notification's own RemoteInput and fire its
         *  actionIntent — identical to typing the reply on-device. */
        private fun replyTo(ctx: Context, sbn: StatusBarNotification, text: String): String {
            val action = sbn.notification.actions?.firstOrNull {
                it.remoteInputs?.isNotEmpty() == true
            } ?: return "no reply action"
            val ri = action.remoteInputs
            val intent = android.content.Intent()
                .addFlags(android.content.Intent.FLAG_RECEIVER_FOREGROUND)
            android.app.RemoteInput.addResultsToIntent(ri, intent,
                android.os.Bundle().apply {
                    ri.forEach { putCharSequence(it.resultKey, text) }
                })
            return runCatching {
                action.actionIntent.send(ctx, 0, intent)
            }.fold({ "replied" }, { "reply failed" })
        }

        /** Latest posted notifications as "App: title — text" lines. */
        fun latest(ctx: Context, n: Int = 5): List<String> {
            val svc = instance ?: return emptyList()
            return runCatching {
                svc.activeNotifications
                    .sortedByDescending { it.postTime }
                    .take(n)
                    .mapNotNull { sbn: StatusBarNotification ->
                        val e = sbn.notification.extras
                        val title = e.getCharSequence(
                            android.app.Notification.EXTRA_TITLE)?.toString()
                        val text = e.getCharSequence(
                            android.app.Notification.EXTRA_TEXT)?.toString()
                        val app = sbn.packageName.substringAfterLast('.')
                        when {
                            title.isNullOrBlank() -> null
                            text.isNullOrBlank() -> "$app: $title"
                            else -> "$app: $title — ${text.take(120)}"
                        }
                    }
            }.getOrDefault(emptyList())
        }
    }
}
