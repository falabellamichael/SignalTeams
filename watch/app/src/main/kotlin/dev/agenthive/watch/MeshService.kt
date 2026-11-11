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
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import dev.agenthive.watch.MeshLinker
import dev.agenthive.watch.nexus.NexusState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

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
    private var watchJob: kotlinx.coroutines.Job? = null
    private var mgr: NotificationManager? = null

    /** True when the user can actually interact — PowerManager can stay
     *  "interactive" on a Wear always-on display, so a dozing panel counts
     *  as off for cadence purposes. */
    private fun interactive(): Boolean {
        val pm = getSystemService(PowerManager::class.java) ?: return true
        if (!pm.isInteractive) return false
        val st = runCatching {
            (getSystemService(android.hardware.display.DisplayManager::class.java)
                ?.getDisplay(android.view.Display.DEFAULT_DISPLAY))?.state
        }.getOrNull()
        return st != android.view.Display.STATE_DOZE &&
            st != android.view.Display.STATE_DOZE_SUSPEND
    }

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
        // A screen wake while deep-idle doesn't foreground the app — no
        // ON_START, no net event — so the park wait would ride out its 15min
        // cap. SCREEN_ON kicks it instead: wrist raised → mesh resumes.
        registerReceiver(screenRx,
            android.content.IntentFilter(android.content.Intent.ACTION_SCREEN_ON))
    }

    private val screenRx = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context, i: android.content.Intent) {
            (application as? HiveApp)?.kickMesh()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loopJob?.isActive == true) return START_STICKY   // one warm loop
        // watchdog: a hung ln_* call holds linking=true forever AND blocks
        // reset() on the same mutex — the only escape is a fresh process.
        // Guarded like loopJob — re-delivered start intents stacked one each.
        if (watchJob?.isActive != true) {
            watchJob = scope.launch {
                while (isActive) {
                    delay(60_000)
                    if (linking && linkStart > 0 &&
                        android.os.SystemClock.elapsedRealtime() - linkStart > 360_000) {
                        Log.e("MeshService", "link hung >6min — killing process for a clean rejoin")
                        android.os.Process.killProcess(android.os.Process.myPid())
                    }
                }
            }
        }
        loopJob = scope.launch {
            val app = application as HiveApp
            var lastActive = SystemClock.elapsedRealtime()
            var deepIdle = false
            while (isActive) {
                if (!app.store.meshEnabled && !app.store.paired) {
                    stopSelf(); break          // never linked — nothing to keep alive
                }
                val interactive = interactive()
                if (interactive) lastActive = SystemClock.elapsedRealtime()

                if (deepIdle) {
                    if (interactive) {
                        deepIdle = false
                        Log.i("MeshService", "wrist raised — resuming dataplane")
                        runCatching { app.nexus.resume() }
                    } else {
                        // Dataplane suspended — the WG keepalives are off and
                        // the radio actually idles. A kick (wrist raise, net
                        // change, Wear message) wakes instantly; otherwise a
                        // 15min maintenance wake re-handshakes once so the
                        // tunnel, peer presence and the complication stay
                        // warm — then straight back to sleep.
                        val kicked = withTimeoutOrNull(DEEP_IDLE_CHECK_MS) {
                            app.meshKick.first(); true
                        } ?: false
                        if (!kicked) {
                            runCatching { app.nexus.resume() }
                            try {
                                linkOnce(app)
                            } catch (e: Exception) {
                                Log.w("MeshService", "maintenance pass: ${e.message}")
                            }
                            if (app.nexus.state == NexusState.RUNNING)
                                runCatching { app.nexus.suspendMesh() }
                        }
                        continue
                    }
                }

                if (!interactive &&
                    SystemClock.elapsedRealtime() - lastActive > DEEP_IDLE_MS &&
                    app.nexus.state == NexusState.RUNNING) {
                    deepIdle = true
                    Log.i("MeshService", "deep idle — suspending dataplane")
                    runCatching { app.nexus.suspendMesh() }
                    notify("Mesh sleeping — wakes when you do")
                    continue
                } else if (!interactive &&
                    SystemClock.elapsedRealtime() - lastActive > DEEP_IDLE_MS / 2) {
                    // Diagnostic: approaching the suspend mark — shows whether
                    // idle is accumulating or something keeps bumping it.
                    Log.d("MeshService", "idle ${
                        (SystemClock.elapsedRealtime() - lastActive) / 1000
                    }s state=${app.nexus.state}")
                }

                try {
                    linkOnce(app)
                } catch (e: Exception) {
                    Log.w("MeshService", "cycle failed: ${e.message}")
                }
                // One wait, every case: meshKick fires on network arrivals,
                // screen-on and app foregrounding — the loop sleeps until a
                // kick or the cap. Pathless gets a slow 2min re-check of the
                // phone proxy; a healthy link polls at 30s while interactive
                // and stretches to 2.5min on the always-on display, where a
                // stale bridge can wait for the wrist to raise anyway.
                val pathless = !app.nexus.directNetworkUp() &&
                    app.api.baseUrl != "phone://proxy"
                val inter = interactive()
                val waitMs = when {
                    pathless -> 120_000L
                    !inter -> 150_000L
                    else -> 30_000L
                }
                withTimeoutOrNull(waitMs) { app.meshKick.first() }
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
            // The node list is a Wear binder round-trip — lazy so healthy
            // direct passes never pay it; computed once per pass.
            var phoneN: Boolean? = null
            suspend fun phoneNearby(): Boolean = phoneN
                ?: dev.agenthive.watch.device.PhoneBridge.hasNearbyPhone(this)
                    .also { phoneN = it }
            val direct = app.nexus.directNetworkUp()
            if (!direct && phoneNearby()) {
                // No IP path of our own — the phone proxy is the only route.
                // First probe answers in ~1s when the Wear link is alive;
                // only on a miss do we pay the retry loop.
                if (dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(this)) {
                    app.nexus.companionProxyViable = true
                    app.store.meshEnabled = true
                    app.api.baseUrl = "phone://proxy"
                    app.store.meshUrl = "phone://proxy"
                    notify("Linked via phone (Bluetooth)")
                    refreshSuggestion(app)
                    return
                }
                // BT may be dead but a live LTE plan can still save this —
                // kick the modem window CONCURRENTLY with the remaining Wear
                // retries instead of behind ~20s of them. Fire-and-forget:
                // a proxy win below still answers immediately; a join win
                // upgrades the path on the next pass.
                if (!app.nexus.inCellCooldown() &&
                    app.nexus.state != NexusState.CONNECTING) {
                    scope.launch {
                        runCatching {
                            app.nexus.connect(
                                deviceName = "${app.store.username.ifBlank { "nexus" }}-watch",
                                linkToken = "", genesisPubkey = "",
                            )
                            if (MeshLinker.discover(app, log = { m ->
                                    Log.i("MeshService", m) }) != null) {
                                app.store.meshEnabled = true
                                notify("Encrypted link to your hive is up")
                                refreshSuggestion(app)
                            }
                        }.onFailure {
                            Log.w("MeshService", "bg join: ${it.message}")
                        }
                    }
                }
                val phoneUp = phoneMeshUp()
                app.nexus.companionProxyViable = phoneUp
                if (phoneUp) {
                    app.store.meshEnabled = true
                    app.api.baseUrl = "phone://proxy"
                    app.store.meshUrl = "phone://proxy"
                    notify("Linked via phone (Bluetooth)")
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
                        deviceName = "${app.store.username.ifBlank { "nexus" }}-watch",
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
                        deviceName = "${app.store.username.ifBlank { "nexus" }}-watch",
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
                    if (attempt == 3 && phoneNearby()) {
                        if (phoneMeshUp()) {
                            app.store.meshEnabled = true
                            app.api.baseUrl = "phone://proxy"
                            app.store.meshUrl = "phone://proxy"
                            notify("Linked via phone (Bluetooth)")
                            refreshSuggestion(app)
                            return
                        }
                    }
                }
                delay(if (attempt == 1) 8_000 else 15_000)
            }
            if (phoneNearby() && dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(this)) {
                app.store.meshEnabled = true
                app.api.baseUrl = "phone://proxy"
                app.store.meshUrl = "phone://proxy"
                notify("Linked via phone (Bluetooth)")
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

    /** Last posted notification text — re-posting an identical ongoing
     *  notification every pass is pure SystemUI churn. */
    private var lastNotified = ""

    private fun notify(text: String) {
        if (text == lastNotified) return
        lastNotified = text
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notif = Notification.Builder(this, CHANNEL)
            .setContentTitle("Nexus mesh")
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
        runCatching { unregisterReceiver(screenRx) }
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

        /** No user interaction for this long → suspend the dataplane. */
        private const val DEEP_IDLE_MS = 8 * 60_000L
        /** Deep-idle maintenance wake — one link pass, then re-suspend. */
        private const val DEEP_IDLE_CHECK_MS = 15 * 60_000L
    }
}
