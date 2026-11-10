package dev.agenthive.phone.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState
import org.json.JSONArray
import org.json.JSONObject

private val EMOJI_CHOICES = listOf(
    "🤖", "🐝", "🦉", "🦊", "🐙", "⚡", "🌙", "🍯", "🔍", "📚", "🛠", "🎲")
private val COLOR_CHOICES = listOf(
    "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245",
    "#F47FFF", "#FF7FA5", "#1ABC9C", "#FFA502", "#E3E5E8")
private val STATUSES = listOf(
    "online" to "Online", "idle" to "Idle",
    "dnd" to "Do Not Disturb", "offline" to "Invisible")
private val STATUS_COLORS = mapOf(
    "online" to Color(0xFF23A55A), "idle" to Color(0xFFF0B232),
    "dnd" to Color(0xFFF23F43), "offline" to Color(0xFF80848E))

@Composable
fun SettingsScreen(state: UiState, vm: AppViewModel) {
    var page by remember { mutableStateOf("menu") }
    var connSel by remember { mutableStateOf<JSONObject?>(null) }
    val ctx = LocalContext.current

    // back walks the internal stack before leaving settings
    BackHandler {
        when {
            connSel != null -> connSel = null
            page != "menu" -> page = "menu"
            else -> vm.closeSettings()
        }
    }

    // OAuth begin → hand the consent url to the browser
    LaunchedEffect(state.connOAuth) {
        val o = state.connOAuth ?: return@LaunchedEffect
        val url = o.optString("url")
        if (url.isNotBlank())
            runCatching {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
    }

    Box(Modifier.fillMaxSize().background(DcChat).imePadding()) {
        when {
            connSel != null -> ConnDetailPage(connSel!!, state, vm,
                onBack = { connSel = null })
            else -> when (page) {
                "menu" -> SettingsMenu(state, vm, onPage = { page = it })
                "profile" -> ProfilePage(state, vm) { page = "menu" }
                "notif" -> NotifPage(state, vm) { page = "menu" }
                "models" -> ModelsPage(state, vm) { page = "menu" }
                "conns" -> ConnsPage(state,
                    onBack = { page = "menu" },
                    onPick = { connSel = it })
                "perms" -> PermsPage(state, vm) { page = "menu" }
                "mesh" -> MeshPage(state, vm) { page = "menu" }
                "account" -> AccountPage(state, vm) { page = "menu" }
            }
        }
    }
}

/* ============================== menu ==================================== */

private data class SetRow(
    val icon: ImageVector, val label: String, val blurb: String,
    val page: String, val tint: Color = DcIcon,
)

@Composable
private fun SettingsMenu(state: UiState, vm: AppViewModel,
                         onPage: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Settings", color = DcText, fontSize = 20.sp,
                 fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable { vm.closeSettings() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "close",
                     tint = DcIcon, modifier = Modifier.size(20.dp))
            }
        }
        val me = state.meJson
        LazyColumn(Modifier.fillMaxSize()) {
            // Discord shows your account card first
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp)
                        .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                        .clickable { onPage("profile") }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(
                        me?.optString("avatar_emoji") ?: "🙂",
                        me?.optString("avatar_color") ?: "#5865F2", 44)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            me?.optString("display_name") ?: state.me,
                            color = DcText, fontSize = 15.sp,
                            fontWeight = FontWeight.Bold, maxLines = 1)
                        Text(
                            "@${me?.optString("username") ?: state.meUsername}" +
                            (me?.optString("status_text")
                                ?.takeIf { it.isNotBlank() }
                                ?.let { " · $it" } ?: ""),
                            color = DcSub, fontSize = 12.sp, maxLines = 1,
                            overflow = TextOverflow.Ellipsis)
                    }
                    Icon(Icons.Filled.ChevronRight, contentDescription = null,
                         tint = DcMuted, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.height(14.dp))
            }

            val sections = listOf(
                "USER SETTINGS" to listOf(
                    SetRow(Icons.Filled.AccountCircle, "My Account",
                        "Profile, avatar and presence", "profile"),
                    SetRow(Icons.Filled.Notifications, "Notifications",
                        "Keyword alerts", "notif"),
                ),
                "AI & AUTOMATION" to listOf(
                    SetRow(Icons.Filled.Psychology, "Models",
                        "Endpoint summons use first", "models"),
                    SetRow(Icons.Filled.Link, "Connections",
                        "AI providers and OAuth plugins", "conns"),
                    SetRow(Icons.Filled.Lock, "Permissions",
                        "Who may summon your agents", "perms"),
                ),
                "NETWORK" to listOf(
                    SetRow(Icons.Filled.Hub, "Nexus Mesh",
                        "P2P mesh — status, peers, invites", "mesh"),
                ),
                "ACCOUNT" to listOf(
                    SetRow(Icons.Filled.Key, "Password & Sessions",
                        "Change password, revoke devices", "account"),
                ),
            )
            sections.forEach { (title, rows) ->
                item { SetHeader(title) }
                rows.forEach { r ->
                    item {
                        SettingsRow(r.icon, r.label, r.blurb, r.tint) {
                            if (r.page == "conns") onPage("conns") else onPage(r.page)
                        }
                    }
                }
                item { Spacer(Modifier.height(10.dp)) }
            }
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 2.dp)
                        .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                        .clickable { vm.signOut() }
                        .padding(horizontal = 12.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(34.dp).clip(CircleShape).background(DcRed.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp,
                             contentDescription = null, tint = DcRed,
                             modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text("Log Out", color = DcRed, fontSize = 14.sp,
                         fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

@Composable
private fun SetHeader(t: String, modifier: Modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 6.dp)) {
    Text(t.uppercase(), color = DcMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
         letterSpacing = 0.8.sp,
         modifier = modifier)
}

@Composable
private fun SettingsRow(icon: ImageVector, label: String, blurb: String,
                        tint: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(DcHover),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint,
                 modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(label, color = DcText, fontSize = 14.sp,
                 fontWeight = FontWeight.Medium)
            if (blurb.isNotBlank())
                Text(blurb, color = DcMuted, fontSize = 11.sp, maxLines = 1,
                     overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null,
             tint = DcMuted, modifier = Modifier.size(20.dp))
    }
}

/* ============================ sub-page kit ============================== */

@Composable
private fun SubPage(title: String, onBack: () -> Unit,
                    content: LazyListScope.() -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth()
                .padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "back",
                     tint = DcIcon, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(6.dp))
            Text(title, color = DcText, fontSize = 17.sp,
                 fontWeight = FontWeight.Bold)
        }
        HorizontalDivider(color = DcBorder, thickness = 1.dp)
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
            item { Spacer(Modifier.height(12.dp)) }
            content()
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun FieldLabel(t: String) {
    Text(t.uppercase(), color = DcSub, fontSize = 11.sp,
         fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
         modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
}

@Composable
private fun SetField(value: String, hint: String, secret: Boolean = false,
                     multiline: Boolean = false,
                     onChange: (String) -> Unit) {
    Box(
        Modifier.fillMaxWidth()
            .height(if (multiline) 72.dp else 40.dp)
            .clip(RoundedCornerShape(8.dp)).background(DcInput)
            .border(1.dp, DcBorder, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        contentAlignment = if (multiline) Alignment.TopStart
                           else Alignment.CenterStart,
    ) {
        if (value.isEmpty())
            Text(hint, color = DcMuted, fontSize = 14.sp)
        BasicTextField(
            value = value, onValueChange = onChange,
            textStyle = TextStyle(color = DcText, fontSize = 14.sp),
            cursorBrush = SolidColor(DcAccent),
            singleLine = !multiline,
            visualTransformation =
                if (secret) PasswordVisualTransformation()
                else androidx.compose.ui.text.input.VisualTransformation.None,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun PrimaryBtn(label: String, enabled: Boolean = true,
                       danger: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().padding(top = 14.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (!enabled) DcHover
                else if (danger) DcRed else DcAccent)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.White, fontSize = 14.sp,
             fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun MsgLine(msg: String) {
    if (msg.isBlank()) return
    Text(
        msg,
        color = if (msg.startsWith("✗")) DcRed else DcGreen,
        fontSize = 12.sp,
        modifier = Modifier.padding(top = 10.dp),
    )
}

@Composable
private fun Avatar(emoji: String, color: String, size: Int) {
    val c = runCatching { Color(android.graphics.Color.parseColor(color)) }
        .getOrDefault(DcAccent)
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(c),
        contentAlignment = Alignment.Center,
    ) { Text(emoji, fontSize = (size * 0.45).sp) }
}

/* ============================== profile ================================= */

@Composable
private fun ProfilePage(state: UiState, vm: AppViewModel,
                        onBack: () -> Unit) {
    val me = state.meJson
    var emoji by remember(me) {
        mutableStateOf(me?.optString("avatar_emoji", "🙂") ?: "🙂") }
    var color by remember(me) {
        mutableStateOf(me?.optString("avatar_color", "#5865F2") ?: "#5865F2") }
    var banner by remember(me) {
        mutableStateOf(me?.optString("banner_color", "") ?: "") }
    var name by remember(me) {
        mutableStateOf(me?.optString("display_name", "") ?: "") }
    var pronouns by remember(me) {
        mutableStateOf(me?.optString("pronouns", "") ?: "") }
    var bio by remember(me) {
        mutableStateOf(me?.optString("bio", "") ?: "") }
    var status by remember(me) {
        mutableStateOf(me?.optString("status", "online") ?: "online") }
    var statusText by remember(me) {
        mutableStateOf(me?.optString("status_text", "") ?: "") }

    SubPage("My Account", onBack) {
        item {
            // Discord-style banner + avatar preview
            Box(
                Modifier.fillMaxWidth().height(64.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(
                        runCatching {
                            Color(android.graphics.Color.parseColor(
                                banner.ifBlank { color }))
                        }.getOrDefault(DcBlurple)),
            ) {
                Box(Modifier.align(Alignment.BottomStart).padding(start = 12.dp)
                    .padding(bottom = 0.dp)
                    .size(56.dp).clip(CircleShape).background(DcChat)
                    .padding(4.dp)) {
                    Avatar(emoji, color, 48)
                }
            }
            FieldLabel("Avatar")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(EMOJI_CHOICES.size) { i ->
                    val e = EMOJI_CHOICES[i]
                    Box(
                        Modifier.size(40.dp).clip(CircleShape)
                            .background(if (e == emoji) DcBlurple else DcInput)
                            .clickable { emoji = e },
                        contentAlignment = Alignment.Center,
                    ) { Text(e, fontSize = 20.sp) }
                }
            }
            FieldLabel("Avatar color")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                COLOR_CHOICES.forEach { c ->
                    val col = runCatching {
                        Color(android.graphics.Color.parseColor(c))
                    }.getOrDefault(DcBlurple)
                    Box(
                        Modifier.size(30.dp).clip(CircleShape).background(col)
                            .clickable { color = c },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (color == c)
                            Icon(Icons.Filled.Close, contentDescription = null,
                                 tint = Color.White,
                                 modifier = Modifier.size(14.dp))
                    }
                }
            }
            FieldLabel("Banner color")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                COLOR_CHOICES.forEach { c ->
                    val col = runCatching {
                        Color(android.graphics.Color.parseColor(c))
                    }.getOrDefault(DcBlurple)
                    Box(
                        Modifier.size(30.dp).clip(CircleShape).background(col)
                            .clickable { banner = c },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (banner == c)
                            Icon(Icons.Filled.Close, contentDescription = null,
                                 tint = Color.White,
                                 modifier = Modifier.size(14.dp))
                    }
                }
            }
            FieldLabel("Display name")
            SetField(name, "how you appear") { name = it }
            FieldLabel("Pronouns")
            SetField(pronouns, "she/her · they/them") { pronouns = it }
            FieldLabel("Status")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                STATUSES.forEach { (id, label) ->
                    Row(
                        Modifier.clip(RoundedCornerShape(14.dp))
                            .background(if (status == id) DcBlurple else DcInput)
                            .clickable { status = id }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape)
                            .background(STATUS_COLORS[id] ?: DcGreen))
                        Spacer(Modifier.width(6.dp))
                        Text(label, color = if (status == id) Color.White
                                            else DcSub, fontSize = 12.sp)
                    }
                }
            }
            FieldLabel("Status text")
            SetField(statusText, "what are you up to?") { statusText = it }
            FieldLabel("About me")
            SetField(bio, "a few words", multiline = true) { bio = it }
            PrimaryBtn("Save Changes") {
                vm.saveProfile(JSONObject()
                    .put("avatar_emoji", emoji).put("avatar_color", color)
                    .put("banner_color", banner)
                    .put("display_name", name).put("pronouns", pronouns)
                    .put("bio", bio).put("status", status)
                    .put("status_text", statusText))
            }
            MsgLine(state.settingsMsg)
        }
    }
}

