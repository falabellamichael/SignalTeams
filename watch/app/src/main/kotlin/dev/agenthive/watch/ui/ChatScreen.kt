package dev.agenthive.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.Text
import dev.agenthive.watch.Msg
import dev.agenthive.watch.UiState

private data class QuickPrompt(val icon: String, val label: String, val prompt: String)

private val QUICK_PROMPTS = listOf(
    QuickPrompt("✦", "Daily brief", "Give me a crisp 3-bullet executive focus brief for today."),
    QuickPrompt("⚡", "Quick idea", "Pitch one bold creative micro-feature for a team chat app."),
)

@Composable
fun ChatScreen(
    state: UiState,
    modifier: Modifier = Modifier,
    onInput: (String) -> Unit,
    onSend: (String) -> Unit,
    onMic: () -> Unit,
    onStop: () -> Unit = {},
    onPickAgent: (Int) -> Unit,
    onRefreshAgents: () -> Unit,
    onRelinkMesh: () -> Unit,
    onClearChat: () -> Unit,
    onDisconnect: () -> Unit,
    onCode: (String) -> Unit = {},
    onLinkCode: (String) -> Unit = {},
) {
    var showAgents by rememberSaveable { mutableStateOf(false) }
    var showMesh by rememberSaveable { mutableStateOf(false) }
    var showComposer by rememberSaveable { mutableStateOf(false) }
    val listState = rememberScalingLazyListState()
    val haptic = LocalHapticFeedback.current

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.text?.length) {
        if (state.messages.isNotEmpty()) {
            runCatching { listState.animateScrollToItem(0) }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(HiveColors.BgGlow, HiveColors.Bg),
                )
            ),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Bezel-safe top capsule inside the upper arc of the circular watch face
            TopArcPill(
                state = state,
                onAgentClick = { showAgents = true },
                onMeshClick = { showMesh = true },
            )

            // Main stage
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                if (state.messages.isEmpty()) {
                    GeminiHomeStage(
                        state = state,
                        onPrompt = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onSend(it)
                        },
                        onMeshClick = { showMesh = true },
                    )
                } else {
                    ScalingLazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        state = listState,
                        reverseLayout = true,
                        contentPadding = PaddingValues(
                            horizontal = 18.dp,
                            vertical = 8.dp,
                        ),
                    ) {
                        items(state.messages.asReversed()) { msg ->
                            MessageBubble(msg)
                        }
                    }
                }
            }

            // Bezel-safe bottom floating dock tucked inside the lower arc
            BottomArcDock(
                state = state,
                onOpenComposer = { showComposer = true },
                onMic = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onMic()
                },
                onStop = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onStop()
                },
                onSecondary = {
                    if (state.messages.isNotEmpty()) onClearChat() else showMesh = true
                },
            )
        }

        if (showComposer) {
            PromptComposerSheet(
                state = state,
                onInput = onInput,
                onSend = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    showComposer = false
                    onSend(it)
                },
                onClose = { showComposer = false },
            )
        }

        if (showAgents) {
            AgentPickerSheet(
                state = state,
                onPick = {
                    showAgents = false
                    onPickAgent(it)
                },
                onRefresh = onRefreshAgents,
                onClose = { showAgents = false },
            )
        }

        if (showMesh) {
            MeshConsoleSheet(
                state = state,
                onRelink = onRelinkMesh,
                onDisconnect = {
                    showMesh = false
                    onDisconnect()
                },
                onCode = onCode,
                onLinkCode = onLinkCode,
                onClose = { showMesh = false },
            )
        }
    }
}

