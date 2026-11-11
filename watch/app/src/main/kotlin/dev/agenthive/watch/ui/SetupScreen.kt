package dev.agenthive.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.Text
import dev.agenthive.watch.Phase
import dev.agenthive.watch.UiState

@Composable
fun SetupScreen(
    state: UiState,
    modifier: Modifier = Modifier,
    onCode: (String) -> Unit,
    onLinkCode: (String) -> Unit,
    onScanHives: () -> Unit = {},
    onPickHive: (dev.agenthive.watch.MeshLinker.MeshHive) -> Unit = {},
) {
    val busy = state.phase != Phase.SETUP
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    listOf(HiveColors.BgGlow, HiveColors.Bg),
                )
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            GeminiOrb(size = 38.dp, active = busy, animate = !state.ambient)
            Spacer(Modifier.height(4.dp))
            Text(
                "Hive Watch",
                color = HiveColors.Text,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Nexus Mesh · AI",
                color = HiveColors.Cyan,
                fontSize = 9.sp,
                fontWeight = FontWeight.Medium,
            )

            Spacer(Modifier.height(8.dp))

            if (busy) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                Spacer(Modifier.height(6.dp))
                Text(
                    state.statusLine.ifBlank { "Linking mesh…" },
                    color = HiveColors.Text,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                )
                state.log.takeLast(3).forEach { line ->
                    Text(
                        line,
                        color = HiveColors.Dim,
                        fontSize = 9.sp,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                    )
                }
            } else {
                // Mesh-only badge when the watch already stands on the mesh
                if (state.unlinked) {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(HiveColors.Panel)
                            .border(1.dp, HiveColors.MeshOn, CircleShape)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            "● mesh up — enter hive code",
                            color = HiveColors.MeshOn,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }

                // The whole onboarding story: one invite code, nothing else.
                CodeField(
                    value = state.inviteCode,
                    onChange = onCode,
                )
                Text(
                    "from the hive's Mesh settings\n(Invite a device → Pair a watch)",
                    color = HiveColors.Faint,
                    fontSize = 8.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 10.sp,
                )

                Spacer(Modifier.height(8.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.86f)
                        .clip(CircleShape)
                        .background(Brush.horizontalGradient(HiveColors.PillGradient))
                        .clickable { onLinkCode(state.inviteCode) }
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (state.inviteCode.isBlank()) "✦ Join Mesh" else "✦ Link to Hive",
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }

                if (state.unlinked) {
                    Spacer(Modifier.height(10.dp))
                    HivePicker(
                        hives = state.hives,
                        scanning = state.hiveScanning,
                        activeNodeId = state.meshSnap.hiveNodeId,
                        onScan = onScanHives,
                        onPick = onPickHive,
                    )
                }
            }

            if (state.error.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    state.error,
                    color = HiveColors.Error,
                    fontSize = 9.sp,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(Modifier.height(14.dp))
        }
    }
}

/** Mesh hive switcher — every group member answering the AgentHive probe is
 *  a tap-to-connect row. Bound hives get a "linked" chip (code-free hop),
 *  the active hive highlights, ↻ rescans. */
@Composable
fun HivePicker(
    hives: List<dev.agenthive.watch.MeshLinker.MeshHive>,
    scanning: Boolean,
    activeNodeId: String,
    onScan: () -> Unit,
    onPick: (dev.agenthive.watch.MeshLinker.MeshHive) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        androidx.compose.foundation.layout.Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "HIVES ON MESH",
                color = HiveColors.Faint,
                fontSize = 7.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.size(6.dp))
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .border(1.dp, HiveColors.Cyan, CircleShape)
                    .clickable(onClick = onScan)
                    .padding(horizontal = 6.dp, vertical = 1.dp),
            ) {
                Text(
                    if (scanning) "…" else "↻",
                    color = HiveColors.Cyan,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        if (scanning) {
            CircularProgressIndicator(modifier = Modifier.size(14.dp))
            Spacer(Modifier.height(4.dp))
        }
        hives.forEach { h ->
            val active = h.nodeId.isNotBlank() && h.nodeId == activeNodeId
            androidx.compose.foundation.layout.Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) HiveColors.PanelHi else HiveColors.Panel)
                    .border(
                        1.dp,
                        if (active) HiveColors.MeshOn else HiveColors.Border,
                        RoundedCornerShape(10.dp),
                    )
                    .clickable { onPick(h) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        h.name, color = HiveColors.Text, fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold, maxLines = 1,
                    )
                    Text(h.ip, color = HiveColors.Dim, fontSize = 8.sp, maxLines = 1)
                }
                if (h.bound) {
                    Text(
                        "linked", color = HiveColors.MeshOn,
                        fontSize = 7.sp, fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.size(4.dp))
                }
                if (active) Text("●", color = HiveColors.MeshOn, fontSize = 8.sp)
            }
            Spacer(Modifier.height(4.dp))
        }
        if (!scanning && hives.isEmpty()) {
            Text(
                "no hives found — tap ↻ to rescan",
                color = HiveColors.Faint, fontSize = 8.sp, textAlign = TextAlign.Center,
            )
        }
    }
}

/** Big centered code field — the whole watch onboarding in one input. */
@Composable
fun CodeField(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            "INVITE CODE",
            color = HiveColors.Faint,
            fontSize = 7.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 6.dp, bottom = 1.dp),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(HiveColors.Panel)
                .border(
                    1.dp,
                    if (value.isNotBlank()) HiveColors.Violet else HiveColors.Border,
                    RoundedCornerShape(12.dp),
                )
                .padding(horizontal = 10.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (value.isEmpty()) {
                Text("8-digit code", color = HiveColors.Faint, fontSize = 11.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(
                    color = HiveColors.Text,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    letterSpacing = 2.sp,
                ),
                cursorBrush = SolidColor(HiveColors.Cyan),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
