package dev.agenthive.phone.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// SignalTeams / AgentHive Desktop Dark Palette (reverse-engineered from frontend/src/styles.css)
val DcRail = Color(0xFF0A0D12)        // --bg2: server rail (deepest slate)
val DcSidebar = Color(0xFF161B22)     // --panel: sidebar & channel list
val DcChat = Color(0xFF0D1117)        // --bg: main chat background
val DcInput = Color(0xFF161B22)       // inputs / composer background
val DcBar = Color(0xFF1C2129)         // --panel2: user footer bar / headers
val DcBorder = Color(0xFF2D333B)      // --border / line
val DcText = Color(0xFFE6EDF3)        // --fg / text: primary crisp text
val DcSub = Color(0xFF8B949E)         // --dim: secondary text
val DcIcon = Color(0xFFA2ABB5)        // icon tint
val DcMuted = Color(0xFF6E7681)       // placeholder & muted labels
val DcAccent = Color(0xFF4DA3FF)      // --accent: crisp electric blue
val DcBlurple = Color(0xFF4DA3FF)     // mapped to desktop accent blue
val DcHoney = Color(0xFFE8B54A)       // --honey: SignalTeams signature warm gold
val DcGreen = Color(0xFF3FB950)       // --good: online green
val DcRed = Color(0xFFF85149)         // --bad: danger / mentions red
val DcWarn = Color(0xFFD29922)        // --warn / idle amber
val DcHover = Color(0x14FFFFFF)       // --hover
val DcSelected = Color(0x331F6FEB)     // --sel2: selected background

private val Scheme = darkColorScheme(
    primary = DcAccent,
    onPrimary = Color.White,
    background = DcChat,
    onBackground = DcText,
    surface = DcSidebar,
    onSurface = DcText,
    surfaceVariant = DcInput,
    onSurfaceVariant = DcSub,
    outline = DcBorder,
)

@Composable
fun PhoneTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
