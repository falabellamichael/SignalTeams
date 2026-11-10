package dev.agenthive.watch.data

import android.content.Context
import org.json.JSONObject

/** Tiny SharedPreferences-backed store for the watch's hive session. */
class Store(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("hive", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(v) = prefs.edit().putString("server_url", v).apply()

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(v) = prefs.edit().putString("token", v).apply()

    var username: String
        get() = prefs.getString("username", "") ?: ""
        set(v) = prefs.edit().putString("username", v).apply()

    var displayName: String
        get() = prefs.getString("display_name", "") ?: ""
        set(v) = prefs.edit().putString("display_name", v).apply()

    var agentId: Int
        get() = prefs.getInt("agent_id", 0)
        set(v) = prefs.edit().putInt("agent_id", v).apply()

    var meshUrl: String
        get() = prefs.getString("mesh_url", "") ?: ""
        set(v) = prefs.edit().putString("mesh_url", v).apply()

    var meshTargetIp: String
        get() = prefs.getString("mesh_target_ip", "") ?: ""
        set(v) = prefs.edit().putString("mesh_target_ip", v).apply()

    var meshTargetPort: Int
        get() = prefs.getInt("mesh_target_port", 0)
        set(v) = prefs.edit().putInt("mesh_target_port", v).apply()

    var egressPort: Int
        get() = prefs.getInt("egress_port", 0)
        set(v) = prefs.edit().putInt("egress_port", v).apply()

    var meshEnabled: Boolean
        get() = prefs.getBoolean("mesh_enabled", false)
        set(v) = prefs.edit().putBoolean("mesh_enabled", v).apply()

    /** Random per-watch credential minted at first pair — sent alongside the
     *  pairing code so only this bezel can ever claim the bound session. */
    var watchSecret: String
        get() = prefs.getString("watch_secret", "") ?: ""
        set(v) = prefs.edit().putString("watch_secret", v).apply()

    /** Node id of the hive peer we paired with — fast-path egress on reboot. */
    var hiveNodeId: String
        get() = prefs.getString("hive_node_id", "") ?: ""
        set(v) = prefs.edit().putString("hive_node_id", v).apply()

    /** A bound session exists — reconnect needs no pairing code. */
    var paired: Boolean
        get() = prefs.getBoolean("paired", false)
        set(v) = prefs.edit().putBoolean("paired", v).apply()

    /** Last assistant reply — the glanceable tile shows it. */
    var lastReply: String
        get() = prefs.getString("last_reply", "") ?: ""
        set(v) = prefs.edit().putString("last_reply", v.take(200)).apply()

    /** Proactive glanceable line from /api/assistant/next ("Meeting in 35m")
     *  — refreshed by MeshService ~10min; the tile/complication show it. */
    var suggestion: String
        get() = prefs.getString("suggestion", "") ?: ""
        set(v) = prefs.edit().putString("suggestion", v.take(80)).apply()

    /** Ensure a watch secret exists; returns it. */
    fun ensureSecret(): String {
        if (watchSecret.isBlank()) {
            watchSecret = java.util.UUID.randomUUID().toString()
        }
        return watchSecret
    }

    var nexusJson: String
        get() = prefs.getString("nexus_cfg", "") ?: ""
        set(v) = prefs.edit().putString("nexus_cfg", v).apply()

    fun nexusCfg(): JSONObject? = nexusJson.takeIf { it.isNotBlank() }?.let {
        runCatching { JSONObject(it) }.getOrNull()
    }

    fun saveNexusCfg(j: JSONObject) { nexusJson = j.toString() }

    fun clear() = prefs.edit().clear().apply()

    // -- per-channel read state (client-side, Discord 'mark unread' needs it) --

    private var lastReadJson: String
        get() = prefs.getString("last_read", "{}") ?: "{}"
        set(v) = prefs.edit().putString("last_read", v).apply()

    /** Timestamp of the newest message the user has seen in channel cid. */
    fun lastRead(cid: Int): Double =
        runCatching { JSONObject(lastReadJson).optDouble("$cid") }
            .getOrDefault(0.0)

    fun setLastRead(cid: Int, ts: Double) {
        if (ts <= 0) return
        val j = runCatching { JSONObject(lastReadJson) }
            .getOrDefault(JSONObject())
        j.put("$cid", ts)
        lastReadJson = j.toString()
    }
}
