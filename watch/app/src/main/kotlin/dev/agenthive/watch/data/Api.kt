package dev.agenthive.watch.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.emitAll
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Minimal AgentHive REST client — bearer auth, NDJSON streaming. */
/** Optional proxy handler for when direct network is unavailable (e.g. watch on BT). */
interface ApiProxyHandler {
    suspend fun proxyRequest(method: String, path: String, bodyString: String, token: String): Pair<Int, String>
    fun proxyStream(agentId: Int, message: String, history: List<Pair<String, String>>, model: String?): Flow<HiveApi.StreamEvent>
    suspend fun probeMesh(): Boolean
    suspend fun hasCompanion(): Boolean
}

class HiveApi(var ctx: android.content.Context? = null) {

    data class Agent(
        val id: Int,
        val name: String,
        val icon: String,
        val tagline: String,
        val model: String,
        val useWho: String = "",
        val useWhen: String = "always",
        val ownerId: Int = 0,
    ) {
        companion object {
            fun fromJson(o: JSONObject) = Agent(
                id = o.optInt("id"),
                name = o.optString("name", "Agent"),
                icon = o.optString("icon", "✦"),
                tagline = o.optString("tagline", ""),
                model = o.optString("model", ""),
                useWho = o.optString("use_who", ""),
                useWhen = o.optString("use_when", "always"),
                ownerId = o.optInt("owner_id",
                    o.optJSONObject("owner")?.optInt("id") ?: 0),
            )
        }
    }

    data class User(val id: Int, val username: String, val displayName: String)

    sealed class StreamEvent {
        data class Meta(val provider: String, val model: String) : StreamEvent()
        data class Token(val text: String) : StreamEvent()
        data class Thinking(val n: Int) : StreamEvent()
        data class Tool(val name: String, val ok: Boolean) : StreamEvent()
        data class Replace(val text: String) : StreamEvent()
        object Done : StreamEvent()
        data class Error(val message: String) : StreamEvent()
    }

    class ApiException(message: String, val code: Int = 0) : Exception(message)

    private val json = "application/json; charset=utf-8".toMediaType()

    // Streaming client — NDJSON replies can be slow; no read cap.
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    // Request/response client — a stalled mesh-egress read must not hang the
    // link/discovery coroutine forever (probeHive/watchSession share this path).
    private val reqClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    // LLM round-trip calls (act/tts) can take tens of seconds — a bounded but
    // generous read budget so a model thinking through a step doesn't time out.
    private val slowClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build()

    // Discovery probes — bounded timeout (8s connect / 8s read) so cold WireGuard
    // handshakes and LAN hole punching have time to settle without hanging indefinitely.
    private val probeClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    @Volatile var baseUrl: String = ""
    @Volatile var token: String = ""
    @Volatile var proxyHandler: ApiProxyHandler? = null

    /** Wall time of the last successful hive probe — lets callers trust a
     *  bridge the keep-alive just verified instead of re-paying the RTT. */
    @Volatile var lastProbeOk: Long = 0L

    private fun url(path: String) = if (baseUrl.startsWith("phone://")) "http://127.0.0.1$path" else baseUrl.trimEnd('/') + path

    private fun request(path: String, method: String = "GET", body: JSONObject? = null): Request {
        val b = Request.Builder().url(url(path))
        if (token.isNotBlank()) b.header("Authorization", "Bearer $token")
        return when (method) {
            "POST" -> b.post((body?.toString() ?: "{}").toRequestBody(json)).build()
            "PATCH" -> b.patch((body?.toString() ?: "{}").toRequestBody(json)).build()
            "PUT" -> b.put((body?.toString() ?: "{}").toRequestBody(json)).build()
            "DELETE" -> b.delete(
                if (body != null) body.toString().toRequestBody(json) else null
            ).build()
            else -> b.build()
        }
    }

