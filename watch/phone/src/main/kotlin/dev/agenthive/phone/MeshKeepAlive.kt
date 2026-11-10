package dev.agenthive.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import dev.agenthive.watch.nexus.NexusState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Owns the phone's mesh link for the device's uptime — the counterpart of
 * the watch's MeshService. While alive it keeps the NexusNode joined and
 * the egress bridge to the hive warm, so the stored loopback URL
 * (server_url/mesh_url — http://127.0.0.1:<lp>) stays answerable for the
 * app, the Wear bridge AND AppFunctions calls like askHive/remember.
 */
class PhoneMeshService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var linking = false
    private var loopJob: kotlinx.coroutines.Job? = null
    private var mgr: NotificationManager? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        mgr = getSystemService(NotificationManager::class.java)
        mgr?.createNotificationChannel(
            NotificationChannel(CHANNEL, "Mesh link",
                NotificationManager.IMPORTANCE_LOW))
        notify("Encrypted link to your hive is starting…")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        if (loopJob?.isActive == true) return START_STICKY
        loopJob = scope.launch {
            val app = application as PhoneApp
            while (isActive) {
                if (!app.store.meshEnabled && !app.store.paired) {
                    stopSelf(); break
                }
                runCatching { linkOnce(app) }
                    .onFailure { Log.w("PhoneMesh", "cycle: ${it.message}") }
                delay(30_000)
            }
        }
        return START_STICKY
    }

    /** relink() is idempotent: RUNNING verifies tunnel_up, a dead dataplane
     *  tears down and rejoins; discover's fast path re-opens the stored
     *  hive's egress before any group scan. */
    private suspend fun linkOnce(app: PhoneApp) {
        if (linking) return
        linking = true
        try {
            if (app.nexus.state != NexusState.RUNNING)
                notify("Connecting to mesh…")
            Linker.relink(app.store, app.api, app.nexus) { m ->
                Log.i("PhoneMesh", m)
            }
            notify("Encrypted link to your hive is up")
        } catch (e: Exception) {
            notify("Mesh offline — retrying…")
        } finally { linking = false }
    }

    private fun notify(text: String) {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL)
            .setContentTitle("Hive mesh")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34)
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(1, n)
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        const val CHANNEL = "hive_mesh"
        const val ACTION_STOP = "dev.agenthive.phone.STOP_MESH"

        fun start(ctx: Context) {
            val i = Intent(ctx, PhoneMeshService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }
}

/** Re-arms the mesh keep-alive at boot — the watch gets the same treatment
 *  via its BootReceiver. Only starts when a pairing exists. */
class PhoneBootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = ctx.applicationContext as PhoneApp
        if (app.store.paired || app.store.meshEnabled)
            PhoneMeshService.start(ctx)
    }
}
