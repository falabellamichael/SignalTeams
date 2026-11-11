package dev.agenthive.watch.nexus

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import android.system.Os
import android.util.Log
import com.sun.jna.Library
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.ptr.PointerByReference
import com.sun.jna.ptr.ShortByReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * JNA binding of the Lemonade Nexus C ABI (ln_*), mirroring backend/app/nexus.py.
 * The watch joins the mesh as its own node, then reaches the hive's published
 * service through an egress bridge — all traffic stays inside the encrypted
 * userspace WireGuard dataplane.
 */
interface LibC : Library {
    fun getenv(name: String?): String?
    fun socket(domain: Int, type: Int, protocol: Int): Int
    fun connect(fd: Int, addr: Pointer?, len: Int): Int
    fun close(fd: Int): Int
    fun strerror(err: Int): String?
    fun __errno(): Pointer?
    fun dup2(oldfd: Int, newfd: Int): Int
    fun open(path: String?, oflag: Int, mode: Int): Int
    fun bind(fd: Int, addr: Pointer?, len: Int): Int
}

interface LnApi : Library {
    fun ln_free(p: Pointer?)
    fun ln_create(host: String?, port: Short): Pointer?
    fun ln_create_tls(host: String?, port: Short): Pointer?
    fun ln_destroy(client: Pointer?)
    fun ln_health(client: Pointer?, out: PointerByReference?): Int
    fun ln_discover_servers(domain: String?, region: String?, port: Short, out: PointerByReference?): Int
    fun ln_discover_genesis_key(client: Pointer?, hostsJson: String?, out: PointerByReference?): Int
    fun ln_set_genesis_key(client: Pointer?, key: String?, minEpoch: Long): Int
    fun ln_set_epoch_floor(client: Pointer?, chain: String?, minEpoch: Long): Int
    fun ln_tier1_refresh(client: Pointer?, out: PointerByReference?): Int
    fun ln_tier1_membership(client: Pointer?, out: PointerByReference?): Int
    fun ln_resume(client: Pointer?): Int
    fun ln_suspend(client: Pointer?): Int

    fun ln_identity_generate(): Pointer?
    fun ln_identity_load(path: String?): Pointer?
    fun ln_identity_save(identity: Pointer?, path: String?): Int
    fun ln_identity_pubkey(identity: Pointer?): Pointer?
    fun ln_identity_destroy(identity: Pointer?)
    fun ln_set_identity(client: Pointer?, identity: Pointer?): Int
    fun ln_set_device_name(client: Pointer?, name: String?): Int
    fun ln_set_link_token(client: Pointer?, token: String?): Int

    fun ln_auth_ed25519(client: Pointer?, out: PointerByReference?): Int
    fun ln_join_network(client: Pointer?, username: String?, password: String?, out: PointerByReference?): Int
    fun ln_leave_network(client: Pointer?, out: PointerByReference?): Int
    fun ln_set_node_id(client: Pointer?, nodeId: String?): Int
    fun ln_get_node_id(client: Pointer?): Pointer?
    fun ln_set_session_token(client: Pointer?, token: String?): Int
    fun ln_list_network_devices(client: Pointer?, out: PointerByReference?): Int
    fun ln_invite_accept(client: Pointer?, token: String?, out: PointerByReference?): Int
    fun ln_get_group_devices(client: Pointer?, groupId: String?, out: PointerByReference?): Int

    fun ln_mesh_enable(client: Pointer?): Int
    fun ln_mesh_disable(client: Pointer?): Int
    fun ln_mesh_is_active(client: Pointer?): Int
    fun ln_mesh_status(client: Pointer?, out: PointerByReference?): Int
    fun ln_mesh_peers(client: Pointer?, out: PointerByReference?): Int
    fun ln_mesh_refresh(client: Pointer?): Int
    fun ln_mesh_open_egress(client: Pointer?, ip: String?, port: Short, outPort: ShortByReference?): Int
    fun ln_mesh_close_egress(client: Pointer?, ip: String?, port: Short)
}

object NexusLib {
    @Volatile private var api: LnApi? = null
    @Volatile private var err: String? = null

