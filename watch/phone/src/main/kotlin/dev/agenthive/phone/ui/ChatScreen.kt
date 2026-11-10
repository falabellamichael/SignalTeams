package dev.agenthive.phone.ui

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Forward
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.MarkUnreadChatAlt
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Tag
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private fun msgAuthor(m: JSONObject) = m.optJSONObject("author") ?: JSONObject()

private fun sameAuthor(a: JSONObject?, b: JSONObject?): Boolean {
    if (a == null || b == null) return false
    return msgAuthor(a).optString("username") == msgAuthor(b).optString("username")
}

private fun msgDay(m: JSONObject): LocalDate =
    Instant.ofEpochSecond(m.optDouble("created_at", 0.0).toLong())
        .atZone(ZoneId.systemDefault()).toLocalDate()

private fun fmtTs(epoch: Double): String {
    val t = Instant.ofEpochSecond(epoch.toLong()).atZone(ZoneId.systemDefault())
    val time = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    return when (t.toLocalDate()) {
        LocalDate.now() -> "Today at " + t.format(time)
        LocalDate.now().minusDays(1) -> "Yesterday at " + t.format(time)
        else -> t.format(DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.US))
    }
}

private fun fmtDay(d: LocalDate): String =
    d.format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US))

@Composable
fun ChatScreen(state: UiState, vm: AppViewModel) {
    val chat = state.chat ?: return
    val listState = rememberLazyListState()
    var draft by remember { mutableStateOf("") }
    var showEmoji by remember { mutableStateOf(false) }
    var reactEmoji by remember { mutableStateOf(-1) }   // mid picking reaction

    // edit action prefills the composer with the message body
    LaunchedEffect(state.editing) {
        state.editing?.let { draft = it.optString("content") }
    }

    LaunchedEffect(state.messages.length()) {
        if (state.messages.length() > 0)
            listState.animateScrollToItem(state.messages.length() - 1)
    }

    // Discord mobile: swipe right → channel drawer (back); swipe left →
    // member list. Single-column app, so both are just overlays.
    var dragX by remember { mutableStateOf(0f) }
    Box(
        Modifier.fillMaxSize().background(DcChat).imePadding()
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { dragX = 0f },
                    onHorizontalDrag = { _, d -> dragX += d },
                    onDragEnd = {
                        when {
                            dragX > 250 -> if (state.showMembers) vm.closeMembers()
                                           else vm.backHome()
                            dragX < -250 -> if (chat.hasMembers) vm.toggleMembers()
                        }
                    },
                )
            },
    ) {
    Column(Modifier.fillMaxSize()) {
        // header — Discord: hamburger, # name, member/search icons
        // Header: perfectly aligned icons, 36dp touch targets, active tints
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable { vm.backHome() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Menu,
                    contentDescription = "back",
                    tint = DcIcon,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        chat.title,
                        color = DcText,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                }
                if (chat.subtitle.isNotBlank())
                    Text(
                        chat.subtitle,
                        color = DcMuted,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .clickable { vm.togglePins() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.PushPin,
                        contentDescription = "pins",
                        tint = if (state.showPins) DcHoney else DcIcon,
                        modifier = Modifier.size(19.dp),
                    )
                }
                if (chat.hasMembers) {
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .clickable { vm.toggleMembers() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.Group,
                            contentDescription = "members",
                            tint = if (state.showMembers) DcAccent else DcIcon,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .clickable { vm.toggleSearch() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Search,
                        contentDescription = "search",
                        tint = if (state.searching) DcAccent else DcIcon,
                        modifier = Modifier.size(19.dp),
                    )
                }
            }
        }
        HorizontalDivider(color = DcBorder, thickness = 1.dp)

        // messages (or search results when 🔍 is open)
        if (state.searching) {
            Box(Modifier.weight(1f)) { SearchPane(state, vm) }
        } else {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
        ) {
            item { ChannelIntro(chat.title, chat.subtitle) }
            items(state.messages.length()) { i ->
                val m = state.messages.optJSONObject(i) ?: return@items
                val prev = if (i > 0) state.messages.optJSONObject(i - 1) else null
                val grouped = sameAuthor(prev, m) &&
                    prev != null &&
                    (m.optDouble("created_at") - prev.optDouble("created_at")) < 300 &&
                    msgDay(prev) == msgDay(m)
                if (prev == null || msgDay(prev) != msgDay(m))
                    DayDivider(msgDay(m))
                // Discord's red "NEW" bar — first message after the read stamp
                val cutoff = state.chatReadCutoff
                if (cutoff > 0 && m.optDouble("created_at") > cutoff &&
                    (prev == null || prev.optDouble("created_at") <= cutoff) &&
                    msgAuthor(m).optInt("id") != state.meId)
                    NewDivider()
                MessageRow(m, grouped, state.meUsername, vm, state)
            }
            item { Spacer(Modifier.height(10.dp)) }
        }
        }

        if (state.error.isNotBlank())
            Text(state.error, color = DcRed, fontSize = 12.sp,
                 modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        if (state.toast.isNotBlank())
            Text(state.toast, color = DcGreen, fontSize = 12.sp,
                 modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

        // Discord reply/edit context bar above the composer
        val reply = state.replyTo
        val editing = state.editing
        if (reply != null || editing != null) {
            Row(
                Modifier.fillMaxWidth().background(DcSidebar)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (editing != null) "Editing message"
                    else "Replying to " +
                        (reply?.optJSONObject("author")
                            ?.optString("display_name")
                            ?: reply?.optJSONObject("author")
                                ?.optString("username") ?: ""),
                    color = DcSub, fontSize = 12.sp,
                    modifier = Modifier.weight(1f), maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(Icons.Filled.Close, contentDescription = "cancel",
                     tint = DcMuted,
                     modifier = Modifier.clickable {
                         if (editing != null) vm.cancelEdit()
                         else vm.cancelReply()
                     }.size(16.dp))
            }
        }

        // "Nova is typing…" — Discord's line above the composer
        LaunchedEffect(state.chat?.cid) {
            while (true) { vm.pruneTyping(); kotlinx.coroutines.delay(2000) }
        }
        if (state.typingUsers.isNotEmpty()) {
            val names = state.typingUsers.values.map { it.first }
            Text(
                when (names.size) {
                    1 -> "${names[0]} is typing…"
                    2 -> "${names[0]} and ${names[1]} are typing…"
                    else -> "Several people are typing…"
                },
                color = DcSub, fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 3.dp),
            )
        }

        // staged attachment chip (Discord shows a pending attachment row)
        val att = state.pendingAttach
        if (att != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp)
                    .clip(RoundedCornerShape(8.dp)).background(DcSidebar)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.InsertDriveFile, contentDescription = null,
                     tint = DcIcon, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(att.optString("name", "file"), color = DcText,
                     fontSize = 13.sp, modifier = Modifier.weight(1f),
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Filled.Close, contentDescription = "remove",
                     tint = DcMuted,
                     modifier = Modifier.clickable { vm.clearAttachment() }
                         .size(16.dp))
            }
        }

        // composer — Discord pill: ⊕  Message #chan  😀 / ➤
        val ctx = LocalContext.current
        val pickFile = androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.GetContent(),
        ) { uri: android.net.Uri? ->
            uri?.let {
                runCatching {
                    var name = "file"
                    ctx.contentResolver.query(it, null, null, null, null)
                        ?.use { c ->
                            val i = c.getColumnIndex(
                                android.provider.OpenableColumns.DISPLAY_NAME)
                            if (c.moveToFirst() && i >= 0) name = c.getString(i)
                        }
                    val mime = ctx.contentResolver.getType(it)
                        ?: "application/octet-stream"
                    val bytes = ctx.contentResolver.openInputStream(it)
                        ?.readBytes() ?: return@runCatching
                    vm.stageAttachment(name, bytes, mime)
                }
            }
        }
        Box {
            // @mention + /command autocompletes — Discord's input popups
            val mQ = mentionQuery(draft)
            if (mQ != null)
                MentionPopup(mQ, state) { insert ->
                    draft = draft.dropLast(mQ.length + 1) + "@$insert "
                }
            val sQ = if (draft.startsWith("/") && !draft.contains(" "))
                draft else null
            if (sQ != null)
                SlashPopup(sQ, state) { out -> draft = out }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
            Row(
                Modifier.weight(1f).height(42.dp)
                    .clip(RoundedCornerShape(21.dp))
                    .background(DcInput)
                    .border(1.dp, DcBorder, RoundedCornerShape(21.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.AddCircle, contentDescription = "attach",
                     tint = DcIcon,
                     modifier = Modifier.size(24.dp)
                         .clickable { pickFile.launch("*/*") })
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f)) {
                    if (draft.isBlank())
                        Text(
                            "Message ${chat.title.trimStart('#', '@')}",
                            color = DcMuted, fontSize = 14.sp,
                        )
                    BasicTextField(
                        value = draft,
                        onValueChange = {
                            draft = it
                            vm.onDraftTyping(it.isNotBlank())
                        },
                        textStyle = TextStyle(color = DcText, fontSize = 14.sp),
                        cursorBrush = SolidColor(DcAccent),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = {
                            val t = draft
                            if (t.isNotBlank()) { vm.send(t); draft = "" }
                        }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (draft.isBlank())
                    Icon(Icons.Filled.EmojiEmotions, contentDescription = "emoji",
                         tint = DcIcon,
                         modifier = Modifier.size(20.dp)
                             .clickable { showEmoji = true })
            }
            if (draft.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier.size(42.dp).clip(CircleShape).background(DcAccent)
                        .clickable { vm.send(draft); draft = "" },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send,
                         contentDescription = "send",
                         tint = Color.White, modifier = Modifier.size(18.dp))
                }
            }
            }   // composer Row
        }   // inner Box (composer + autocomplete popups)
    }   // Column
        if (state.showMembers) MembersPanel(state, vm)
        if (state.showPins) PinsPanel(state, vm)
        state.sheetMsg?.let { m ->
            ActionSheet(m, state, vm,
                onPickEmoji = { mid -> reactEmoji = mid; vm.closeSheet() })
        }
        state.fwdMsg?.let { m -> ForwardSheet(m, state, vm) }
        if (showEmoji)
            EmojiSheet(onPick = { draft += it }, onClose = { showEmoji = false })
        if (reactEmoji > 0)
            EmojiSheet(onPick = { e ->
                vm.react(reactEmoji, e); reactEmoji = -1
            }, onClose = { reactEmoji = -1 })
        state.threadRoot?.let { ThreadPanel(state, vm) }
        state.profile?.let { p -> ProfileCard(p, state, vm) }
    }       // Box
}