/* =========================== notifications ============================== */

@Composable
private fun NotifPage(state: UiState, vm: AppViewModel,
                      onBack: () -> Unit) {
    val me = state.meJson
    var kw by remember(me) {
        mutableStateOf(
            me?.optJSONArray("keywords")?.let { a ->
                (0 until a.length()).joinToString(", ") { a.optString(it) }
            } ?: "")
    }
    SubPage("Notifications", onBack) {
        item {
            Text(
                "Keyword alerts",
                color = DcText, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
            Text(
                "Get pinged when any of these words show up in a channel you can see — comma-separated.",
                color = DcSub, fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
            FieldLabel("Keywords")
            SetField(kw, "deploy, incident, your name") { kw = it }
            PrimaryBtn("Save") {
                val arr = JSONArray()
                kw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                    .forEach { arr.put(it) }
                vm.saveProfile(JSONObject().put("keywords", arr))
            }
            MsgLine(state.settingsMsg)
        }
    }
}

/* ============================== models ================================== */

@Composable
private fun ModelsPage(state: UiState, vm: AppViewModel,
                       onBack: () -> Unit) {
    val llm = state.llm
    var kind by remember(llm) {
        mutableStateOf(llm.optString("kind", "openai").ifBlank { "openai" }) }
    var base by remember(llm) {
        mutableStateOf(llm.optString("base_url", "")) }
    var model by remember(llm) {
        mutableStateOf(llm.optString("model", "")) }
    var key by remember { mutableStateOf("") }
    var hdrs by remember { mutableStateOf("") }

    val kinds = listOf("openai", "ollama", "lmstudio", "custom")
    val modelOpts = remember(state.llmProv, base) {
        val out = mutableListOf<String>()
        for (i in 0 until state.llmProv.length()) {
            val p = state.llmProv.optJSONObject(i) ?: continue
            val isCustom = p.optString("name") == "custom"
            if (base.isBlank() == !isCustom) continue
            val ms = p.optJSONArray("models") ?: continue
            for (j in 0 until ms.length()) out += ms.optString(j)
        }
        out
    }

    SubPage("Models", onBack) {
        item {
            Text("LLM endpoint", color = DcText, fontSize = 15.sp,
                 fontWeight = FontWeight.Bold)
            Text(
                "The provider summons and the Try tab hit first — leave the URL blank to use local providers (Ollama / LM Studio).",
                color = DcSub, fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp))
            FieldLabel("Provider kind")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                kinds.forEach { k ->
                    Text(
                        k, color = if (kind == k) Color.White else DcSub,
                        fontSize = 12.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.clip(RoundedCornerShape(14.dp))
                            .background(if (kind == k) DcBlurple else DcInput)
                            .clickable { kind = k }
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
            }
            FieldLabel("Base URL")
            SetField(base, "https://api.openai.com/v1 (blank = local)") {
                base = it }
            FieldLabel("Model")
            SetField(model, "model name") { model = it }
            if (modelOpts.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(modelOpts.size.coerceAtMost(12)) { i ->
                        val m = modelOpts[i]
                        Text(
                            m, color = if (m == model) Color.White else DcSub,
                            fontSize = 11.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clip(RoundedCornerShape(10.dp))
                                .background(if (m == model) DcBlurple else DcInput)
                                .clickable { model = m }
                                .padding(horizontal = 10.dp, vertical = 5.dp),
                        )
                    }
                }
            }
            FieldLabel("API key")
            SetField(key,
                if (llm.optBoolean("has_key")) "saved — type to replace"
                else "sk-…", secret = true) { key = it }
            FieldLabel("Extra headers (JSON, optional)")
            SetField(hdrs, """{"X-Header":"…"}""") { hdrs = it }
            PrimaryBtn("Save Endpoint") {
                vm.saveLlm(base, model, kind, key, hdrs) }
            Spacer(Modifier.height(8.dp))
            PrimaryBtn("Test Connection") { vm.testLlm() }
            MsgLine(state.settingsMsg)
        }
    }
}

/* ============================ connections =============================== */

@Composable
private fun ConnsPage(state: UiState, onBack: () -> Unit,
                      onPick: (JSONObject) -> Unit) {
    val ai = (0 until state.conns.length())
        .mapNotNull { state.conns.optJSONObject(it) }
        .filter { !it.optBoolean("plugin") }
    val plugs = (0 until state.conns.length())
        .mapNotNull { state.conns.optJSONObject(it) }
        .filter { it.optBoolean("plugin") }
    SubPage("Connections", onBack) {
        item { SetHeader("AI PROVIDERS") }
        ai.forEach { c -> item(key = c.optString("id")) { ConnRow(c) { onPick(c) } } }
        item { SetHeader("PLUGINS") }
        plugs.forEach { c -> item(key = c.optString("id")) { ConnRow(c) { onPick(c) } } }
    }
}

@Composable
private fun ConnRow(c: JSONObject, onClick: () -> Unit) {
    val hue = runCatching {
        Color(android.graphics.Color.parseColor(
            c.optString("hue", "#888")))
    }.getOrDefault(DcSub)
    val connected = c.optBoolean("connected")
    val detected = c.optBoolean("detected")
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp)
            .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(34.dp).clip(CircleShape)
                .background(hue.copy(alpha = 0.22f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                c.optString("icon").ifBlank {
                    c.optString("name").firstOrNull()?.uppercase() ?: "?" },
                fontSize = 15.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(c.optString("name"), color = DcText, fontSize = 14.sp,
                 fontWeight = FontWeight.Medium, maxLines = 1,
                 overflow = TextOverflow.Ellipsis)
            Text(
                when {
                    connected -> c.optString("label")
                        .ifBlank { "connected" }
                    c.optBoolean("saved") -> "saved — finish setup"
                    detected -> "detected locally — import"
                    else -> c.optString("blurb")
                },
                color = if (connected) DcGreen else DcMuted,
                fontSize = 11.sp, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
        }
        if (connected)
            Box(Modifier.size(8.dp).clip(CircleShape).background(DcGreen))
        Icon(Icons.Filled.ChevronRight, contentDescription = null,
             tint = DcMuted, modifier = Modifier.size(18.dp))
    }
}

/* Connection detail — opens when a row is tapped. Rendered via connSel in
   SettingsScreen's outer when. */
@Composable
private fun ConnDetailPage(c: JSONObject, state: UiState,
                           vm: AppViewModel, onBack: () -> Unit) {
    val connected = c.optBoolean("connected")
    val plugin = c.optBoolean("plugin")
    val pid = c.optString("id")
    var key by remember { mutableStateOf("") }
    var model by remember(c) {
        mutableStateOf(c.optString("model", "")) }
    var label by remember(c) {
        mutableStateOf(c.optString("label", "")) }
    var url by remember(c) { mutableStateOf(c.optString("url", "")) }
    val ctx = LocalContext.current

    SubPage(c.optString("name"), onBack) {
        item {
            Text(c.optString("blurb"), color = DcSub, fontSize = 13.sp)
            if (connected) {
                Spacer(Modifier.height(14.dp))
                Text("connected via ${c.optString("via", "?")}" +
                     c.optString("label").let {
                         if (it.isBlank()) "" else " — $it" },
                     color = DcGreen, fontSize = 13.sp)
            }
            val oauth = state.connOAuth
            if (oauth != null && oauth.optString("pid") == pid) {
                Spacer(Modifier.height(12.dp))
                val dev = oauth.optJSONObject("device")
                if (dev != null) {
                    Text("enter this code in the browser window:",
                         color = DcSub, fontSize = 12.sp)
                    Text(dev.optString("user_code"),
                         color = DcText, fontSize = 22.sp,
                         fontWeight = FontWeight.Bold,
                         modifier = Modifier.padding(vertical = 6.dp))
                    PrimaryBtn("I entered it — check") {
                        vm.connPoll(pid, dev) }
                } else if (oauth.optString("url").isNotBlank()) {
                    Text("finish sign-in in the browser, then come back.",
                         color = DcSub, fontSize = 12.sp)
                    PrimaryBtn("Open again") {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW,
                            Uri.parse(oauth.optString("url"))))
                    }
                }
            }
            if (!connected) {
                if (plugin) {
                    if (c.optBoolean("configured"))
                        PrimaryBtn("Connect via ${c.optString("app", "OAuth")}") {
                            vm.connBegin(pid) }
                    else
                        Text(
                            "this plugin needs an OAuth app configured on the hive first.",
                            color = DcMuted, fontSize = 12.sp,
                            modifier = Modifier.padding(top = 14.dp))
                    FieldLabel("…or paste a token")
                    SetField(key, "manual access token", secret = true) {
                        key = it }
                    PrimaryBtn("Save token", enabled = key.isNotBlank()) {
                        vm.connSave(pid, key, "", "", "") }
                } else {
                    if (c.optBoolean("importable") && c.optBoolean("detected"))
                        PrimaryBtn("Import from local CLI login") {
                            vm.connImport(pid) }
                    FieldLabel("API key")
                    SetField(key, "paste key", secret = true) { key = it }
                    FieldLabel("Model (optional)")
                    SetField(model, "default model") { model = it }
                    FieldLabel("Label (optional)")
                    SetField(label, "nickname") { label = it }
                    if (c.optBoolean("custom")) {
                        FieldLabel("Base URL")
                        SetField(url, "https://…/v1") { url = it }
                    }
                    PrimaryBtn("Save", enabled = key.isNotBlank()) {
                        vm.connSave(pid, key, model, label, url) }
                }
            } else {
                if (model.isBlank() && !plugin) {
                    FieldLabel("Model")
                    SetField(model, "default model") { model = it }
                }
                if (c.optBoolean("usable") && !plugin)
                    PrimaryBtn("Use as default provider") { vm.connUse(pid) }
                if (!plugin)
                    PrimaryBtn("Test") { vm.connTest(pid) }
                if (plugin && c.optBoolean("configured"))
                    PrimaryBtn("Reconnect") { vm.connBegin(pid) }
                PrimaryBtn("Disconnect", danger = true) { vm.connDel(pid) }
            }
            MsgLine(state.settingsMsg)
        }
    }
}