    private fun execute(req: Request): Pair<Int, String> {
        val isProxy = baseUrl.startsWith("phone://") || baseUrl.isBlank()
        val proxy = proxyHandler
        if (isProxy && proxy != null) {
            val path = req.url.encodedPath + (req.url.encodedQuery?.let { "?$it" } ?: "")
            val bodyStr = req.body?.let { b ->
                val buf = okio.Buffer()
                b.writeTo(buf)
                buf.readUtf8()
            }.orEmpty()
            val res: Pair<Int, String> = kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                proxy.proxyRequest(req.method, path, bodyStr, token)
            }
            val code = res.first
            val body = res.second
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(body).optString("detail", body) }
                    .getOrDefault(body.ifBlank { "HTTP $code" })
                throw ApiException(msg, code)
            }
            return Pair(code, body)
        }
        return try {
            reqClient.newCall(req).execute().use { r ->
                val text = r.body?.string() ?: ""
                if (!r.isSuccessful) {
                    val msg = runCatching { JSONObject(text).optString("detail", text) }
                        .getOrDefault(text.ifBlank { "HTTP ${r.code}" })
                    throw ApiException(msg, r.code)
                }
                Pair(r.code, text)
            }
        } catch (e: Exception) {
            if (proxy != null && (e is java.io.IOException || e is java.net.SocketException)) {
                val path = req.url.encodedPath + (req.url.encodedQuery?.let { "?$it" } ?: "")
                val bodyStr = req.body?.let { b ->
                    val buf = okio.Buffer()
                    b.writeTo(buf)
                    buf.readUtf8()
                }.orEmpty()
                val res: Pair<Int, String> = kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                    proxy.proxyRequest(req.method, path, bodyStr, token)
                }
                if (res.first in 200..299) {
                    return res
                }
            }
            throw e
        }
    }

    private fun getJson(path: String): JSONObject {
        val (_, text) = execute(request(path))
        return JSONObject(text)
    }

    private fun getJsonArray(path: String): JSONArray {
        val (_, text) = execute(request(path))
        return JSONArray(text)
    }

    private fun postJson(path: String, body: JSONObject = JSONObject()): JSONObject {
        val (_, text) = execute(request(path, "POST", body))
        return JSONObject(text)
    }

    private suspend fun ioJson(path: String, method: String = "GET",
                               body: JSONObject? = null): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            execute(request(path, method, body)).let { JSONObject(it.second) }
        }

    private suspend fun ioArr(path: String): JSONArray =
        kotlinx.coroutines.withContext(Dispatchers.IO) { getJsonArray(path) }

    // -- settings surface (web SettingsModal parity) -------------------------------

    /** Full /api/me — profile + flags (has_password, is_admin, keywords…). */
    suspend fun meJson(): JSONObject = ioJson("/api/me")

    /** PATCH /api/me — returns the updated public_user. */
    suspend fun updateMe(patch: JSONObject): JSONObject =
        ioJson("/api/me", "PATCH", patch)

    suspend fun setPassword(current: String, next: String, kickOthers: Boolean = true) =
        ioJson("/api/me/password", "POST", JSONObject()
            .put("current", current).put("next", next).put("kick_others", kickOthers))

    suspend fun signOutOthers() = ioJson("/api/me/signout-others", "POST")

    // LLM endpoint (Settings → Models)
    suspend fun llmMe(): JSONObject = ioJson("/api/me/llm")
    suspend fun llmSave(p: JSONObject): JSONObject = ioJson("/api/me/llm", "PUT", p)
    suspend fun llmTest(): JSONObject = ioJson("/api/me/llm/test", "POST")
    suspend fun llmProviders(): JSONArray = ioArr("/api/llm/providers")

    data class Caps(
        val tts: Boolean = false,
        val stt: Boolean = false,
        val embed: Boolean = false,
        val image: Boolean = false,
        val ttsModel: String = "",
    )

    /** Which modality models the bound endpoint exposes — drives auto-detect:
     *  no TTS model → replies stay text-only. */
    suspend fun capabilities(): Caps = kotlinx.coroutines.withContext(Dispatchers.IO) {
        runCatching { getJson("/api/llm/capabilities") }
            .map { o ->
                Caps(
                    tts = o.optBoolean("tts"),
                    stt = o.optBoolean("stt"),
                    embed = o.optBoolean("embed"),
                    image = o.optBoolean("image"),
                    ttsModel = o.optJSONObject("models")
                        ?.optJSONArray("tts")?.optString(0) ?: "",
                )
            }
            .getOrDefault(Caps())
    }

    /** POST /api/llm/act — one device-driving step: {goal,app,screen,steps,
     *  picked} → {action, target, text}. Null on transport/parse failure. */
    suspend fun act(
        goal: String,
        app: String = "",
        screen: List<String> = emptyList(),
        steps: List<String> = emptyList(),
        picked: String = "",
    ): JSONObject? = kotlinx.coroutines.withContext(Dispatchers.IO) {
        val b = JSONObject()
            .put("goal", goal.take(2000))
            .put("app", app.take(64))
            .put("screen", JSONArray(screen.take(80)))
            .put("steps", JSONArray(steps.takeLast(12)))
            .put("picked", picked.take(160))
        // the egress bridge flaps under the mesh keepalive — a single dead
        // stream must not kill a running task, so retry briefly.
        repeat(4) { attempt ->
            runCatching {
                val req = request("/api/llm/act", "POST", b)
                slowClient.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) {
                        android.util.Log.w(
                            "HiveApi", "act ${r.code} ${r.body?.string()?.take(80)}")
                        return@use null
                    }
                    JSONObject(r.body?.string() ?: "{}")
                }
            }.onSuccess { if (it != null) return@withContext it }
              .onFailure { android.util.Log.w(
                  "HiveApi", "act failed(${attempt + 1}): ${it.message}") }
            if (attempt < 3) kotlinx.coroutines.delay(1500L * (attempt + 1))
        }
        null
    }

    /** POST /api/llm/resolve — the hive turns a play/listen goal into a
     *  concrete deep link (or an option list) before any UI driving starts.
     *  Same flap-tolerant retry as act(). */
    suspend fun resolve(goal: String, app: String = ""): JSONObject? =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val b = JSONObject()
                .put("goal", goal.take(2000))
                .put("app", app.take(64))
            repeat(3) { attempt ->
                runCatching {
                    val req = request("/api/llm/resolve", "POST", b)
                    slowClient.newCall(req).execute().use { r ->
                        if (!r.isSuccessful) {
                            android.util.Log.w(
                                "HiveApi", "resolve ${r.code} ${r.body?.string()?.take(80)}")
                            return@use null
                        }
                        JSONObject(r.body?.string() ?: "{}")
                    }
                }.onSuccess { if (it != null) return@withContext it }
                  .onFailure { android.util.Log.w(
                      "HiveApi", "resolve failed(${attempt + 1}): ${it.message}") }
                if (attempt < 2) kotlinx.coroutines.delay(1500L * (attempt + 1))
            }
            null
        }

    /** Personal-context memory — POST adds, GET lists, DELETE idx drops. */
    suspend fun memoryList(): JSONArray = ioArr("/api/memory")
    suspend fun memoryAdd(text: String): JSONObject =
        ioJson("/api/memory", "POST", JSONObject().put("text", text.take(300)))
    suspend fun memoryForget(idx: Int): JSONObject =
        ioJson("/api/memory", "POST", JSONObject().put("text", "-").put("idx", idx))

    /** Proactive glanceable line ("Team sync in 35m") — blank when nothing's
     *  due soon or no calendar plugin. Tile/complication poll this. */
    suspend fun assistantNext(): String =
        runCatching { ioJson("/api/assistant/next").optString("label", "") }
            .getOrDefault("")

    /** POST /api/llm/tts — mp3 bytes, or null when the endpoint has no TTS
     *  model (404) / synthesis fails. Callers fall back to text. */
    suspend fun ttsBytes(text: String): ByteArray? =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            runCatching {
                val body = JSONObject().put("text", text.take(4000))
                val req = request("/api/llm/tts", "POST", body)
                slowClient.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) return@use null
                    r.body?.bytes()
                }
            }.getOrNull()
        }

    // AI connections + OAuth plugins (Settings → Connections)
    suspend fun connections(): JSONArray = ioArr("/api/connections")
    suspend fun connSave(pid: String, p: JSONObject) =
        ioJson("/api/connections/$pid", "PUT", p)
    suspend fun connImport(pid: String) = ioJson("/api/connections/$pid/import", "POST")
    suspend fun connDel(pid: String) = ioJson("/api/connections/$pid", "DELETE")
    suspend fun connTest(pid: String) = ioJson("/api/connections/$pid/test", "POST")
    suspend fun connUse(pid: String) = ioJson("/api/connections/$pid/use", "POST")
    suspend fun connBegin(pid: String) = ioJson("/api/connections/$pid/begin", "POST")
    suspend fun connPoll(pid: String, flow: JSONObject) =
        ioJson("/api/connections/$pid/poll", "POST",
            JSONObject().put("flow", flow))

    // Nexus mesh (Settings → Mesh)
    suspend fun nexusPeers(): JSONArray = ioArr("/api/nexus/peers")
    suspend fun nexusDevices(): JSONArray = ioArr("/api/nexus/devices")
    suspend fun nexusDeviceRemove(nodeId: String) =
        ioJson("/api/nexus/devices/$nodeId", "DELETE")
    suspend fun nexusInvite(ttlSec: Int = 86400) =
        ioJson("/api/nexus/invite", "POST", JSONObject().put("ttl_sec", ttlSec))

    /** PATCH /api/agents/{id} — permission flags (use_who/use_when). */
    suspend fun agentUpdate(aid: Int, patch: JSONObject) =
        ioJson("/api/agents/$aid", "PATCH", patch)

    // -- phone app surface --------------------------------------------------------

    suspend fun servers(): JSONArray = kotlinx.coroutines.withContext(Dispatchers.IO) {
        getJsonArray("/api/servers")
    }

    suspend fun createServer(name: String): JSONObject =
        ioJson("/api/servers", "POST", JSONObject().put("name", name))

    suspend fun joinServer(code: String): JSONObject =
        ioJson("/api/servers/join", "POST",
            JSONObject().put("invite_code", code))

    suspend fun leaveServer(sid: Int): JSONObject =
        ioJson("/api/servers/$sid/leave", "POST")

    /** Server detail — includes channels[] and members[]. */
    suspend fun serverDetail(sid: Int): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            getJson("/api/servers/$sid")
        }

    /** Channel messages, oldest→newest. before=id pages upward. */
    suspend fun messages(cid: Int, before: Int = 0, limit: Int = 50): JSONArray =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            getJsonArray("/api/channels/$cid/messages?limit=$limit&before=$before")
        }

    suspend fun postMessage(cid: Int, content: String, poll: JSONObject? = null,
                            replyTo: Int? = null, fwdOf: Int? = null,
                            threadRoot: Int? = null,
                            attachments: JSONArray? = null): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val b = JSONObject().put("content", content)
            if (poll != null) b.put("poll", poll)
            if (fwdOf != null) b.put("fwd_of", fwdOf)
            if (replyTo != null) b.put("reply_to", replyTo)
            if (threadRoot != null) b.put("thread_root", threadRoot)
            if (attachments != null) b.put("attachments", attachments)
            postJson("/api/channels/$cid/messages", b)
        }

    // message actions (Discord long-press sheet parity)
    suspend fun react(mid: Int, emoji: String): JSONObject =
        ioJson("/api/messages/$mid/react", "POST",
            JSONObject().put("emoji", emoji))

    suspend fun editMessage(mid: Int, content: String): JSONObject =
        ioJson("/api/messages/$mid", "PATCH", JSONObject().put("content", content))

    suspend fun deleteMessage(mid: Int): JSONObject =
        ioJson("/api/messages/$mid", "DELETE")

    suspend fun pinMessage(mid: Int): JSONObject =
        ioJson("/api/messages/$mid/pin", "POST")

    suspend fun saveMessage(mid: Int): JSONObject =
        ioJson("/api/messages/$mid/save", "POST")

    suspend fun saved(): JSONArray = ioArr("/api/saved")

    /** Mention inbox — buzz rows of kind 'mentioned' directed at me. */
    suspend fun inbox(): JSONArray = ioArr("/api/inbox")

    suspend fun threadMessages(mid: Int): JSONArray =
        ioArr("/api/messages/$mid/thread")

    suspend fun channelPins(cid: Int): JSONArray =
        ioArr("/api/channels/$cid/pins")

    suspend fun searchMessages(cid: Int, q: String): JSONArray =
        ioArr("/api/channels/$cid/search?q=" +
            java.net.URLEncoder.encode(q, "UTF-8"))

    /** Full profile card data — user, friend edge, agents, mutuals. */
    suspend fun userProfile(uid: Int): JSONObject =
        ioJson("/api/users/$uid/profile")

    /** Find-or-create a 1:1 DM with a user — {"id": cid}. */
    suspend fun openDm(uid: Int): JSONObject =
        ioJson("/api/dms/$uid", "POST")

    /** Friends graph — {accepted:[], incoming:[], outgoing:[]} of public users. */
    suspend fun friends(): JSONObject = ioJson("/api/friends")

    suspend fun addFriend(username: String): JSONObject =
        ioJson("/api/friends", "POST",
            JSONObject().put("username", username))

    suspend fun acceptFriend(fid: Int): JSONObject =
        ioJson("/api/friends/$fid/accept", "POST")

    suspend fun removeFriend(fid: Int): JSONObject =
        ioJson("/api/friends/$fid", "DELETE")

    suspend fun blocks(): JSONArray = ioArr("/api/blocks")

    suspend fun toggleBlock(uid: Int): JSONObject =
        ioJson("/api/blocks/$uid", "POST")

    /** Multipart file upload → {id,name,mime,size} for message attachments. */
    suspend fun upload(name: String, bytes: ByteArray, mime: String): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val body = okhttp3.MultipartBody.Builder()
                .setType(okhttp3.MultipartBody.FORM)
                .addFormDataPart("file", name,
                    bytes.toRequestBody(mime.toMediaType()))
                .build()
            val b = Request.Builder().url(url("/api/upload")).post(body)
            if (token.isNotBlank()) b.header("Authorization", "Bearer $token")
            execute(b.build()).let { JSONObject(it.second) }
        }

    /** Bearer-authed file URL — Coil loads it directly. */
    fun fileUrl(fid: String): String =
        "${baseUrl.trimEnd('/')}/api/files/$fid?token=$token"

    /** DM/group channels the user is in. */
    suspend fun dms(): JSONArray = kotlinx.coroutines.withContext(Dispatchers.IO) {
        getJsonArray("/api/dms")
    }

    /** Find-or-create the 1:1 DM with an agent's bot user — {"id": cid}. */
    suspend fun agentDm(aid: Int): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            postJson("/api/agents/$aid/dm")
        }

    /** Stamp a DM channel as read (channel_members.last_read). */
    suspend fun markRead(cid: Int) = kotlinx.coroutines.withContext(Dispatchers.IO) {
        runCatching { postJson("/api/channels/$cid/read") }
    }

    /** Discord 'mark unread' — rewinds last_read to just before a message. */
    suspend fun markUnread(cid: Int, mid: Int) =
        ioJson("/api/channels/$cid/mark-unread", "POST",
            JSONObject().put("message_id", mid))

    suspend fun login(server: String, username: String, password: String): Pair<String, User> =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            baseUrl = server.trim().trimEnd('/')
            val body = JSONObject().put("username", username).put("password", password)
            val (_, text) = execute(
                Request.Builder().url(url("/api/login")).post(body.toString().toRequestBody(json)).build()
            )
            val o = JSONObject(text)
            token = o.getString("token")
            val u = o.optJSONObject("user") ?: JSONObject()
            token to User(u.optInt("id"), u.optString("username"),
                u.optString("display_name", u.optString("username")))
        }

    suspend fun register(server: String, username: String, password: String,
                         display: String, invite: String = ""): Pair<String, User> =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            if (server.isNotBlank()) baseUrl = server.trim().trimEnd('/')
            val body = JSONObject().put("username", username).put("password", password)
                .put("display_name", display).put("invite", invite)
            val o = postJson("/api/register", body)
            token = o.getString("token")
            val u = o.optJSONObject("user") ?: JSONObject()
            token to User(u.optInt("id"), u.optString("username"),
                u.optString("display_name", u.optString("username")))
        }

    /** What auth providers this hive advertises — supabase? crew-only? */
    suspend fun authConfig(): JSONObject = kotlinx.coroutines.withContext(Dispatchers.IO) {
        getJson("/api/auth/config")
    }

    /** Public preview — what role does this mesh invite code grant on signup. */
    suspend fun inviteRole(code: String): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            getJson("/api/invite-role/${java.net.URLEncoder.encode(code, "UTF-8")}")
        }

    /** Supabase password grant — goes to supabase.co, not the hive. */
    suspend fun supaPassword(supaUrl: String, anon: String,
                             email: String, password: String): String =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("${supaUrl.trimEnd('/')}/auth/v1/token?grant_type=password")
                .header("apikey", anon)
                .header("Authorization", "Bearer $anon")
                .post(JSONObject().put("email", email).put("password", password)
                    .toString().toRequestBody(json))
                .build()
            reqClient.newCall(req).execute().use { r ->
                val text = r.body?.string() ?: ""
                if (!r.isSuccessful)
                    throw ApiException(
                        runCatching { JSONObject(text).optString("error_description",
                            JSONObject(text).optString("msg", text)) }.getOrDefault(text),
                        r.code)
                JSONObject(text).getString("access_token")
            }
        }

    /** Supabase signup — returns access_token, or "" when email confirm is required. */
    suspend fun supaSignup(supaUrl: String, anon: String, email: String,
                           password: String, display: String): String =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url("${supaUrl.trimEnd('/')}/auth/v1/signup")
                .header("apikey", anon)
                .post(JSONObject().put("email", email).put("password", password)
                    .put("data", JSONObject().put("display_name", display))
                    .toString().toRequestBody(json))
                .build()
            reqClient.newCall(req).execute().use { r ->
                val text = r.body?.string() ?: ""
                if (!r.isSuccessful)
                    throw ApiException(
                        runCatching { JSONObject(text).optString("error_description",
                            JSONObject(text).optString("msg", text)) }.getOrDefault(text),
                        r.code)
                JSONObject(text).optString("access_token", "")
            }
        }

    /** Exchange a Supabase access_token for a hive session token. */
    suspend fun supaExchange(accessToken: String): Pair<String, User> =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val o = postJson("/api/auth/supabase",
                JSONObject().put("access_token", accessToken))
            token = o.getString("token")
            val u = o.optJSONObject("user") ?: JSONObject()
            token to User(u.optInt("id"), u.optString("username"),
                u.optString("display_name", u.optString("username")))
        }

    suspend fun me(): User = kotlinx.coroutines.withContext(Dispatchers.IO) {
        val o = getJson("/api/me")
        User(o.optInt("id"), o.optString("username"),
            o.optString("display_name", o.optString("username")))
    }

    suspend fun agents(): List<Agent> = kotlinx.coroutines.withContext(Dispatchers.IO) {
        val (_, text) = execute(request("/api/agents?sort=installs"))
        val arr = JSONArray(text)
        (0 until arr.length()).map { Agent.fromJson(arr.getJSONObject(it)) }
    }

    suspend fun nexusStatus(): JSONObject = kotlinx.coroutines.withContext(Dispatchers.IO) {
        getJson("/api/nexus/status")
    }

    /** Join params for the watch: mesh endpoints + a fresh group invite. */
    suspend fun watchJoin(): JSONObject = kotlinx.coroutines.withContext(Dispatchers.IO) {
        execute(request("/api/nexus/watch-join", "POST", JSONObject()))
            .let { JSONObject(it.second) }
    }

    /**
     * Cheap unauthed probe — GET /api/auth/config answers on any AgentHive
     * backend. Used to identify the hive behind a mesh egress candidate.
     */
    suspend fun probeHive(baseOverride: String? = null): Boolean = kotlinx.coroutines.withContext(Dispatchers.IO) {
        val base = (baseOverride ?: baseUrl).trimEnd('/')
        val proxy = proxyHandler
        if (base.startsWith("phone://")) {
            val ok = proxy?.probeMesh() ?: false
            if (ok) lastProbeOk = System.currentTimeMillis()
            return@withContext ok
        }
        val directOk = probeHiveInfo(base) != null
        if (directOk) lastProbeOk = System.currentTimeMillis()

        if (!directOk && baseOverride == null && proxy != null) {
            if (proxy.hasCompanion()) {
                val ok = proxy.probeMesh()
                if (ok) lastProbeOk = System.currentTimeMillis()
                return@withContext ok
            }
        }
        directOk
    }

    /**
     * GET /api/auth/config — unauthed AgentHive fingerprint. Returns the parsed
     * JSON (supabase keys + `hive` identity block) or null when the endpoint
     * isn't one of ours. The hive-switcher scan reads `hive.name` from it.
     */
    suspend fun probeHiveInfo(base: String): org.json.JSONObject? =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("${base.trimEnd('/')}/api/auth/config").build()
                probeClient.newCall(req).execute().use { r ->
                    val body = r.body?.string() ?: ""
                    if (!r.isSuccessful || !body.contains("supabase")) {
                        android.util.Log.d("HiveApi", "probeHiveInfo $base status=${r.code}")
                        return@withContext null
                    }
                    org.json.JSONObject(body)
                }
            }.onFailure {
                android.util.Log.d("HiveApi", "probeHiveInfo $base failed: ${it.message}")
            }.getOrNull()
        }

    /**
     * POST /api/watch/session — mesh-membership auth. First pair sends
     * {node_id, code, secret}; reconnects send {node_id, secret} alone.
     */
    suspend fun watchSession(nodeId: String, code: String, secret: String): JSONObject =
        kotlinx.coroutines.withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("node_id", nodeId)
                .put("code", code)
                .put("secret", secret)
            execute(request("/api/watch/session", "POST", body))
                .let { JSONObject(it.second) }
        }

    /**
     * POST /api/agents/{id}/try_stream — NDJSON events as a cold Flow.
     * history = [{"role":"user"|"assistant","content":"..."}]
     */
    fun tryStream(
        agentId: Int,
        message: String,
        history: List<Pair<String, String>>,
        model: String? = null,
    ): Flow<StreamEvent> = flow {
        val hist = JSONArray()
        history.takeLast(20).forEach { (r, c) ->
            hist.put(JSONObject().put("role", r).put("content", c))
        }
        val body = JSONObject()
            .put("message", message)
            .put("history", hist)
        if (!model.isNullOrBlank()) body.put("model", model)

        val proxy = proxyHandler
        if ((baseUrl.startsWith("phone://") || baseUrl.isBlank()) && proxy != null) {
            emitAll(proxy.proxyStream(agentId, message, history, model))
            return@flow
        }
        val req = request("/api/agents/$agentId/try_stream", "POST", body)
        try {
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) {
                    val t = r.body?.string() ?: ""
                    val msg = runCatching { JSONObject(t).optString("detail", t) }
                        .getOrDefault("HTTP ${r.code}")
                    emit(StreamEvent.Error(msg))
                    return@use
                }
                val source = r.body?.source() ?: return@use
                while (!source.exhausted()) {
                    val line = source.readUtf8Line() ?: break
                    if (line.isBlank()) continue
                    val ev = runCatching { JSONObject(line) }.getOrNull() ?: continue
                    when (ev.optString("t")) {
                        "meta" -> emit(StreamEvent.Meta(ev.optString("provider"), ev.optString("model")))
                        "token" -> emit(StreamEvent.Token(ev.optString("c")))
                        "thinking" -> emit(StreamEvent.Thinking(ev.optInt("n")))
                        "tool" -> emit(StreamEvent.Tool(ev.optString("name"), ev.optBoolean("ok")))
                        "replace" -> emit(StreamEvent.Replace(ev.optString("c")))
                        "error" -> emit(StreamEvent.Error(ev.optString("message", "stream error")))
                        "done" -> emit(StreamEvent.Done)
                    }
                }
                emit(StreamEvent.Done)
            }
        } catch (e: Exception) {
            if (proxy != null && (e is java.io.IOException || e is java.net.SocketException)) {
                emitAll(proxy.proxyStream(agentId, message, history, model))
                return@flow
            }
            emit(StreamEvent.Error(e.message ?: "stream error"))
        }
    }.flowOn(Dispatchers.IO)
}