/* ========================= action sheet ================================= */

private val SHEET_EMOJIS = listOf("👍", "❤️", "😂", "🔥", "🎉", "👀")

/** Discord's long-press sheet: quick reactions + action list, bottom sheet. */
@Composable
private fun ActionSheet(m: JSONObject, state: UiState, vm: AppViewModel,
                        onPickEmoji: (Int) -> Unit = {}) {
    val clip = LocalClipboardManager.current
    val mine = msgAuthor(m).optString("username") == state.meUsername
    Box(
        Modifier.fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f))
            .clickable { vm.closeSheet() },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier.fillMaxWidth()
                .clickable(enabled = false) {}
                .padding(horizontal = 10.dp, vertical = 14.dp),
        ) {
            // quick-react row — Discord puts 6 common emojis on top
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp)).background(DcSidebar)
                    .border(1.dp, DcBorder, RoundedCornerShape(14.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SHEET_EMOJIS.forEach { e ->
                    Box(
                        Modifier.size(36.dp)
                            .clip(CircleShape)
                            .clickable { vm.react(m.optInt("id"), e) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(e, fontSize = 22.sp)
                    }
                }
                // "+" tile → full emoji picker for any other reaction
                Box(
                    Modifier.size(36.dp)
                        .clip(CircleShape)
                        .background(DcChat)
                        .border(1.dp, DcBorder, CircleShape)
                        .clickable { onPickEmoji(m.optInt("id")) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.AddCircle, contentDescription = "more emojis",
                        tint = DcIcon,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            // action list
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp)).background(DcSidebar)
                    .border(1.dp, DcBorder, RoundedCornerShape(14.dp))
                    .verticalScroll(androidx.compose.foundation.rememberScrollState()),
            ) {
                SheetAction(Icons.AutoMirrored.Filled.Reply, "Reply",
                    DcIcon) { vm.startReply(m) }
                if (mine)
                    SheetAction(Icons.Filled.Edit, "Edit Message",
                        DcIcon) { vm.startEdit(m) }
                SheetAction(Icons.Filled.ContentCopy, "Copy Text", DcIcon) {
                    clip.setText(AnnotatedString(m.optString("content")))
                    vm.closeSheet()
                }
                SheetAction(Icons.Filled.PushPin, "Pin Message", DcIcon) {
                    vm.pinMsg(m.optInt("id")) }
                SheetAction(Icons.Filled.Bookmark, "Save Message", DcIcon) {
                    vm.saveMsg(m.optInt("id")) }
                SheetAction(Icons.Filled.Share, "Forward",
                    DcIcon) { vm.openForward(m) }
                SheetAction(Icons.Filled.MarkUnreadChatAlt, "Mark Unread",
                    DcIcon) { vm.markUnreadHere(m) }
                if (m.optInt("thread_count") > 0)
                    SheetAction(Icons.Filled.Forum, "Open Thread", DcIcon) {
                        vm.openThread(m) }
                if (mine)
                    SheetAction(Icons.Filled.Delete, "Delete", DcRed) {
                        vm.deleteMsg(m.optInt("id")) }
            }
        }
    }
}