    fun load(): LnApi {
        api?.let { return it }
        synchronized(this) {
            api?.let { return it }
            err?.let { throw IllegalStateException("nexus SDK failed to load: $it") }
            return try {
                // Load via the app's own classloader namespace first — JNA's
                // bare dlopen can land in a different linker namespace where
                // netd-aware bionic calls (getaddrinfo/socket) resolve
                // differently. System.loadLibrary puts it where the app's
                // other native deps live; JNA then attaches to the same lib.
                runCatching {
                    java.lang.System.loadLibrary("lemonade_nexus_sdk")
                    Log.i("NexusLib", "loaded via System.loadLibrary")
                }.onFailure {
                    Log.w("NexusLib", "System.loadLibrary failed: ${it.message}")
                }
                // UTF-8 so device names / JSON survive the char* boundary.
                Native.load(
                    "lemonade_nexus_sdk", LnApi::class.java,
                    mapOf(Library.OPTION_STRING_ENCODING to "UTF-8")
                ).also { api = it }
            } catch (e: Throwable) {
                err = e.message ?: e.javaClass.simpleName
                throw IllegalStateException("nexus SDK unavailable: $err", e)
            }
        }
    }

    fun available(): Boolean = try { load(); true } catch (_: Throwable) { false }
}

class NexusException(message: String) : Exception(message)

/** Public trust anchors for the production lemonade-nexus.io network. */
private val PUBLIC_GENESIS = mapOf(
    "lemonade-nexus.io" to "W7xnOjHqav3coRGGAxo5X8DWeE9AnOZee2mlzCxt4Ic="
)

data class NexusInfo(
    val nodeId: String = "",
    val tunnelIp: String = "",
    val meshPubkey: String = "",
    val pubkey: String = "",
    val server: String = "",
    val domain: String = "",
    val vport: Int = 0,
    val membership: String? = null,
)

enum class NexusState { OFF, CONNECTING, RUNNING, ERROR }

data class NexusCfg(
    val enabled: Boolean = false,
    val domain: String = "lemonade-nexus.io",
    val region: String = "us-west",
    val server: String = "",          // explicit host[:port], skips DNS discovery
    val deviceName: String = "agenthive-watch",
    val account: String = "agenthive",
)

/**
 * One mesh node per watch. All SDK calls serialize on [mutex] and run on
 * Dispatchers.IO — the C ABI blocks on network I/O.
 */
class NexusNode(private val ctx: Context) {

    private val mutex = Mutex()
    private val dir = File(ctx.filesDir, "nexus").apply { mkdirs() }
    private val identityPath = File(dir, "identity.json").absolutePath
    private val anchorsFile = File(dir, "anchors.json")

    init {
        captureNativeOutput()
        ensureTrustStore()
        // Wake a direct radio NOW — the LTE modem takes 20–40 s to power up,
        // so the demand has to be filed at process start, not when connect()
        // finally reaches bindDirectNetwork.
        runCatching { registerDirectDemand() }
    }

    /**
     * The SDK's Rust/spdlog diagnostics write to stdout/stderr — both are
     * /dev/null on Android. Redirect them into files/nexus/native.log before
     * the .so loads so we can see WHY its HTTPS path reports unreachable.
     */
    private fun captureNativeOutput() {
        runCatching {
            val f = File(dir, "native.log")
            val libc = com.sun.jna.Native.load("c", LibC::class.java)
            // O_WRONLY|O_CREAT|O_APPEND, mode 0600
            val fd = libc.open(f.absolutePath, 1 or 64 or 1024, 384)
            libc.dup2(fd, 1)
            libc.dup2(fd, 2)
            Log.i("NexusNode", "native stdout/stderr -> ${f.absolutePath}")
        }.onFailure { Log.w("NexusNode", "native log capture failed: ${it.message}") }
    }

    /**
     * Android has no /etc/ssl/cert.pem, so OpenSSL inside liblemonade_nexus_sdk.so
     * rejects every TLS handshake unless SSL_CERT_FILE points at a PEM bundle.
     */
    private fun ensureTrustStore() {
        runCatching {
            val pem = File(dir, "cacert.pem")
            if (!pem.exists() || pem.length() < 10_000L) {
                ctx.assets.open("cacert.pem").use { input ->
                    pem.outputStream().use { output -> input.copyTo(output) }
                }
            }
            Os.setenv("SSL_CERT_FILE", pem.absolutePath, true)
            // Upstream's mobile trust store is SSL_CERT_FILE alone — extra
            // OpenSSL env (OPENSSL_CONF, SSL_CERT_DIR) can break provider
            // init inside the static OpenSSL and kill every handshake.
            // SDK debug logging → logcat
            Os.setenv("LN_DEBUG", "1", true)
            Os.setenv("RUST_LOG", "trace", true)
            Os.setenv("SPDLOG_LEVEL", "trace", true)
            // TEMP diag: TLS handshake stage — does keylog appear (keys derived
            // = handshake reached cert-verify) or not (dies in ClientHello)?
            val keylog = File(dir, "keylog.txt")
            Os.setenv("SSLKEYLOGFILE", keylog.absolutePath, true)
            // TEMP diag: confirm native getenv() actually sees it
            runCatching {
                val libc = com.sun.jna.Native.load("c", LibC::class.java)
                Log.i("NexusNode", "SSL_CERT_FILE=${libc.getenv("SSL_CERT_FILE")} path=${pem.absolutePath}")
            }.onFailure { Log.w("NexusNode", "getenv diag failed: ${it.message}") }
        }.onFailure {
            Log.w("NexusNode", "Failed to install cacert.pem: ${it.message}")
        }
    }

