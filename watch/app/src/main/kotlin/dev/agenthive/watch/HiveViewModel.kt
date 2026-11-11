package dev.agenthive.watch

import android.app.Application
import android.content.Context
import android.os.PowerManager
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.agenthive.watch.data.HiveApi
import dev.agenthive.watch.device.DeviceAgent
import dev.agenthive.watch.device.DeviceCommands
import dev.agenthive.watch.MeshLinker
import dev.agenthive.watch.nexus.NexusInfo
import dev.agenthive.watch.nexus.NexusNode
import dev.agenthive.watch.nexus.NexusState
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class Phase { SETUP, LINKING, READY }

data class Msg(
    val role: String,          // "user" | "assistant"
    val text: String,
    val meta: String = "",
    val pending: Boolean = false,
)

data class MeshSnapshot(
    val watchTunnelIp: String = "",
    val watchNodeId: String = "",
    val seedServer: String = "",
    val hiveTunnelIp: String = "",
    val hiveNodeId: String = "",
    val hiveVport: Int = 0,
    val egressPort: Int = 0,
    val peerCount: Int = 0,
    val onlineCount: Int = 0,
    val tunnelUp: Boolean = false,
)

data class UiState(
    val phase: Phase = Phase.SETUP,
    val statusLine: String = "",
    val log: List<String> = emptyList(),
    val inviteCode: String = "",
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val displayName: String = "",
    val agents: List<HiveApi.Agent> = emptyList(),
    val agent: HiveApi.Agent? = null,
    val messages: List<Msg> = emptyList(),
    val input: String = "",
    val busy: Boolean = false,
    val listening: Boolean = false,
    val speaking: Boolean = false,
    val mesh: String = "off",          // off | direct | connecting | mesh | error
    val unlinked: Boolean = false,     // mesh up but no hive session claimed
    val meshInfo: String = "",
    val meshSnap: MeshSnapshot = MeshSnapshot(),
    val error: String = "",
    val caps: HiveApi.Caps = HiveApi.Caps(),
    /** Proactive glanceable line from /api/assistant/next — becomes a
     *  prompt chip when non-blank ("Meeting in 35m" → tap asks about it). */
    val suggestion: String = "",
    /** Always-on-display mode — the chat dims to a burn-in-safe surface. */
    val ambient: Boolean = false,
)

class HiveViewModel(app: Application) : AndroidViewModel(app) {

    private val hive = app as HiveApp
    private val api: HiveApi get() = hive.api
    private val store get() = hive.store
    private val nexus: NexusNode get() = hive.nexus

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var meshPoll: Job? = null
    private var sessionJob: Job? = null
    private var sendJob: Job? = null
    private var deviceAgent: DeviceAgent? = null

    private fun agentRunner(): DeviceAgent {
        if (deviceAgent == null) {
            val app = getApplication<HiveApp>()
            deviceAgent = DeviceAgent(getApplication(), api, app.appScope).apply {
                onMsg = { m ->
                    android.util.Log.i("DeviceAgent", "msg: ${m.text.take(90)}")
                    _ui.update {
                        it.copy(messages = it.messages +
                            Msg("assistant", m.text, meta = m.meta))
                    }
                    app.appScope.launch { hive.speaker.speak(m.text) }
                }
            }
        }
        return deviceAgent!!
    }

    /** True when the utterance is an in-app task ("play X on spotify") —
     *  needs a task verb AND an installed app's name. Plain "open X" stays
     *  with DeviceCommands' instant path. */
    private fun deviceGoal(msg: String): String? {
        val t = msg.lowercase()
        if (t.matches(Regex("^(open|launch|start|run)\\s+(the\\s+|up\\s+)?[\\w .'-]+$")))
            return null
        val verb = Regex(
            "\\b(play|listen|watch|stream|order|find|search|send|post|message|" +
            "call|book|navigate|queue|download|buy|reply|text|email|create|add|log)\\b")
        if (!verb.containsMatchIn(t)) return null
        val pm = getApplication<Application>().packageManager
        val probe = android.content.Intent(android.content.Intent.ACTION_MAIN)
            .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
        val hasApp = pm.queryIntentActivities(probe,
            android.content.pm.PackageManager.MATCH_ALL).any { ri ->
            val label = ri.loadLabel(pm)?.toString()?.lowercase() ?: ""
            label.isNotBlank() &&
                Regex("\\b${Regex.escape(label)}\\b").containsMatchIn(t)
        }
        return if (hasApp) msg else null
    }