@Composable
private fun SheetAction(icon: androidx.compose.ui.graphics.vector.ImageVector,
                        label: String, tint: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint,
                 modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(14.dp))
        Text(label, color = if (tint == DcRed) DcRed else DcText,
             fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/* =========================== emoji picker =============================== */

private val EMOJI_SET = listOf(
    "😀","😄","😁","🤣","😂","🙂","😉","😊","😇","🥰","😍","😘",
    "😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡","🤐","🤨","😐",
    "😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤",
    "😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠",
    "🥳","😎","🤓","🧐","😕","🫤","😟","🙁","😮","😯","😲","😳",
    "🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣",
    "😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀",
    "💩","🤡","👹","👺","👻","👽","🤖","😺","👍","👎","👏","🙌",
    "🤝","🙏","✌️","🤞","🫰","👌","🤌","🤏","👈","👉","👆","👇",
    "☝️","✋","🤚","🖐️","🖖","👋","🤙","💪","🫶","❤️","🧡","💛",
    "💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗",
    "💖","💘","💯","🔥","✨","🎉","🎊","🎈","🎁","🏆","🥇","⭐",
    "🌟","💫","⚡","☄️","💥","🌈","☀️","🌙","❄️","☔","🌊","💧",
    "🍀","🌸","🌺","🍕","🍔","🌮","🍣","🍩","🍪","☕","🍺","🎂",
    "🚀","✈️","🚗","🚲","⏰","📌","📎","🔒","🔑","🛠️","💡","📱",
    "💻","⌚","📷","🎮","🎲","🎵","🎶","🔔","📢","💬","👀","✅",
    "❌","⚠️","❓","❗","♻️","🏳️","🚩","🏁","🐝","🦾","🧠","👑",
)

/** Discord's emoji sheet — bottom grid, tap inserts into the draft. */
@Composable
private fun EmojiSheet(onPick: (String) -> Unit, onClose: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))
            .clickable(onClick = onClose),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier.fillMaxWidth()
                .clickable(enabled = false) {}
                .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .background(DcSidebar).padding(10.dp),
        ) {
            Box(
                Modifier.align(Alignment.CenterHorizontally)
                    .width(36.dp).height(4.dp)
                    .clip(RoundedCornerShape(2.dp)).background(DcMuted),
            )
            Spacer(Modifier.height(8.dp))
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 40.dp),
                modifier = Modifier.heightIn(max = 280.dp),
            ) {
                items(EMOJI_SET.size) { i ->
                    Text(
                        EMOJI_SET[i], fontSize = 24.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier
                            .clickable { onPick(EMOJI_SET[i]) }
                            .padding(4.dp),
                    )
                }
            }
        }
    }
}

/* =========================== forward sheet ============================== */

/** Discord's forward picker — target channel/DM list + optional caption. */
@Composable
private fun ForwardSheet(m: JSONObject, state: UiState, vm: AppViewModel) {
    var caption by remember { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f))
            .clickable { vm.closeForward() },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier.fillMaxWidth()
                .clickable(enabled = false) {}
                .padding(horizontal = 10.dp, vertical = 14.dp)
                .clip(RoundedCornerShape(14.dp)).background(DcSidebar)
                .padding(12.dp),
        ) {
            Text("Forward to…", color = DcText, fontSize = 14.sp,
                 fontWeight = FontWeight.Bold,
                 modifier = Modifier.padding(bottom = 8.dp))
            LazyColumn(Modifier.heightIn(max = 260.dp)) {
                for (i in 0 until state.channels.length()) {
                    val c = state.channels.optJSONObject(i) ?: continue
                    if (c.optString("kind") != "text") continue
                    item(key = "c${c.optInt("id")}") {
                        FwdTarget("#" + c.optString("name")) {
                            vm.forward(m, c.optInt("id"), caption)
                        }
                    }
                }
                for (i in 0 until state.dms.length()) {
                    val d = state.dms.optJSONObject(i) ?: continue
                    val other = d.optJSONObject("other")
                    val nm = other?.optString("display_name",
                        other.optString("username", "dm"))
                        ?: d.optString("name", "group dm")
                    item(key = "d${d.optInt("id")}") {
                        FwdTarget("@$nm") {
                            vm.forward(m, d.optInt("id"), caption)
                        }
                    }
                }
            }
            BasicTextField(
                value = caption, onValueChange = { caption = it },
                textStyle = TextStyle(color = DcText, fontSize = 13.sp),
                cursorBrush = SolidColor(DcAccent),
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    .clip(RoundedCornerShape(8.dp)).background(DcChat)
                    .padding(10.dp),
                decorationBox = { inner ->
                    Box {
                        if (caption.isBlank())
                            Text("add a caption (optional)", color = DcMuted,
                                 fontSize = 13.sp)
                        inner()
                    }
                },
            )
        }
    }
}

@Composable
private fun FwdTarget(name: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(name, color = DcText, fontSize = 14.sp)
    }
}

/* ============================ thread view =============================== */

