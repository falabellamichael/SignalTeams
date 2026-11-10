package dev.agenthive.watch

import android.util.Log
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

        // fast path — re-open the egress to the last-linked hive before any
        // group scan; a stored pairing reconnects in under a second.
        val knownIp = store.meshTargetIp
        if (knownIp.isNotBlank()) {
            // already-bridged? probe the live listener first — keepalive cycles
            // must not swap a healthy bridge for a fresh port every pass, that
            // races and kills in-flight requests.
            val cur = api.baseUrl.ifBlank { store.meshUrl }
            // Proxy is a fallback, not a preference: only keep it while there is
            // no direct path — once WiFi/LTE is back, our own tunnel is strictly
            // better than routing the hive through the phone over Bluetooth.
            if (cur.startsWith("phone://") && !nexus.directNetworkUp()
                && dev.agenthive.watch.device.PhoneBridge.probePhoneMesh(app)) {
                api.baseUrl = "phone://proxy"
                store.meshUrl = "phone://proxy"
                onHive(knownIp, store.meshTargetPort, 0, store.hiveNodeId)
                return Triple(store.hiveNodeId.ifBlank { "phone-proxy" }, knownIp, 0)
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
                lp = nexus.openEgress(knownIp, port)
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
