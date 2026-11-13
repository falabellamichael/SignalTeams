package dev.agenthive.phone.ui

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PhoneDisabled
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState
import dev.agenthive.phone.VoiceFeed
import org.json.JSONObject

/** Full-screen Discord voice panel — grid of participants + control bar. */
@Composable
fun VoiceScreen(state: UiState, vm: AppViewModel) {
    val ctx = LocalContext.current
    val landscape = LocalConfiguration.current.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.toggleCamera()
    }
    val toggleCamera = {
        if (state.voiceCamera || androidx.core.content.ContextCompat.checkSelfPermission(ctx,
                android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) vm.toggleCamera()
        else cameraPermission.launch(android.Manifest.permission.CAMERA)
    }
    val shareLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK)
            r.data?.let { vm.screenShareGranted(it) }
    }
    // others' screens first, then my screen, then cameras
    val stage = state.voiceFeeds.values.sortedWith(
        compareByDescending<VoiceFeed> { f ->
            (if (f.kind == "screen") 2 else 0) +
            (if (f.uid != state.meId) 1 else 0)
        })
    var selectedTrack by remember { mutableStateOf<String?>(null) }
    // Receiving/publishing a track does not opt the user into viewing it.
    val primary = stage.firstOrNull { it.trackId == selectedTrack }
    var expanded by remember { mutableStateOf(false) }
    val isExpanded = expanded && primary != null
    BackHandler(enabled = isExpanded) { expanded = false }
    Column(Modifier.fillMaxSize().background(DcChat)) {
        PageTopBar(
            navIcon = Icons.Filled.ExpandMore, navDesc = "minimize",
            navIconSize = 24.dp,
            onNav = { vm.closeVoicePanel() },
            title = {
                Column(Modifier.weight(1f)) {
                    Text("Voice Connected", color = DcGreen, fontSize = 11.sp,
                         fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
                    Text("🔊 ${state.voiceName}", color = DcText,
                         fontSize = 16.sp, fontWeight = FontWeight.Bold,
                         maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
        )
        if (primary != null)
            VideoStage(
                feed = primary, count = stage.size, meId = state.meId,
                roster = state.voiceRoster,
                onFlip = {
                    val next = (stage.indexOfFirst { it.trackId == selectedTrack } + 1) % stage.size
                    selectedTrack = stage[next].trackId
                },
                expanded = isExpanded,
                onExpand = { expanded = !expanded },
                modifier = if (isExpanded) Modifier.weight(1f)
                    else if (landscape) Modifier.height((LocalConfiguration.current.screenHeightDp * .35f).dp)
                    else Modifier,
                constrainedHeight = landscape,
            )
        if (!isExpanded) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 96.dp),
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(state.voiceRoster.length()) { i ->
                val u = state.voiceRoster.optJSONObject(i) ?: return@items
                val uid = u.optInt("id")
                val own = uid == state.meId
                val feeds = stage.filter { it.uid == uid }
                Box {
                    var menu by remember { mutableStateOf(false) }
                    VoiceTile(u, muted = if (own) state.voiceMuted else u.optBoolean("muted"),
                        sharing = (own && state.voiceSharing) || u.optBoolean("sharing") || feeds.any { it.kind == "screen" },
                        camera = (own && state.voiceCamera) || u.optBoolean("cam") || feeds.any { it.kind == "cam" },
                        onClick = { menu = true })
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        listOf("screen" to "View screen share", "cam" to "View camera").forEach { (kind, label) ->
                            val feed = feeds.firstOrNull { it.kind == kind }
                            val viewing = feed != null && selectedTrack == feed.trackId
                            DropdownMenuItem(text = { Text(if (viewing) label.replace("View", "Hide") else label) }, enabled = feed != null,
                                onClick = {
                                    selectedTrack = if (viewing) null else feed?.trackId
                                    expanded = false
                                    menu = false
                                })
                        }
                        if (own) {
                            DropdownMenuItem(text = { Text(if (state.voiceMuted) "Unmute microphone" else "Mute microphone") },
                                onClick = { vm.toggleMute(); menu = false })
                            DropdownMenuItem(text = { Text(if (state.voiceCamera) "Turn camera off" else "Turn camera on") },
                                onClick = { toggleCamera(); menu = false })
                            if (state.voiceSharing) DropdownMenuItem(text = { Text("Stop screen share") },
                                onClick = { vm.stopScreenShare(); menu = false })
                        }
                    }
                }
            }
        }
        }
        // Discord's control bar — mute / deafen / speaker / share / disconnect
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
                .background(DcSidebar)
                 .padding(horizontal = 6.dp, vertical = 16.dp),
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
            VoiceBtn(if (state.voiceCamera) Icons.Filled.Videocam else Icons.Filled.VideocamOff,
                "Camera", active = state.voiceCamera, onClick = toggleCamera)
            VoiceBtn(
                Icons.Filled.ScreenShare,
                if (state.voiceSharing) "Stop share" else "Share",
                active = state.voiceSharing,
            ) {
                if (state.voiceSharing) vm.stopScreenShare()
                else {
                    val mpm = ctx
                        .getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                        as MediaProjectionManager
                    shareLauncher.launch(mpm.createScreenCaptureIntent())
                }
            }
            VoiceBtn(Icons.Filled.PhoneDisabled, "Disconnect",
                active = false, danger = true) { vm.leaveVoice() }
        }
    }
}