    // Wear OS dozes the app mid-link (wrist down, screen off) which freezes the
    // coroutine and the SDK dataplane gets suspended by ON_STOP — the classic
    // "restore failed, typed a code and it worked" (typing = screen stayed on).
    // A partial wake lock for the link window keeps the CPU through doze.
    private var linkWake: PowerManager.WakeLock? = null
    private fun holdLinkWake() {
        if (linkWake?.isHeld == true) return
        val pm = getApplication<Application>().getSystemService(Context.POWER_SERVICE)
                as PowerManager
        linkWake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hive:link")
            .apply { acquire(5 * 60 * 1000L) }
    }
    private fun releaseLinkWake() {
        runCatching { linkWake?.takeIf { it.isHeld }?.release() }
        linkWake = null
    }

    init {
        nexus.onStatus = { m -> logLine(m) }
        viewModelScope.launch {
            hive.speaker.speaking.collect { s -> _ui.update { it.copy(speaking = s) } }
        }
        restore()
    }

    private fun logLine(m: String) = _ui.update {
        it.copy(log = (it.log + m).takeLast(40), statusLine = m)
    }

    // -- session restore ---------------------------------------------------------

    /**
     * Zero-touch reconnect: the watch's persisted identity rejoins the mesh on
     * its own, the bound node_id+secret redeems a session over the tunnel —
     * no code, no URL, no password. Falls back to the setup screen if the
     * hive kicked this watch or the bound session is gone.
     */
    private fun restore() {
        _ui.update {
            it.copy(
                serverUrl = store.serverUrl,
                username = store.username,
                displayName = store.displayName,
            )
        }
        val hasSession = store.token.isNotBlank() || store.paired
        if (!hasSession) return

        _ui.update { it.copy(phase = Phase.LINKING, statusLine = "rejoining mesh…") }
        sessionJob = viewModelScope.launch {
            holdLinkWake()
            try {
            // service mid-join — wait for its pass to settle rather than
            // throwing "already joining" from a second connect()
            var settle = 0L
            while (nexus.state == NexusState.CONNECTING && settle < 20_000) {
                delay(500); settle += 500
            }
            // warm path — MeshService already holds a live bridge; one probe
            // and a session claim instead of a whole relink.
            val warm = store.meshUrl
            if (warm.isNotBlank() && api.probeHive(warm)) {
                api.baseUrl = warm
                logLine("mesh link verified live — no relink needed")
                if (store.token.isNotBlank()) {
                    api.token = store.token
                    runCatching { api.me() }.onSuccess {
                        finishReady(); return@launch
                    }
                }
                claimSession("")
                finishReady()
                return@launch
            }
            var lastErr: Exception? = null
            // Two passes — on cellular the first connect races the LTE radio
            // waking (SEIP discovery dies on the still-active BT proxy), and
            // by the time it fails the radio is up. A failed pass that left
            // the mesh RUNNING is reused by the next meshUp() early-return.
            for (attempt in 1..2) {
                try {
                    meshUp("")
                    discoverHive { logLine(it) }
                        ?: throw Exception("hive peer unreachable")
                    if (store.token.isNotBlank()) {
                        api.token = store.token
                        runCatching { api.me() }.onSuccess {
                            finishReady(); return@launch
                        }
                    }
                    claimSession("")            // bound node_id + secret — no code
                    finishReady()
                    return@launch
                } catch (e: Exception) {
                    lastErr = e
                    if (attempt == 1) {
                        logLine("retrying — ${e.message?.take(28) ?: "mesh settling…"}")
                        // Dataplane hole punching over UDP may still be negotiating peer endpoints.
                        // Give it a few seconds to settle before retrying discovery without tearing down the node.
                        delay(6000)
                    }
                }
            }
            val hasPhone = dev.agenthive.watch.device.PhoneBridge.hasNearbyPhone(getApplication())
            if (hasPhone && dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(getApplication())) {
                api.baseUrl = "phone://proxy"
                store.meshUrl = "phone://proxy"
                logLine("linked via phone companion (Bluetooth)")
                if (store.token.isNotBlank()) {
                    api.token = store.token
                    runCatching { api.me() }.onSuccess {
                        finishReady(); return@launch
                    }
                }
                claimSession("")
                finishReady()
                return@launch
            }
            if (store.serverUrl.isNotBlank() && store.token.isNotBlank()) {
                runCatching {
                    api.baseUrl = store.serverUrl; api.token = store.token
                    api.me(); loadAgents()
                    _ui.update { it.copy(phase = Phase.READY, mesh = "direct") }
                    startMeshPoll()
                    return@launch
                }
            }
            if (nexus.state == NexusState.RUNNING) contextStartMeshService()
            _ui.update {
                it.copy(phase = Phase.SETUP, unlinked = true,
                        error = "re-pair with a fresh code — ${lastErr?.message?.take(40) ?: "offline"}")
            }
            } finally { releaseLinkWake() }
        }
    }

