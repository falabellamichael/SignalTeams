package dev.agenthive.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import kotlinx.coroutines.CompletableDeferred

/** Capture must start only after Android has promoted this service. */
class ScreenShareService : Service() {
    companion object { var ready = CompletableDeferred<Unit>() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("screen_share", "Screen sharing", NotificationManager.IMPORTANCE_LOW))
        val notification = Notification.Builder(this, "screen_share")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("SignalHive is sharing your screen")
            .setContentText("Stop sharing from the voice channel or Android capture controls.")
            .setOngoing(true).build()
        startForeground(7402, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        ready.complete(Unit)
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        ready = CompletableDeferred()
        super.onDestroy()
    }
}