    @Volatile var state = NexusState.OFF; private set
    @Volatile var error = ""; private set
    @Volatile var info = NexusInfo(); private set
    @Volatile var cfg = NexusCfg(); private set

    /** Optional UI status tap — reports what the link path is blocked on. */
    @Volatile var onStatus: ((String) -> Unit)? = null
    @Volatile var hasCompanionCheck: (() -> Boolean)? = null

    private var cli: Pointer? = null
    private var ident: Pointer? = null
    @Volatile private var connectStart = 0L
    @Volatile private var joinFails = 0
    /** Set by the keep-alive after probing: false means the companion proxy is
     *  dead too, so a nearby phone must NOT shorten the LTE wake window. */
    @Volatile var companionProxyViable = true
    private var wifiDemand: ConnectivityManager.NetworkCallback? = null
    private var cellDemand: ConnectivityManager.NetworkCallback? = null
    /** Dead-radio bookkeeping: an unfulfilled cell demand keeps the modem
     *  powering + scanning forever (DENIED attach, expired plan, no coverage).
     *  Give it a window to attach, then let the radio rest and retry later. */
    @Volatile private var cellDemandSince = 0L
    @Volatile private var cellCooldownUntil = 0L
    private val CELL_GIVE_MS = 8 * 60_000L       // unanswered → stop asking
    private val CELL_COOLDOWN_MS = 30 * 60_000L  // then retry on a slow clock

    fun directNetworkUp(): Boolean {
        val cm = connectivityManager() ?: return false
        return directNet(cm) != null
    }

    /** Signaled the instant a direct network comes up — no poll granularity. */
    @Volatile private var directLatch = java.util.concurrent.CountDownLatch(1)

    private fun connectivityManager(): ConnectivityManager? = try {
        ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    } catch (e: Exception) {
        Log.w("NexusNode", "no connectivity service: ${e.message}"); null
    }

