package dev.agenthive.phone.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.Hive
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState
import dev.agenthive.watch.data.HiveApi
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/* ============================ layout ================================= */

@Composable
fun HomeScreen(state: UiState, vm: AppViewModel) {
    // one-time notification permission ask (API 33+)
    val notifPerm = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (android.os.Build.VERSION.SDK_INT >= 33)
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    Box(Modifier.fillMaxSize().background(DcRail)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.weight(1f).fillMaxWidth()) {
                ServerRail(state, vm)
                VerticalDivider(color = DcBorder, thickness = 1.dp)
                Column(
                    Modifier.weight(1f).fillMaxHeight().background(DcSidebar),
                ) {
                    Box(Modifier.weight(1f)) {
                        if (state.railSel == 0) DmPanel(state, vm)
                        else ServerPanel(state, vm)
                    }
                    VoiceMiniBar(state, vm)
                }
            }
            UserBar(state, vm)
        }
        if (state.savedMsgs != null) SavedPanel(state, vm)
        if (state.friendsJson != null) FriendsPanel(state, vm)
        if (state.serverSheet) ServerSheet(state, vm)
        if (state.chanMenu != null) ChanMenuSheet(state, vm)
        if (state.serverMenu != null) ServerMenuSheet(state, vm)
        if (state.statusSheet) StatusSheet(state, vm)
        if (state.inboxArr != null) InboxPanel(state, vm)
    }
}

