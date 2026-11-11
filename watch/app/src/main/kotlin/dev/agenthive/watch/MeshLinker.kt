package dev.agenthive.watch

import android.util.Log
import dev.agenthive.watch.nexus.NexusNode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Headless hive discovery shared by the app link flow and MeshService's
 * boot-time relink — same fast-path-then-scan order as the ViewModel's
 * interactive version, minus the UI writes. onHive fires when a working
 * bridge lands so callers can refresh their own state.
 */
object MeshLinker {

    const val HIVE_VPORT = 8075

    private data class Cand(
        val nodeId: String,
        val ip: String,
        val admin: Boolean,
        val member: Boolean,
    )

    /** A group member that answered the AgentHive probe — a switchable hive. */
    data class MeshHive(
        val nodeId: String,
        val ip: String,
        val name: String,
        val lp: Int,          // live local egress bridge to it (127.0.0.1:lp)
        val member: Boolean,
        val bound: Boolean,   // this watch already claimed a session on it
    )

    /** Enumerate group devices + dataplane peers into [cands] (keyed by node
     *  id, falling back to ip). Returns (devices seen, peers seen) for logs. */
    private suspend fun collectCands(
        nexus: NexusNode, selfIp: String, cands: MutableMap<String, Cand>,
    ): Pair<Int, Int> {
        var devN = -1; var peerN = -1
        runCatching { nexus.devices() }.getOrNull()?.let { arr ->
            devN = arr.length()
            for (i in 0 until arr.length()) {
                val d = arr.optJSONObject(i) ?: continue
                if (d.optBoolean("is_self")) continue
                val ip = d.optString("tunnel_ip").substringBefore("/")
                if (ip.isBlank()) continue
                val nid = d.optString("node_id")
                cands[nid.ifBlank { ip }] = Cand(
                    nid, ip,
                    admin = d.optBoolean("admin"),
                    member = d.optBoolean("member") ||
                            d.optString("group_role") == "member",
                )
            }
        }
        runCatching { nexus.peers() }.getOrNull()?.let { arr ->
            peerN = arr.length()
            for (i in 0 until arr.length()) {
                val p = arr.optJSONObject(i) ?: continue
                val ip = p.optString("tunnel_ip").substringBefore("/")
                if (ip.isBlank() || ip == selfIp) continue
                val nid = p.optString("node_id")
                val key = nid.ifBlank { ip }
                if (!cands.containsKey(key)) cands[key] = Cand(nid, ip, false, false)
            }
        }
        return devN to peerN
    }

    /**
     * Hive switcher scan: probe EVERY candidate, keep all that answer
     * /api/auth/config. Winners keep their egress bridge open so switching is
     * a baseUrl swap, not a re-bridge. Names come from each hive's own
     * `hive.name` identity block (fallback: tunnel ip).
     */
    suspend fun discoverAll(
        app: HiveApp,
        log: (String) -> Unit = {},
    ): List<MeshHive> {
        val nexus = app.nexus
        val store = app.store
        if (!nexus.directNetworkUp()) return emptyList()

        val selfIp = nexus.info.tunnelIp.substringBefore("/")
        val cands = LinkedHashMap<String, Cand>()
        for (round in 1..3) {
            val (d, p) = collectCands(nexus, selfIp, cands)
            Log.i("MeshLinker", "scan r$round dev=$d peer=$p cands=${cands.size}")
            if (cands.isNotEmpty()) break
            delay(1200)
        }
        val bound = store.boundHiveIds()
        val found = java.util.concurrent.CopyOnWriteArrayList<MeshHive>()
        coroutineScope {
            for (c in cands.values.sortedWith(
                compareByDescending<Cand> { it.admin }.thenByDescending { it.member }
            ).take(8)) {
                launch {
                    repeat(2) {
                        val lp = nexus.openEgress(c.ip, HIVE_VPORT) ?: return@repeat
                        val info = app.api.probeHiveInfo("http://127.0.0.1:$lp")
                        if (info != null) {
                            val name = info.optJSONObject("hive")
                                ?.optString("name")?.takeIf { it.isNotBlank() }
                                ?: c.ip
                            log("found ${name} — ${c.ip}")
                            found.add(MeshHive(c.nodeId, c.ip, name, lp,
                                c.member, c.nodeId in bound))
                            return@launch
                        }
                        nexus.closeEgress(c.ip, HIVE_VPORT)
                        delay(500)
                    }
                }
            }
        }
        return found.sortedWith(
            compareByDescending<MeshHive> { it.bound }
                .thenByDescending { it.member }
                .thenBy { it.name })
    }