/* ============================ permissions =============================== */

private val USE_WHO = listOf(
    "" to "Follow visibility", "public" to "Public",
    "friends" to "Friends", "people" to "People on servers",
    "private" to "Private")
private val USE_WHEN = listOf(
    "always" to "Always", "online" to "Only while I'm online",
    "off" to "Off")

@Composable
private fun PermsPage(state: UiState, vm: AppViewModel,
                      onBack: () -> Unit) {
    SubPage("Permissions", onBack) {
        item {
            Text(
                "Who may summon each of your agents — mirrors Settings → Permissions on the web.",
                color = DcSub, fontSize = 12.sp)
        }
        val mine = state.agents.filter { it.ownerId == state.meId }
        if (mine.isEmpty()) {
            item {
                Text("No agents yet — publish one from the web app.",
                     color = DcMuted, fontSize = 12.sp,
                     modifier = Modifier.padding(top = 12.dp))
            }
        }
        mine.forEach { a -> item(key = a.id) { AgentPermCard(a, vm) } }
        item { MsgLine(state.settingsMsg) }
    }
}

@Composable
private fun AgentPermCard(a: dev.agenthive.watch.data.HiveApi.Agent,
                          vm: AppViewModel) {
    var who by remember(a) { mutableStateOf(a.useWho) }
    var whn by remember(a) { mutableStateOf(a.useWhen) }
    Column(
        Modifier.fillMaxWidth().padding(vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(a.icon.ifBlank { "✦" }, "#3d2f12", 30)
            Spacer(Modifier.width(10.dp))
            Text(a.name, color = DcText, fontSize = 14.sp,
                 fontWeight = FontWeight.Medium, maxLines = 1,
                 overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(8.dp))
        PermPicker("Who can use", USE_WHO, who) { who = it }
        PermPicker("When", USE_WHEN, whn) { whn = it }
        Box(
            Modifier.align(Alignment.End).padding(top = 8.dp)
                .clip(RoundedCornerShape(6.dp)).background(DcBlurple)
                .clickable { vm.agentPerm(a.id, who, whn) }
                .padding(horizontal = 14.dp, vertical = 7.dp),
        ) {
            Text("Save", color = Color.White, fontSize = 12.sp,
                 fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PermPicker(label: String, opts: List<Pair<String, String>>,
                       sel: String, onSel: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = DcSub, fontSize = 12.sp,
             modifier = Modifier.weight(1f))
        Box {
            Row(
                Modifier.clip(RoundedCornerShape(6.dp)).background(DcInput)
                    .clickable { open = true }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(opts.firstOrNull { it.first == sel }?.second ?: sel,
                     color = DcText, fontSize = 12.sp)
                Icon(Icons.Filled.ChevronRight, contentDescription = null,
                     tint = DcMuted, modifier = Modifier.size(14.dp))
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false },
                modifier = Modifier.background(DcHover)) {
                opts.forEach { (v, l) ->
                    DropdownMenuItem(
                        text = { Text(l, color = DcText, fontSize = 13.sp) },
                        onClick = { onSel(v); open = false })
                }
            }
        }
    }
}

/* =============================== mesh =================================== */

@Composable
private fun MeshPage(state: UiState, vm: AppViewModel,
                     onBack: () -> Unit) {
    val clip = LocalClipboardManager.current
    val nx = state.nxStatus
    val online = nx.optBoolean("online", nx.optBoolean("enabled"))
    SubPage("Nexus Mesh", onBack) {
        item {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(38.dp).clip(CircleShape)
                        .background(if (online) DcGreen.copy(alpha = .2f)
                                    else DcHover),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Hub, contentDescription = null,
                         tint = if (online) DcGreen else DcMuted,
                         modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(if (online) "mesh online" else "mesh offline",
                         color = DcText, fontSize = 14.sp,
                         fontWeight = FontWeight.Bold)
                    Text(
                        listOf(
                            nx.optString("domain"),
                            nx.optString("service", nx.optString("addr")),
                            nx.optString("node_id").take(12),
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                        color = DcSub, fontSize = 11.sp, maxLines = 1,
                        overflow = TextOverflow.Ellipsis)
                }
            }
            SetHeader("PEERS — ${state.nxPeers.length()}")
        }
        for (i in 0 until state.nxPeers.length()) {
            val p = state.nxPeers.optJSONObject(i) ?: continue
            item {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp)
                        .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(
                        if (p.optBoolean("online", true)) DcGreen else DcMuted))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.optString("name", p.optString("node_id", "peer")),
                             color = DcText, fontSize = 13.sp, maxLines = 1,
                             overflow = TextOverflow.Ellipsis)
                        Text(p.optString("ip", p.optString("addr", "")),
                             color = DcMuted, fontSize = 11.sp)
                    }
                    Text(p.optString("path", ""), color = DcMuted,
                         fontSize = 10.sp)
                }
            }
        }
        item {
            SetHeader("INVITE A DEVICE")
            if (state.inviteCode.isBlank()) {
                Text(
                    "Mint an 8-digit pairing code — the watch or another client redeems it to join this hive's mesh.",
                    color = DcSub, fontSize = 12.sp)
            }
            PrimaryBtn(if (state.inviteCode.isBlank()) "Create invite"
                       else "New invite") { vm.mintInvite() }
            if (state.inviteCode.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                        .clickable {
                            clip.setText(AnnotatedString(state.inviteCode)) }
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(state.inviteCode, color = DcText, fontSize = 22.sp,
                         fontWeight = FontWeight.Bold, letterSpacing = 3.sp,
                         modifier = Modifier.weight(1f))
                    Icon(Icons.Filled.ContentCopy, contentDescription = "copy",
                         tint = DcIcon, modifier = Modifier.size(18.dp))
                }
            }
            if (state.nxDevices.length() > 0)
                SetHeader("DEVICES — ${state.nxDevices.length()}")
        }
        for (i in 0 until state.nxDevices.length()) {
            val d = state.nxDevices.optJSONObject(i) ?: continue
            item {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 2.dp)
                        .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(d.optString("name", d.optString("node_id", "device")),
                             color = DcText, fontSize = 13.sp, maxLines = 1,
                             overflow = TextOverflow.Ellipsis)
                        Text(d.optString("node_id", ""),
                             color = DcMuted, fontSize = 10.sp, maxLines = 1,
                             overflow = TextOverflow.Ellipsis)
                    }
                    Icon(Icons.Filled.PersonRemove,
                         contentDescription = "remove", tint = DcRed,
                         modifier = Modifier
                             .clickable {
                                 vm.removeDevice(d.optString("node_id")) }
                             .padding(6.dp).size(18.dp))
                }
            }
        }
        item { MsgLine(state.settingsMsg) }
    }
}

/* ============================== account ================================= */

@Composable
private fun AccountPage(state: UiState, vm: AppViewModel,
                        onBack: () -> Unit) {
    var cur by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    val hasPw = state.meJson?.optBoolean("has_password", true) ?: true
    SubPage("Password & Sessions", onBack) {
        item {
            FieldLabel(if (hasPw) "Current password" else "Set a password")
            if (hasPw)
                SetField(cur, "current password", secret = true) { cur = it }
            FieldLabel("New password")
            SetField(next, "at least 6 characters", secret = true) {
                next = it }
            PrimaryBtn("Change password",
                       enabled = next.length >= 4 &&
                           (!hasPw || cur.isNotBlank())) {
                vm.changePassword(cur, next); cur = ""; next = ""
            }
            SetHeader("SESSIONS")
            Text(
                "Changing your password signs other devices out automatically.",
                color = DcSub, fontSize = 12.sp)
            PrimaryBtn("Sign out all other devices") { vm.signOutOthers() }
            SetHeader("DANGER")
            PrimaryBtn("Log out of this device", danger = true) {
                vm.signOut() }
            MsgLine(state.settingsMsg)
        }
    }
}
