package dev.agenthive.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import dev.agenthive.watch.MeshLinker
import dev.agenthive.watch.nexus.NexusState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that OWNS the mesh link for the watch's uptime — started
 * by BootReceiver at boot and by the app after link. While alive it keeps the
 * NexusNode joined and the egress bridge to the hive warm, so the app (and
 * anything else — tiles, assistants, intents) opens onto a ready connection.
 * MainActivity skips suspending the dataplane while [running] is set.
 */
class MeshService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var linking = false
    private var loopJob: kotlinx.coroutines.Job? = null
    private var mgr: NotificationManager? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        mgr = getSystemService(NotificationManager::class.java)
        mgr?.createNotificationChannel(
            NotificationChannel(CHANNEL, "Mesh link", NotificationManager.IMPORTANCE_LOW)
        )
        notify("Encrypted link to your hive is starting…")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loopJob?.isActive == true) return START_STICKY   // one warm loop
        loopJob = scope.launch {
            val app = application as HiveApp
            while (isActive) {
                if (!app.store.meshEnabled && !app.store.paired) {
                    stopSelf(); break          // never linked — nothing to keep alive
                }
                try {
                    linkOnce(app)
                } catch (e: Exception) {
                    Log.w("MeshService", "cycle failed: ${e.message}")
                }
                delay(30_000)
            }
        }
        return START_STICKY
    }

    /**
     * One keep-alive cycle. connect() is idempotent: on RUNNING it verifies
     * tunnel_up (ln_mesh_status) and re-seats the network bind, and when the
     * dataplane silently died — WiFi toggled off, radio roamed, doze — it
     * tears down and rejoins. Discover's fast path is itself the bridge
     * warm-up: probe → re-open → full scan only if the hive is gone.
     * The first LTE join races the radio waking, so failures get a couple of
     * spaced retries while the demand keeps the modem up.
     */
    private suspend fun linkOnce(app: HiveApp) {
        if (linking) return
        linking = true
        try {
            for (attempt in 1..3) {
                try {
                    if (app.nexus.state != NexusState.RUNNING) {
                        notify("Connecting to mesh…")
                        Log.i("MeshService", "link pass $attempt — join")
                    }
                    app.nexus.connect(
                        deviceName = "${app.store.username.ifBlank { "hive" }}-watch",
                        linkToken = "", genesisPubkey = "",
                    )
                    if (MeshLinker.discover(app, log = { m ->
                            Log.i("MeshService", m) }) != null) {
                        app.store.meshEnabled = true
                        notify("Encrypted link to your hive is up")
                        return
                    }
                    // tunnel reported up but nothing answers — status can lag
                    // a dead roam; force a real rejoin on the next pass while
                    // keeping the radio demand armed.
                    runCatching { app.nexus.reset() }
                } catch (e: Exception) {
                    Log.w("MeshService", "pass $attempt: ${e.message}")
                }
                delay(if (attempt == 1) 8_000 else 15_000)
            }
            notify("Mesh offline — retrying…")
        } finally { linking = false }
    }

    private fun notify(text: String) {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notif = Notification.Builder(this, CHANNEL)
            .setContentTitle("Hive mesh")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(1, notif)
        }
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL = "hive_mesh"

        /** Set while the service owns the link — MainActivity consults this
         *  before suspending the dataplane on ON_STOP. */
        @Volatile var running = false; private set
    }
}
