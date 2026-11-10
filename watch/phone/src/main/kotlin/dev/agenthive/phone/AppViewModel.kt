package dev.agenthive.phone

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.agenthive.watch.data.HiveApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject

/** App routes — login → home → chat (+settings overlay). Mesh is transport. */
enum class Route { LOGIN, LINKING, HOME, CHAT, SETTINGS }

data class ChatRef(
    val cid: Int, val title: String, val subtitle: String = "",
    val hasMembers: Boolean = false,
)

data class UiState(
    val route: Route = Route.LOGIN,
    val busy: Boolean = false,
    val status: String = "",
    val error: String = "",
    val me: String = "",
    val meUsername: String = "",
    val meId: Int = 0,
    val serverUrl: String = "",
    val meshUp: Boolean = false,
    val members: JSONArray = JSONArray(),
    val roles: JSONArray = JSONArray(),        // server_roles of selected server
    val chatMembers: JSONArray = JSONArray(),  // mentionable users in open chat
    val showMembers: Boolean = false,
    val servers: JSONArray = JSONArray(),
    val channels: JSONArray = JSONArray(),
    val serverName: String = "",
    val railSel: Int = 0,        // 0 = home/DMs, else server id
    val dms: JSONArray = JSONArray(),
    val agents: List<HiveApi.Agent> = emptyList(),
    val chat: ChatRef? = null,
    val messages: JSONArray = JSONArray(),
    val sending: Boolean = false,
    // settings surface — mirrors the web SettingsModal pages
    val meJson: JSONObject? = null,
    val conns: JSONArray = JSONArray(),
    val llm: JSONObject = JSONObject(),
    val llmProv: JSONArray = JSONArray(),
    val nxStatus: JSONObject = JSONObject(),
    val nxPeers: JSONArray = JSONArray(),
    val nxDevices: JSONArray = JSONArray(),
    val settingsMsg: String = "",
    /** Conn begin → consent url to hand to the browser; {pid,url} or {pid,device}. */
    val connOAuth: JSONObject? = null,
    /** Fresh mesh invite code minted in settings. */
    val inviteCode: String = "",
    // chat interaction state — Discord mobile action-sheet model
    val sheetMsg: JSONObject? = null,      // long-press target
    val replyTo: JSONObject? = null,       // composer reply target
    val editing: JSONObject? = null,       // message being edited in composer
    val threadRoot: JSONObject? = null,    // open thread parent
    val threadMsgs: JSONArray = JSONArray(),
    val searching: Boolean = false,
    val searchResults: JSONArray = JSONArray(),
    val toast: String = "",
    val profile: JSONObject? = null,       // user profile card
    val pins: JSONArray = JSONArray(),
    val showPins: Boolean = false,
    val pendingAttach: JSONObject? = null, // staged upload {id,name,mime,size}
    val uploading: Boolean = false,
    // voice — joined room + per-channel rosters
    val voiceCid: Int = 0,                 // 0 = not in voice
    val voiceName: String = "",
    val voiceRoster: JSONArray = JSONArray(),
    val voiceMuted: Boolean = false,
    val voiceDeafened: Boolean = false,
    val voiceSpeaker: Boolean = true,
    val voiceOpen: Boolean = false,        // full voice screen vs mini-bar
    val voiceOccupants: Map<Int, JSONArray> = emptyMap(),  // cid → roster
    val typingUsers: Map<Int, Pair<String, Long>> = emptyMap(),  // uid → (name, expiryMs)
    val unread: Set<Int> = emptySet(),        // channel ids w/ unseen msgs (WS)
    val mentions: Set<Int> = emptySet(),      // channel ids w/ a @me ping
    val fwdMsg: JSONObject? = null,           // message being forwarded
    val savedMsgs: JSONArray? = null,         // saved-messages panel (null=closed)
    val friendsJson: JSONObject? = null,      // friends panel (null=closed)
    val blockIds: Set<Int> = emptySet(),
    val friendsTab: Int = 0,                  // 0=all 1=pending 2=blocked 3=add
    val friendStatus: String = "",            // add-friend feedback
    val serverSheet: Boolean = false,         // create/join server sheet
    val serverSheetStatus: String = "",
    val chanMenu: JSONObject? = null,         // channel/DM long-press target
    val serverMenu: JSONObject? = null,       // server long-press target
    val statusSheet: Boolean = false,         // presence picker sheet
    val inboxArr: JSONArray? = null,          // mention inbox (null=closed)
    val chatReadCutoff: Double = 0.0,         // NEW divider — msgs after = unread
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val appInst get() = getApplication<PhoneApp>()
    private val store get() = appInst.store
    private val api get() = appInst.api
    private val nexus get() = appInst.nexus

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var pollJob: Job? = null
    private var linkJob: Job? = null

    private var wsClient: WsClient? = null
    private var voice: VoiceEngine? = null

    init {
        nexus.onStatus = { m -> _ui.update { it.copy(status = m) } }
        resume()
    }

    // -- websocket + voice --------------------------------------------------

    /** Bring the realtime socket up once a session is valid. */
    private fun ensureWs() {
        if (wsClient != null) return
        wsClient = WsClient(viewModelScope) { onWsEvent(it) }.also {
            it.connect(api.baseUrl, api.token)
        }
    }

    private fun onWsEvent(evt: JSONObject) {
        when (evt.optString("type")) {
            "voice" -> onVoiceRoster(
                evt.optInt("channel_id"),
                evt.optJSONArray("members") ?: JSONArray())
            "voice_reject" -> {
                if (evt.optInt("channel_id") == _ui.value.voiceCid) {
                    voice?.leave()
                    _ui.update { it.copy(voiceCid = 0, voiceOpen = false,
                        toast = evt.optString("reason", "can't join voice")) }
                }
            }
            "voice_signal" -> voice?.onSignal(
                evt.optInt("from"),
                evt.optJSONObject("data") ?: JSONObject())
            "typing" -> {
                if (evt.optInt("channel_id") == _ui.value.chat?.cid) {
                    val u = evt.optJSONObject("user") ?: return
                    val uid = u.optInt("id")
                    _ui.update {
                        val m = it.typingUsers.toMutableMap()
                        if (evt.optBoolean("on"))
                            m[uid] = u.optString("display_name", "?") to
                                (System.currentTimeMillis() + 7000)
                        else m.remove(uid)
                        it.copy(typingUsers = m)
                    }
                }
            }
            "message" -> onWsMessage(evt)
            "buzz" -> {
                // friend request/accept etc — refresh panel + DM list
                if (_ui.value.friendsJson != null) openFriends()
                refreshHome()
            }
            "message_deleted", "message_updated" -> {
                if (evt.optInt("channel_id") == _ui.value.chat?.cid)
                    refreshMessages()
            }
            "ws:open" -> if (_ui.value.voiceCid > 0)
                wsClient?.send(JSONObject().put("type", "voice_join")
                    .put("channel_id", _ui.value.voiceCid))
        }
    }

    private fun onWsMessage(evt: JSONObject) {
        val cid = evt.optInt("channel_id")
        val m = evt.optJSONObject("message") ?: return
        if (cid == _ui.value.chat?.cid) {
            // live-append to the open channel (poll resyncs regardless)
            _ui.update { s ->
                val arr = s.messages
                val dup = (0 until arr.length()).any {
                    arr.optJSONObject(it)?.optInt("id") == m.optInt("id") }
                if (dup) s else s.copy(messages = JSONArray(arr.toString()).put(m))
            }
            viewModelScope.launch { api.markRead(cid) }
            return
        }
        val author = m.optJSONObject("author")
        if (author?.optInt("id") == _ui.value.meId) return   // own msg elsewhere
        val content = m.optString("content")
        var pinged = "@${_ui.value.meUsername}".let {
            it.length > 1 && content.contains(it, ignoreCase = true) } ||
            content.contains("@everyone") ||
            content.contains("@here")
        // keyword alerts (Settings → Notifications) ping like mentions
        if (!pinged) {
            val kws = _ui.value.meJson?.optJSONArray("notify_mentions")
            if (kws != null) for (i in 0 until kws.length()) {
                val k = kws.optString(i)
                if (k.isNotBlank() && content.contains(k, ignoreCase = true)) {
                    pinged = true; break }
            }
        }
        // muted channels don't badge (Discord parity — PATCH /api/me lists)
        val mutedList = _ui.value.meJson?.optJSONArray("server_muted")
        var muted = false
        if (mutedList != null) for (i in 0 until mutedList.length())
            if (mutedList.optInt(i) == cid) { muted = true; break }
        if (muted) return
        _ui.update { s ->
            s.copy(unread = s.unread + cid,
                   mentions = if (pinged) s.mentions + cid else s.mentions)
        }
    }

    private fun refreshMessages() {
        val c = _ui.value.chat ?: return
        viewModelScope.launch {
            runCatching {
                val arr = api.messages(c.cid, limit = 50)
                _ui.update { it.copy(messages = arr) }
                store.setLastRead(c.cid,
                    arr.optJSONObject(arr.length() - 1)
                        ?.optDouble("created_at") ?: 0.0)
            }
        }
    }

    // -- typing --------------------------------------------------------------

    private var lastTypingSent = 0L

    /** Called on every composer keystroke — throttled "typing" heartbeat. */
    fun onDraftTyping(nonEmpty: Boolean) {
        val cid = _ui.value.chat?.cid ?: return
        val nowMs = System.currentTimeMillis()
        if (!nonEmpty) {
            if (lastTypingSent > 0) {
                lastTypingSent = 0
                wsClient?.send(JSONObject().put("type", "typing")
                    .put("channel_id", cid).put("on", false))
            }
            return
        }
        if (nowMs - lastTypingSent < 4000) return
        lastTypingSent = nowMs
        wsClient?.send(JSONObject().put("type", "typing")
            .put("channel_id", cid).put("on", true))
    }

    fun pruneTyping() {
        val nowMs = System.currentTimeMillis()
        if (_ui.value.typingUsers.values.any { it.second < nowMs })
            _ui.update { s ->
                s.copy(typingUsers = s.typingUsers
                    .filterValues { it.second >= nowMs })
            }
    }

    private fun onVoiceRoster(cid: Int, roster: JSONArray) {
        _ui.update {
            val occ = it.voiceOccupants.toMutableMap()
            if (roster.length() == 0) occ.remove(cid) else occ[cid] = roster
            it.copy(voiceOccupants = occ,
                    voiceRoster = if (cid == it.voiceCid) roster
                                  else it.voiceRoster)
        }
        if (cid == _ui.value.voiceCid) voice?.onRoster(roster)
    }

    fun joinVoice(ch: JSONObject) {
        val cid = ch.optInt("id")
        val eng = voice ?: VoiceEngine(appInst,
            send = { wsClient?.send(it) },
            onRoster = {})
        voice = eng
        eng.join(cid, _ui.value.meId)
        _ui.update {
            it.copy(voiceCid = cid, voiceName = ch.optString("name"),
                    voiceOpen = true, voiceMuted = false,
                    voiceDeafened = false, showMembers = false)
        }
    }

    fun leaveVoice() {
        voice?.leave()
        _ui.update { it.copy(voiceCid = 0, voiceOpen = false,
                             voiceRoster = JSONArray(),
                             voiceMuted = false, voiceDeafened = false) }
    }

    fun openVoice() { _ui.update { it.copy(voiceOpen = true) } }
    fun closeVoicePanel() { _ui.update { it.copy(voiceOpen = false) } }

    fun toggleMute() {
        val m = !_ui.value.voiceMuted
        _ui.update { it.copy(voiceMuted = m) }
        voice?.setMuted(m)
    }

    fun toggleDeafen() {
        val d = !_ui.value.voiceDeafened
        _ui.update { it.copy(voiceDeafened = d, voiceMuted = d || it.voiceMuted) }
        voice?.setDeafened(d)
    }

    fun toggleSpeaker() {
        val s = !_ui.value.voiceSpeaker
        _ui.update { it.copy(voiceSpeaker = s) }
        voice?.setSpeaker(s)
    }

    // -- login / resume ------------------------------------------------------

    /** Boot: mesh members rejoin quietly, then a stored login resumes. */
    private fun resume() {
        if (store.paired) { linkMesh("", silent = true); return }
        if (store.token.isBlank() || store.serverUrl.isBlank()) return
        _ui.update { it.copy(route = Route.LINKING, status = "signing back in…",
                             serverUrl = store.serverUrl) }
        linkJob = viewModelScope.launch {
            api.baseUrl = store.serverUrl; api.token = store.token
            if (runCatching { api.me(); true }.getOrDefault(false)) enterHome()
            else _ui.update { it.copy(route = Route.LOGIN, status = "session expired — sign in") }
        }
    }

    /** Normal crew login — same POST /api/login the web UI makes. */
    fun signIn(server: String, user: String, pass: String) {
        val host = server.trim().trimEnd('/')
        if (host.isBlank() || user.isBlank() || pass.isBlank()) {
            _ui.update { it.copy(error = "hive url, username and password required") }
            return
        }
        if (linkJob?.isActive == true) return
        linkJob = viewModelScope.launch {
            _ui.update { it.copy(busy = true, error = "", status = "signing in…") }
            try {
                val (token, u) = api.login(host, user, pass)
                store.paired = false
                store.serverUrl = api.baseUrl
                store.username = u.username
                store.displayName = u.displayName
                store.token = token
                enterHome()
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, status = "",
                                     error = e.message ?: "sign in failed") }
            }
        }
    }

    // -- mesh (transport only) --------------------------------------------------

    /** Pair code (or empty to rejoin) → egress loopback becomes the server URL. */
    fun linkMesh(code: String, silent: Boolean = false) {
        val c = code.trim()
        if (c.isNotBlank() && c.length < 6) {
            _ui.update { it.copy(error = "paste the full 8-digit code") }
            return
        }
        if (linkJob?.isActive == true) return
        linkJob = viewModelScope.launch {
            _ui.update {
                it.copy(busy = !silent, error = "",
                        status = if (c.isBlank()) "rejoining mesh…" else "joining Nexus mesh…")
            }
            try {
                val l = Linker.link(store, api, nexus, c) { m ->
                    _ui.update { it.copy(status = m) }
                }
                onMeshUp(l.baseUrl, silent)
            } catch (e: Exception) {
                _ui.update {
                    it.copy(route = Route.LOGIN, busy = false,
                            error = "${e.message ?: "link failed"} — pair with a fresh code",
                            status = "")
                }
            }
        }
    }

    /** Egress landed — the loopback IS the server. Stored login resumes if valid. */
    private suspend fun onMeshUp(meshUrl: String, silent: Boolean) {
        store.serverUrl = meshUrl
        runCatching { PhoneMeshService.start(getApplication()) }
        _ui.update { it.copy(serverUrl = meshUrl, meshUp = true) }
        if (store.token.isNotBlank()) {
            api.baseUrl = meshUrl; api.token = store.token
            if (runCatching { api.me(); true }.getOrDefault(false)) { enterHome(); return }
        }
        _ui.update {
            it.copy(route = Route.LOGIN, busy = false,
                    status = "mesh up — sign in to finish")
        }
    }

    // -- home ---------------------------------------------------------------

    private suspend fun enterHome() {
        val me = runCatching { api.me() }.getOrNull()
        val meJson = runCatching { api.meJson() }.getOrNull()
        _ui.update {
            it.copy(route = Route.HOME, busy = false, status = "", error = "",
                    me = me?.displayName ?: store.displayName,
                    meUsername = me?.username ?: store.username,
                    meId = me?.id ?: 0,
                    meJson = meJson ?: it.meJson)
        }
        ensureWs()
        RealtimeService.start(appInst, _ui.value.meId,
            _ui.value.meUsername)
        refreshHome()
    }

    fun refreshHome() {
        viewModelScope.launch {
            val servers = runCatching { api.servers() }.getOrNull() ?: JSONArray()
            val dms = runCatching { api.dms() }.getOrNull() ?: JSONArray()
            val agents = runCatching { api.agents() }.getOrNull() ?: emptyList()
            val meJson = runCatching { api.meJson() }.getOrNull()
            _ui.update { it.copy(
                servers = servers,
                dms = dms,
                agents = agents,
                meJson = meJson ?: it.meJson,
            ) }
        }
    }

    fun selectRail(sid: Int) {
        if (sid == _ui.value.railSel && sid == 0) return
        _ui.update { it.copy(railSel = sid) }
        if (sid == 0) return
        val s = (0 until _ui.value.servers.length())
            .map { _ui.value.servers.optJSONObject(it) }
            .firstOrNull { it?.optInt("id") == sid }
        _ui.update { it.copy(serverName = s?.optString("name") ?: "") }
        viewModelScope.launch {
            val d = runCatching { api.serverDetail(sid) }.getOrNull()
            _ui.update {
                it.copy(channels = d?.optJSONArray("channels") ?: JSONArray(),
                        members = d?.optJSONArray("members") ?: JSONArray(),
                        roles = d?.optJSONArray("roles") ?: JSONArray())
            }
        }
    }

    // -- chat ----------------------------------------------------------------

    fun openChannel(ch: JSONObject) {
        val cid = ch.optInt("id")
        _ui.update { it.copy(unread = it.unread - cid,
                             mentions = it.mentions - cid,
                             chatMembers = it.members) }
        openChat(ChatRef(cid, "#${ch.optString("name")}",
                         ch.optString("topic"), hasMembers = true))
        viewModelScope.launch { api.markRead(cid) }
    }

    fun openDm(dm: JSONObject) {
        val cid = dm.optInt("id")
        val other = dm.optJSONObject("other")
        val name = when {
            dm.optString("name").isNotBlank() -> dm.optString("name")
            other != null -> other.optString("display_name",
                other.optString("username", "dm"))
            else -> {
                val names = mutableListOf<String>()
                dm.optJSONArray("members")?.let { arr ->
                    for (i in 0 until arr.length())
                        arr.optJSONObject(i)?.let {
                            names += it.optString("display_name",
                                it.optString("username"))
                        }
                }
                names.joinToString(", ").ifBlank { "dm" }
            }
        }
        // server-side read stamp for DMs beats the local one
        val serverRead = dm.optJSONObject("reads")
            ?.optDouble("${_ui.value.meId}") ?: 0.0
        _ui.update { it.copy(unread = it.unread - cid,
                             mentions = it.mentions - cid,
                             chatMembers = dm.optJSONArray("members")
                                 ?: JSONArray()) }
        openChat(ChatRef(cid, name, "direct messages"),
                 cutoff = maxOf(store.lastRead(cid), serverRead))
        viewModelScope.launch { api.markRead(cid) }
    }

    /** Agent → find-or-create its DM channel — every message auto-summons it. */
    fun openAgent(a: HiveApi.Agent) {
        viewModelScope.launch {
            val r = runCatching { api.agentDm(a.id) }.getOrNull()
            val cid = r?.optInt("id") ?: 0
            if (cid > 0) {
                _ui.update { it.copy(chatMembers = JSONArray()) }
                openChat(ChatRef(cid, "${a.icon} ${a.name}", "agent · ${a.tagline}"))
                viewModelScope.launch { api.markRead(cid) }
            }
            else _ui.update { it.copy(error = "couldn't open agent chat") }
        }
    }

    fun openChat(c: ChatRef, cutoff: Double = -1.0) {
        // Discord's "NEW" divider — everything at/below this stamp is read
        _ui.update { it.copy(chat = c, route = Route.CHAT,
                             messages = JSONArray(),
                             typingUsers = emptyMap(),
                             chatReadCutoff = if (cutoff >= 0) cutoff
                                              else store.lastRead(c.cid)) }
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (isActive) {
                runCatching {
                    val arr = api.messages(c.cid, limit = 50)
                    if (arr.length() != _ui.value.messages.length() ||
                        arr.optJSONObject(arr.length() - 1)?.optInt("id") !=
                        _ui.value.messages.optJSONObject(
                            _ui.value.messages.length() - 1)?.optInt("id")) {
                        _ui.update { it.copy(messages = arr) }
                    }
                    store.setLastRead(c.cid,
                        arr.optJSONObject(arr.length() - 1)
                            ?.optDouble("created_at") ?: 0.0)
                }
                delay(4000)
            }
        }
    }

    fun backHome() {
        pollJob?.cancel()
        lastTypingSent = 0
        _ui.update { it.copy(route = Route.HOME, chat = null,
                             showMembers = false,
                             typingUsers = emptyMap()) }
    }

    fun toggleMembers() { _ui.update { it.copy(showMembers = !it.showMembers) } }
    fun closeMembers() { _ui.update { it.copy(showMembers = false) } }

    fun send(text: String) {
        val c = _ui.value.chat ?: return
        val msg = text.trim()
        val attach = _ui.value.pendingAttach
        if ((msg.isEmpty() && attach == null) || _ui.value.sending) return
        val edit = _ui.value.editing
        val reply = _ui.value.replyTo
        val thread = _ui.value.threadRoot
        viewModelScope.launch {
            _ui.update { it.copy(sending = true, error = "") }
            if (lastTypingSent > 0) {
                lastTypingSent = 0
                wsClient?.send(JSONObject().put("type", "typing")
                    .put("channel_id", c.cid).put("on", false))
            }
            try {
                if (edit != null) {
                    api.editMessage(edit.optInt("id"), msg)
                    _ui.update { it.copy(editing = null) }
                } else {
                    val atts = attach?.let { f ->
                        JSONArray().put(JSONObject()
                            .put("id", f.optString("id"))
                            .put("name", f.optString("name"))
                            .put("mime", f.optString("mime"))
                            .put("size", f.optInt("size")))
                    }
                    // "/poll question | a | b | …" → Discord-style poll card
                    val poll = if (msg.startsWith("/poll ", true)) {
                        val parts = msg.drop(6).split("|")
                            .map { it.trim() }.filter { it.isNotBlank() }
                        if (parts.size >= 2)
                            JSONObject().put("q", parts[0]).put("options",
                                JSONArray(parts.drop(1).take(9)))
                        else null
                    } else null
                    api.postMessage(c.cid,
                        if (poll != null) poll.optString("q") else msg,
                        poll = poll,
                        replyTo = reply?.optInt("id"),
                        threadRoot = thread?.optInt("id"),
                        attachments = atts)
                    _ui.update { it.copy(replyTo = null,
                                         pendingAttach = null) }
                }
                api.markRead(c.cid)   // own post shouldn't look unread (DMs only)
                if (thread != null) {
                    val t = api.threadMessages(thread.optInt("id"))
                    val arr = api.messages(c.cid, limit = 50)
                    _ui.update { it.copy(threadMsgs = t, messages = arr,
                                         sending = false) }
                } else {
                    val arr = api.messages(c.cid, limit = 50)
                    _ui.update { it.copy(messages = arr, sending = false) }
                }
            } catch (e: Exception) {
                Log.w("AppVM", "send failed", e)
                _ui.update { it.copy(sending = false,
                                     error = e.message ?: "send failed") }
            }
        }
    }

    // -- message actions (Discord long-press sheet) ----------------------------

    fun openSheet(m: JSONObject) { _ui.update { it.copy(sheetMsg = m) } }
    fun closeSheet() { _ui.update { it.copy(sheetMsg = null) } }

    // Discord "Forward" — caption optional; targets = server channels + DMs
    fun openForward(m: JSONObject) {
        _ui.update { it.copy(sheetMsg = null, fwdMsg = m) }
    }
    fun closeForward() { _ui.update { it.copy(fwdMsg = null) } }

    fun openSaved() {
        viewModelScope.launch {
            val arr = runCatching { api.saved() }.getOrNull() ?: JSONArray()
            _ui.update { it.copy(savedMsgs = arr) }
        }
    }
    fun closeSaved() { _ui.update { it.copy(savedMsgs = null) } }

    // -- friends -------------------------------------------------------------

    fun openFriends() {
        viewModelScope.launch {
            val f = runCatching { api.friends() }.getOrNull() ?: JSONObject()
            val b = runCatching { api.blocks() }.getOrNull() ?: JSONArray()
            val ids = (0 until b.length()).map { b.optInt(it) }.toSet()
            _ui.update { it.copy(friendsJson = f, blockIds = ids,
                                 friendStatus = "") }
        }
    }
    fun closeFriends() { _ui.update { it.copy(friendsJson = null) } }

    // -- servers -------------------------------------------------------------

    fun openServerSheet() {
        _ui.update { it.copy(serverSheet = true, serverSheetStatus = "") }
    }
    fun closeServerSheet() {
        _ui.update { it.copy(serverSheet = false, serverSheetStatus = "") }
    }

    // -- channel/server context menus ----------------------------------------

    fun openChanMenu(ch: JSONObject) {
        _ui.update { it.copy(chanMenu = ch) }
    }
    fun closeChanMenu() { _ui.update { it.copy(chanMenu = null) } }

    fun openServerMenu(s: JSONObject) {
        _ui.update { it.copy(serverMenu = s) }
    }
    fun closeServerMenu() { _ui.update { it.copy(serverMenu = null) } }

    fun openStatusSheet() { _ui.update { it.copy(statusSheet = true) } }
    fun closeStatusSheet() { _ui.update { it.copy(statusSheet = false) } }

    /** Discord Set Status — online/idle/dnd/invisible via PATCH /api/me. */
    fun setPresence(status: String) {
        viewModelScope.launch {
            runCatching { api.updateMe(JSONObject().put("status", status)) }
                .onSuccess { u ->
                    _ui.update { it.copy(meJson = u, statusSheet = false) }
                }
        }
    }

    fun saveStatusText(text: String) {
        viewModelScope.launch {
            runCatching { api.updateMe(
                JSONObject().put("status_text", text)) }
                .onSuccess { u ->
                    _ui.update { it.copy(meJson = u, statusSheet = false) }
                }
        }
    }

    // -- inbox (mention feed) --------------------------------------------------

    fun openInbox() {
        viewModelScope.launch {
            val arr = runCatching { api.inbox() }.getOrNull() ?: JSONArray()
            _ui.update { it.copy(inboxArr = arr) }
        }
    }
    fun closeInbox() { _ui.update { it.copy(inboxArr = null) } }

    /** Inbox row → jump into the mentioned channel. */
    fun openInboxItem(item: JSONObject) {
        val p = item.optJSONObject("payload") ?: return
        val cid = p.optInt("channel_id")
        if (cid <= 0) return
        closeInbox()
        openChat(ChatRef(cid, "#" + p.optString("channel", "channel"), ""))
        viewModelScope.launch { api.markRead(cid) }
    }

    fun isChannelMuted(cid: Int): Boolean {
        val l = _ui.value.meJson?.optJSONArray("server_muted") ?: return false
        for (i in 0 until l.length()) if (l.optInt(i) == cid) return true
        return false
    }

    /** Discord mute — toggles the channel in me.server_muted via PATCH /api/me. */
    fun toggleMuteChannel(cid: Int) {
        viewModelScope.launch {
            val me = _ui.value.meJson ?: return@launch
            val cur = me.optJSONArray("server_muted") ?: JSONArray()
            val next = JSONArray()
            var had = false
            for (i in 0 until cur.length()) {
                val v = cur.optInt(i)
                if (v == cid) had = true else next.put(v)
            }
            if (!had) next.put(cid)
            runCatching {
                api.updateMe(JSONObject().put("server_muted", next))
            }.onSuccess { u ->
                _ui.update { it.copy(meJson = u, chanMenu = null,
                                     unread = if (had) it.unread
                                              else it.unread - cid) }
            }
        }
    }

    fun markChannelRead(cid: Int) {
        _ui.update { it.copy(chanMenu = null,
                             unread = it.unread - cid,
                             mentions = it.mentions - cid) }
        viewModelScope.launch { api.markRead(cid) }
    }

    /** Discord 'Mark Unread' — rewind the read stamp so the channel badges. */
    fun markUnreadHere(m: JSONObject) {
        val cid = _ui.value.chat?.cid ?: return
        val mid = m.optInt("id")
        _ui.update { it.copy(sheetMsg = null,
                             unread = it.unread + cid) }
        viewModelScope.launch {
            runCatching { api.markUnread(cid, mid) }
            store.setLastRead(cid,
                m.optDouble("created_at") - 0.0001)
        }
    }

    fun leaveServer(sid: Int) {
        viewModelScope.launch {
            runCatching { api.leaveServer(sid) }
                .onSuccess {
                    _ui.update { it.copy(serverMenu = null, railSel = 0) }
                    refreshHome()
                }
                .onFailure { e ->
                    _ui.update { it.copy(toast =
                        e.message?.substringAfterLast(": ") ?: "can't leave") }
                }
        }
    }

    fun createServer(name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            runCatching { api.createServer(name.trim()) }
                .onSuccess { s ->
                    _ui.update { it.copy(serverSheet = false) }
                    refreshHome()
                    selectRail(s.optInt("id"))
                }
                .onFailure { e ->
                    _ui.update { it.copy(serverSheetStatus =
                        e.message?.substringAfterLast(": ") ?: "failed") }
                }
        }
    }

    fun joinServer(code: String) {
        if (code.isBlank()) return
        viewModelScope.launch {
            runCatching { api.joinServer(code.trim()) }
                .onSuccess { s ->
                    _ui.update { it.copy(serverSheet = false) }
                    refreshHome()
                    selectRail(s.optInt("id"))
                }
                .onFailure { e ->
                    _ui.update { it.copy(serverSheetStatus =
                        e.message?.substringAfterLast(": ") ?: "bad code") }
                }
        }
    }
    fun friendsTab(t: Int) {
        _ui.update { it.copy(friendsTab = t, friendStatus = "") }
    }

    fun sendFriendReq(username: String) {
        if (username.isBlank()) return
        viewModelScope.launch {
            runCatching { api.addFriend(username.trim()) }
                .onSuccess { r ->
                    _ui.update { it.copy(friendStatus =
                        "request sent — ${r.optString("status")}") }
                    openFriends()
                }
                .onFailure { e ->
                    _ui.update { it.copy(friendStatus =
                        e.message?.substringAfterLast(": ")
                            ?: "no such user") }
                }
        }
    }

    fun acceptFriend(fid: Int) {
        viewModelScope.launch {
            runCatching { api.acceptFriend(fid) }; openFriends()
        }
    }

    fun declineFriend(fid: Int) {
        viewModelScope.launch {
            runCatching { api.removeFriend(fid) }; openFriends()
        }
    }

    fun toggleBlock(uid: Int) {
        viewModelScope.launch {
            runCatching { api.toggleBlock(uid) }; openFriends()
        }
    }

    /** Friend row → jump straight into the 1:1 DM. */
    fun dmWith(uid: Int) {
        viewModelScope.launch {
            val r = runCatching { api.openDm(uid) }.getOrNull()
            val cid = r?.optInt("id") ?: 0
            if (cid > 0) {
                closeFriends()
                val dm = r?.optJSONObject("dm") ?: r
                val other = dm?.optJSONObject("other")
                openChat(ChatRef(cid,
                    other?.optString("display_name",
                        other.optString("username", "dm")) ?: "dm",
                    "direct messages"))
            }
        }
    }

    fun forward(m: JSONObject, targetCid: Int, caption: String) {
        viewModelScope.launch {
            runCatching {
                api.postMessage(targetCid,
                    caption.ifBlank { "↪️" }, fwdOf = m.optInt("id"))
                _ui.update { it.copy(fwdMsg = null,
                                     toast = "forwarded ✓") }
            }.onFailure {
                _ui.update { it.copy(error = "forward failed") }
            }
        }
    }

    fun startReply(m: JSONObject) {
        _ui.update { it.copy(sheetMsg = null, replyTo = m, editing = null) }
    }
    fun cancelReply() { _ui.update { it.copy(replyTo = null) } }

    fun startEdit(m: JSONObject) {
        _ui.update { it.copy(sheetMsg = null, editing = m, replyTo = null) }
    }
    fun cancelEdit() { _ui.update { it.copy(editing = null) } }

    /** Toggle a reaction chip / sheet emoji, then refresh that message. */
    fun react(mid: Int, emoji: String) {
        val c = _ui.value.chat ?: return
        viewModelScope.launch {
            _ui.update { it.copy(sheetMsg = null) }
            runCatching { api.react(mid, emoji) }
            val arr = runCatching { api.messages(c.cid, limit = 50) }
                .getOrNull() ?: return@launch
            _ui.update { it.copy(messages = arr) }
        }
    }

    fun deleteMsg(mid: Int) {
        val c = _ui.value.chat ?: return
        viewModelScope.launch {
            _ui.update { it.copy(sheetMsg = null) }
            runCatching { api.deleteMessage(mid) }
            val arr = runCatching { api.messages(c.cid, limit = 50) }
                .getOrNull() ?: return@launch
            _ui.update { it.copy(messages = arr) }
        }
    }

    fun pinMsg(mid: Int) = msgAction(mid, "toggled pin") { api.pinMessage(it) }
    fun saveMsg(mid: Int) = msgAction(mid, "saved") { api.saveMessage(it) }

    private fun msgAction(mid: Int, toast: String,
                          block: suspend (Int) -> JSONObject) {
        val c = _ui.value.chat ?: return
        viewModelScope.launch {
            _ui.update { it.copy(sheetMsg = null) }
            try {
                block(mid)
                _ui.update { it.copy(toast = toast) }
            } catch (e: Exception) {
                _ui.update { it.copy(toast = "✗ ${e.message}") }
            }
            val arr = runCatching { api.messages(c.cid, limit = 50) }
                .getOrNull() ?: return@launch
            _ui.update { it.copy(messages = arr) }
            viewModelScope.launch {
                delay(2400); _ui.update { it.copy(toast = "") }
            }
        }
    }

    // -- thread ------------------------------------------------------------------

    fun openThread(m: JSONObject) {
        _ui.update { it.copy(threadRoot = m, threadMsgs = JSONArray(),
                             sheetMsg = null) }
        viewModelScope.launch {
            val arr = runCatching { api.threadMessages(m.optInt("id")) }
                .getOrNull() ?: JSONArray()
            _ui.update { it.copy(threadMsgs = arr) }
        }
    }

    fun closeThread() {
        _ui.update { it.copy(threadRoot = null, threadMsgs = JSONArray()) }
    }

    // -- channel search ------------------------------------------------------------

    fun toggleSearch() {
        _ui.update {
            it.copy(searching = !it.searching,
                    searchResults = JSONArray())
        }
    }

    fun search(q: String) {
        val c = _ui.value.chat ?: return
        viewModelScope.launch {
            val r = runCatching { api.searchMessages(c.cid, q) }
                .getOrNull() ?: JSONArray()
            _ui.update { it.copy(searchResults = r) }
        }
    }

    // -- profile card ---------------------------------------------------------

    fun openProfile(uid: Int) {
        if (uid <= 0) return
        _ui.update { it.copy(showMembers = false, sheetMsg = null) }
        viewModelScope.launch {
            val p = runCatching { api.userProfile(uid) }.getOrNull()
            _ui.update { it.copy(profile = p ?: JSONObject()
                .put("error", "couldn't load profile")) }
        }
    }

    fun closeProfile() { _ui.update { it.copy(profile = null) } }

    /** "Send Message" → find-or-create the 1:1 DM and open it. */
    fun messageUser(uid: Int) {
        viewModelScope.launch {
            _ui.update { it.copy(profile = null, sheetMsg = null) }
            val r = runCatching { api.openDm(uid) }.getOrNull()
            val cid = r?.optInt("id") ?: 0
            if (cid > 0) {
                val u = _ui.value.profile?.optJSONObject("user")
                val name = u?.optString("display_name",
                    u.optString("username", "dm")) ?: "dm"
                openChat(ChatRef(cid, name, "direct messages"))
                viewModelScope.launch { api.markRead(cid) }
            } else _ui.update { it.copy(error = "couldn't open dm") }
        }
    }

    // -- pins -------------------------------------------------------------------

    fun togglePins() {
        val c = _ui.value.chat ?: return
        if (_ui.value.showPins) {
            _ui.update { it.copy(showPins = false) }
            return
        }
        _ui.update { it.copy(showPins = true, showMembers = false) }
        viewModelScope.launch {
            val r = runCatching { api.channelPins(c.cid) }
                .getOrNull() ?: JSONArray()
            _ui.update { it.copy(pins = r) }
        }
    }

    // -- attachments --------------------------------------------------------------

    /** ⊕ picked a file → upload it and stage it as the next attachment. */
    fun stageAttachment(name: String, bytes: ByteArray, mime: String) {
        viewModelScope.launch {
            _ui.update { it.copy(uploading = true) }
            try {
                val f = api.upload(name, bytes, mime)
                _ui.update { it.copy(pendingAttach = f, uploading = false) }
            } catch (e: Exception) {
                _ui.update { it.copy(uploading = false,
                    toast = "✗ ${e.message}") }
            }
        }
    }

    fun clearAttachment() { _ui.update { it.copy(pendingAttach = null) } }

    /** Bearer-authed file URL for Coil. */
    fun fileUrl(fid: String) = api.fileUrl(fid)

    // -- settings --------------------------------------------------------------

    fun openSettings() {
        _ui.update { it.copy(route = Route.SETTINGS, settingsMsg = "",
                             error = "", connOAuth = null) }
        refreshSettings()
    }

    fun closeSettings() {
        _ui.update { it.copy(route = Route.HOME, connOAuth = null) }
        refreshHome()
    }

    fun refreshSettings() {
        viewModelScope.launch {
            val me = runCatching { api.meJson() }.getOrNull()
            val conns = runCatching { api.connections() }.getOrNull() ?: JSONArray()
            val llm = runCatching { api.llmMe() }.getOrNull() ?: JSONObject()
            val prov = runCatching { api.llmProviders() }.getOrNull() ?: JSONArray()
            val nx = runCatching { api.nexusStatus() }.getOrNull() ?: JSONObject()
            val peers = runCatching { api.nexusPeers() }.getOrNull() ?: JSONArray()
            val devs = runCatching { api.nexusDevices() }.getOrNull() ?: JSONArray()
            _ui.update { it.copy(meJson = me, conns = conns, llm = llm,
                                 llmProv = prov, nxStatus = nx,
                                 nxPeers = peers, nxDevices = devs) }
        }
    }

    private fun settingsCall(label: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _ui.update { it.copy(settingsMsg = "") }
            try {
                block()
                _ui.update { it.copy(settingsMsg = label) }
            } catch (e: Exception) {
                _ui.update { it.copy(settingsMsg = "✗ ${e.message}") }
            }
        }
    }

    fun saveProfile(patch: JSONObject) =
        settingsCall("profile saved ✓") {
            val u = api.updateMe(patch)
            _ui.update { it.copy(meJson = u,
                me = u.optString("display_name", it.me)) }
        }

    fun changePassword(cur: String, next: String) =
        settingsCall("password changed — other devices signed out") {
            api.setPassword(cur, next)
        }

    fun signOutOthers() =
        settingsCall("other sessions revoked ✓") { api.signOutOthers() }

    // LLM endpoint — Settings → Models
    fun saveLlm(base: String, model: String, kind: String,
                key: String, headers: String) =
        settingsCall("endpoint saved ✓") {
            api.llmSave(JSONObject()
                .put("base_url", base).put("model", model).put("kind", kind)
                .put("api_key", key.ifBlank { JSONObject.NULL })
                .put("headers", headers.ifBlank { JSONObject.NULL }))
            _ui.update { it.copy(llm = runCatching { api.llmMe() }
                .getOrNull() ?: it.llm) }
        }

    fun testLlm() =
        settingsCall("test passed — model answers") {
            _ui.update { it.copy(settingsMsg = "testing…") }
            val r = api.llmTest()
            if (!r.optBoolean("ok", true))
                throw Exception(r.optString("error", "test failed"))
            _ui.update { it.copy(settingsMsg =
                "✓ connected (${r.optInt("latency_ms")}ms)" +
                r.optJSONArray("models")?.let { m ->
                    " — ${m.length()} model(s)" }.orEmpty()) }
        }

    // Connections — AI providers + OAuth plugins
    fun connSave(pid: String, key: String, model: String,
                 label: String, url: String) =
        settingsCall("connection saved ✓") {
            api.connSave(pid, JSONObject()
                .put("api_key", key.ifBlank { null })
                .put("model", model.ifBlank { null })
                .put("label", label.ifBlank { null })
                .put("url", url.ifBlank { null }))
            reloadConns()
        }

    fun connImport(pid: String) = settingsCall("imported ✓") {
        api.connImport(pid); reloadConns()
    }

    fun connDel(pid: String) = settingsCall("disconnected") {
        api.connDel(pid); reloadConns()
    }

    fun connTest(pid: String) = settingsCall("connection works ✓") {
        val r = api.connTest(pid)
        if (r.optBoolean("ok") == false && !r.isNull("error"))
            throw Exception(r.optString("error"))
    }

    fun connUse(pid: String) = settingsCall("set as default ✓") {
        api.connUse(pid); reloadConns()
        _ui.update { it.copy(llm = runCatching { api.llmMe() }
            .getOrNull() ?: it.llm) }
    }

    /** OAuth/device flow kickoff — response drives a browser open or poll UI. */
    fun connBegin(pid: String) =
        settingsCall("") {
            val r = api.connBegin(pid)
            _ui.update { it.copy(connOAuth = r.put("pid", pid)) }
        }

    fun connPoll(pid: String, flow: JSONObject) =
        settingsCall("connected ✓") {
            api.connPoll(pid, flow)
            _ui.update { it.copy(connOAuth = null) }
            reloadConns()
        }

    fun clearConnOAuth() { _ui.update { it.copy(connOAuth = null) } }

    private suspend fun reloadConns() {
        _ui.update { it.copy(conns = runCatching { api.connections() }
            .getOrNull() ?: it.conns) }
    }

    // Permissions — agent summon rules
    fun agentPerm(aid: Int, useWho: String?, useWhen: String?) =
        settingsCall("permissions saved ✓") {
            api.agentUpdate(aid, JSONObject()
                .put("use_who", useWho ?: JSONObject.NULL)
                .put("use_when", useWhen ?: JSONObject.NULL))
        }

    // Nexus mesh
    fun mintInvite() = settingsCall("invite minted") {
        val r = api.nexusInvite()
        _ui.update { it.copy(inviteCode =
            r.optString("code", r.optString("invite", ""))) }
    }

    fun removeDevice(nodeId: String) = settingsCall("device removed") {
        api.nexusDeviceRemove(nodeId)
        _ui.update { it.copy(nxDevices = runCatching { api.nexusDevices() }
            .getOrNull() ?: it.nxDevices) }
    }

    fun signOut() {
        pollJob?.cancel()
        linkJob?.cancel()
        RealtimeService.stop(appInst)
        voice?.dispose(); voice = null
        wsClient?.close(); wsClient = null
        store.token = ""; store.serverUrl = ""
        _ui.value = UiState(route = Route.LOGIN)
    }

    fun clearError() { _ui.update { it.copy(error = "") } }
}
