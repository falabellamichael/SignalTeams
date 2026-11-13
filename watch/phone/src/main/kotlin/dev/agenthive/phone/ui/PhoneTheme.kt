package dev.agenthive.phone.ui

import android.content.Context
import android.app.Activity
import android.content.ContextWrapper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

data class PhonePalette(
    val id: String, val label: String,
    val chat: Color, val rail: Color, val sidebar: Color, val bar: Color,
    val border: Color, val text: Color, val sub: Color, val accent: Color,
    val honey: Color, val green: Color, val red: Color, val warn: Color,
    val light: Boolean = false,
    val icon: Color = sub, val muted: Color = sub,
) {
    val onAccent: Color get() = if (id == "obsidian") Color(0xFF0A0A0A) else Color.White
}

private fun c(hex: Long) = Color(0xFF000000 or hex)
val PhonePalettes = listOf(
    PhonePalette("dark", "Tokyo Night", c(0x0D1117), c(0x0A0D12), c(0x161B22), c(0x1C2129),
        c(0x2D333B), c(0xE6EDF3), c(0x8B949E), c(0x4DA3FF), c(0xD4AF37),
        c(0x3FB950), c(0xF85149), c(0xD29922)),
    PhonePalette("obsidian", "Obsidian", c(0x050505), c(0x000000), c(0x141414), c(0x1F1F1F),
        c(0x2E2E2E), c(0xF2F2F2), c(0x8C8C8C), c(0xD4D4D4), c(0xBDBDBD),
        c(0x4ADE80), c(0xF87171), c(0xEAB308)),
    PhonePalette("light", "Warm", c(0xFFFFFF), c(0xFAF7F0), c(0xF4EFE4), c(0xEFE9DA),
        c(0xE2DAC6), c(0x2B2722), c(0x8A7C67), c(0xA25927), c(0x96611A),
        c(0x23774C), c(0xB83A2C), c(0x96611A), light = true),
    PhonePalette("daylight", "Daylight", c(0xFFFFFF), c(0xF8FAFC), c(0xF1F5F9), c(0xE2E8F0),
        c(0xCBD5E1), c(0x0F172A), c(0x64748B), c(0x2563EB), c(0xD97706),
        c(0x16A34A), c(0xDC2626), c(0xD97706), light = true),
)

// Snapshot-backed getters also update existing screens that use Dc* colors directly.
object PhoneAppearance {
    var palette by mutableStateOf(PhonePalettes.first())
        private set
    private var loaded = false
    fun load(context: Context) {
        if (loaded) return
        val prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
        val id = prefs.getString("theme", "dark")
        palette = PhonePalettes.firstOrNull { it.id == id } ?: PhonePalettes.first()
        if (id != palette.id) prefs.edit().putString("theme", palette.id).apply()
        loaded = true
    }
    fun select(context: Context, theme: PhonePalette) {
        context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
            .edit().putString("theme", theme.id).apply()
        palette = theme
    }
}

val DcRail get() = PhoneAppearance.palette.rail
val DcSidebar get() = PhoneAppearance.palette.sidebar
val DcChat get() = PhoneAppearance.palette.chat
val DcInput get() = PhoneAppearance.palette.sidebar
val DcBar get() = PhoneAppearance.palette.bar
val DcBorder get() = PhoneAppearance.palette.border
val DcText get() = PhoneAppearance.palette.text
val DcSub get() = PhoneAppearance.palette.sub
val DcIcon get() = PhoneAppearance.palette.icon
val DcMuted get() = PhoneAppearance.palette.muted
val DcAccent get() = PhoneAppearance.palette.accent
val DcBlurple get() = DcAccent
val DcHoney get() = PhoneAppearance.palette.honey
val DcGreen get() = PhoneAppearance.palette.green
val DcRed get() = PhoneAppearance.palette.red
val DcWarn get() = PhoneAppearance.palette.warn
val DcHover get() = DcText.copy(alpha = .08f)
val DcSelected get() = DcAccent.copy(alpha = .20f)
val DcOnAccent get() = PhoneAppearance.palette.onAccent

@Composable
fun PhoneTheme(content: @Composable () -> Unit) {
    PhoneAppearance.load(LocalContext.current)
    val p = PhoneAppearance.palette
    val view = LocalView.current
    SideEffect {
        var context = view.context
        while (context is ContextWrapper && context !is Activity) context = context.baseContext
        (context as? Activity)?.let { activity ->
            WindowCompat.getInsetsController(activity.window, view).apply {
                isAppearanceLightStatusBars = p.light
                isAppearanceLightNavigationBars = p.light
            }
        }
    }
    val base = if (p.light) lightColorScheme() else darkColorScheme()
    MaterialTheme(colorScheme = base.copy(
        primary = p.accent, onPrimary = p.onAccent,
        secondary = p.honey, onSecondary = p.chat,
        background = p.chat, onBackground = p.text,
        surface = p.sidebar, onSurface = p.text,
        surfaceVariant = p.bar, onSurfaceVariant = p.sub,
        outline = p.border, error = p.red,
    ), content = content)
}