    // -- setup / linking ---------------------------------------------------------

    fun setInviteCode(v: String) { _ui.update { it.copy(inviteCode = v) } }
    fun setServer(v: String) { _ui.update { it.copy(serverUrl = v) } }
    fun setUsername(v: String) { _ui.update { it.copy(username = v) } }
    fun setPassword(v: String) { _ui.update { it.copy(password = v) } }
    fun setInput(v: String) { _ui.update { it.copy(input = v) } }

    /** PRIMARY: 8-digit code → mesh join → discover hive → mesh session.
     *  Blank code = mesh-only join — the watch stands on the mesh with no hive. */
    fun linkWithCode(code: String) {
        val c = code.trim()
        if (c.isBlank()) { joinMeshOnly(); return }
        if (sessionJob?.isActive == true) { Log.w("HiveVM", "linkWithCode ignored — sessionJob active"); return }
        Log.i("HiveVM", "linkWithCode '$c' phase=${_ui.value.phase}")
        _ui.update { it.copy(inviteCode = c) }
        sessionJob = viewModelScope.launch { doMeshLink(c) }
    }

    /** Mesh without a hive — the watch is a full mesh node on its own network. */
    fun joinMeshOnly() {
        if (sessionJob?.isActive == true) return
        sessionJob = viewModelScope.launch {
            holdLinkWake()
            try {
                _ui.update { it.copy(phase = Phase.LINKING, error = "", log = emptyList()) }
                logLine("joining Nexus mesh…")
                meshUp("")
                _ui.update {
                    it.copy(phase = Phase.READY, unlinked = true, mesh = "mesh",
                            meshInfo = "mesh up · no hive linked")
                }
                startMeshPoll()
                contextStartMeshService()
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message ?: "mesh join failed", phase = Phase.SETUP) }
            } finally { releaseLinkWake() }
        }
    }

    /** Console path when already on the mesh but not linked to a hive. */
    fun linkHive(code: String) {
        val c = code.trim()
        if (c.isBlank()) {
            _ui.update { it.copy(statusLine = "enter the 8-digit code") }
            return
        }
        if (sessionJob?.isActive == true) return
        sessionJob = viewModelScope.launch {
            holdLinkWake()
            try {
                _ui.update { it.copy(statusLine = "linking hive…", error = "") }
                runCatching { nexus.acceptInvite(c) }
                discoverHive { logLine(it) }
                    ?: throw Exception("no hive peer found in group")
                claimSession(c)
                finishReady()
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message ?: "link failed", statusLine = "") }
            } finally { releaseLinkWake() }
        }
    }

    private suspend fun doMeshLink(code: String) {
        holdLinkWake()
        try {
            _ui.update { it.copy(phase = Phase.LINKING, error = "", log = emptyList()) }
            logLine("joining Nexus mesh…")
            meshUp(code)
            val hive = discoverHive { logLine(it) }
            if (hive == null) {
                // Mesh is still up — land unlinked so the console is reachable.
                _ui.update {
                    it.copy(phase = Phase.READY, unlinked = true, mesh = "mesh",
                            meshInfo = "mesh up · hive not found",
                            error = "hive peer not found — check the code or re-link in the console")
                }
                startMeshPoll()
                contextStartMeshService()
                return
            }
            claimSession(code)
            finishReady()
        } catch (e: Exception) {
            _ui.update {
                it.copy(error = e.message ?: "link failed", phase = Phase.SETUP,
                        unlinked = nexus.state == NexusState.RUNNING)
            }
        } finally { releaseLinkWake() }
    }

    /** Dev path — explicit hive URL + login, kept for LAN/QA (intent extras). */
    fun connectWith(server: String, user: String, pass: String) {
        _ui.update { it.copy(serverUrl = server, username = user, password = pass) }
        sessionJob?.cancel()
        sessionJob = viewModelScope.launch { doConnect(server.trim(), user.trim(), pass) }
    }

    fun connect() {
        val s = _ui.value
        val server = s.serverUrl.trim()
        val user = s.username.trim()
        val pass = s.password
        if (server.isBlank() || user.isBlank() || pass.isBlank()) {
            _ui.update { it.copy(error = "server, username and password required") }
            return
        }
        if (sessionJob?.isActive == true) return
        sessionJob = viewModelScope.launch { doConnect(server, user, pass) }
    }

    private suspend fun doConnect(server: String, user: String, pass: String) {
        holdLinkWake()
        try {
            _ui.update { it.copy(phase = Phase.LINKING, error = "", log = emptyList()) }
            logLine("signing in…")
            val (token, u) = api.login(server, user, pass)
            store.serverUrl = server; store.username = u.username
            store.displayName = u.displayName; store.token = token
            _ui.update { it.copy(username = u.username, displayName = u.displayName) }
            logLine("welcome, ${u.displayName}")

            loadAgents()
            linkMeshViaApi()
            _ui.update { it.copy(phase = Phase.READY, statusLine = "", error = "") }
            startMeshPoll()
        } catch (e: Exception) {
            _ui.update { it.copy(error = e.message ?: "connect failed", phase = Phase.SETUP) }
        } finally { releaseLinkWake() }
    }

    fun relinkMesh() {
        if (sessionJob?.isActive == true) return
        sessionJob = viewModelScope.launch {
            holdLinkWake()
            try {
                nexus.stop()
                meshUp("")
                discoverHive { logLine(it) }
                    ?: throw Exception("hive peer unreachable")
                if (store.token.isNotBlank()) {
                    api.token = store.token
                    runCatching { api.me() }.onSuccess { finishReady(); return@launch }
                }
                claimSession("")
                finishReady()
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message ?: "re-link failed") }
            } finally { releaseLinkWake() }
        }
    }

    // -- mesh internals -----------------------------------------------------------

    /**
     * Bring the watch's nexus node up (discover → pin → identity → join →
     * BoringTun). A link token joins the hive's group; empty token rejoins as
     * the persisted node. invite_accept after join is belt-and-braces for the
     * case where join didn't consume the code (existing node + fresh code).
     */
    private suspend fun meshUp(linkToken: String): NexusInfo {
        _ui.update { it.copy(mesh = "connecting", meshInfo = "joining Nexus mesh…") }
        val ni = nexus.connect(
            deviceName = "${store.username.ifBlank { "hive" }}-watch",
            linkToken = linkToken,
            genesisPubkey = "",
        )
        Log.i("HiveVM", "meshUp connect done nodeId=${ni.nodeId} tunnel=${ni.tunnelIp}")
        if (linkToken.isNotBlank()) {
            val acc = runCatching { nexus.acceptInvite(linkToken) }
            Log.i("HiveVM", "acceptInvite('$linkToken') -> ${acc.getOrNull()} err=${acc.exceptionOrNull()?.message}")
        }
        store.meshEnabled = true
        val clean = ni.tunnelIp.substringBefore("/")
        logLine("mesh up — ${clean.ifBlank { ni.nodeId }}")
        _ui.update {
            it.copy(
                mesh = "mesh",
                meshSnap = it.meshSnap.copy(
                    watchTunnelIp = clean,
                    watchNodeId = ni.nodeId,
                    seedServer = ni.server,
                    tunnelUp = true,
                ),
            )
        }
        return ni
    }

    /**
     * Find the hive purely from the mesh — delegates to the shared headless
     * implementation (MeshLinker, also used by MeshService's boot relink) and
     * paints the result into the mesh snapshot for the link screen.
     */
    private suspend fun discoverHive(log: (String) -> Unit): Triple<String, String, Int>? {
        val selfIp = nexus.info.tunnelIp.substringBefore("/")
        return MeshLinker.discover(
            app = getApplication<HiveApp>(),
            log = log,
            onHive = { ip, port, lp, nodeId ->
                _ui.update {
                    it.copy(
                        meshInfo = "mesh · ${selfIp.ifBlank { "watch" }} ⇄ $ip:$port",
                        meshSnap = it.meshSnap.copy(
                            hiveTunnelIp = ip,
                            hiveNodeId = nodeId.ifBlank { store.hiveNodeId },
                            hiveVport = port,
                            egressPort = lp,
                            tunnelUp = true,
                        ),
                    )
                }
            },
        )
    }

    /**
     * POST /api/watch/session over the tunnel. Membership propagation lags the
     * join by a few seconds — the backend answers 403 until it sees us, so we
     * retry briefly before giving up.
     */
    private suspend fun claimSession(code: String) {
        val secret = store.ensureSecret()
        val nodeId = nexus.info.nodeId.ifBlank { nexus.nodeId() }
        var lastErr = "session claim failed"
        for (i in 1..8) {
            try {
                val o = api.watchSession(nodeId, code, secret)
                Log.i("HiveVM", "watchSession try$i node=$nodeId -> token=${o.optString("token").take(8)}")
                val token = o.optString("token")
                if (token.isNotBlank()) {
                    api.token = token
                    store.token = token
                    val u = o.optJSONObject("user")
                    if (u != null) {
                        store.username = u.optString("username", store.username)
                        store.displayName = u.optString("display_name", store.username)
                    }
                    val h = o.optJSONObject("hive")
                    if (h != null) {
                        _ui.update {
                            it.copy(meshSnap = it.meshSnap.copy(
                                hiveTunnelIp = h.optString("tunnel_ip", it.meshSnap.hiveTunnelIp),
                                hiveVport = h.optInt("vport", it.meshSnap.hiveVport),
                            ))
                        }
                    }
                    store.paired = true
                    logLine("linked as ${store.displayName}")
                    return
                }
                lastErr = "empty session response"
            } catch (e: Exception) {
                lastErr = e.message ?: "session claim failed"
                Log.w("HiveVM", "watchSession try$i err=$lastErr")
                delay(1500)
            }
        }
        throw Exception(lastErr)
    }

    /**
     * API-assisted link (direct/LAN path): the backend hands the watch join
     * params + an invite via /api/nexus/watch-join — the session is the login
     * token, the mesh hop still carries the traffic.
     */
    private suspend fun linkMeshViaApi() {
        try {
            api.baseUrl = store.serverUrl
            val status = api.nexusStatus()
            val meshIp = status.optString("tunnel_ip", "").substringBefore("/")
            val meshPort = status.optInt("vport", 0)
            if (status.optString("state") != "running" || meshIp.isBlank() || meshPort <= 0) {
                _ui.update { it.copy(mesh = "direct", meshInfo = "hive mesh offline · direct") }
                return
            }
            _ui.update { it.copy(mesh = "connecting", statusLine = "joining Nexus mesh…") }

            val join = runCatching { api.watchJoin() }.getOrNull()
            val invite = join?.optJSONObject("invite")
            val linkToken = invite?.optString("link_token")
                ?: invite?.optString("code") ?: ""

            val ni = nexus.connect(
                domain = join?.optString("domain", "lemonade-nexus.io") ?: "lemonade-nexus.io",
                region = join?.optString("region", "us-west") ?: "us-west",
                server = join?.optString("server", "") ?: "",
                deviceName = "${store.username}-watch",
                account = store.nexusCfg()?.optString("account") ?: "agenthive",
                linkToken = linkToken,
                genesisPubkey = join?.optString("genesis_pubkey", "") ?: "",
            )
            if (linkToken.isNotBlank()) runCatching { nexus.acceptInvite(linkToken) }
            val cleanWatchIp = ni.tunnelIp.substringBefore("/")
            logLine("mesh up — ${cleanWatchIp.ifBlank { ni.nodeId }}")

            _ui.update {
                it.copy(
                    meshSnap = it.meshSnap.copy(
                        watchTunnelIp = cleanWatchIp,
                        watchNodeId = ni.nodeId,
                        seedServer = ni.server,
                        hiveTunnelIp = meshIp,
                        hiveVport = meshPort,
                        tunnelUp = true,
                    )
                )
            }

            var lp: Int? = null
            for (attempt in 1..6) {
                lp = nexus.openEgress(meshIp, meshPort)
                if (lp != null) break
                delay(1200)
            }
            if (lp != null) {
                val egressUrl = "http://127.0.0.1:$lp"
                store.meshUrl = egressUrl
                store.meshTargetIp = meshIp
                store.meshTargetPort = meshPort
                store.egressPort = lp
                store.meshEnabled = true
                val egressWorks = runCatching {
                    api.baseUrl = egressUrl
                    api.me()
                    true
                }.getOrDefault(false)
                if (!egressWorks) api.baseUrl = store.serverUrl
                _ui.update {
                    it.copy(
                        mesh = "mesh",
                        meshInfo = "mesh · $cleanWatchIp ⇄ $meshIp:$meshPort",
                        meshSnap = it.meshSnap.copy(egressPort = lp, tunnelUp = true),
                    )
                }
                contextStartMeshService()
            } else {
                api.baseUrl = store.serverUrl
                _ui.update {
                    it.copy(mesh = "mesh", meshInfo = "mesh · $cleanWatchIp (${ni.server.substringBefore(".")})")
                }
            }
        } catch (e: Exception) {
            api.baseUrl = store.serverUrl
            _ui.update {
                it.copy(mesh = "direct", meshInfo = "direct · ${e.message?.take(36) ?: "mesh unavailable"}")
            }
        }
    }

    private suspend fun finishReady() {
        loadAgents()
        _ui.update {
            it.copy(phase = Phase.READY, unlinked = false, mesh = "mesh",
                    statusLine = "", error = "")
        }
        store.meshEnabled = true
        contextStartMeshService()
        startMeshPoll()
        refreshCaps()
    }

    /** Probe the bound endpoint's modality models once — TTS drives whether
     *  replies get spoken aloud; missing model = text only (auto-detect). */
    private fun refreshCaps() {
        viewModelScope.launch {
            val c = api.capabilities()
            _ui.update { it.copy(caps = c) }
            hive.speaker.enabled = c.tts
            if (c.tts) logLine("voice replies on — ${c.ttsModel}")
        }
    }

    private fun contextStartMeshService() {
        val ctx = getApplication<Application>()
        runCatching {
            val i = android.content.Intent(ctx, MeshService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }

    private suspend fun loadAgents() {
        val list = api.agents()
        val chosen = list.firstOrNull { it.id == store.agentId }
            ?: list.firstOrNull()
        store.agentId = chosen?.id ?: 0
        _ui.update { it.copy(agents = list, agent = chosen) }
    }

    fun pickAgent(id: Int) {
        store.agentId = id
        _ui.update { s -> s.copy(agent = s.agents.firstOrNull { it.id == id }) }
    }

    fun clearChat() {
        _ui.update { it.copy(messages = emptyList(), error = "") }
    }

    fun disconnect() {
        meshPoll?.cancel()
        store.clear()
        api.token = ""; api.baseUrl = ""
        viewModelScope.launch { nexus.stop() }   // mutex-guarded teardown
        runCatching {
            val ctx = getApplication<Application>()
            ctx.stopService(android.content.Intent(ctx, MeshService::class.java))
        }
        _ui.value = UiState()
    }

    // -- chat ---------------------------------------------------------------------

    fun send(text: String) {
        val s = _ui.value
        val msg = text.trim()

        // "stop" always wins — aborts a running in-app task even mid-busy.
        if (msg.equals("stop", true) || msg.equals("cancel", true) ||
            msg.equals("never mind", true) || msg.equals("stop it", true) ||
            msg.equals("quit", true)) {
            stopAll()
            _ui.update { it.copy(input = "") }
            return
        }
        if (msg.isEmpty() || s.busy) { Log.w("HiveVM", "send: empty/busy busy=${s.busy}"); return }

        // parked on an "ask" — this utterance is the user's pick.
        if (deviceAgent?.feedPick(msg) == true) {
            _ui.update {
                it.copy(messages = it.messages + Msg("user", msg), input = "")
            }
            return
        }

        // new in-app task — "play a podcast about ai on spotify" → agent loop.
        deviceGoal(msg)?.let { goal ->
            Log.i("HiveVM", "device task '$msg'")
            _ui.update {
                it.copy(messages = it.messages + Msg("user", msg),
                        input = "", error = "")
            }
            agentRunner().run(goal)
            return
        }

        // Gemini-style device commands — matched locally, answered instantly,
        // and they work even with no agent/session ("open settings" on an
        // unlinked watch still works). Anything unmatched falls through to
        // the mesh LLM.
        DeviceCommands.handle(getApplication(), msg)?.let { c ->
            Log.i("HiveVM", "device cmd '$msg' -> ${c.text.take(40)}")
            _ui.update {
                it.copy(
                    messages = it.messages + Msg("user", msg) +
                        Msg("assistant", c.text, meta = "⌁ device"),
                    input = "", error = "",
                )
            }
            store.lastReply = c.text
            viewModelScope.launch {
                hive.speaker.speak(c.text)
                c.deferred?.let { d ->
                    runCatching { d() }.getOrNull()
                        ?.takeIf { it.isNotBlank() }?.let { extra ->
                            _ui.update { s ->
                                s.copy(messages = s.messages +
                                    Msg("assistant", extra, meta = "⌁ device"))
                            }
                            hive.speaker.speak(extra)
                        }
                }
            }
            return
        }

        val agent = s.agent ?: run { Log.w("HiveVM", "send: no agent"); return }
        if (api.token.isBlank()) {
            Log.w("HiveVM", "send: no token base=${api.baseUrl}")
            _ui.update { it.copy(error = "link a hive from the mesh console (🔗) to chat") }
            return
        }
        Log.i("HiveVM", "send '${msg.take(30)}' agent=${agent.id} base=${api.baseUrl}")

        val prior = s.messages.filter { !it.pending }
            .takeLast(20)
            .map { it.role to it.text }
        _ui.update {
            it.copy(
                messages = it.messages + Msg("user", msg) + Msg("assistant", "", pending = true),
                input = "", busy = true, error = "",
            )
        }
        sendJob = viewModelScope.launch {
            hive.speaker.stop()
            val (reply, meta, failed) = streamOnce(agent.id, msg, prior)
            val finalText = reply.ifBlank { failed ?: "(empty reply)" }
            patchLast(
                text = finalText,
                meta = if (failed != null) "⚠ $failed" else meta,
                pending = false,
            )
            if (failed == null) store.lastReply = finalText
            _ui.update { it.copy(busy = false) }
            // audio was fed per-sentence during the stream — nothing left to speak
        }
    }

    /** One-tap abort: kills a streaming reply, playback, mic session, and any
     *  in-app task — the dock's Ask pill becomes Stop while any of these run. */
    fun stopAll() {
        sendJob?.cancel()
        deviceAgent?.stop()
        hive.speaker.stop()
        _ui.update { s ->
            val msgs = s.messages.toMutableList()
            if (msgs.isNotEmpty() && msgs.last().pending) {
                msgs[msgs.lastIndex] = msgs.last().copy(
                    pending = false,
                    text = msgs.last().text.ifBlank { "(stopped)" },
                )
            }
            s.copy(messages = msgs, busy = false, listening = false)
        }
    }

    /**
     * ln_mesh_open_egress bridges are ephemeral — a dataplane re-handshake can
     * tear the loopback listener down, leaving store.meshUrl pointing at a dead
     * port. Probe the live bridge and re-open it against the known hive target
     * when it has died. Returns true when api.baseUrl reaches the hive.
     */
    private suspend fun ensureMeshEgress(force: Boolean = false): Boolean {
        // The keep-alive re-proves the bridge every 30s — an ask seconds
        // behind that verdict skips the redundant RTT; the failure path
        // below still force-probes when a stream actually dies.
        if (!force && System.currentTimeMillis() - api.lastProbeOk < 10_000)
            return true
        val ip = store.meshTargetIp
        if (api.probeHive()) return true
        // Dead bridge: race the re-bridge against a phone probe — whichever
        // answers first wins, instead of ~8s serial probes each way.
        val phoneLive = viewModelScope.async(kotlinx.coroutines.Dispatchers.IO) {
            dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(getApplication())
        }
        try {
            if (ip.isNotBlank()) {
                val port = store.meshTargetPort.takeIf { it > 0 } ?: HIVE_VPORT
                nexus.openEgress(ip, port)?.let { lp ->
                    api.baseUrl = "http://127.0.0.1:$lp"
                    store.meshUrl = api.baseUrl
                    store.egressPort = lp
                    Log.i("HiveVM", "egress re-opened ${ip}:$port -> lp=$lp")
                    _ui.update { it.copy(meshSnap = it.meshSnap.copy(egressPort = lp)) }
                    if (api.probeHive()) {
                        phoneLive.cancel()
                        return true
                    }
                }
            }
            // own tunnel is dead — ride the phone's mesh over the Wear channel.
            // MeshService restores direct on a later pass once our tunnel heals.
            if (phoneLive.await()) {
                api.baseUrl = "phone://proxy"
                store.meshUrl = "phone://proxy"
                Log.i("HiveVM", "egress dead — falling back to phone proxy")
                return true
            }
            return false
        } finally {
            phoneLive.cancel()
        }
    }

    private suspend fun streamOnce(
        agentId: Int,
        msg: String,
        prior: List<Pair<String, String>>,
    ): Triple<String, String, String?> {
        val viaMesh = api.baseUrl.startsWith("http://127.0.0.1:")
        val viaProxy = api.baseUrl.startsWith("phone://")
        if ((viaMesh || viaProxy) && !ensureMeshEgress())
            return Triple("", "", "hive unreachable over mesh")
        var res = collectStream(agentId, msg, prior)
        // A dead bridge surfaces as a connect/stream error — reopen once and retry.
        val connectErr = res.third?.contains("onnect", ignoreCase = true) == true
        val streamErr = res.third != null
        if ((viaMesh && connectErr || viaProxy && streamErr) && ensureMeshEgress(force = true)) {
            // the retry supersedes whatever the dead stream fed to the speaker
            hive.speaker.stop()
            res = collectStream(agentId, msg, prior)
        }
        return res
    }

    private suspend fun collectStream(
        agentId: Int,
        msg: String,
        prior: List<Pair<String, String>>,
    ): Triple<String, String, String?> {
        var reply = ""
        var meta = ""
        var lastFlush = 0L
        var spokenUpTo = 0
        var failed: String? = null
        val viaMesh = api.baseUrl.startsWith("http://127.0.0.1:")
        val routeBadge = if (viaMesh || _ui.value.mesh == "mesh") "mesh" else "direct"
        // Feed the speaker one complete sentence at a time — first audio
        // starts while the tail is still streaming (early-voice latency).
        // A terminator only counts once followed by whitespace/newline, so
        // abbreviations at the buffer edge don't cut early; tiny fragments
        // merge into the next sentence instead of chirping alone.
        fun feedSentences(force: Boolean = false) {
            if (!hive.speaker.enabled) return
            val tail = reply.substring(spokenUpTo)
            if (!force && tail.length < 24) return
            val cut = if (force) reply.length else {
                val m = SENTENCE_END.findAll(tail).lastOrNull() ?: return
                spokenUpTo + m.range.last + 1
            }
            hive.speaker.feed(reply.substring(spokenUpTo, cut))
            spokenUpTo = cut
        }
        try {
            api.tryStream(agentId, msg, prior).collect { ev ->
                when (ev) {
                    is HiveApi.StreamEvent.Meta -> {
                        meta = "${ev.provider} · ${ev.model} · $routeBadge"
                        patchLast(meta = meta)
                    }
                    is HiveApi.StreamEvent.Token -> {
                        reply += ev.text
                        feedSentences()
                        val now = System.currentTimeMillis()
                        if (now - lastFlush > 75) { lastFlush = now; patchLast(text = reply) }
                    }
                    is HiveApi.StreamEvent.Thinking ->
                        patchLast(meta = "✦ thinking… (${ev.n})")
                    is HiveApi.StreamEvent.Tool ->
                        patchLast(meta = "⚙ ${ev.name}${if (ev.ok) "" else " · failed"}")
                    is HiveApi.StreamEvent.Replace -> {
                        reply = ev.text
                        spokenUpTo = 0
                        feedSentences(force = true)
                        patchLast(text = reply)
                    }
                    is HiveApi.StreamEvent.Error -> failed = ev.message
                    HiveApi.StreamEvent.Done -> {}
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = e.message ?: "stream failed"
        }
        feedSentences(force = true)
        if (reply.isBlank()) hive.speaker.feed(failed ?: "")
        return Triple(reply, meta, failed)
    }

    private fun patchLast(text: String? = null, meta: String? = null, pending: Boolean? = null) {
        _ui.update { s ->
            val msgs = s.messages.toMutableList()
            if (msgs.isNotEmpty()) {
                val last = msgs.last()
                msgs[msgs.lastIndex] = last.copy(
                    text = text ?: last.text,
                    meta = meta ?: last.meta,
                    pending = pending ?: last.pending,
                )
            }
            s.copy(messages = msgs)
        }
    }

    fun setListening(v: Boolean) { _ui.update { it.copy(listening = v) } }
    fun setAmbient(v: Boolean) { _ui.update { it.copy(ambient = v) } }

    fun voiceResult(text: String) {
        _ui.update { it.copy(listening = false) }
        if (text.isNotBlank()) send(text)
    }

    // -- mesh status ----------------------------------------------------------------

    private fun startMeshPoll() {
        meshPoll?.cancel()
        meshPoll = viewModelScope.launch {
            while (isActive) {
                // Ambient shows a static card — no need to keep the FFI
                // mutex hot; interactive cadence is halved too — the badge
                // doesn't need 10s freshness.
                delay(if (_ui.value.ambient) 60_000 else 20_000)
                if (nexus.state != NexusState.RUNNING) {
                    if (store.meshUrl.startsWith("phone://") || api.baseUrl.startsWith("phone://")) {
                        _ui.update {
                            it.copy(
                                mesh = "phone",
                                meshInfo = "mesh · via phone (BT)",
                                suggestion = store.suggestion,
                            )
                        }
                    }
                    continue
                }
                val st = runCatching { nexus.meshStatus() }.getOrNull()
                val peers = runCatching { nexus.peers() }.getOrNull()
                val pc = peers?.length() ?: st?.optInt("peer_count", 0) ?: 0
                val oc = st?.optInt("online_count", 0) ?: 0
                val up = st?.optBoolean("tunnel_up", false) ?: false
                val cleanIp = nexus.info.tunnelIp.substringBefore("/")
                if (up && store.meshUrl.isNotBlank() &&
                    !_ui.value.unlinked && api.baseUrl != store.meshUrl) {
                    runCatching {
                        api.baseUrl = store.meshUrl
                        api.me()
                    }.onFailure {
                        if (store.serverUrl.isNotBlank()) api.baseUrl = store.serverUrl
                    }
                }
                _ui.update {
                    it.copy(
                        mesh = if (up) "mesh" else "connecting",
                        meshInfo = "mesh · $cleanIp · $oc/$pc peers",
                        suggestion = store.suggestion,
                        meshSnap = it.meshSnap.copy(
                            watchTunnelIp = cleanIp,
                            peerCount = pc,
                            onlineCount = oc,
                            tunnelUp = up,
                        ),
                    )
                }
                if (!up) runCatching { nexus.resume() }
            }
        }
    }

    fun refreshAgents() {
        viewModelScope.launch {
            runCatching { loadAgents() }
                .onFailure { _ui.update { s -> s.copy(error = it.message ?: "refresh failed") } }
        }
    }

    companion object {
        /** Hive's published service port — the backend default (PORT). */
        const val HIVE_VPORT = 8075

        /** Complete-sentence boundary for the streaming TTS feed: terminator
         *  + optional closing quote/bracket + whitespace, or a line break. */
        private val SENTENCE_END = Regex("[.!?]+[\"'”’)\\]]*\\s+|\\n+")
    }
}
