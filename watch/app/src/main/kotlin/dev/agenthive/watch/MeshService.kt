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
    @Volatile private var linkStart = 0L
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
        // Wear OS refuses manifest MESSAGE_RECEIVED delivery to sideloaded
        // apps — a runtime listener rides a live binder and works.
        com.google.android.gms.wearable.Wearable.getMessageClient(this)
            .addListener { ev ->
                if (ev.path.startsWith("/hive/"))
                    dev.agenthive.watch.device.WatchWearService.handleMessage(this, ev)
            }.addOnCompleteListener { t ->
                android.util.Log.i("MeshService",
                    "wear listener registered: ${t.isSuccessful}" +
                    (t.exception?.let { " (${it.message})" } ?: ""))
            }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loopJob?.isActive == true) return START_STICKY   // one warm loop
        // watchdog: a hung ln_* call holds linking=true forever AND blocks
        // reset() on the same mutex — the only escape is a fresh process.
        scope.launch {
            while (isActive) {
                delay(60_000)
                if (linking && linkStart > 0 &&
                    android.os.SystemClock.elapsedRealtime() - linkStart > 360_000) {
                    Log.e("MeshService", "link hung >6min — killing process for a clean rejoin")
                    android.os.Process.killProcess(android.os.Process.myPid())
                }
            }
        }
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
                // No IP path = nothing a 30s poll can accomplish — park on the
                // network latch instead. The callback wakes us the instant
                // WiFi/LTE appears; the timeout is a slow re-check of the
                // phone proxy, not a busy poll.
                if (!app.nexus.directNetworkUp() &&
                    app.api.baseUrl != "phone://proxy") {
                    app.nexus.awaitDirect(120_000)
                } else {
                    delay(30_000)
                }
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
    /** The Wear channel answers at its own pace — a single probe can miss a
     *  perfectly live phone. Three tries, ~6s total. */
    private suspend fun phoneMeshUp(): Boolean {
        repeat(3) {
            if (dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(this)) return true
            Log.i("MeshService", "phone mesh probe miss — retrying")
            delay(2_000)
        }
        return false
    }

    private suspend fun linkOnce(app: HiveApp) {
        if (linking) return
        linking = true
        linkStart = android.os.SystemClock.elapsedRealtime()
        try {
            val hasPhone = dev.agenthive.watch.device.PhoneBridge.hasNearbyPhone(this)
            val direct = app.nexus.directNetworkUp()
            if (!direct && hasPhone) {
                // No IP path of our own — the phone proxy is the only route.
                // The Wear channel can take a second to answer; probe a few
                // times before burning minutes on joins that can't work anyway.
                val phoneUp = phoneMeshUp()
                app.nexus.companionProxyViable = phoneUp
                if (phoneUp) {
                    app.store.meshEnabled = true
                    app.api.baseUrl = "phone://proxy"
                    app.store.meshUrl = "phone://proxy"
                    notify("Linked to Hive via Phone (Bluetooth)")
                    refreshSuggestion(app)
                    return
                }
                Log.i("MeshService", "no direct + phone probe dead — joins will retry anyway")
            }

            // No IP interface = no tunnel, period: UDP hole-punching can't ride
            // the BT companion relay (TCP-only). One connect() is still worth it —
            // its bindDirectNetwork wait IS the LTE-modem wake window — but
            // burning three full passes on a guaranteed fail just drains battery.
            // During cell cooldown the radio is resting anyway — skip it all.
            if (!direct) {
                if (app.nexus.inCellCooldown()) {
                    notify("Waiting for network…")
                    return
                }
                try {
                    app.nexus.connect(
                        deviceName = "${app.store.username.ifBlank { "hive" }}-watch",
                        linkToken = "", genesisPubkey = "",
                    )
                    if (MeshLinker.discover(app, log = { m ->
                            Log.i("MeshService", m) }) != null) {
                        app.store.meshEnabled = true
                        notify("Encrypted link to your hive is up")
                        refreshSuggestion(app)
                        return
                    }
                } catch (e: Exception) {
                    Log.w("MeshService", "join while offline: ${e.message}")
                }
                notify("Waiting for network…")
                return
            }

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
                        refreshSuggestion(app)
                        return
                    }
                    // Hole-punching over UDP and peer handshake can take several seconds.
                    // Do NOT reset the active dataplane on earlier passes; only force a full
                    // rejoin on the final attempt if everything has timed out.
                    if (attempt == 3) {
                        runCatching { app.nexus.reset() }
                    }
                } catch (e: Exception) {
                    Log.w("MeshService", "pass $attempt: ${e.message}")
                    if (attempt == 3 && hasPhone) {
                        if (phoneMeshUp()) {
                            app.store.meshEnabled = true
                            app.api.baseUrl = "phone://proxy"
                            app.store.meshUrl = "phone://proxy"
                            notify("Linked to Hive via Phone (Bluetooth)")
                            refreshSuggestion(app)
                            return
                        }
                    }
                }
                delay(if (attempt == 1) 8_000 else 15_000)
            }
            if (hasPhone && dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(this)) {
                app.store.meshEnabled = true
                app.api.baseUrl = "phone://proxy"
                app.store.meshUrl = "phone://proxy"
                notify("Linked to Hive via Phone (Bluetooth)")
                refreshSuggestion(app)
                return
            }
            notify("Mesh offline — retrying…")
        } finally { linking = false }
    }

    /** Proactive glanceable — pull /api/assistant/next ~every 10min so the
     *  tile + watch-face complication can show "Meeting in 35m" unprompted.
     *  Errors leave the old line in place. */
    private suspend fun refreshSuggestion(app: HiveApp) {
        val now = System.currentTimeMillis()
        if (now - lastSuggest < 600_000) return
        lastSuggest = now
        val label = app.api.assistantNext()
        if (app.store.suggestion != label) {
            app.store.suggestion = label
            runCatching {
                androidx.wear.watchface.complications.datasource
                    .ComplicationDataSourceUpdateRequester
                    .create(this, android.content.ComponentName(
                        this, dev.agenthive.watch.complication
                            .HiveComplicationService::class.java))
                    .requestUpdateAll()
            }
            runCatching {
                androidx.wear.tiles.TileService.getUpdater(this)
                    .requestUpdate(dev.agenthive.watch.tile
                        .HiveTileService::class.java)
            }
        }
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

        /** Last proactive-suggestion refresh — ~10min cadence. */
        @Volatile private var lastSuggest = 0L
    }
}