/** Live video feed above the participant grid — flip cycles the feeds. */
@Composable
private fun VideoStage(feed: VoiceFeed, count: Int, meId: Int,
                       roster: org.json.JSONArray, onFlip: () -> Unit,
                       expanded: Boolean, onExpand: () -> Unit,
                       constrainedHeight: Boolean,
                       modifier: Modifier = Modifier) {
    val ru = (0 until roster.length()).map { roster.optJSONObject(it) }
        .firstOrNull { it?.optInt("id") == feed.uid }
    val name = if (feed.uid == meId) "you"
        else ru?.optString("display_name", ru.optString("username", "Video"))
    Box(
        modifier.fillMaxWidth().then(if (expanded || constrainedHeight) Modifier else Modifier.aspectRatio(16f / 9f))
            .background(Color.Black)
    ) {
        key(feed.trackId) {
            AndroidView(
                factory = {
                    (feed.view.parent as? android.view.ViewGroup)?.removeView(feed.view)
                    feed.view
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (feed.kind == "screen")
            Text("LIVE", color = Color.White, fontSize = 9.sp,
                 fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp,
                 modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
                     .clip(RoundedCornerShape(4.dp)).background(DcRed)
                     .padding(horizontal = 6.dp, vertical = 2.dp))
        Row(Modifier.align(Alignment.TopEnd).padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (count > 1)
            Box(
                Modifier.size(44.dp)
                    .clip(CircleShape).background(Color(0xA5000000))
                    .clickable(onClick = onFlip),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.SwapHoriz, "flip feed", tint = Color.White,
                     modifier = Modifier.size(16.dp))
            }
        Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0xA5000000))
            .clickable(onClick = onExpand), contentAlignment = Alignment.Center) {
            Icon(if (expanded) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                if (expanded) "Collapse shared video" else "Expand shared video",
                tint = Color.White, modifier = Modifier.size(24.dp))
        }
        }
        Text(
            "$name · ${if (feed.kind == "screen") "Screen" else "Cam"}",
            color = Color.White, fontSize = 11.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp)
                .clip(RoundedCornerShape(4.dp)).background(Color(0xA5000000))
                .padding(horizontal = 7.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun VoiceTile(u: JSONObject, muted: Boolean, sharing: Boolean, camera: Boolean, onClick: () -> Unit) {
    Column(Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
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
        Row(Modifier.padding(top = 5.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(if (muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                if (muted) "Microphone muted" else "Microphone active",
                tint = if (muted) DcRed else DcGreen, modifier = Modifier.size(16.dp))
            if (sharing) Icon(Icons.Filled.ScreenShare, "Screen sharing active", tint = DcAccent, modifier = Modifier.size(16.dp))
            if (camera) Icon(Icons.Filled.Videocam, "Camera active", tint = DcAccent, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun VoiceBtn(icon: androidx.compose.ui.graphics.vector.ImageVector,
                     label: String, active: Boolean, danger: Boolean = false,
                     onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(44.dp).clip(CircleShape)
                .background(
                    when {
                        danger -> DcRed
                        active -> DcAccent
                        else -> DcHover
                    })
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon, contentDescription = label,
                tint = when {
                    danger -> Color.White
                    active -> DcOnAccent
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