    private fun transports(cm: ConnectivityManager, n: Network): String {
        val caps = cm.getNetworkCapabilities(n) ?: return "?"
        return buildList {
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) add("cell")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) add("wifi")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) add("eth")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)) add("bt")
        }.joinToString("+").ifBlank { "?" }
    }

    /**
     * A usable path for the mesh dataplane: internet-capable, not VPN, not the
     * BT companion proxy. VALIDATED isn't required — a freshly-woken LTE takes
     * seconds to finish the portal check, and binding early is safe (onLost
     * re-seats if it drops).
     */
    private fun isDirect(cm: ConnectivityManager, n: Network): Boolean {
        val caps = cm.getNetworkCapabilities(n) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)
    }

    private fun directNet(cm: ConnectivityManager): Network? =
        cm.allNetworks.firstOrNull { isDirect(cm, it) }

    /**
     * Demand for a direct radio — naming CELLULAR is what powers the LTE
     * modem on Wear OS when only the BT proxy is up. The WIFI request is
     * standing (it's the path we already use); the CELLULAR one is held only
     * while WiFi is down — that's the only window LTE can matter, and an
     * unfulfilled demand otherwise keeps the modem waking forever.
     * A dead radio (denied attach, lapsed plan, no coverage) gets a window
     * to attach, then a cooldown so it stops cycling.
     */
    private fun registerDirectDemand() {
        val cm = connectivityManager() ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = offer(network)
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = offer(network)
            override fun onLost(network: Network) {
                Log.w("NexusNode", "direct net lost ${transports(cm, network)}")
                val rem = directNet(cm)
                if (rem == null) {
                    directLatch = java.util.concurrent.CountDownLatch(1)
                    cm.bindProcessToNetwork(null)
                    Log.i("NexusNode", "all direct nets lost; unbound process from network")
                } else {
                    val ok = cm.bindProcessToNetwork(rem)
                    Log.i("NexusNode", "re-seated process to ${transports(cm, rem)} ok=$ok")
                }
            }
            private fun offer(network: Network) {
                if (!isDirect(cm, network)) return
                val caps = cm.getNetworkCapabilities(network)
                if (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
                    releaseCellDemand(cm)          // WiFi won — let the modem sleep
                val ok = cm.bindProcessToNetwork(network)
                directLatch.countDown()
                Log.i("NexusNode", "direct net up ${transports(cm, network)} bind=$ok")
            }
        }
        if (wifiDemand == null) {
            wifiDemand = cb
            try {
                cm.requestNetwork(
                    NetworkRequest.Builder()
                        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build(), cb
                )
            } catch (e: Exception) {
                Log.w("NexusNode", "requestNetwork wifi failed: ${e.message}")
            }
        }
        if (cellDemand == null) registerCellDemand(cm)
    }

    /** Ask the OS for cellular — skipped during cooldown so a dead radio rests. */
    private fun registerCellDemand(cm: ConnectivityManager) {
        if (cellDemand != null) return
        if (SystemClock.elapsedRealtime() < cellCooldownUntil) return
        val cb = wifiDemand ?: return
        val cellCb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = cb.onAvailable(network)
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = cb.onCapabilitiesChanged(network, caps)
            override fun onLost(network: Network) = cb.onLost(network)
        }
        cellDemand = cellCb
        cellDemandSince = SystemClock.elapsedRealtime()
        try {
            cm.requestNetwork(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(), cellCb
            )
        } catch (e: Exception) {
            Log.w("NexusNode", "requestNetwork cellular failed: ${e.message}")
        }
    }

    private fun releaseCellDemand(cm: ConnectivityManager) {
        cellDemand?.let { runCatching { cm.unregisterNetworkCallback(it) } }
        cellDemand = null
        cellDemandSince = 0L
    }

    /** Event-driven idle for the keep-alive: true if a direct net arrived. */
    fun awaitDirect(timeoutMs: Long): Boolean =
        runCatching { directLatch.await(timeoutMs,
            java.util.concurrent.TimeUnit.MILLISECONDS) }.getOrDefault(false)

    /** True while LTE is being ignored — a dead radio resting between tries. */
    fun inCellCooldown(): Boolean =
        SystemClock.elapsedRealtime() < cellCooldownUntil

    /**
     * Wear OS routes app traffic through the BLUETOOTH companion-proxy by
     * default whenever the phone is in range — a userspace relay whose
     * Private-DNS (DoT to 8.8.8.8) path may be dead, so every netd-bound
     * getaddrinfo fails ("No address associated") even though raw shell
     * tools work. The mesh needs a direct path anyway: bind this process to
     * Wi-Fi/cellular/ethernet so both the framework resolver and the SDK's
     * bionic getaddrinfo hit a live DNS.
     */
    private fun bindDirectNetwork(waitMs: Long = 35_000) {
        val cm = connectivityManager() ?: return
        registerDirectDemand()
        var net = directNet(cm)
        // If phone is connected over Bluetooth, don't stall for 35s when LTE takes time;
        // give LTE a short chance (3s) before letting the companion mesh proxy take over.
        // BUT only on the first join attempts — once a join has failed, the proxy is
        // presumed dead too, and a cold modem needs its full 20-40s power-up window.
        val hasPhone = hasCompanionCheck?.invoke() ?: false
        val effectiveWait =
            if (hasPhone && companionProxyViable && joinFails < 2) 3_000L else waitMs

        if (net == null && effectiveWait > 0) {
            onStatus?.invoke("waking LTE radio…")
            directLatch.await(effectiveWait, java.util.concurrent.TimeUnit.MILLISECONDS)
            net = directNet(cm)
        }
        if (net != null) {
            val ok = cm.bindProcessToNetwork(net)
            Log.i("NexusNode", "bound process to ${transports(cm, net)} ok=$ok")
        } else {
            cm.bindProcessToNetwork(null)
            Log.w("NexusNode", "no direct network — BT proxy or cellular pending, process unbound")
            // Keep begging for LTE only for a while — a dead radio (denied
            // attach, lapsed plan) otherwise cycles the modem forever.
            val now = SystemClock.elapsedRealtime()
            if (cellDemandSince > 0 && now - cellDemandSince > CELL_GIVE_MS) {
                releaseCellDemand(cm)
                cellCooldownUntil = now + CELL_COOLDOWN_MS
                Log.i("NexusNode", "cell demand unanswered — radio rests for ${CELL_COOLDOWN_MS/60000}min")
            } else {
                registerCellDemand(cm)
            }
        }
    }

    // -- helpers ---------------------------------------------------------------

    private fun Pointer?.isNull() = this == null || this == Pointer.NULL

    private fun jsonOf(out: PointerByReference): JSONObject? {
        val p = out.value ?: return null
        return try {
            JSONObject(p.getString(0, "UTF-8") ?: "")
        } catch (_: Exception) { null } finally {
            NexusLib.load().ln_free(p)
        }
    }

    private fun callJson(block: (LnApi) -> Int, out: PointerByReference): Pair<Int, JSONObject?> {
        val api = NexusLib.load()
        val rc = block(api)
        return rc to jsonOf(out)
    }

    private fun strPtr(p: Pointer?): String {
        if (p.isNull()) return ""
        return try { p!!.getString(0, "UTF-8") ?: "" } finally { NexusLib.load().ln_free(p) }
    }

    private fun loadAnchors(): JSONObject {
        return try { JSONObject(anchorsFile.readText()) } catch (_: Exception) { JSONObject() }
    }

    private fun saveAnchors(net: JSONObject) {
        try { anchorsFile.writeText(net.toString()) } catch (_: Exception) {}
    }

    // -- lifecycle ---------------------------------------------------------------

    /** Blocking connect: discover -> pin -> identity -> join -> mesh up. */
    suspend fun connect(
        domain: String = "",
        region: String = "",
        server: String = "",
        deviceName: String = "",
        account: String = "",
        linkToken: String = "",
        genesisPubkey: String = "",
    ): NexusInfo = mutex.withLock {
        withContext(Dispatchers.IO) {
            val api = NexusLib.load()
            if (state == NexusState.RUNNING) {
                // The dataplane can die under us (radio roamed, doze) while the
                // process stayed bound to a network that's now gone — verify
                // before trusting cached info, and re-seat the process bind.
                val up = runCatching {
                    val out = PointerByReference()
                    api.ln_mesh_status(cli, out) == 0 &&
                        jsonOf(out)?.optBoolean("tunnel_up") == true
                }.getOrDefault(false)
                if (up) {
                    bindDirectNetwork(waitMs = 0)   // tunnel's live — bind only a net that's already up
                    return@withContext info
                }
                teardown()   // fall through to a real rejoin
            }
            if (state == NexusState.CONNECTING) {
                // A join can wedge inside native code (dead TLS mid-roam, a
                // seed that never answers) — past 150s it will never finish,
                // so tear it down and join fresh instead of refusing forever.
                val stuckMs = SystemClock.elapsedRealtime() - connectStart
                if (stuckMs < 150_000) throw NexusException("mesh is already joining")
                Log.w("NexusNode", "join stuck ${stuckMs / 1000}s — tearing down")
            }
            teardown()
            state = NexusState.CONNECTING; error = ""
            connectStart = SystemClock.elapsedRealtime()

            val c = NexusCfg(
                domain = domain.ifBlank { cfg.domain },
                region = region.ifBlank { cfg.region },
                server = server.ifBlank { cfg.server },
                deviceName = deviceName.ifBlank { cfg.deviceName },
                account = account.ifBlank { cfg.account },
            )
            cfg = c

            try {
                info = doConnect(api, c, linkToken, genesisPubkey)
                connectStart = 0L
                joinFails = 0
                state = NexusState.RUNNING
                info
            } catch (e: Exception) {
                joinFails++
                state = NexusState.ERROR
                error = e.message ?: "connect failed"
                teardown()
                throw e
            }
        }
    }

    private data class Seed(val host: String, val port: Int)

    /**
     * SEIP DNS discovery → candidate seed list. The cold-radio race hits here
     * first (getaddrinfo on a still-waking LTE or dead BT-proxy DNS), so retry
     * briefly before declaring the network unreachable.
     */
    private fun collectSeeds(api: LnApi, c: NexusCfg): List<Seed> {
        val seeds = mutableListOf<Seed>()
        if (c.server.isNotBlank()) {
            val hp = c.server.split(":")
            seeds += Seed(hp[0], hp.getOrNull(1)?.toIntOrNull() ?: 9100)
        }
        for (tryN in 1..3) {
            val discOut = PointerByReference()
            val discRc = api.ln_discover_servers(c.domain, c.region, 9100, discOut)
            val discArr = jsonOf(discOut)?.optJSONArray("servers")
            if (discRc == 0 && discArr != null) {
                for (i in 0 until discArr.length()) {
                    val s = discArr.getJSONObject(i)
                    val seed = Seed(s.getString("host"), s.optInt("port", 9100))
                    if (seed !in seeds) seeds += seed
                }
                if (seeds.isNotEmpty()) return seeds
            }
            Log.w("NexusNode", "discover_servers try$tryN rc=$discRc — retrying")
            Thread.sleep(800)
        }
        return seeds
    }

    private fun doConnect(api: LnApi, c: NexusCfg, linkToken: String, genesisHint: String = ""): NexusInfo {
        // 0. escape the BT companion-proxy — bind to a direct (Wi-Fi/LTE/eth)
        //    network first so the SDK's TLS + UDP dataplane get a real route.
        //    When only Bluetooth is up this powers the LTE modem for the mesh.
        bindDirectNetwork()

        // 1. fast path — the seed that served the last join skips DNS discovery
        //    and the candidate walk entirely (reconnects: TLS + join only).
        val anchors = loadAnchors()
        val cached = anchors.optString("seed").takeIf { it.isNotBlank() }?.let {
            val hp = it.split(":")
            Seed(hp[0], hp.getOrNull(1)?.toIntOrNull() ?: 9100)
        }
        if (cached != null && c.server.isBlank()) {
            try {
                return joinOnSeed(api, c, cached, listOf(cached), linkToken, genesisHint)
            } catch (e: Exception) {
                Log.w("NexusNode", "cached seed ${cached.host} failed — ${e.message} — full discovery")
                teardown()
            }
        }

        // 2. candidate seeds: explicit override first, then SEIP DNS discovery
        val seeds = collectSeeds(api, c)
        if (seeds.isEmpty()) throw NexusException("no nexus servers in ${c.region}")

        // 3. walk seeds — individual sn0X nodes are flaky (backend health-walks
        //    too), and a seed that just timed out during LTE wake works on the
        //    next pass. Up to 3 seeds × 2 passes.
        var lastErr = "join failed"
        for (pass in 1..2) {
            for (seed in seeds.take(3)) {
                try {
                    return joinOnSeed(api, c, seed, seeds, linkToken, genesisHint)
                } catch (e: Exception) {
                    lastErr = "${seed.host}: ${e.message ?: "join failed"}"
                    Log.w("NexusNode", "seed ${seed.host}:${seed.port} pass$pass failed — $lastErr")
                    teardown()   // destroy the dead client before the next seed
                    Thread.sleep(700)
                }
            }
            if (pass == 1) Thread.sleep(1500)   // radio still warming — one more sweep
        }
        throw NexusException(lastErr)
    }

    /**
     * One full join on a single seed: TLS client → genesis pin → identity →
     * link token → auth → join → mesh dataplane. Caller walks candidates.
     */
    private fun joinOnSeed(
        api: LnApi,
        c: NexusCfg,
        seed: Seed,
        allSeeds: List<Seed>,
        linkToken: String,
        genesisHint: String,
    ): NexusInfo {
        val client = api.ln_create_tls(seed.host, seed.port.toShort())
        if (client.isNull()) throw NexusException("could not create nexus client")
        cli = client

        // 3. pin the network key: stored trust anchor, hive hint, the public
        //    lemonade-nexus.io anchor baked in below (a public constant — the
        //    Tier-1 chain walk + endpoint proofs still verify everything), or
        //    finally TOFU discovery.
        val anchors = loadAnchors()
        val storedGk = anchors.optString("genesis_pubkey")
            .ifBlank { genesisHint }
            .ifBlank { PUBLIC_GENESIS[c.domain].orEmpty() }
        if (storedGk.isNotBlank()) {
            val rc = api.ln_set_genesis_key(client, storedGk, 0L)
            if (rc != 0) throw NexusException("stored genesis key refused")
            if (anchors.optString("genesis_pubkey").isBlank()) {
                anchors.put("genesis_pubkey", storedGk)
                saveAnchors(anchors)
            }
            val chain = anchors.optString("chain")
            val epoch = anchors.optLong("epoch", 0L)
            if (chain.isNotBlank() && epoch > 0) api.ln_set_epoch_floor(client, chain, epoch)
        } else {
            // hostsJson must carry HOSTNAMES — discovery needs ≥3 agreeing
            // hosts inside the DNS domain (the verified-HTTPS ownership check)
            val hostsJson = JSONArray().apply {
                for (s in allSeeds) put(JSONObject().put("host", s.host).put("port", s.port))
            }.toString()
            Log.i("NexusNode", "genesis discovery on ${allSeeds.size} hosts…")
            val out = PointerByReference()
            val rc = api.ln_discover_genesis_key(client, hostsJson, out)
            val d = jsonOf(out)
            val gk = d?.optString("genesis_pubkey") ?: ""
            Log.i("NexusNode", "genesis discovery rc=$rc gk=${gk.take(12)} err=${d?.optString("error")}")
            if (rc != 0 || gk.isBlank()) {
                throw NexusException((d?.optString("error") ?: "genesis key discovery failed"))
            }
            val net = JSONObject()
                .put("genesis_pubkey", gk)
                .put("network_id", d?.optString("network_id", "") ?: "")
                .put("domain", d?.optString("dns_base_domain", c.domain) ?: c.domain)
            saveAnchors(net)
        }

        // 4. device identity (persisted — same node across restarts)
        var idt = api.ln_identity_load(identityPath)
        if (idt.isNull()) {
            idt = api.ln_identity_generate()
            if (idt.isNull() || api.ln_identity_save(idt, identityPath) != 0) {
                throw NexusException("could not create mesh identity")
            }
        }
        ident = idt
        val pubkey = strPtr(api.ln_identity_pubkey(idt))
        api.ln_set_identity(client, idt)
        if (c.deviceName.isNotBlank()) api.ln_set_device_name(client, c.deviceName)
        if (linkToken.isNotBlank()) {
            val rc = api.ln_set_link_token(client, linkToken)
            if (rc != 0) throw NexusException("invalid link token (8-digit code or lnk_…)")
        }

        // 5a. Ed25519 challenge auth — registers/validates this device identity
        //     against the network account before join can proceed.
        run {
            val out = PointerByReference()
            val rc = api.ln_auth_ed25519(client, out)
            val d = jsonOf(out)
            Log.i("NexusNode", "auth_ed25519 rc=$rc authed=${d?.optBoolean("authenticated")} err=${d?.optString("error")}")
        }

        // 5. join — retry across candidates on no-response
        Log.i("NexusNode", "joining network (account=${c.account}, token=${linkToken.take(4)}…)…")
        var joined: JSONObject? = null
        var lastJoin = "join failed"
        repeat(3) {
            if (joined != null) return@repeat
            val out = PointerByReference()
            val rc = api.ln_join_network(client, c.account, "", out)
            val d = jsonOf(out)
            Log.i("NexusNode", "join rc=$rc success=${d?.optBoolean("success")} err=${d?.optString("error")}")
            if (rc == 0 && d?.optBoolean("success") == true) {
                joined = d
            } else {
                lastJoin = (d?.optString("error") ?: "join rc=$rc")
                Thread.sleep(2000)
            }
        }
        if (joined == null) throw NexusException(lastJoin)

        // 6. mesh dataplane
        api.ln_mesh_enable(client)

        // 7. record the verified epoch floor + the seed that served this join —
        //    next boot's fast path goes straight back to it (no DNS discovery).
        val out = PointerByReference()
        val rc = api.ln_tier1_refresh(client, out)
        val d = jsonOf(out)
        val net = loadAnchors()
        net.put("seed", "${seed.host}:${seed.port}")
        if (rc == 0 && d != null && d.has("chain")) {
            net.put("chain", d.optString("chain"))
            net.put("epoch", d.optLong("epoch", 0L))
        }
        saveAnchors(net)

        val nodeId = joined!!.optString("node_id", "")
        if (nodeId.isNotBlank()) api.ln_set_node_id(client, nodeId)
        joined.optString("session_token", "").takeIf { it.isNotBlank() }?.let {
            runCatching { api.ln_set_session_token(client, it) }
        }

        return NexusInfo(
            nodeId = nodeId,
            tunnelIp = joined!!.optString("tunnel_ip", ""),
            meshPubkey = joined!!.optString("mesh_pubkey", ""),
            pubkey = pubkey,
            server = "${seed.host}:${seed.port}",
            domain = c.domain,
            vport = 0,
            membership = joined!!.optJSONObject("membership")?.toString(),
        )
    }

    suspend fun stop() = mutex.withLock {
        teardown(releaseDemand = true)
        state = NexusState.OFF; error = ""; info = NexusInfo()
    }

    /** Drop the mesh client but KEEP the network demand armed — used when the
     *  tunnel silently died (roam, WiFi toggle) and the next connect() must
     *  rejoin without paying another modem wake. */
    suspend fun reset() = mutex.withLock {
        teardown(releaseDemand = false)
        state = NexusState.OFF; error = ""; info = NexusInfo()
    }

    private fun teardown(releaseDemand: Boolean = false) {
        runCatching { cli?.let { NexusLib.load().ln_destroy(it) } }
        runCatching { ident?.let { NexusLib.load().ln_identity_destroy(it) } }
        cli = null; ident = null; info = NexusInfo()
        if (releaseDemand) {
            val cm = connectivityManager()
            wifiDemand?.let { runCatching { cm?.unregisterNetworkCallback(it) } }
            cellDemand?.let { runCatching { cm?.unregisterNetworkCallback(it) } }
            wifiDemand = null
            cellDemand = null
            runCatching { cm?.bindProcessToNetwork(null) }
        }
    }

    suspend fun resume() = withContext(Dispatchers.IO) {
        mutex.withLock {
            cli?.let { runCatching { NexusLib.load().ln_resume(it) } }
        }
    }

    suspend fun suspendMesh() = withContext(Dispatchers.IO) {
        mutex.withLock {
            cli?.let { runCatching { NexusLib.load().ln_suspend(it) } }
        }
    }

    /** Live mesh status JSON (tunnel_up, peer_count, online_count, …). */
    suspend fun meshStatus(): JSONObject? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = cli ?: return@withLock null
            val api = NexusLib.load()
            val out = PointerByReference()
            if (api.ln_mesh_status(c, out) == 0) jsonOf(out) else null
        }
    }

    /** Peer list JSON. */
    suspend fun peers(): JSONArray? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = cli ?: return@withLock null
            val api = NexusLib.load()
            val out = PointerByReference()
            if (api.ln_mesh_peers(c, out) == 0) {
                val p = out.value
                try {
                    val s = p?.getString(0, "UTF-8") ?: return@withLock null
                    if (s.trimStart().startsWith("[")) JSONArray(s)
                    else JSONObject(s).optJSONArray("peers")
                } catch (_: Exception) { null } finally {
                    p?.let { api.ln_free(it) }
                }
            } else null
        }
    }

    /**
     * Devices visible to this identity — its own network's devices plus every
     * device in groups joined with an invite (the hive appears there once a
     * link token is accepted). JSONArray of NetworkDevice objects.
     */
    suspend fun devices(): JSONArray? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = cli ?: return@withLock null
            val api = NexusLib.load()
            val out = PointerByReference()
            if (api.ln_list_network_devices(c, out) == 0) {
                val p = out.value
                try {
                    val s = p?.getString(0, "UTF-8") ?: return@withLock null
                    if (s.trimStart().startsWith("[")) JSONArray(s)
                    else JSONObject(s).optJSONArray("devices")
                } catch (_: Exception) { null } finally {
                    p?.let { api.ln_free(it) }
                }
            } else null
        }
    }

    /**
     * Redeem a link token for an identity that already joined a network —
     * the follow-up call when join didn't consume the code (e.g. the watch
     * rejoins as an existing node before accepting the hive's invite).
     * Errors are swallowed: "already a member" and "token already used" are
     * both fine outcomes here.
     */
    suspend fun acceptInvite(token: String): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = cli ?: run { Log.w("NexusNode", "acceptInvite: no client"); return@withLock false }
            val api = NexusLib.load()
            val out = PointerByReference()
            val rc = api.ln_invite_accept(c, token, out)
            val d = jsonOf(out)
            val ok = rc == 0 && d?.optBoolean("success") == true
            Log.i("NexusNode", "ln_invite_accept('$token') rc=$rc ok=$ok resp=${d?.toString()?.take(200)}")
            ok
        }
    }

    /** Our own node id as the mesh sees it ("" before first join). */
    fun nodeId(): String {
        val c = cli ?: return ""
        return strPtr(NexusLib.load().ln_get_node_id(c))
    }

    /**
     * Bridge a peer's published mesh service to a loopback port.
     * Returns the loopback port, or null on failure.
     */
    suspend fun openEgress(ip: String, port: Int): Int? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = cli ?: return@withLock null
            if (NexusLib.load().ln_mesh_is_active(c) == 0) return@withLock null
            val api = NexusLib.load()
            val clean = ip.substringBefore("/")
            val outPort = ShortByReference()
            val rc = api.ln_mesh_open_egress(c, clean, port.toShort(), outPort)
            val lp = outPort.value.toInt() and 0xFFFF
            if (rc == 0 && lp > 0) lp else null
        }
    }

    suspend fun closeEgress(ip: String, port: Int) = withContext(Dispatchers.IO) {
        mutex.withLock {
            cli?.let { NexusLib.load().ln_mesh_close_egress(it, ip.substringBefore("/"), port.toShort()) }
        }
    }
}
