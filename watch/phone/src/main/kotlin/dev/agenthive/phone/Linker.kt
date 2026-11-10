package dev.agenthive.phone

import dev.agenthive.watch.data.HiveApi
import dev.agenthive.watch.data.Store
import dev.agenthive.watch.nexus.NexusNode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Mesh link, transport only: an 8-digit code joins the phone to the hive's
 * group and bridges its published API to a loopback port.
 *
 *   code → join Nexus mesh → find the hive among group devices → open an
 *   egress bridge to its :8075 → http://127.0.0.1:<lp> is the server URL.
 *
 * Sign-in is deliberately separate — the app then logs in normally
 * (username + password → /api/login), exactly like the web. Reconnects skip
 * the code: the persisted node identity rejoins silently.
 */
object Linker {
    private const val HIVE_VPORT = 8075

    data class Linked(val baseUrl: String, val hiveIp: String)

    private data class Cand(val nodeId: String, val ip: String,
                            val admin: Boolean, val member: Boolean)

    /**
     * Mesh link only — no session is minted. [code] is the 8-digit pair
     * code; empty on reconnect, where the persisted node identity rejoins.
     * Returns the egress URL the caller signs into normally.
     */
    suspend fun link(store: Store, api: HiveApi, nexus: NexusNode, code: String,
                     server: String = "",
                     log: (String) -> Unit = {}): Linked {
        // 1. bring the phone's mesh node up (invite lands us in the hive's group)
        log("joining Nexus mesh…")
        val ni = nexus.connect(deviceName = "agenthive-phone", linkToken = code, server = server)
        if (code.isNotBlank()) runCatching { nexus.acceptInvite(code) }
        store.meshEnabled = true
        log("mesh up — ${ni.tunnelIp.substringBefore("/").ifBlank { ni.nodeId }}")

        // 2. find the hive peer and bridge to its published API
        val (hiveIp, lp) = discover(store, api, nexus, log)
            ?: throw Exception("hive peer not found — check the code")
        val baseUrl = "http://127.0.0.1:$lp"
        api.baseUrl = baseUrl
        store.meshUrl = baseUrl
        store.meshTargetIp = hiveIp
        store.meshTargetPort = HIVE_VPORT
        store.egressPort = lp
        store.paired = true           // mesh membership — reconnects silently
        return Linked(baseUrl, hiveIp)
    }

    /** Silent re-link after a restart: same flow, empty code. */
    suspend fun relink(store: Store, api: HiveApi, nexus: NexusNode,
                       log: (String) -> Unit = {}): Linked =
        link(store, api, nexus, "", log = log)

    /**
     * Find the hive purely from the mesh. Fast path first: the last-linked
     * hive's egress is re-opened and probed before any peer scan — a stored
     * pairing reconnects in under a second when the tunnel is up. Otherwise
     * devices() lists every node in groups we belong to (the hive administers
     * the group we joined via invite) and candidates are probed in PARALLEL —
     * first one answering /api/auth/config wins.
     */
    private suspend fun discover(store: Store, api: HiveApi, nexus: NexusNode,
                                 log: (String) -> Unit): Pair<String, Int>? {
        // fast path — re-bridge the stored hive, skip the group scan
        val knownIp = store.meshTargetIp
        if (knownIp.isNotBlank()) {
            log("re-bridging ${knownIp}…")
            val port = store.meshTargetPort.takeIf { it > 0 } ?: HIVE_VPORT
            var lp: Int? = null
            repeat(3) {                     // dataplane may still be settling post-join
                lp = nexus.openEgress(knownIp, port)
                if (lp != null) return@repeat
                delay(400)
            }
            if (lp != null && api.probeHive("http://127.0.0.1:$lp")) return knownIp to lp
            if (lp != null) nexus.closeEgress(knownIp, port)
        }

        val cands = LinkedHashMap<String, Cand>()
        val selfIp = nexus.info.tunnelIp.substringBefore("/")

        repeat(6) {
            runCatching { nexus.devices() }.getOrNull()?.let { arr ->
                for (i in 0 until arr.length()) {
                    val d = arr.optJSONObject(i) ?: continue
                    if (d.optBoolean("is_self")) continue
                    val ip = d.optString("tunnel_ip").substringBefore("/")
                    if (ip.isBlank()) continue
                    val nid = d.optString("node_id").ifBlank { ip }
                    cands[nid] = Cand(
                        nid, ip, d.optBoolean("admin"),
                        d.optBoolean("member") || d.optString("group_role") == "member")
                }
            }
            runCatching { nexus.peers() }.getOrNull()?.let { arr ->
                for (i in 0 until arr.length()) {
                    val p = arr.optJSONObject(i) ?: continue
                    val ip = p.optString("tunnel_ip").substringBefore("/")
                    if (ip.isBlank() || ip == selfIp) continue
                    val nid = p.optString("node_id").ifBlank { ip }
                    if (!cands.containsKey(nid)) cands[nid] = Cand(nid, ip, false, false)
                }
            }
            if (cands.isNotEmpty()) return@repeat
            delay(1500)   // group membership is still propagating
        }

        // probe every candidate at once — the slowest dead node no longer
        // gates the whole discovery; first working egress wins
        val ordered = cands.values.sortedWith(
            compareByDescending<Cand> { it.admin }.thenByDescending { it.member })
        return coroutineScope {
            val win = CompletableDeferred<Pair<String, Int>>()
            for (c in ordered.take(4)) {
                launch {
                    log("found ${c.ip} — bridging…")
                    repeat(2) {
                        val lp = nexus.openEgress(c.ip, HIVE_VPORT) ?: return@repeat
                        if (api.probeHive("http://127.0.0.1:$lp")) {
                            if (win.complete(c.ip to lp)) {
                                store.hiveNodeId = c.nodeId
                                return@launch
                            }
                        }
                        nexus.closeEgress(c.ip, HIVE_VPORT)
                        delay(600)
                    }
                }
            }
            val res = withTimeoutOrNull(25_000) { win.await() }
            coroutineContext.cancelChildren()
            res
        }
    }
}