@Composable
private fun TopArcPill(
    state: UiState,
    onAgentClick: () -> Unit,
    onMeshClick: () -> Unit,
) {
    val (dotColor, meshTag) = when (state.mesh) {
        "mesh" -> HiveColors.MeshOn to "MESH"
        "direct" -> HiveColors.MeshDirect to "DIRECT"
        "connecting" -> HiveColors.Cyan to "SYNC"
        else -> HiveColors.MeshOff to "OFF"
    }
    Row(
        modifier = Modifier
            .padding(top = 10.dp, bottom = 2.dp)
            .clip(CircleShape)
            .background(HiveColors.Panel.copy(alpha = 0.92f))
            .border(1.dp, HiveColors.Border, CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .clickable(onClick = onAgentClick)
                .padding(horizontal = 4.dp, vertical = 1.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                state.agent?.icon?.ifBlank { "✦" } ?: "✦",
                color = HiveColors.Violet,
                fontSize = 10.sp,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                state.agent?.name ?: "Agent",
                color = HiveColors.Text,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(" ▾", color = HiveColors.Dim, fontSize = 8.sp)
        }

        Box(
            Modifier
                .padding(horizontal = 5.dp)
                .width(1.dp)
                .height(10.dp)
                .background(HiveColors.Border)
        )

        Row(
            modifier = Modifier
                .clip(CircleShape)
                .clickable(onClick = onMeshClick)
                .padding(horizontal = 4.dp, vertical = 1.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(dotColor)
            )
            Spacer(Modifier.width(3.dp))
            Text(
                meshTag,
                color = dotColor,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun GeminiHomeStage(
    state: UiState,
    onPrompt: (String) -> Unit,
    onMeshClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        GeminiOrb(size = 42.dp, active = state.busy || state.listening || state.speaking)

        Spacer(Modifier.height(4.dp))

        val who = state.displayName.ifBlank { state.username }.ifBlank { "there" }
        Text(
            "Hi, $who",
            color = HiveColors.Text,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
        )

        val meshSub = when {
            state.unlinked && state.meshSnap.watchTunnelIp.isNotBlank() ->
                "mesh ${state.meshSnap.watchTunnelIp} · tap 🔗 to link a hive"
            state.mesh == "mesh" && state.meshSnap.watchTunnelIp.isNotBlank() ->
                "mesh ${state.meshSnap.watchTunnelIp} ⇄ ${state.meshSnap.hiveTunnelIp}"
            state.meshInfo.isNotBlank() -> state.meshInfo
            else -> "Ask ${state.agent?.name ?: "your agent"} anything"
        }
        Text(
            meshSub,
            color = if (state.mesh == "mesh") HiveColors.Cyan else HiveColors.Dim,
            fontSize = 8.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable(onClick = onMeshClick),
        )

        Spacer(Modifier.height(8.dp))

        // Sleek Gemini prompt pills nested in the widest chord of the watch
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        ) {
            for (item in QUICK_PROMPTS) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(HiveColors.Panel)
                        .border(1.dp, HiveColors.Border, RoundedCornerShape(14.dp))
                        .clickable(enabled = !state.busy) { onPrompt(item.prompt) }
                        .padding(horizontal = 8.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(item.icon, color = HiveColors.Violet, fontSize = 10.sp)
                    Spacer(Modifier.width(4.dp))
                    Text(
                        item.label,
                        color = HiveColors.Text,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: Msg) {
    if (msg.role == "user") {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 3.dp),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Box(
                modifier = Modifier
                    .widthIn(max = 175.dp)
                    .clip(RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(HiveColors.UserBubble, HiveColors.PanelHi)
                        )
                    )
                    .border(
                        1.dp,
                        HiveColors.UserBubbleEdge,
                        RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp),
                    )
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(
                    msg.text,
                    color = HiveColors.Text,
                    fontSize = 11.sp,
                    lineHeight = 14.sp,
                )
            }
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(HiveColors.Panel.copy(alpha = 0.88f))
                .border(1.dp, HiveColors.Border, RoundedCornerShape(14.dp))
                .padding(horizontal = 10.dp, vertical = 7.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("✦", color = HiveColors.Cyan, fontSize = 10.sp)
                Spacer(Modifier.width(4.dp))
                Text(
                    msg.meta.ifBlank { if (msg.pending) "streaming via mesh…" else "Gemini · Mesh" },
                    color = HiveColors.Dim,
                    fontSize = 8.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(3.dp))
            val body = when {
                msg.text.isEmpty() && msg.pending -> "Thinking…"
                msg.pending -> msg.text + " ▍"
                else -> msg.text
            }
            Text(
                body,
                color = HiveColors.Text,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )
        }
    }
}

@Composable
private fun BottomArcDock(
    state: UiState,
    onOpenComposer: () -> Unit,
    onMic: () -> Unit,
    onStop: () -> Unit,
    onSecondary: () -> Unit,
) {
    val stoppable = state.busy || state.speaking || state.listening
    Row(
        modifier = Modifier
            .padding(bottom = 10.dp, top = 2.dp)
            .clip(CircleShape)
            .background(HiveColors.Panel.copy(alpha = 0.95f))
            .border(1.dp, HiveColors.Border, CircleShape)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Keyboard / Type trigger
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(HiveColors.PanelHi)
                .clickable(enabled = !state.busy, onClick = onOpenComposer),
            contentAlignment = Alignment.Center,
        ) {
            Text("⌨", color = HiveColors.Text, fontSize = 12.sp)
        }

        // Primary luminous Gemini Ask / Voice pill — flips to Stop while
        // the assistant is listening, thinking, or speaking.
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .background(
                    Brush.horizontalGradient(
                        if (stoppable) listOf(HiveColors.Pink, HiveColors.Violet)
                        else HiveColors.PillGradient
                    )
                )
                .clickable(
                    onClick = {
                        when {
                            stoppable -> onStop()
                            state.input.isNotBlank() -> onOpenComposer()
                            else -> onMic()
                        }
                    },
                )
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.busy) {
                CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp)
                Spacer(Modifier.width(4.dp))
                Text("Stop", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            } else {
                Text(
                    if (stoppable) "■ Stop" else "✦ Ask",
                    color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }

        // Right button: clear chat (when in conversation) or open Mesh info
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(HiveColors.PanelHi)
                .clickable(onClick = onSecondary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (state.messages.isNotEmpty()) "↺" else "🔗",
                color = HiveColors.Cyan,
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun PromptComposerSheet(
    state: UiState,
    onInput: (String) -> Unit,
    onSend: (String) -> Unit,
    onClose: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HiveColors.Bg.copy(alpha = 0.97f))
            .padding(horizontal = 22.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Ask ${state.agent?.name ?: "Agent"}",
                color = HiveColors.Text,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(HiveColors.Panel)
                    .border(1.dp, HiveColors.Violet, RoundedCornerShape(14.dp))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (state.input.isEmpty()) {
                    Text("Type a prompt…", color = HiveColors.Faint, fontSize = 11.sp)
                }
                BasicTextField(
                    value = state.input,
                    onValueChange = onInput,
                    textStyle = TextStyle(color = HiveColors.Text, fontSize = 12.sp),
                    cursorBrush = SolidColor(HiveColors.Cyan),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(HiveColors.PanelHi)
                        .clickable(onClick = onClose)
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text("Cancel", color = HiveColors.Dim, fontSize = 10.sp)
                }
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Brush.horizontalGradient(HiveColors.PillGradient))
                        .clickable(enabled = state.input.isNotBlank()) { onSend(state.input) }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text("Send ➤", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun AgentPickerSheet(
    state: UiState,
    onPick: (Int) -> Unit,
    onRefresh: () -> Unit,
    onClose: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HiveColors.Bg.copy(alpha = 0.97f))
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Select Agent", color = HiveColors.Text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("↻", color = HiveColors.Cyan, fontSize = 13.sp, modifier = Modifier.clickable(onClick = onRefresh))
                Text("✕", color = HiveColors.Dim, fontSize = 12.sp, modifier = Modifier.clickable(onClick = onClose))
            }
            Spacer(Modifier.height(6.dp))
            state.agents.forEach { a ->
                val sel = a.id == state.agent?.id
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (sel) HiveColors.PanelHi else HiveColors.Panel)
                        .border(
                            1.dp,
                            if (sel) HiveColors.Violet else HiveColors.Border,
                            RoundedCornerShape(12.dp),
                        )
                        .clickable { onPick(a.id) }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(a.icon.ifBlank { "✦" }, fontSize = 13.sp)
                    Column(Modifier.padding(start = 8.dp).weight(1f)) {
                        Text(a.name, color = HiveColors.Text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        Text(
                            a.tagline.ifBlank { a.model }.ifBlank { "AI Agent" },
                            color = HiveColors.Dim,
                            fontSize = 8.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (sel) Text("●", color = HiveColors.Cyan, fontSize = 10.sp)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun MeshConsoleSheet(
    state: UiState,
    onRelink: () -> Unit,
    onDisconnect: () -> Unit,
    onCode: (String) -> Unit,
    onLinkCode: (String) -> Unit,
    onClose: () -> Unit,
) {
    val snap = state.meshSnap
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HiveColors.Bg.copy(alpha = 0.97f))
            .padding(horizontal = 22.dp, vertical = 14.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Nexus Mesh Link", color = HiveColors.Text, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(
                if (state.mesh == "mesh") "● BORINGTUN WIREGUARD UP" else "● ${state.mesh.uppercase()}",
                color = if (state.mesh == "mesh") HiveColors.MeshOn else HiveColors.MeshDirect,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))

            MeshRow("Watch IP", snap.watchTunnelIp.ifBlank { "—" })
            MeshRow("Hive Peer", if (snap.hiveTunnelIp.isNotBlank()) "${snap.hiveTunnelIp}:${snap.hiveVport}" else "—")
            MeshRow("Egress Bridge", if (snap.egressPort > 0) "127.0.0.1:${snap.egressPort}" else "direct")
            MeshRow("Seed Node", snap.seedServer.substringBefore("."))
            MeshRow("Node ID", snap.watchNodeId.take(12).ifBlank { "—" })
            if (snap.peerCount > 0) {
                MeshRow("Peers", "${snap.onlineCount}/${snap.peerCount} online")
            }

            if (state.unlinked) {
                // The whole point: link a hive with just a code — no URL, no password.
                Spacer(Modifier.height(8.dp))
                Text(
                    "LINK YOUR HIVE",
                    color = HiveColors.Faint,
                    fontSize = 7.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "8-digit code from the hive's\nMesh settings → Pair a watch",
                    color = HiveColors.Dim,
                    fontSize = 8.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 10.sp,
                )
                CodeField(value = state.inviteCode, onChange = onCode)
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Brush.horizontalGradient(HiveColors.PillGradient))
                        .clickable { onLinkCode(state.inviteCode) }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text("✦ Link", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                if (state.statusLine.isNotBlank()) {
                    Text(state.statusLine, color = HiveColors.Cyan, fontSize = 8.sp,
                        modifier = Modifier.padding(top = 4.dp))
                }
            }

            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(HiveColors.PanelHi)
                        .border(1.dp, HiveColors.Cyan, CircleShape)
                        .clickable(onClick = onRelink)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                ) {
                    Text("↻ Re-link", color = HiveColors.Cyan, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
                }
                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(HiveColors.PanelHi)
                        .clickable(onClick = onClose)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                ) {
                    Text("Done", color = HiveColors.Text, fontSize = 9.sp)
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "Sign out",
                color = HiveColors.Error,
                fontSize = 9.sp,
                modifier = Modifier
                    .clickable(onClick = onDisconnect)
                    .padding(4.dp),
            )
        }
    }
}

@Composable
private fun MeshRow(k: String, v: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 1.5.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(HiveColors.Panel)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(k, color = HiveColors.Dim, fontSize = 8.sp)
        Text(v, color = HiveColors.Text, fontSize = 9.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}