    suspend fun discover(
        app: HiveApp,
        log: (String) -> Unit = {},
        onHive: (ip: String, port: Int, lp: Int, nodeId: String) -> Unit = { _, _, _, _ -> },
    ): Triple<String, String, Int>? {
        val nexus = app.nexus
        val store = app.store
        val api = app.api
        val cands = LinkedHashMap<String, Cand>()
        val selfIp = nexus.info.tunnelIp.substringBefore("/")

        // No direct network → the UDP dataplane can't form, so every openEgress
        // below is doomed (control plane rides the BT sysproxy fine, which is
        // why a join can "succeed" yet never carry data). The phone proxy is
        // the only path that can work — probe it and get out instead of
        // burning cycles re-bridging into a dead dataplane.
        if (!nexus.directNetworkUp()) {
            if (dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(app)) {
                log("no direct network — riding phone proxy")
                api.baseUrl = "phone://proxy"
                store.meshUrl = "phone://proxy"
                onHive(store.meshTargetIp, store.meshTargetPort, 0,
                       store.hiveNodeId)
                return Triple(store.hiveNodeId.ifBlank { "phone-proxy" },
                              store.meshTargetIp, 0)
            }
            log("no network path — WiFi/LTE down, phone unreachable")
            return null
        }

        // fast path — re-open the egress to the last-linked hive before any
        // group scan; a stored pairing reconnects in under a second.
        val knownIp = store.meshTargetIp
        if (knownIp.isNotBlank()) {
            // already-bridged? probe the live listener first — keepalive cycles
            // must not swap a healthy bridge for a fresh port every pass, that
            // races and kills in-flight requests.
            val cur = api.baseUrl.ifBlank { store.meshUrl }
            // directNetworkUp() passed above — a stored phone:// is stale now
            // that a real path exists; re-bridge to our own tunnel instead.
            if (cur.startsWith("phone://")) {
                api.baseUrl = ""
                store.meshUrl = ""
            }
            if (cur.startsWith("http://127.0.0.1:") && api.probeHive(cur)) {
                api.baseUrl = cur
                store.meshUrl = cur
                val lp = cur.substringAfterLast(':').toIntOrNull() ?: 0
                if (lp > 0) store.egressPort = lp
                onHive(knownIp, store.meshTargetPort, lp, store.hiveNodeId)
                return Triple(store.hiveNodeId.ifBlank { knownIp }, knownIp, lp)
            }
            log("re-bridging $knownIp…")
            val port = store.meshTargetPort.takeIf { it > 0 } ?: HIVE_VPORT
            var lp: Int? = null
            repeat(3) {                     // dataplane may still be settling post-join
                // force — the cached map entry is exactly the port whose
                // probe just failed above.
                lp = nexus.openEgress(knownIp, port, force = true)
                if (lp != null) return@repeat
                delay(400)
            }
            if (lp != null) {
                var ok = false
                repeat(2) {
                    if (api.probeHive("http://127.0.0.1:$lp")) {
                        ok = true
                        return@repeat
                    }
                    delay(800)
                }
                if (ok) {
                    api.baseUrl = "http://127.0.0.1:$lp"
                    store.meshUrl = api.baseUrl
                    store.egressPort = lp!!
                    onHive(knownIp, port, lp!!, store.hiveNodeId)
                    return Triple(store.hiveNodeId.ifBlank { knownIp }, knownIp, lp!!)
                }
                nexus.closeEgress(knownIp, port)
            }
        }

        for (round in 1..6) {
            var devN = -1; var peerN = -1
            runCatching { nexus.devices() }.getOrNull()?.let { arr ->
                devN = arr.length()
                for (i in 0 until arr.length()) {
                    val d = arr.optJSONObject(i) ?: continue
                    if (d.optBoolean("is_self")) continue
                    val ip = d.optString("tunnel_ip").substringBefore("/")
                    if (ip.isBlank()) continue
                    val nid = d.optString("node_id")
                    cands[nid.ifBlank { ip }] = Cand(
                        nid, ip,
                        admin = d.optBoolean("admin"),
                        member = d.optBoolean("member") ||
                                d.optString("group_role") == "member",
                    )
                }
            }
            runCatching { nexus.peers() }.getOrNull()?.let { arr ->
                peerN = arr.length()
                for (i in 0 until arr.length()) {
                    val p = arr.optJSONObject(i) ?: continue
                    val ip = p.optString("tunnel_ip").substringBefore("/")
                    if (ip.isBlank() || ip == selfIp) continue
                    val nid = p.optString("node_id")
                    val key = nid.ifBlank { ip }
                    if (!cands.containsKey(key)) cands[key] = Cand(nid, ip, false, false)
                }
            }
            Log.i("MeshLinker", "discover r$round dev=$devN peer=$peerN cands=${cands.size}")
            if (cands.isNotEmpty()) break
            delay(1500)   // group membership is still propagating
        }

        // probe candidates in parallel — the slowest dead node no longer gates
        // discovery; first working egress wins and the losers get cancelled.
        val ordered = cands.values.sortedWith(
            compareByDescending<Cand> { it.admin }.thenByDescending { it.member })
        return coroutineScope {
            val win = CompletableDeferred<Triple<String, String, Int>>()
            for (c in ordered.take(4)) {
                launch {
                    log("found ${c.ip} — bridging…")
                    repeat(2) {
                        val lp = nexus.openEgress(c.ip, HIVE_VPORT) ?: return@repeat
                        Log.i("MeshLinker", "egress ${c.ip}:$HIVE_VPORT -> lp=$lp")
                        val ok = api.probeHive("http://127.0.0.1:$lp")
                        Log.i("MeshLinker", "probeHive ${c.ip} -> $ok")
                        if (ok && win.complete(Triple(c.nodeId, c.ip, lp))) return@launch
                        nexus.closeEgress(c.ip, HIVE_VPORT)
                        delay(600)
                    }
                }
            }
            val res = withTimeoutOrNull(25_000) { win.await() }
            coroutineContext.cancelChildren()
            res?.let { (nodeId, ip, lp) ->
                api.baseUrl = "http://127.0.0.1:$lp"
                store.meshUrl = api.baseUrl
                store.meshTargetIp = ip
                store.meshTargetPort = HIVE_VPORT
                store.egressPort = lp
                store.hiveNodeId = nodeId
                onHive(ip, HIVE_VPORT, lp, nodeId)
                Triple(nodeId, ip, lp)
            }
        }
    }
}
