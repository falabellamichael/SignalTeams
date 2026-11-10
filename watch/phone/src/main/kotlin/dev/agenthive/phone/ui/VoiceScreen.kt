package dev.agenthive.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PhoneDisabled
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState
import org.json.JSONObject

/** Full-screen Discord voice panel — grid of participants + control bar. */
@Composable
fun VoiceScreen(state: UiState, vm: AppViewModel) {
    Column(Modifier.fillMaxSize().background(DcChat)) {
        Row(
            Modifier.fillMaxWidth()
                .padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable { vm.closeVoicePanel() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.ExpandMore, contentDescription = "minimize",
                     tint = DcIcon, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Text("Voice Connected", color = DcGreen, fontSize = 11.sp,
                     fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
                Text("🔊 ${state.voiceName}", color = DcText,
                     fontSize = 16.sp, fontWeight = FontWeight.Bold,
                     maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 96.dp),
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(state.voiceRoster.length()) { i ->
                val u = state.voiceRoster.optJSONObject(i) ?: return@items
                VoiceTile(u)
            }
        }
        // Discord's control bar — mute / deafen / speaker / disconnect
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
                .background(DcSidebar)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            VoiceBtn(
                if (state.voiceMuted) Icons.Filled.MicOff else Icons.Filled.Mic,
                if (state.voiceMuted) "Unmute" else "Mute",
                active = state.voiceMuted,
            ) { vm.toggleMute() }
            VoiceBtn(
                if (state.voiceDeafened) Icons.Filled.HeadsetOff
                else Icons.Filled.Headset,
                if (state.voiceDeafened) "Undeafen" else "Deafen",
                active = state.voiceDeafened,
            ) { vm.toggleDeafen() }
            VoiceBtn(Icons.AutoMirrored.Filled.VolumeUp, "Speaker",
                active = state.voiceSpeaker) { vm.toggleSpeaker() }
            VoiceBtn(Icons.Filled.PhoneDisabled, "Disconnect",
                active = false, danger = true) { vm.leaveVoice() }
        }
    }
}

@Composable
private fun VoiceTile(u: JSONObject) {
    val muted = u.optBoolean("muted")
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            val c = runCatching {
                Color(android.graphics.Color.parseColor(
                    u.optString("avatar_color", "#5865F2")))
            }.getOrDefault(DcBlurple)
            Box(
                Modifier.size(72.dp).clip(CircleShape)
                    .background(if (!muted) DcGreen else Color.Transparent)
                    .padding(3.dp)
                    .clip(CircleShape).background(c),
                contentAlignment = Alignment.Center,
            ) {
                Text(u.optString("avatar_emoji", "🙂"), fontSize = 32.sp)
            }
            if (muted)
                Box(
                    Modifier.align(Alignment.BottomEnd).size(22.dp)
                        .clip(CircleShape).background(DcChat).padding(2.dp)
                        .clip(CircleShape).background(DcRed),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.MicOff, contentDescription = "muted",
                         tint = Color.White, modifier = Modifier.size(11.dp))
                }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            u.optString("display_name", u.optString("username", "?")),
            color = DcText, fontSize = 12.sp, maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun VoiceBtn(icon: androidx.compose.ui.graphics.vector.ImageVector,
                     label: String, active: Boolean, danger: Boolean = false,
                     onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(52.dp).clip(CircleShape)
                .background(
                    when {
                        danger -> DcRed
                        active -> Color.White
                        else -> DcHover
                    })
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon, contentDescription = label,
                tint = when {
                    danger || active -> DcChat
                    else -> DcIcon
                },
                modifier = Modifier.size(24.dp),
            )
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = if (danger) DcRed else DcSub, fontSize = 10.sp)
    }
}

/** Mini voice bar — "Connected · #chan" strip above the user bar. */
@Composable
fun VoiceMiniBar(state: UiState, vm: AppViewModel) {
    if (state.voiceCid <= 0) return
    Row(
        Modifier.fillMaxWidth()
            .background(DcSidebar)
            .clickable { vm.openVoice() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(DcGreen))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text("Voice Connected", color = DcGreen, fontSize = 10.sp,
                 fontWeight = FontWeight.Bold)
            Text("🔊 ${state.voiceName}", color = DcSub, fontSize = 11.sp,
                 maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .clickable { vm.leaveVoice() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.PhoneDisabled, contentDescription = "disconnect",
                 tint = DcRed, modifier = Modifier.size(18.dp))
        }
    }
}