/** Discord's Inbox (bell) — every @you mention, newest first. */
@Composable
private fun InboxPanel(state: UiState, vm: AppViewModel) {
    val arr = state.inboxArr ?: return
    Column(Modifier.fillMaxSize().background(DcSidebar)) {
        PageTopBar(
            navIcon = Icons.Filled.Close, navDesc = "close",
            onNav = { vm.closeInbox() },
            title = {
                Text("Inbox", color = DcText, fontSize = 15.sp,
                     fontWeight = FontWeight.Bold)
            },
        )
        LazyColumn(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            if (arr.length() == 0)
                item { EmptyNote("no mentions yet") }
            items(arr.length()) { i ->
                val it2 = arr.optJSONObject(i) ?: return@items
                val u = it2.optJSONObject("user") ?: JSONObject()
                val p = it2.optJSONObject("payload") ?: JSONObject()
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(DcChat)
                        .clickable { vm.openInboxItem(it2) }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(32.dp).clip(CircleShape).background(
                            runCatching {
                                Color(android.graphics.Color.parseColor(
                                    u.optString("avatar_color", "#4DA3FF")))
                            }.getOrDefault(DcAccent)),
                        contentAlignment = Alignment.Center,
                    ) { Text(u.optString("avatar_emoji", "🙂"),
                             fontSize = 15.sp) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${u.optString("display_name",
                                u.optString("username", "?"))} · " +
                                "#${p.optString("channel", "?")}",
                            color = DcText, fontSize = 13.sp,
                            fontWeight = FontWeight.Medium, maxLines = 1,
                            overflow = TextOverflow.Ellipsis)
                        Text(p.optString("excerpt"), color = DcSub,
                             fontSize = 12.sp, maxLines = 2,
                             overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/** Discord's Set Status sheet — presence dots + status text. */
@Composable
private fun StatusSheet(state: UiState, vm: AppViewModel) {
    val cur = state.meJson?.optString("status", "online") ?: "online"
    var statusText by remember {
        mutableStateOf(state.meJson?.optString("status_text") ?: "") }
    MenuSheet(title = "Set Status", onClose = { vm.closeStatusSheet() }) {
        listOf(Triple("online", "Online", DcGreen),
               Triple("idle", "Idle", DcWarn),
               Triple("dnd", "Do Not Disturb", DcRed),
               Triple("invisible", "Invisible", DcMuted))
            .forEach { (st, label, c) ->
                Row(
                    Modifier.fillMaxWidth()
                        .clickable { vm.setPresence(st) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(c))
                    Spacer(Modifier.width(12.dp))
                    Text(label,
                         color = DcText, fontSize = 14.sp,
                         fontWeight = FontWeight.Medium,
                         modifier = Modifier.weight(1f))
                    if (cur == st)
                        Icon(Icons.Filled.Check, null, tint = DcAccent,
                             modifier = Modifier.size(16.dp))
                }
            }
        SheetField(statusText, { statusText = it }, "What's on your mind?")
        SheetBtn("Save Status", enabled = true) {
            vm.saveStatusText(statusText)
        }
    }
}

/** Discord's channel/DM long-press — mark read + mute. */
@Composable
private fun ChanMenuSheet(state: UiState, vm: AppViewModel) {
    val ch = state.chanMenu ?: return
    val cid = ch.optInt("id")
    val title = if (ch.has("server_id") && !ch.isNull("server_id"))
        "#" + ch.optString("name") else (ch.optJSONObject("other")
            ?.optString("display_name") ?: ch.optString("name", "channel"))
    val muted = vm.isChannelMuted(cid)
    MenuSheet(
        title = title,
        onClose = { vm.closeChanMenu() },
    ) {
        MenuAction(if (cid in state.unread) "Mark As Read" else "Mark As Read",
            Icons.Filled.Check) { vm.markChannelRead(cid) }
        MenuAction(if (muted) "Unmute Channel" else "Mute Channel",
            Icons.AutoMirrored.Filled.VolumeUp) {
            vm.toggleMuteChannel(cid) }
    }
}

/** Discord's server long-press — invite code + leave. */
@Composable
private fun ServerMenuSheet(state: UiState, vm: AppViewModel) {
    val s = state.serverMenu ?: return
    val sid = s.optInt("id")
    val code = s.optString("invite_code")
    val ctx = LocalContext.current
    MenuSheet(title = s.optString("name", "server"),
            onClose = { vm.closeServerMenu() }) {
        if (code.isNotBlank())
            MenuAction("Invite People — $code", Icons.Filled.Add) {
                val cm = ctx.getSystemService(
                    android.content.Context.CLIPBOARD_SERVICE)
                    as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText(
                    "invite", code))
                vm.closeServerMenu()
            }
        MenuAction("Leave Server", Icons.Filled.Close, danger = true) {
            vm.leaveServer(sid) }
    }
}

/** Shared menu-sheet scaffold — dimmed scrim + action list at bottom. */
@Composable
private fun MenuSheet(title: String, onClose: () -> Unit,
                      content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f))
            .clickable(onClick = onClose))
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .padding(12.dp).clip(RoundedCornerShape(12.dp))
                .background(DcSidebar).border(
                    1.dp, DcBorder, RoundedCornerShape(12.dp)),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(title, color = DcText, fontSize = 13.sp,
                     fontWeight = FontWeight.Bold,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(
                    Modifier.size(28.dp).clip(CircleShape)
                        .clickable(onClick = onClose),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Close, contentDescription = "close",
                         tint = DcIcon, modifier = Modifier.size(16.dp))
                }
            }
            HorizontalDivider(color = DcBorder, thickness = 1.dp)
            Spacer(Modifier.height(4.dp))
            content()
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun MenuAction(label: String,
                       icon: androidx.compose.ui.graphics.vector.ImageVector,
                       danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null,
                 tint = if (danger) DcRed else DcIcon,
                 modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(label, color = if (danger) DcRed else DcText,
             fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/** Discord's "create or join a server" bottom sheet. */
@Composable
private fun ServerSheet(state: UiState, vm: AppViewModel) {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(DcSidebar)) {
        PageTopBar(
            title = {
                Text("Your Servers", color = DcText, fontSize = 16.sp,
                     fontWeight = FontWeight.Bold,
                     modifier = Modifier.weight(1f).padding(start = 8.dp))
            },
            actions = {
                TopBarIconBtn(Icons.Filled.Close, "close") { vm.closeServerSheet() }
            },
        )
        Column(Modifier.fillMaxSize().padding(16.dp)) {
        Spacer(Modifier.height(14.dp))
        Text("CREATE A SERVER", color = DcMuted, fontSize = 10.5.sp,
             fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
        SheetField(name, { name = it }, "server name")
        SheetBtn("create my own", enabled = name.isNotBlank()) {
            vm.createServer(name)
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
            Text("  have an invite?  ", color = DcMuted, fontSize = 11.sp)
            HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(16.dp))
        Text("JOIN A SERVER", color = DcMuted, fontSize = 10.5.sp,
             fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
        SheetField(code, { code = it }, "invite code")
        SheetBtn("join", enabled = code.isNotBlank()) {
            vm.joinServer(code)
        }
        if (state.serverSheetStatus.isNotBlank())
            Text(state.serverSheetStatus, color = DcRed, fontSize = 12.sp,
                 modifier = Modifier.padding(top = 10.dp))
        }
    }
}

@Composable
private fun SheetField(v: String, set: (String) -> Unit, hint: String) {
    Box(
        Modifier.fillMaxWidth().padding(top = 8.dp)
            .clip(RoundedCornerShape(8.dp)).background(DcInput)
            .border(1.dp, DcBorder, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp),
    ) {
        BasicTextField(
            value = v, onValueChange = set,
            textStyle = TextStyle(color = DcText, fontSize = 14.sp),
            cursorBrush = SolidColor(DcAccent), singleLine = true,
            decorationBox = { inner ->
                if (v.isEmpty()) Text(hint, color = DcMuted, fontSize = 14.sp)
                inner()
            })
    }
}

@Composable
private fun SheetBtn(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().padding(top = 8.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (enabled) DcAccent else DcHover)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (enabled) Color.White else DcMuted,
             fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Friends — Discord's All / Pending / Blocked / Add Friend surface. */
@Composable
private fun FriendsPanel(state: UiState, vm: AppViewModel) {
    val f = state.friendsJson ?: return
    val accepted = f.optJSONArray("accepted") ?: JSONArray()
    val incoming = f.optJSONArray("incoming") ?: JSONArray()
    val outgoing = f.optJSONArray("outgoing") ?: JSONArray()
    Column(Modifier.fillMaxSize().background(DcSidebar)) {
        // tab strip — Discord's All/Pending/Blocked/Add, under the top bar
        val tabs = listOf("all", "pending", "blocked", "add")
        PageTopBar(
            navIcon = Icons.Filled.Close, navDesc = "close",
            onNav = { vm.closeFriends() },
            title = {
                Text("Friends", color = DcText, fontSize = 15.sp,
                     fontWeight = FontWeight.Bold)
            },
            below = {
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp)
                    .horizontalScroll(rememberScrollState())) {
                    tabs.forEachIndexed { i, t ->
                        val sel = state.friendsTab == i
                        val label = if (t == "pending" &&
                            incoming.length() + outgoing.length() > 0)
                                "pending (${incoming.length() + outgoing.length()})"
                            else t
                        Text(
                            label, color = if (sel) DcText else DcMuted,
                            fontSize = 12.sp,
                            fontWeight = if (sel) FontWeight.SemiBold
                                          else FontWeight.Medium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (sel) DcHover else Color.Transparent)
                                .clickable { vm.friendsTab(i) }
                                .padding(horizontal = 10.dp, vertical = 5.dp))
                        Spacer(Modifier.width(4.dp))
                    }
                }
                Spacer(Modifier.height(8.dp))
            },
        )
        LazyColumn(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            when (state.friendsTab) {
                3 -> item { AddFriendBox(state, vm) }
                2 -> {
                    if (state.blockIds.isEmpty())
                        item { EmptyNote("no blocked users") }
                    items(state.blockIds.toList()) { uid ->
                        BlockedRow(uid, state, vm)
                    }
                }
                1 -> {
                    if (incoming.length() > 0) {
                        item { SecLabel("received — ${incoming.length()}") }
                        for (i in 0 until incoming.length()) {
                            val u = incoming.optJSONObject(i) ?: continue
                            item(key = "in" + u.optInt("id")) {
                                FriendRow(u, state, vm,
                                    actions = listOf("accept", "decline"))
                            }
                        }
                    }
                    if (outgoing.length() > 0) {
                        item { SecLabel("sent — ${outgoing.length()}") }
                        for (i in 0 until outgoing.length()) {
                            val u = outgoing.optJSONObject(i) ?: continue
                            item(key = "out" + u.optInt("id")) {
                                FriendRow(u, state, vm,
                                    actions = listOf("decline"))
                            }
                        }
                    }
                    if (incoming.length() + outgoing.length() == 0)
                        item { EmptyNote("no pending requests") }
                }
                else -> {
                    if (accepted.length() == 0)
                        item { EmptyNote("no friends yet — add someone!") }
                    item { SecLabel("friends — ${accepted.length()}") }
                    for (i in 0 until accepted.length()) {
                        val u = accepted.optJSONObject(i) ?: continue
                        item(key = u.optInt("id")) {
                            FriendRow(u, state, vm,
                                actions = listOf("dm", "remove"))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SecLabel(t: String) {
    Text(t.uppercase(), color = DcMuted, fontSize = 10.sp,
         fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
         modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 4.dp))
}

@Composable
private fun EmptyNote(t: String) {
    Text(t, color = DcMuted, fontSize = 13.sp,
         modifier = Modifier.padding(14.dp))
}

@Composable
private fun FriendRow(u: JSONObject, state: UiState, vm: AppViewModel,
                      actions: List<String>) {
    val online = u.optString("status") == "online"
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp)
            .clip(RoundedCornerShape(8.dp)).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(
                    runCatching {
                        Color(android.graphics.Color.parseColor(
                            u.optString("avatar_color", "#4DA3FF")))
                    }.getOrDefault(DcAccent)),
                contentAlignment = Alignment.Center,
            ) { Text(u.optString("avatar_emoji", "🙂"), fontSize = 16.sp) }
            Box(Modifier.align(Alignment.BottomEnd).size(11.dp)
                .clip(CircleShape).background(DcSidebar)
                .padding(1.5.dp).clip(CircleShape)
                .background(if (online) DcGreen else DcMuted))
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(u.optString("display_name",
                    u.optString("username", "?")),
                color = DcText, fontSize = 13.sp,
                fontWeight = FontWeight.Medium, maxLines = 1)
            Text("@${u.optString("username")}", color = DcMuted,
                 fontSize = 11.sp)
        }
        if ("accept" in actions)
            Icon(Icons.Filled.Check, "accept", tint = DcGreen,
                 modifier = Modifier.clickable {
                     vm.acceptFriend(u.optInt("friendship_id")) }
                     .padding(6.dp).size(20.dp))
        if ("decline" in actions)
            Icon(Icons.Filled.Close, "decline", tint = DcRed,
                 modifier = Modifier.clickable {
                     vm.declineFriend(u.optInt("friendship_id")) }
                     .padding(6.dp).size(20.dp))
        if ("dm" in actions)
            Icon(Icons.AutoMirrored.Filled.Send, "message", tint = DcIcon,
                 modifier = Modifier.clickable { vm.dmWith(u.optInt("id")) }
                     .padding(6.dp).size(18.dp))
        if ("remove" in actions)
            Icon(Icons.Filled.PersonRemove, "remove", tint = DcMuted,
                 modifier = Modifier.clickable {
                     vm.declineFriend(u.optInt("friendship_id")) }
                     .padding(6.dp).size(18.dp))
    }
}

@Composable
private fun BlockedRow(uid: Int, state: UiState, vm: AppViewModel) {
    val u = (0 until state.chatMembers.length())
        .mapNotNull { state.chatMembers.optJSONObject(it) }
        .firstOrNull { it.optInt("id") == uid }
        ?: JSONObject().put("username", "user-$uid")
            .put("display_name", "user #$uid")
    FriendRow(u, state, vm, actions = listOf()) 
    Icon(Icons.Filled.Lock, "unblock", tint = DcMuted,
         modifier = Modifier.clickable { vm.toggleBlock(uid) })
}

@Composable
private fun AddFriendBox(state: UiState, vm: AppViewModel) {
    var name by remember { mutableStateOf("") }
    Column(Modifier.padding(vertical = 12.dp)) {
        Text("ADD FRIEND", color = DcMuted, fontSize = 10.sp,
             fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
        Text("You can add friends with their username.",
             color = DcSub, fontSize = 12.sp,
             modifier = Modifier.padding(top = 4.dp))
        Row(
            Modifier.fillMaxWidth().padding(top = 10.dp)
                .clip(RoundedCornerShape(8.dp)).background(DcRail)
                .border(1.dp, DcBorder, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = name, onValueChange = { name = it },
                textStyle = TextStyle(color = DcText, fontSize = 14.sp),
                cursorBrush = SolidColor(DcAccent), singleLine = true,
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    if (name.isEmpty())
                        Text("username", color = DcMuted, fontSize = 14.sp)
                    inner()
                })
            Text("send", color = if (name.isBlank()) DcMuted else DcAccent,
                 fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                 modifier = Modifier.clickable(enabled = name.isNotBlank()) {
                     vm.sendFriendReq(name) })
        }
        if (state.friendStatus.isNotBlank())
            Text(state.friendStatus, color = DcSub, fontSize = 12.sp,
                 modifier = Modifier.padding(top = 8.dp))
    }
}

/** Saved messages — bookmark list opened from the DM header. */
@Composable
private fun SavedPanel(state: UiState, vm: AppViewModel) {
    Column(Modifier.fillMaxSize().background(DcSidebar)) {
        PageTopBar(
            navIcon = Icons.Filled.Close, navDesc = "close",
            onNav = { vm.closeSaved() },
            title = {
                Text("Saved Messages", color = DcText, fontSize = 15.sp,
                     fontWeight = FontWeight.Bold)
            },
        )
        LazyColumn(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            val arr = state.savedMsgs!!
            if (arr.length() == 0)
                item {
                    Text("nothing saved yet — long-press a message → Save",
                         color = DcMuted, fontSize = 13.sp,
                         modifier = Modifier.padding(14.dp))
                }
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                item(key = m.optInt("id", i)) {
                    Column(
                        Modifier.fillMaxWidth()
                            .padding(vertical = 6.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(DcChat).padding(10.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                m.optJSONObject("author")
                                    ?.optString("display_name") ?: "?",
                                color = DcText, fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                run {
                                    val cid = m.optInt("channel_id")
                                    var nm = "#$cid"
                                    for (j in 0 until state.channels.length()) {
                                        val c = state.channels.optJSONObject(j) ?: continue
                                        if (c.optInt("id") == cid) { nm = "#" + c.optString("name"); break }
                                    }
                                    "in $nm"
                                },
                                color = DcMuted, fontSize = 11.sp)
                        }
                        Text(m.optString("content"), color = DcSub,
                             fontSize = 13.sp, maxLines = 3,
                             overflow = TextOverflow.Ellipsis,
                             modifier = Modifier.padding(top = 3.dp))
                    }
                }
            }
        }
    }
}

/* ============================ server rail ============================ */

@Composable
private fun ServerRail(state: UiState, vm: AppViewModel) {
    LazyColumn(
        modifier = Modifier.width(72.dp).fillMaxHeight(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            RailIcon(
                label = "", selected = state.railSel == 0,
                bgIfIdle = DcSidebar, fgIfIdle = DcHoney,
                icon = Icons.Filled.Hive,
            ) { vm.selectRail(0) }
        }
        item {
            HorizontalDivider(
                color = DcBorder, thickness = 1.dp,
                modifier = Modifier.width(32.dp),
            )
        }
        items(state.servers.length()) { i ->
            val s = state.servers.optJSONObject(i) ?: return@items
            val sid = s.optInt("id")
            RailIcon(
                label = s.optString("icon").ifBlank {
                    s.optString("name").firstOrNull()?.uppercase() ?: "?"
                },
                selected = state.railSel == sid,
                emoji = true,
                onLongClick = { vm.openServerMenu(s) },
            ) { vm.selectRail(sid) }
        }
        item {
            Box(
                Modifier.fillMaxWidth().height(48.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(48.dp)
                        .clip(CircleShape)
                        .background(DcSidebar)
                        .border(1.dp, DcBorder, CircleShape)
                        .clickable { vm.openServerSheet() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Add, contentDescription = "add server",
                        tint = DcGreen, modifier = Modifier.size(24.dp),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RailIcon(
    label: String, selected: Boolean,
    bgIfIdle: Color = DcSidebar, fgIfIdle: Color = DcText,
    emoji: Boolean = false,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        // Left selector indicator pill: flush at left edge, perfectly centered vertically
        if (selected) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(4.dp)
                    .height(36.dp)
                    .clip(RoundedCornerShape(topEnd = 2.dp, bottomEnd = 2.dp))
                    .background(DcHoney),
            )
        }
        // Center icon: exactly centered in 72dp column, identical alignment for every item
        Box(
            Modifier
                .size(48.dp)
                .clip(if (selected) RoundedCornerShape(14.dp) else CircleShape)
                .background(if (selected) DcSelected else bgIfIdle)
                .border(
                    width = if (selected) 1.5.dp else 1.dp,
                    color = if (selected) DcHoney else DcBorder,
                    shape = if (selected) RoundedCornerShape(14.dp) else CircleShape,
                )
                .combinedClickable(
                    onLongClick = onLongClick, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            if (icon != null) {
                Icon(
                    icon, contentDescription = null,
                    tint = if (selected) DcHoney else fgIfIdle,
                    modifier = Modifier.size(24.dp),
                )
            } else {
                Text(
                    label,
                    color = if (selected) Color.White else fgIfIdle,
                    fontSize = if (emoji) 20.sp else 16.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/* ============================ DM panel =============================== */

@Composable
private fun DmPanel(state: UiState, vm: AppViewModel) {
    var filter by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        // Desktop-style SignalHive header — the shared page top bar
        PageTopBar(
            title = {
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Signal",
                            color = DcText,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(2.dp))
                        Text(
                            "Hive",
                            color = DcHoney,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                        )
                    }
                    Text(
                        "your hive, on your wrist",
                        color = DcSub,
                        fontSize = 11.sp,
                    )
                }
            },
            actions = {
                TopBarIconBtn(Icons.Filled.Notifications, "inbox") { vm.openInbox() }
                TopBarIconBtn(Icons.Filled.Group, "friends") { vm.openFriends() }
                TopBarIconBtn(Icons.Filled.Bookmark, "saved messages") { vm.openSaved() }
            },
        )

        // Search Bar with Search Icon
        Row(
            Modifier
                .padding(horizontal = 10.dp)
                .fillMaxWidth()
                .height(36.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(DcRail)
                .border(1.dp, DcBorder, RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = DcSub,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f)) {
                if (filter.isBlank())
                    Text("Find or start a conversation", color = DcMuted, fontSize = 13.sp)
                androidx.compose.foundation.text.BasicTextField(
                    value = filter, onValueChange = { filter = it },
                    textStyle = androidx.compose.ui.text.TextStyle(
                        color = DcText, fontSize = 13.sp),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(DcAccent),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }
            if (filter.isNotBlank()) {
                Icon(
                    Icons.Filled.Close, contentDescription = "clear",
                    tint = DcSub,
                    modifier = Modifier.size(16.dp).clickable { filter = "" },
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        LazyColumn(Modifier.weight(1f)) {
            item {
                Text(
                    "DIRECT MESSAGES", color = DcMuted, fontSize = 11.sp,
                    fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp,
                    modifier = Modifier.padding(start = 14.dp, top = 4.dp, bottom = 4.dp),
                )
            }
            for (i in 0 until state.dms.length()) {
                val d = state.dms.optJSONObject(i) ?: continue
                val name = dmName(d)
                if (filter.isNotBlank() &&
                    !name.contains(filter, ignoreCase = true)) continue
                val unread = d.optInt("id") in state.unread || run {
                    val last = d.optJSONObject("last") ?: return@run false
                    val read = d.optJSONObject("reads")
                        ?.optDouble("${state.meId}", 0.0) ?: 0.0
                    last.optDouble("created_at") > read
                }
                item(key = d.optInt("id")) {
                    DmRow(d, name, unread,
                          d.optInt("id") in state.mentions, vm)
                }
            }
            item {
                Text(
                    "APPS & AGENTS", color = DcMuted, fontSize = 11.sp,
                    fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp,
                    modifier = Modifier.padding(start = 14.dp, top = 14.dp, bottom = 4.dp),
                )
            }
            if (state.agents.isEmpty()) {
                item {
                    Text("no agents installed", color = DcMuted, fontSize = 13.sp,
                         modifier = Modifier.padding(start = 14.dp, top = 6.dp))
                }
            }
            state.agents
                .filter { filter.isBlank() ||
                    it.name.contains(filter, ignoreCase = true) }
                .forEach { a -> item(key = "a${a.id}") { AgentRow(a, vm) } }
        }
    }
}

private fun dmName(d: JSONObject): String {
    val other = d.optJSONObject("other")
    if (d.optString("name").isNotBlank()) return d.optString("name")
    if (other != null)
        return other.optString("display_name",
            other.optString("username", "dm"))
    val members = d.optJSONArray("members")
    if (members != null && members.length() > 0)
        return (0 until members.length()).mapNotNull {
            members.optJSONObject(it)?.optString("display_name")
        }.joinToString(", ")
    return "group dm"
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DmRow(d: JSONObject, name: String, unread: Boolean,
                  pinged: Boolean, vm: AppViewModel) {
    val other = d.optJSONObject("other")
    val members = d.optJSONArray("members")
    val group = other == null
    val emoji = if (group) "👥" else other!!.optString("avatar_emoji", "🙂")
    val acolor = if (group) "#5865F2"
                 else other!!.optString("avatar_color", "#5865F2")
    val status = other?.optString("status", "") ?: ""
    val preview = if (group) "${members?.length() ?: 0} members"
                  else d.optJSONObject("last")?.optString("content").orEmpty()
    val nameColor = if (unread) Color.White else DcText
    val nameWeight = if (unread) FontWeight.Bold else FontWeight.Medium

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp)
            .clip(RoundedCornerShape(6.dp))
            .combinedClickable(
                onLongClick = { vm.openChanMenu(d) },
            ) { vm.openDm(d) }
            .padding(horizontal = 6.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            if (group)
                Box(
                    Modifier.size(32.dp).clip(CircleShape).background(DcAccent.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Group, contentDescription = null,
                         tint = DcAccent, modifier = Modifier.size(18.dp))
                }
            else
                Avatar(emoji, acolor, 32)
            if (status == "online")
                Box(
                    Modifier.align(Alignment.BottomEnd).size(12.dp)
                        .clip(CircleShape).background(DcSidebar).padding(2.dp)
                        .clip(CircleShape).background(DcGreen),
                )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, color = nameColor, fontSize = 14.sp,
                     fontWeight = nameWeight,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (other?.optString("username")?.startsWith("agent:") == true) {
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(DcHoney.copy(alpha = 0.15f))
                            .border(1.dp, DcHoney.copy(alpha = 0.35f), RoundedCornerShape(3.dp))
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                    ) {
                        Text(
                            "✦ AGENT",
                            color = DcHoney,
                            fontSize = 8.5.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.4.sp,
                        )
                    }
                }
            }
            if (preview.isNotBlank())
                Text(preview, color = DcSub, fontSize = 12.sp,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (pinged)
            Box(
                Modifier.clip(RoundedCornerShape(8.dp)).background(DcRed)
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            ) { Text("1", color = Color.White, fontSize = 10.sp,
                     fontWeight = FontWeight.Bold) }
        else if (unread)
            Box(Modifier.size(8.dp).clip(CircleShape).background(Color.White))
    }
}

@Composable
private fun AgentRow(a: HiveApi.Agent, vm: AppViewModel) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable { vm.openAgent(a) }
            .padding(horizontal = 6.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (a.icon.isBlank())
            Box(
                Modifier.size(32.dp).clip(CircleShape).background(Color(0xFF262015))
                    .border(1.dp, DcHoney.copy(alpha = 0.35f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.SmartToy, contentDescription = null,
                     tint = DcHoney, modifier = Modifier.size(18.dp))
            }
        else
            Avatar(a.icon, "#262015", 32)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(a.name, color = DcText, fontSize = 14.sp,
                     fontWeight = FontWeight.Medium,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DcHoney.copy(alpha = 0.15f))
                        .border(1.dp, DcHoney.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 5.dp, vertical = 1.dp),
                ) {
                    Text(
                        "✦ AGENT",
                        color = DcHoney,
                        fontSize = 8.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp,
                    )
                }
            }
            if (a.tagline.isNotBlank())
                Text(a.tagline, color = DcSub, fontSize = 12.sp,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/* ============================ server panel =========================== */

@Composable
private fun ServerPanel(state: UiState, vm: AppViewModel) {
    var collapsedCats by remember { mutableStateOf(setOf<String>()) }

    val curServer = remember(state.servers, state.railSel) {
        (0 until state.servers.length())
            .mapNotNull { state.servers.optJSONObject(it) }
            .firstOrNull { it.optInt("id") == state.railSel }
    }

    Column(Modifier.fillMaxSize()) {
        PageTopBar(
            onBarClick = { if (curServer != null) vm.openServerMenu(curServer) },
            title = {
                Text(
                    state.serverName.ifBlank { "…" },
                    color = DcText, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            },
            actions = {
                TopBarIconBtn(Icons.Filled.ExpandMore, "server menu") {
                    if (curServer != null) vm.openServerMenu(curServer)
                }
            },
        )

        val chans = remember(state.channels) {
            (0 until state.channels.length())
                .mapNotNull { state.channels.optJSONObject(it) }
                .sortedBy { it.optInt("position") }
        }
        val textChans = remember(chans) {
            chans.filter { it.optString("kind") in listOf("text", "forum", "voice") }
        }
        val agentChans = remember(chans) {
            chans.filter {
                it.optString("kind") == "agents" &&
                !it.optBoolean("workspace") &&
                it.optInt("workspace_id", 0) == 0
            }
        }
        val uncategorized = remember(textChans) {
            textChans.filter { it.optString("category").isBlank() }
        }
        val cats = remember(textChans) {
            val list = mutableListOf<String>()
            for (c in textChans) {
                val cat = c.optString("category")
                if (cat.isNotBlank() && cat !in list) list.add(cat)
            }
            list
        }

        LazyColumn(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            if (chans.isEmpty()) {
                item {
                    Text("No channels", color = DcMuted, fontSize = 13.sp,
                         modifier = Modifier.padding(14.dp))
                }
            }

            // 1. TEXT CHANNELS (uncategorized + categories)
            if (textChans.isNotEmpty()) {
                item {
                    ChannelGroupHeader(
                        title = "Text channels",
                        count = textChans.size,
                    )
                }
                items(uncategorized.size, key = { uncategorized[it].optInt("id") }) { i ->
                    ChannelRow(uncategorized[i], vm, state)
                }
                cats.forEach { cat ->
                    val isCollapsed = cat in collapsedCats
                    val inCat = textChans.filter { it.optString("category") == cat }
                    item(key = "cat_$cat") {
                        ChannelGroupHeader(
                            title = cat,
                            count = inCat.size,
                            collapsed = isCollapsed,
                            onToggle = {
                                collapsedCats = if (isCollapsed) collapsedCats - cat else collapsedCats + cat
                            },
                        )
                    }
                    if (!isCollapsed) {
                        items(inCat.size, key = { inCat[it].optInt("id") }) { i ->
                            ChannelRow(inCat[i], vm, state)
                        }
                    }
                }
            }

            // 2. AGENT CHANNELS
            if (agentChans.isNotEmpty()) {
                item {
                    ChannelGroupHeader(
                        title = "Agent channels",
                        count = agentChans.size,
                    )
                }
                items(agentChans.size, key = { agentChans[it].optInt("id") }) { i ->
                    ChannelRow(agentChans[i], vm, state)
                }
            }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun ChannelGroupHeader(
    title: String,
    count: Int? = null,
    collapsed: Boolean? = null,
    onToggle: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .then(if (onToggle != null) Modifier.clickable(onClick = onToggle) else Modifier)
            .padding(start = 6.dp, end = 6.dp, top = 14.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (collapsed != null) {
                Text(
                    if (collapsed) "▸" else "▾",
                    color = DcMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(end = 4.dp),
                )
            }
            Text(
                title.uppercase(),
                color = DcMuted,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp,
            )
        }
        if (count != null) {
            Text(
                count.toString(),
                color = DcMuted,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Normal,
                modifier = Modifier.padding(end = 4.dp),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChannelRow(ch: JSONObject, vm: AppViewModel, state: UiState) {
    val kind = ch.optString("kind")
    val locked = ch.optBoolean("locked") || ch.optInt("role_id", 0) > 0
    val ctx = LocalContext.current
    val micPerm = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) vm.joinVoice(ch) }
    val icon = when {
        locked -> Icons.Filled.Lock
        kind == "voice" -> Icons.AutoMirrored.Filled.VolumeUp
        kind == "agents" -> Icons.Filled.SmartToy
        kind == "forum" -> Icons.Filled.Forum
        else -> Icons.Filled.Tag
    }
    val cid = ch.optInt("id")
    val unread = cid in state.unread
    val pinged = cid in state.mentions
    val isSelected = state.chat != null && state.chat.cid == cid
    Column {
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(if (isSelected) DcSelected else Color.Transparent)
                .combinedClickable(
                    onLongClick = { vm.openChanMenu(ch) },
                ) {
                    if (kind == "voice") {
                        if (ContextCompat.checkSelfPermission(ctx,
                                Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED)
                            vm.joinVoice(ch)
                        else
                            micPerm.launch(Manifest.permission.RECORD_AUDIO)
                    } else vm.openChannel(ch)
                }
                .padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.width(22.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (kind == "agents" && !locked) {
                    Text(
                        "✦",
                        color = DcHoney,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                    )
                } else {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = when {
                            isSelected -> DcText
                            pinged -> DcHoney
                            kind == "voice" -> DcAccent
                            unread -> DcText
                            else -> DcMuted
                        },
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(
                ch.optString("name"),
                color = if (isSelected || unread || pinged) DcText else DcSub,
                fontSize = 14.sp,
                fontWeight = if (isSelected || unread || pinged) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (pinged) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(DcHoney)
                        .padding(horizontal = 5.dp, vertical = 1.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "@",
                        color = DcChat,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            } else if (unread) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(Color.White),
                )
            } else if (kind == "voice") {
                val n = state.voiceOccupants[cid]?.length() ?: 0
                if (n > 0) {
                    Text("$n", color = DcMuted, fontSize = 11.sp)
                }
            }
        }
        // Discord shows voice occupants indented under the channel
        if (kind == "voice") {
            val occ = state.voiceOccupants[ch.optInt("id")]
            if (occ != null)
                for (i in 0 until occ.length()) {
                    val u = occ.optJSONObject(i) ?: continue
                    Row(
                        Modifier.fillMaxWidth()
                            .padding(start = 30.dp, top = 3.dp, bottom = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(
                            u.optString("avatar_emoji",
                                u.optString("display_name", "?")
                                    .firstOrNull()?.uppercase() ?: "?"),
                            u.optString("avatar_color", "#5865F2"), 22)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            u.optString("display_name",
                                u.optString("username", "?")),
                            color = DcSub, fontSize = 12.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (u.optBoolean("muted"))
                            Icon(Icons.Filled.MicOff, contentDescription = null,
                                 tint = DcMuted, modifier = Modifier.size(13.dp))
                    }
                }
        }
    }
}

/* ============================ user bar =============================== */

@Composable
private fun UserBar(state: UiState, vm: AppViewModel) {
    val meJson = state.meJson
    val emoji = meJson?.optString("avatar_emoji")
        ?.takeIf { it.isNotBlank() }
        ?: (state.me.firstOrNull()?.uppercase() ?: "?")
    val color = meJson?.optString("avatar_color")
        ?.takeIf { it.isNotBlank() }
        ?: "#1F6FEB"
    val statusText = meJson?.optString("status_text")?.takeIf { it.isNotBlank() }
        ?: (if (state.meUsername.isNotBlank()) "@${state.meUsername} · ${if (state.meshUp) "via mesh" else "online"}"
            else if (state.meshUp) "via mesh" else "online")

    Row(
        Modifier
            .fillMaxWidth()
            .background(DcBar)
            .border(1.dp, DcBorder, androidx.compose.ui.graphics.RectangleShape)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.clickable { vm.openStatusSheet() }
        ) {
            Avatar(emoji, color, 34)
            Box(
                Modifier.align(Alignment.BottomEnd).size(12.dp)
                    .clip(CircleShape).background(DcBar).padding(2.dp)
                    .clip(CircleShape).background(
                        when (meJson?.optString("status", "online")) {
                            "idle" -> DcWarn
                            "dnd" -> DcRed
                            "invisible" -> DcMuted
                            else -> DcGreen }),
            )
        }
        Spacer(Modifier.width(9.dp))
        Column(
            Modifier.weight(1f).clickable { vm.openSettings() }
        ) {
            Text(
                state.me,
                color = DcText,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                statusText,
                color = DcSub,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { /* mute toggle */ },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Mic,
                    contentDescription = "mute",
                    tint = DcIcon,
                    modifier = Modifier.size(18.dp),
                )
            }
            Box(
                Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { /* deafen toggle */ },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Headset,
                    contentDescription = "deafen",
                    tint = DcIcon,
                    modifier = Modifier.size(18.dp),
                )
            }
            Box(
                Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { vm.openSettings() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Settings,
                    contentDescription = "settings",
                    tint = DcIcon,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

/* ============================ shared ================================= */

@Composable
private fun Avatar(emoji: String, color: String, size: Int) {
    val c = runCatching { Color(android.graphics.Color.parseColor(color)) }
        .getOrDefault(DcBlurple)
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(c),
        contentAlignment = Alignment.Center,
    ) { Text(emoji, fontSize = (size * 0.5).sp) }
}
