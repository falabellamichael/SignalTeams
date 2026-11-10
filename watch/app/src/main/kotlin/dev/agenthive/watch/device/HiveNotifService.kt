package dev.agenthive.watch.device

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat

/**
 * Notification listener — its real job is unlocking MediaSessionManager, so
 * "pause", "next track" etc. drive whatever is playing on the watch (Spotify,
 * media apps). Needs a one-time toggle in Settings → Apps → Special app
 * access → Notification access.
 */
class HiveNotifService : NotificationListenerService() {

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        if (instance === this) instance = null
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile private var instance: HiveNotifService? = null
        fun isEnabled(ctx: Context): Boolean =
            NotificationManagerCompat.getEnabledListenerPackages(ctx)
                .contains(ctx.packageName)

        /** Deep-link to the notification-access grant page. */
        fun settingsIntent(): Intent =
            Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        private fun activeControllers(ctx: Context): List<MediaController> = runCatching {
            val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE)
                    as MediaSessionManager
            msm.getActiveSessions(ComponentName(ctx, HiveNotifService::class.java))
        }.getOrDefault(emptyList())

        /** Send a transport action to the most-recently-active session. */
        fun transport(ctx: Context, act: (MediaController.TransportControls) -> Unit): Boolean {
            val ctrls = activeControllers(ctx)
            for (c in ctrls) {
                runCatching { act(c.transportControls) }.onSuccess { return true }
            }
            return false
        }

        /** Reply to the newest notification that has an inline-reply action
         *  (RemoteInput). Watches get these for messages/text apps. */
        fun replyToLatest(ctx: Context, text: String): String {
            val svc = instance
                ?: return "Notification access isn't active right now."
            val sbn = runCatching { svc.activeNotifications.toList() }
                .getOrDefault(emptyList())
                .filter { !it.isOngoing }
                .maxByOrNull { it.postTime }
                ?: return "No notification to reply to."
            val action = sbn.notification.actions
                ?.firstOrNull { it.remoteInputs?.isNotEmpty() == true }
                ?: return "The latest notification has no reply action."
            return runCatching {
                val ri = action.remoteInputs!![0]
                val intent = Intent()
                val results = android.os.Bundle().apply {
                    putCharSequence(ri.resultKey, text)
                }
                android.app.RemoteInput.addResultsToIntent(
                    action.remoteInputs, intent, results)
                action.actionIntent.send(ctx, 0, intent)
                val app = sbn.packageName.substringAfterLast('.')
                "Replied to $app: \"$text\""
            }.getOrElse { "Couldn't send that reply — ${it.message}" }
        }

        /** "What's playing" — title · artist from the active session's
         *  metadata, plus whether it's actually playing right now. */
        fun nowPlaying(ctx: Context): String? {
            for (c in activeControllers(ctx)) {
                val md = c.metadata ?: continue
                val title = md.getString(
                    android.media.MediaMetadata.METADATA_KEY_TITLE)
                    ?: continue
                val artist = md.getString(
                    android.media.MediaMetadata.METADATA_KEY_ARTIST)
                    ?: md.getString(
                        android.media.MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
                    ?: md.getString(
                        android.media.MediaMetadata.METADATA_KEY_ALBUM) ?: ""
                val playing = c.playbackState?.state ==
                    android.media.session.PlaybackState.STATE_PLAYING
                return (if (playing) "Playing: " else "Paused: ") +
                    title + if (artist.isNotBlank()) " · $artist" else ""
            }
            return null
        }

        /** Live notification titles for "read my notifications" — app: title. */
        fun latest(ctx: Context): List<String> {
            val svc = instance ?: return emptyList()
            return runCatching {
                svc.activeNotifications.mapNotNull { sbn ->
                    val e = sbn.notification.extras
                    val title = e?.getCharSequence(
                        android.app.Notification.EXTRA_TITLE)?.toString()
                    val text = e?.getCharSequence(
                        android.app.Notification.EXTRA_TEXT)?.toString()
                    val app = sbn.packageName.substringAfterLast('.')
                    when {
                        title.isNullOrBlank() -> null
                        text.isNullOrBlank() -> "$app: $title"
                        else -> "$app: $title — ${text.take(80)}"
                    }
                }.take(12)
            }.getOrDefault(emptyList())
        }
    }
}