@Composable
private fun ThreadPanel(state: UiState, vm: AppViewModel) {
    val root = state.threadRoot ?: return
    var tdraft by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(DcChat)) {
        Row(
            Modifier.fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(36.dp).clip(CircleShape)
                    .clickable { vm.closeThread() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "close thread",
                    tint = DcIcon,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("Thread", color = DcText, fontSize = 15.sp,
                     fontWeight = FontWeight.Bold)
                Text(
                    msgAuthor(root).optString("display_name",
                        msgAuthor(root).optString("username")),
                    color = DcMuted, fontSize = 11.sp, maxLines = 1)
            }
        }
        HorizontalDivider(color = DcBorder, thickness = 1.dp)
        // parent message — always shown on top, Discord-style
        MessageRow(root, grouped = false, meUsername = state.meUsername, state = state,
                   vm = vm)
        HorizontalDivider(color = DcBorder, thickness = 1.dp,
                          modifier = Modifier.padding(vertical = 6.dp))
        LazyColumn(Modifier.weight(1f)) {
            items(state.threadMsgs.length()) { i ->
                val m = state.threadMsgs.optJSONObject(i) ?: return@items
                val prev = if (i > 0) state.threadMsgs.optJSONObject(i - 1)
                           else null
                val grouped = sameAuthor(prev, m) && prev != null &&
                    (m.optDouble("created_at") -
                     prev.optDouble("created_at")) < 300
                MessageRow(m, grouped, state.meUsername, vm, state)
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f).height(42.dp)
                    .clip(RoundedCornerShape(21.dp)).background(DcInput)
                    .border(1.dp, DcBorder, RoundedCornerShape(21.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f)) {
                    if (tdraft.isBlank())
                        Text("Reply to thread", color = DcMuted, fontSize = 14.sp)
                    BasicTextField(
                        value = tdraft, onValueChange = { tdraft = it },
                        textStyle = TextStyle(color = DcText, fontSize = 14.sp),
                        cursorBrush = SolidColor(DcAccent), singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = {
                            if (tdraft.isNotBlank()) {
                                vm.send(tdraft); tdraft = "" }
                        }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            if (tdraft.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier.size(42.dp).clip(CircleShape)
                        .background(DcAccent)
                        .clickable { vm.send(tdraft); tdraft = "" },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send,
                         contentDescription = "send", tint = Color.White,
                         modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

/* =========================== channel search ============================= */

@Composable
private fun SearchPane(state: UiState, vm: AppViewModel) {
    var q by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(8.dp)).background(DcInput)
                .border(1.dp, DcBorder, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Search, contentDescription = null,
                 tint = DcMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f).padding(vertical = 9.dp)) {
                if (q.isBlank())
                    Text("Search", color = DcMuted, fontSize = 14.sp)
                BasicTextField(
                    value = q,
                    onValueChange = { q = it; vm.search(it) },
                    textStyle = TextStyle(color = DcText, fontSize = 14.sp),
                    cursorBrush = SolidColor(DcAccent), singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (q.isNotBlank())
                Icon(Icons.Filled.Close, contentDescription = "clear",
                     tint = DcMuted,
                     modifier = Modifier.clickable { q = ""; vm.search("") }
                         .size(16.dp))
        }
        LazyColumn(Modifier.weight(1f)) {
            items(state.searchResults.length()) { i ->
                val m = state.searchResults.optJSONObject(i) ?: return@items
                MessageRow(m, grouped = false, meUsername = state.meUsername, state = state,
                           vm = vm)
            }
        }
    }
}

@Composable
private fun ChannelIntro(title: String, subtitle: String) {
    Column(Modifier.padding(start = 14.dp, top = 18.dp, bottom = 8.dp)) {
        Box(
            Modifier.size(64.dp).clip(CircleShape).background(DcHover),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (title.startsWith("#")) Icons.Filled.Tag
                else Icons.Filled.AlternateEmail,
                contentDescription = null, tint = DcIcon,
                modifier = Modifier.size(34.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            "Welcome to $title!",
            color = DcText, fontSize = 20.sp, fontWeight = FontWeight.Bold,
        )
        Text(
            if (subtitle.isNotBlank())
                "This is the start of $title. $subtitle"
            else "This is the start of $title.",
            color = DcSub, fontSize = 14.sp,
        )
    }
}

@Composable
private fun DayDivider(day: LocalDate) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(color = DcHover, modifier = Modifier.weight(1f))
        Text(
            fmtDay(day), color = DcMuted, fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        HorizontalDivider(color = DcHover, modifier = Modifier.weight(1f))
    }
}

/** Discord's red NEW unread bar. */
@Composable
private fun NewDivider() {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(color = DcRed, modifier = Modifier.weight(1f))
        Box(
            Modifier.clip(RoundedCornerShape(4.dp)).background(DcRed)
                .padding(horizontal = 5.dp, vertical = 1.dp),
        ) {
            Text("NEW", color = Color.White, fontSize = 9.sp,
                 fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(m: JSONObject, grouped: Boolean,
                       meUsername: String, vm: AppViewModel,
                       state: UiState? = null) {
    val author = msgAuthor(m)
    val name = author.optString("display_name", author.optString("username"))
    val emoji = author.optString("avatar_emoji", "🙂")
    val color = author.optString("avatar_color", "#5865F2")
    val content = m.optString("content")
    val ts = m.optDouble("created_at")

    // system is a non-empty STRING on the wire (e.g. "user_join"), not a bool
    if (m.optString("system").isNotBlank()) {
        Text(
            content, color = DcMuted, fontSize = 12.sp,
            modifier = Modifier.fillMaxWidth()
                .padding(vertical = 4.dp, horizontal = 14.dp),
        )
        return
    }

    var mentioned = meUsername.isNotBlank() && (
        content.contains("@$meUsername") || content.contains("@everyone")
            || content.contains("@here"))
    // keyword alerts tint like a mention
    if (!mentioned) {
        val kws = state?.meJson?.optJSONArray("notify_mentions")
        if (kws != null) for (i in 0 until kws.length()) {
            val k = kws.optString(i)
            if (k.isNotBlank() && content.contains(k, ignoreCase = true)) {
                mentioned = true; break }
        }
    }
    val bg = if (mentioned) DcHoney.copy(alpha = 0.08f)
             else Color.Transparent

    Row(
        Modifier.fillMaxWidth().background(bg)
            .combinedClickable(
                onClick = {},
                onLongClick = { vm.openSheet(m) },
            )
            .padding(top = if (grouped) 1.dp else 8.dp)
            .padding(horizontal = 14.dp),
    ) {
        if (!grouped) {
            val c = runCatching { Color(android.graphics.Color.parseColor(color)) }
                .getOrDefault(DcBlurple)
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(c)
                    .clickable { vm.openProfile(author.optInt("id")) },
                contentAlignment = Alignment.Center,
            ) { Text(emoji, fontSize = 20.sp) }
        } else Spacer(Modifier.width(40.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            // forwarded origin line — "Forwarded from #chan · Name"
            m.optJSONObject("fwd")?.let { f ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Filled.Forward,
                         contentDescription = null, tint = DcMuted,
                         modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "forwarded from " +
                            (f.optJSONObject("author")
                                ?.optString("display_name") ?: "?") +
                            (if (f.optString("channel").isNotBlank())
                                " · #${f.optString("channel")}" else ""),
                        color = DcMuted, fontSize = 11.sp, maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            // Discord reply preview — hooked line + author + clipped content
            m.optJSONObject("reply")?.let { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Filled.Reply,
                         contentDescription = null, tint = DcMuted,
                         modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        r.optJSONObject("author")?.optString("display_name") ?: "",
                        color = DcAccent, fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        r.optString("content"), color = DcMuted, fontSize = 11.sp,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                }
            }
            if (!grouped) {
                val uname = author.optString("username")
                val isAgent = uname.startsWith("agent:")
                val isBot = isAgent || author.optString("status") == "bot" || author.optBoolean("bot")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        name, color = DcText, fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable {
                            vm.openProfile(author.optInt("id")) },
                    )
                    if (isBot) {
                        Spacer(Modifier.width(6.dp))
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(3.dp))
                                .background(if (isAgent) DcHoney.copy(alpha = 0.18f) else DcAccent.copy(alpha = 0.18f))
                                .border(1.dp, if (isAgent) DcHoney.copy(alpha = 0.35f) else DcAccent.copy(alpha = 0.35f), RoundedCornerShape(3.dp))
                                .padding(horizontal = 4.dp, vertical = 1.dp),
                        ) {
                            Text(
                                if (isAgent) "✦ AGENT" else "BOT",
                                color = if (isAgent) DcHoney else DcAccent,
                                fontSize = 8.5.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.4.sp,
                            )
                        }
                    }
                    if (m.optBoolean("pinned")) {
                        Spacer(Modifier.width(5.dp))
                        Icon(
                            Icons.Filled.PushPin,
                            contentDescription = "pinned",
                            tint = DcHoney,
                            modifier = Modifier.size(12.dp),
                        )
                    }
                    Spacer(Modifier.width(7.dp))
                    Text(fmtTs(ts), color = DcMuted, fontSize = 11.sp)
                }
                Spacer(Modifier.height(1.dp))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                MentionText(content, state, meUsername, vm,
                    Modifier.weight(1f, fill = false))
                if (!m.isNull("edited_at"))
                    Text(" (edited)", color = DcMuted, fontSize = 10.sp)
            }
            AttachmentsRow(m, vm)
            PollCard(m, vm)
            ReactionsRow(m, vm)
            // Thread pill — "N replies ›" opens the thread view
            val tc = m.optInt("thread_count")
            if (tc > 0)
                Row(
                    Modifier.padding(top = 3.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { vm.openThread(m) }
                        .padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Forum, contentDescription = null,
                         tint = DcAccent, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(5.dp))
                    Text(
                        "$tc ${if (tc == 1) "reply" else "replies"}",
                        color = DcAccent, fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
        }
    }
}

private val POLL_EMOJI = listOf("1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣",
                                "6️⃣", "7️⃣", "8️⃣", "9️⃣")

/** Discord poll card — option bars + tap-to-vote (votes are reactions). */
@Composable
private fun PollCard(m: JSONObject, vm: AppViewModel) {
    // poll may arrive as an object or as a JSON-encoded string
    val poll = m.optJSONObject("poll")
        ?: m.optString("poll").takeIf { it.startsWith("{") }
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
        ?: return
    val opts = poll.optJSONArray("options")
        ?: poll.optString("options").takeIf { it.startsWith("[") }
            ?.let { runCatching { JSONArray(it) }.getOrNull() }
        ?: return
    val reacts = m.optJSONArray("reactions")
    fun vote(i: Int): Pair<Int, Boolean> {
        var n = 0; var mine = false
        reacts?.let { arr ->
            for (j in 0 until arr.length()) {
                val r = arr.optJSONObject(j) ?: continue
                if (r.optString("emoji") == POLL_EMOJI.getOrNull(i)) {
                    n = r.optInt("count"); mine = r.optBoolean("mine") }
            }
        }
        return n to mine
    }
    val total = (0 until opts.length()).sumOf { vote(it).first }
    Column(
        Modifier.padding(top = 6.dp).clip(RoundedCornerShape(8.dp))
            .background(DcSidebar).padding(10.dp),
    ) {
        Text(poll.optString("q"), color = DcText, fontSize = 13.sp,
             fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        for (i in 0 until opts.length()) {
            val (n, mine) = vote(i)
            val pct = if (total > 0) n * 100 / total else 0
            Box(
                Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(
                        if (mine) DcBlurple.copy(alpha = 0.25f) else DcHover)
                    .clickable {
                        POLL_EMOJI.getOrNull(i)
                            ?.let { vm.react(m.optInt("id"), it) }
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(POLL_EMOJI.getOrNull(i) ?: "", fontSize = 13.sp)
                    Spacer(Modifier.width(6.dp))
                    Text(opts.optString(i), color = DcText, fontSize = 13.sp,
                         modifier = Modifier.weight(1f), maxLines = 1,
                         overflow = TextOverflow.Ellipsis)
                    if (total > 0)
                        Text("$pct%", color = DcSub, fontSize = 11.sp)
                    Spacer(Modifier.width(6.dp))
                    Text("$n", color = DcMuted, fontSize = 11.sp)
                }
            }
        }
        Text("$total vote${if (total == 1) "" else "s"} · tap to vote",
             color = DcMuted, fontSize = 10.sp,
             modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun ReactionsRow(m: JSONObject, vm: AppViewModel) {
    val arr = m.optJSONArray("reactions") ?: return
    if (arr.length() == 0) return
    val pollOpts = m.optJSONObject("poll")
        ?.optJSONArray("options")?.length() ?: 0
    Row(
        Modifier.padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i) ?: continue
            // poll votes live as reactions too — don't double-render them
            if (pollOpts > 0 &&
                POLL_EMOJI.take(pollOpts).contains(r.optString("emoji")))
                continue
            val mine = r.optBoolean("mine")
            Row(
                Modifier.clip(RoundedCornerShape(8.dp))
                    .background(if (mine) DcAccent.copy(alpha = 0.25f) else DcHover)
                    .border(
                        1.dp,
                        if (mine) DcAccent.copy(alpha = 0.5f) else DcBorder,
                        RoundedCornerShape(8.dp),
                    )
                    .clickable { vm.react(m.optInt("id"), r.optString("emoji")) }
                    .padding(horizontal = 7.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(r.optString("emoji"), fontSize = 13.sp)
                Spacer(Modifier.width(4.dp))
                Text(
                    "${r.optInt("count")}",
                    color = if (mine) Color.White else DcSub,
                    fontSize = 12.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/* ============================ member drawer ========================== */

@Composable
private fun MembersPanel(state: UiState, vm: AppViewModel) {
    val all = (0 until state.members.length())
        .mapNotNull { state.members.optJSONObject(it) }
    val on = all.filter { it.optString("status") == "online" }
    val off = all.filter { it.optString("status") != "online" }
    // Discord groups online members by their highest role (roles[] is ordered)
    val roles = state.roles
    fun roleOf(u: JSONObject): JSONObject? {
        val ids = u.optJSONArray("role_ids") ?: return null
        val myIds = (0 until ids.length()).map { ids.optInt(it) }.toSet()
        for (j in 0 until roles.length()) {
            val r = roles.optJSONObject(j) ?: continue
            if (r.optInt("id") in myIds) return r
        }
        return null
    }
    fun roleColor(u: JSONObject): Color? {
        val r = roleOf(u) ?: return null
        val hex = r.optString("color")
        if (hex.isBlank()) return null
        return runCatching {
            Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
    }
    // group online members by top role (Discord: "MODS — 1", "ONLINE — 5")
    val groups = linkedMapOf<String, MutableList<JSONObject>>()
    for (u in on) {
        val r = roleOf(u)
        groups.getOrPut(r?.optString("name") ?: "online") { mutableListOf() } += u
    }

    Box(
        Modifier.fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable { vm.closeMembers() },
    ) {
        Column(
            Modifier.align(Alignment.CenterEnd)
                .fillMaxHeight().width(260.dp)
                .background(DcSidebar)
                .border(1.dp, DcBorder)
                .clickable(enabled = false) {}
                .padding(top = 10.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "MEMBERS — ${state.members.length()}",
                    color = DcText,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp,
                )
                Box(
                    Modifier.size(32.dp).clip(CircleShape)
                        .clickable { vm.closeMembers() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close, contentDescription = "close",
                        tint = DcIcon, modifier = Modifier.size(18.dp),
                    )
                }
            }
            HorizontalDivider(color = DcBorder, thickness = 1.dp)
            LazyColumn {
                groups.forEach { (name, us) ->
                    item { MemberHeader("$name — ${us.size}") }
                    us.forEach { u -> item {
                        MemberRow(u, vm = vm, nameColor = roleColor(u)) } }
                }
                if (off.isNotEmpty()) {
                    item { MemberHeader("Offline — ${off.size}") }
                    off.forEach { u -> item { MemberRow(u, dim = true, vm = vm) } }
                }
            }
        }
    }
}

@Composable
private fun MemberHeader(label: String) {
    Text(
        label.uppercase(), color = DcMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
    )
}

@Composable
private fun MemberRow(u: JSONObject, dim: Boolean = false,
                      vm: AppViewModel? = null, nameColor: Color? = null) {
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .clickable { vm?.openProfile(u.optInt("id")) }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            val c = runCatching {
                Color(android.graphics.Color.parseColor(
                    u.optString("avatar_color", "#5865F2")))
            }.getOrDefault(DcBlurple)
            Box(
                Modifier.size(32.dp).clip(CircleShape).background(c),
                contentAlignment = Alignment.Center,
            ) {
                Text(u.optString("avatar_emoji", "🙂"), fontSize = 16.sp)
            }
            if (!dim)
                Box(
                    Modifier.align(Alignment.BottomEnd).size(12.dp)
                        .clip(CircleShape).background(DcSidebar).padding(2.dp)
                        .clip(CircleShape).background(DcGreen),
                )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f, fill = false)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    u.optString("nickname").ifBlank {
                        u.optString("display_name", u.optString("username")) },
                    color = if (dim) DcMuted else (nameColor ?: DcText),
                    fontSize = 13.5.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                val uname = u.optString("username")
                val isAgent = uname.startsWith("agent:") || u.optBoolean("is_agent")
                val isBot = u.optBoolean("bot") || u.optInt("bot") == 1
                if (isAgent) {
                    Spacer(Modifier.width(5.dp))
                    Box(
                        Modifier.clip(RoundedCornerShape(3.dp))
                            .background(DcHoney.copy(alpha = 0.18f))
                            .border(1.dp, DcHoney.copy(alpha = 0.4f), RoundedCornerShape(3.dp))
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
                } else if (isBot) {
                    Spacer(Modifier.width(5.dp))
                    Box(
                        Modifier.clip(RoundedCornerShape(3.dp))
                            .background(DcAccent.copy(alpha = 0.2f))
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                    ) {
                        Text(
                            "BOT",
                            color = DcAccent,
                            fontSize = 8.5.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.4.sp,
                        )
                    }
                }
            }
            val st = u.optString("status_text")
            if (st.isNotBlank())
                Text(st, color = DcMuted, fontSize = 11.sp, maxLines = 1,
                     overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

/* =========================== attachments ================================ */

@Composable
private fun AttachmentsRow(m: JSONObject, vm: AppViewModel) {
    val atts = m.optJSONArray("attachments") ?: return
    if (atts.length() == 0) return
    Column(Modifier.padding(top = 4.dp),
           verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (i in 0 until atts.length()) {
            val a = atts.optJSONObject(i) ?: continue
            val id = a.optString("id")
            val mime = a.optString("mime", "")
            val name = a.optString("name", "file")
            if (mime.startsWith("image/")) {
                AsyncImage(
                    model = vm.fileUrl(id),
                    contentDescription = name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth()
                        .height(200.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(DcSidebar),
                )
            } else {
                Row(
                    Modifier.clip(RoundedCornerShape(8.dp))
                        .background(DcSidebar)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.InsertDriveFile,
                         contentDescription = null, tint = DcIcon,
                         modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(name, color = DcText, fontSize = 12.sp,
                             maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val kb = a.optInt("size") / 1024
                        if (kb > 0)
                            Text("${kb} KB", color = DcMuted, fontSize = 10.sp)
                    }
                }
            }
        }
    }
}

/* ========================= @ mention autocomplete ======================= */

/** Trailing @query being typed — "@jo" at end of draft returns "jo".
 *  Backend parses @(\w+) so the query is \w only. */
private fun mentionQuery(draft: String): String? {
    val m = Regex("""@(\w*)$""").find(draft) ?: return null
    val start = draft.length - m.value.length
    if (start > 0 && draft[start - 1] != ' ') return null
    return m.groupValues[1]
}

/** Slug-concatenated mention token — "@(\w+)" can't span spaces, so
 *  multi-word agent/role names must be typed joined ("ModTeam"). */
private fun mentionToken(name: String) =
    name.replace(Regex("""[^A-Za-z0-9_]+"""), "")

private data class MCand(
    val insert: String,        // text after @
    val label: String,
    val sub: String,           // @username / tagline / "role"
    val emoji: String,
    val color: String,
    val status: String = "",
    val tag: String = "",      // AGENT / ROLE badge
    val sec: String,           // section: MEMBERS / AGENTS / ROLES
)

private fun mentionCands(q: String, state: UiState): List<MCand> {
    val ql = q.lowercase()
    fun matches(vararg names: String) = ql.isEmpty() ||
        names.any { it.lowercase().startsWith(ql) } ||
        names.any { it.lowercase().contains(ql) }
    fun rankOf(vararg names: String) = when {
        ql.isEmpty() -> 0
        names.any { it.lowercase().startsWith(ql) } -> 0
        else -> 1
    }
    val out = mutableListOf<Pair<Int, MCand>>()
    // members of the open chat (server members or DM participants)
    val seen = mutableSetOf<String>()
    val members = (0 until state.chatMembers.length())
        .mapNotNull { state.chatMembers.optJSONObject(it) }
        .sortedByDescending { it.optString("status") == "online" }
    for (u in members) {
        val un = u.optString("username")
        val dn = u.optString("display_name", un)
        if (un.isBlank() || !seen.add(un)) continue
        if (un.equals(state.meUsername, ignoreCase = true)) continue
        if (!matches(un, dn)) continue
        out += rankOf(un, dn) to MCand(
            un, dn, "@$un",
            u.optString("avatar_emoji", "🙂"),
            u.optString("avatar_color", "#4DA3FF"),
            u.optString("status"), "", "MEMBERS")
    }
    // agents — @summons them (backend slug-matches leftover @tokens)
    for (a in state.agents) {
        val tok = mentionToken(a.name)
        if (tok.isBlank() || !matches(a.name, tok)) continue
        out += rankOf(a.name, tok) to MCand(
            tok, a.name, a.tagline.ifBlank { "agent" },
            a.icon.ifBlank { "✦" }, "#E8B54A", "", "AGENT", "AGENTS")
    }
    // server roles — @role pings every holder
    for (i in 0 until state.roles.length()) {
        val r = state.roles.optJSONObject(i) ?: continue
        val rn = r.optString("name")
        val tok = mentionToken(rn)
        if (rn.isBlank() || tok.isBlank() || !matches(rn, tok)) continue
        out += rankOf(rn, tok) to MCand(
            tok, rn, "role", "◆",
            r.optString("color").ifBlank { "#8B949E" }, "", "ROLE", "ROLES")
    }
    if (matches("everyone")) out += 0 to MCand(
        "everyone", "@everyone", "notify the whole channel", "📢",
        "#D29922", "", "", "EVERYONE")
    if (matches("here")) out += 0 to MCand(
        "here", "@here", "notify online members", "📣",
        "#D29922", "", "", "EVERYONE")
    return out.sortedBy { it.first }.map { it.second }
}

@Composable
private fun MentionPopup(q: String, state: UiState,
                         onPick: (String) -> Unit) {
    val cands = mentionCands(q, state)
    if (cands.isEmpty()) return
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp)).background(DcSidebar)
            .border(1.dp, DcBorder, RoundedCornerShape(10.dp)),
    ) {
        var lastSec = ""
        cands.take(8).forEach { c ->
            if (c.sec != lastSec) {
                lastSec = c.sec
                Text(c.sec, color = DcMuted, fontSize = 10.sp,
                     fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
                     modifier = Modifier.padding(
                         start = 12.dp, top = 8.dp, bottom = 2.dp))
            }
            Row(
                Modifier.fillMaxWidth()
                    .clickable { onPick(c.insert) }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    Box(
                        Modifier.size(26.dp).clip(CircleShape).background(
                            runCatching {
                                Color(android.graphics.Color.parseColor(c.color))
                            }.getOrDefault(DcAccent)),
                        contentAlignment = Alignment.Center,
                    ) { Text(c.emoji, fontSize = 13.sp) }
                    if (c.status.isNotEmpty())
                        Box(
                            Modifier.align(Alignment.BottomEnd).size(10.dp)
                                .clip(CircleShape).background(DcSidebar)
                                .padding(1.5.dp).clip(CircleShape)
                                .background(
                                    when (c.status) {
                                        "online" -> DcGreen
                                        "idle" -> DcWarn
                                        "dnd" -> DcRed
                                        else -> DcMuted }),
                        )
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(c.label, color = DcText, fontSize = 13.sp,
                             fontWeight = FontWeight.Medium, maxLines = 1,
                             overflow = TextOverflow.Ellipsis)
                        if (c.tag.isNotEmpty()) {
                            Spacer(Modifier.width(5.dp))
                            Box(
                                Modifier.clip(RoundedCornerShape(3.dp))
                                    .background(DcHoney.copy(alpha = 0.15f))
                                    .padding(horizontal = 3.dp, vertical = 0.dp),
                            ) {
                                Text(c.tag, color = DcHoney, fontSize = 8.sp,
                                     fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    Text(
                        if (c.sec == "MEMBERS") c.sub
                        else "@${c.insert} · ${c.sub}",
                        color = DcMuted, fontSize = 11.sp, maxLines = 1,
                        overflow = TextOverflow.Ellipsis)
                }
                if (c.status == "online")
                    Text("online", color = DcGreen, fontSize = 10.sp)
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

/* ======================= mention-rich message text ====================== */

/**
 * Renders message content with Discord-style mention pills and
 * markdown-lite (code, spoiler, bold, italic, underline, strike).
 * User mentions are tappable → profile card; spoilers reveal on tap.
 */
@Composable
private fun MentionText(content: String, state: UiState?,
                        meUsername: String, vm: AppViewModel,
                        modifier: Modifier = Modifier) {
    var revealed by remember(content) { mutableStateOf(setOf<Int>()) }
    val annotated = remember(content, state?.chatMembers, state?.roles,
                             state?.agents, meUsername, revealed) {
        buildMentionText(content, state, meUsername, revealed, vm) {
            revealed = if (it in revealed) revealed - it else revealed + it
        }
    }
    Text(annotated, color = DcText, fontSize = 14.sp, lineHeight = 19.sp,
         modifier = modifier)
}

private val MD_TOKEN = Regex(
    """`([^`]+)`|\|\|(.+?)\|\||\*\*([^*]+)\*\*|__([^_]+)__|""" +
    """~~([^~]+)~~|\*([^*]+)\*|@(\w+)""")

private fun buildMentionText(
    content: String, state: UiState?, meUsername: String,
    revealed: Set<Int>, vm: AppViewModel,
    onToggleSpoiler: (Int) -> Unit,
): AnnotatedString {
    // lookup maps for mention resolution
    val members = state?.chatMembers ?: JSONArray()
    val roles = state?.roles ?: JSONArray()
    val agents = state?.agents ?: emptyList()
    fun memberBy(uname: String): JSONObject? {
        for (i in 0 until members.length()) {
            val u = members.optJSONObject(i) ?: continue
            if (u.optString("username").equals(uname, true)) return u
        }
        return null
    }
    fun roleBy(token: String): JSONObject? {
        for (i in 0 until roles.length()) {
            val r = roles.optJSONObject(i) ?: continue
            if (mentionToken(r.optString("name")).equals(token, true)) return r
        }
        return null
    }
    fun agentBy(token: String) = agents.firstOrNull {
        mentionToken(it.name).equals(token, true) }

    val userPill = SpanStyle(color = DcAccent,
        background = DcAccent.copy(alpha = 0.22f),
        fontWeight = FontWeight.SemiBold)
    val mePill = SpanStyle(color = DcHoney,
        background = DcHoney.copy(alpha = 0.24f),
        fontWeight = FontWeight.SemiBold)
    val agentPill = SpanStyle(color = DcHoney,
        background = DcHoney.copy(alpha = 0.18f),
        fontWeight = FontWeight.Bold)
    val codeSpan = SpanStyle(
        color = Color(0xFFE6EDF3),
        background = Color(0xFF1E242C),
        fontFamily = FontFamily.Monospace,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.Medium,
    )

    return androidx.compose.ui.text.buildAnnotatedString {
        var pos = 0
        var spoilerIdx = 0
        for (m in MD_TOKEN.findAll(content)) {
            if (m.range.first > pos) append(content.substring(pos, m.range.first))
            pos = m.range.last + 1
            val g = m.groups
            when {
                g[1] != null -> withStyle(codeSpan) { append(g[1]!!.value) }
                g[2] != null -> {   // ||spoiler|| — tap to reveal
                    val idx = spoilerIdx++
                    pushLink(LinkAnnotation.Clickable(tag = "s:$idx",
                        linkInteractionListener = {
                            onToggleSpoiler(idx); Unit }))
                    if (idx in revealed)
                        withStyle(SpanStyle(background = DcHover)) {
                            append(g[2]!!.value) }
                    else
                        withStyle(SpanStyle(color = Color.Transparent,
                            background = DcHover)) { append(g[2]!!.value) }
                    pop()
                }
                g[3] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                    append(g[3]!!.value) }
                g[4] != null -> withStyle(SpanStyle(
                    textDecoration = TextDecoration.Underline)) {
                    append(g[4]!!.value) }
                g[5] != null -> withStyle(SpanStyle(
                    textDecoration = TextDecoration.LineThrough)) {
                    append(g[5]!!.value) }
                g[6] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(g[6]!!.value) }
                g[7] != null -> {
                    val tok = g[7]!!.value
                    val u = memberBy(tok)
                    val role = if (u == null) roleBy(tok) else null
                    val agent = if (u == null && role == null) agentBy(tok)
                                else null
                    when {
                        tok.equals("everyone", true) ||
                            tok.equals("here", true) ||
                            tok.equals(meUsername, true) ->
                            withStyle(mePill) { append("@$tok") }
                        u != null -> {
                            pushLink(LinkAnnotation.Clickable(
                                tag = "u:${u.optInt("id")}",
                                linkInteractionListener = {
                                    vm.openProfile(u.optInt("id")); Unit }))
                            withStyle(userPill) {
                                append("@" +
                                    u.optString("display_name", tok)) }
                            pop()
                        }
                        role != null -> {
                            val rc = runCatching {
                                Color(android.graphics.Color.parseColor(
                                    role.optString("color"))) }
                                .getOrDefault(DcAccent)
                            withStyle(SpanStyle(color = rc,
                                background = rc.copy(alpha = 0.2f),
                                fontWeight = FontWeight.SemiBold)) {
                                append("@${role.optString("name")}") }
                        }
                        agent != null -> {
                            pushLink(LinkAnnotation.Clickable(
                                tag = "a:${agent.id}",
                                linkInteractionListener = {
                                    vm.openAgent(agent); Unit }))
                            withStyle(agentPill) {
                                append("@${agent.name}") }
                            pop()
                        }
                        else -> withStyle(userPill) { append("@$tok") }
                    }
                }
                else -> append(m.value)
            }
        }
        if (pos < content.length) append(content.substring(pos))
    }
}

/* ============================ / commands ================================ */

private data class SlashCmd(
    val name: String, val desc: String,
    val run: (String) -> String,
)

private fun tailArg(s: String) =
    s.substringAfter(' ').let { if (it == s) "" else it }

private val SLASH_CMDS = listOf(
    SlashCmd("poll", "question | option | option | …") { s ->
        "/poll ${tailArg(s)}" },
    SlashCmd("shrug", "appends shrug kaomoji") { s ->
        (tailArg(s) + " ¯\\_(ツ)_/¯").trim() },
    SlashCmd("tableflip", "flip the table") { s ->
        (tailArg(s) + " (╯°□°)╯︵ ┻━┻").trim() },
    SlashCmd("unflip", "put the table back") { s ->
        (tailArg(s) + " ┬─┬ノ( º _ ºノ)").trim() },
    SlashCmd("spoiler", "mark text as ||spoiler||") { s ->
        "||${tailArg(s)}||" },
    SlashCmd("code", "wrap text in a code block") { s ->
        "```\n${tailArg(s)}\n```" },
    SlashCmd("me", "italic action text") { s -> "*${tailArg(s)}*" },
)

@Composable
private fun SlashPopup(q: String, state: UiState,
                       onPick: (String) -> Unit) {
    val typed = q.removePrefix("/")
    data class Row(val icon: String, val name: String, val desc: String,
                   val insert: String)
    val rows = mutableListOf<Row>()
    SLASH_CMDS.forEach { c ->
        if (c.name.startsWith(typed))
            rows += Row("⌘", "/${c.name}", c.desc, c.run(q))
    }
    state.agents.forEach { a ->
        val slug = a.name.lowercase().replace(Regex("[^a-z0-9]+"), "")
        if (slug.startsWith(typed.lowercase()) && slug.isNotBlank())
            rows += Row(a.icon.ifBlank { "✦" }, "/$slug",
                        "summon ${a.name}", "@${a.name} ")
    }
    if (rows.isEmpty()) return
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp)).background(DcSidebar),
    ) {
        rows.take(6).forEach { r ->
            Row(
                Modifier.fillMaxWidth()
                    .clickable { onPick(r.insert) }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(26.dp).clip(RoundedCornerShape(6.dp))
                        .background(DcHover),
                    contentAlignment = Alignment.Center,
                ) { Text(r.icon, fontSize = 13.sp) }
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(r.name, color = DcText, fontSize = 13.sp,
                         fontWeight = FontWeight.Medium)
                    Text(r.desc, color = DcMuted, fontSize = 11.sp,
                         maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/* ============================ profile card ============================== */

@Composable
private fun ProfileCard(p: JSONObject, state: UiState, vm: AppViewModel) {
    val u = p.optJSONObject("user") ?: return
    val uid = u.optInt("id")
    val isSelf = u.optString("username") == state.meUsername
    Box(
        Modifier.fillMaxSize()
            .background(Color.Black.copy(alpha = 0.6f))
            .clickable { vm.closeProfile() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 28.dp)
                .clip(RoundedCornerShape(16.dp)).background(DcSidebar)
                .clickable(enabled = false) {},
        ) {
            Box(
                Modifier.fillMaxWidth().height(60.dp)
                    .background(runCatching {
                        Color(android.graphics.Color.parseColor(
                            u.optString("banner_color",
                                u.optString("avatar_color", "#5865F2"))))
                    }.getOrDefault(DcBlurple)),
            )
            Row(Modifier.padding(start = 14.dp)) {
                Box(
                    Modifier.size(72.dp)
                        .offset(y = (-30).dp)
                        .clip(CircleShape).background(DcSidebar).padding(5.dp)
                        .clip(CircleShape)
                        .background(runCatching {
                            Color(android.graphics.Color.parseColor(
                                u.optString("avatar_color", "#5865F2")))
                        }.getOrDefault(DcBlurple)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(u.optString("avatar_emoji", "🙂"), fontSize = 34.sp)
                }
            }
            Column(Modifier.padding(horizontal = 14.dp)
                    .offset(y = (-18).dp)) {
                Text(
                    u.optString("display_name", u.optString("username")),
                    color = DcText, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("@${u.optString("username")}", color = DcSub,
                         fontSize = 13.sp)
                    u.optString("pronouns").takeIf { it.isNotBlank() }?.let {
                        Text(" · $it", color = DcMuted, fontSize = 12.sp)
                    }
                    val uname = u.optString("username")
                    val isAgent = uname.startsWith("agent:")
                    if (p.optBoolean("is_bot") || isAgent) {
                        Spacer(Modifier.width(6.dp))
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(3.dp))
                                .background(if (isAgent) DcHoney.copy(alpha = 0.2f) else DcAccent.copy(alpha = 0.2f))
                                .border(1.dp, if (isAgent) DcHoney.copy(alpha = 0.35f) else DcAccent.copy(alpha = 0.35f), RoundedCornerShape(3.dp))
                                .padding(horizontal = 4.dp, vertical = 1.dp),
                        ) {
                            Text(
                                if (isAgent) "✦ AGENT" else "BOT",
                                color = if (isAgent) DcHoney else DcAccent,
                                fontSize = 8.5.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.4.sp,
                            )
                        }
                    }
                }
                val st = u.optString("status_text")
                if (st.isNotBlank())
                    Text(st, color = DcSub, fontSize = 12.sp,
                         modifier = Modifier.padding(top = 2.dp))
                val bio = u.optString("bio")
                if (bio.isNotBlank())
                    Text(bio, color = DcText, fontSize = 13.sp,
                         modifier = Modifier.padding(top = 10.dp))
                val mutual = p.optJSONArray("mutual_servers")
                if (mutual != null && mutual.length() > 0) {
                    Text(
                        "MUTUAL SERVERS", color = DcMuted, fontSize = 10.sp,
                        fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Row(Modifier.padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (i in 0 until mutual.length().coerceAtMost(4)) {
                            val s = mutual.optJSONObject(i) ?: continue
                            Text(
                                "${s.optString("icon")} ${s.optString("name")}",
                                color = DcSub, fontSize = 11.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(DcHover)
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    }
                }
                if (!isSelf) {
                    Box(
                        Modifier.fillMaxWidth().padding(top = 14.dp)
                            .clip(RoundedCornerShape(8.dp)).background(DcAccent)
                            .clickable { vm.messageUser(uid) }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Send Message", color = Color.White,
                             fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Spacer(Modifier.height(14.dp))
            }
        }
    }
}

/* ============================== pins ==================================== */

@Composable
private fun PinsPanel(state: UiState, vm: AppViewModel) {
    Box(
        Modifier.fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable { vm.togglePins() },
    ) {
        Column(
            Modifier.align(Alignment.CenterEnd)
                .fillMaxHeight().width(280.dp)
                .background(DcSidebar)
                .border(1.dp, DcBorder)
                .clickable(enabled = false) {}
                .padding(top = 10.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.PushPin,
                        contentDescription = null,
                        tint = DcHoney,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "PINNED MESSAGES",
                        color = DcText,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp,
                    )
                }
                Box(
                    Modifier.size(32.dp).clip(CircleShape)
                        .clickable { vm.togglePins() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "close",
                        tint = DcIcon,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            HorizontalDivider(color = DcBorder, thickness = 1.dp)
            if (state.pins.length() == 0)
                Text(
                    "No pinned messages yet.\nLong-press a message → Pin Message.",
                    color = DcMuted, fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                )
            LazyColumn {
                items(state.pins.length()) { i ->
                    val m = state.pins.optJSONObject(i) ?: return@items
                    MessageRow(m, grouped = false,
                               meUsername = state.meUsername, vm = vm,
                               state = state)
                }
            }
        }
    }
}

