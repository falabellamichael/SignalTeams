package dev.agenthive.watch.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.dynamicColorScheme

// Deep OLED black with Gemini-inspired iridescent violet / cyan / rose accents.
object HiveColors {
    val Bg = Color(0xFF05050A)
    val BgGlow = Color(0xFF101226)
    val Panel = Color(0xFF121422)
    val PanelHi = Color(0xFF1B1F34)
    val Border = Color(0xFF282D4A)
    val Text = Color(0xFFF4F6FF)
    val Dim = Color(0xFFA0A6C4)
    val Faint = Color(0xFF636987)
    val Violet = Color(0xFF8B7CFF)
    val Blue = Color(0xFF5B8DEF)
    val Cyan = Color(0xFF42E2F5)
    val Pink = Color(0xFFF075B8)
    val UserBubble = Color(0xFF212642)
    val UserBubbleEdge = Color(0xFF3A4270)
    val MeshOn = Color(0xFF34D399)
    val MeshDirect = Color(0xFFFBBF24)
    val MeshOff = Color(0xFF6B6B80)
    val Error = Color(0xFFF87171)

    val GeminiGradient = listOf(Violet, Blue, Cyan, Pink)
    val PillGradient = listOf(Color(0xFF6E59F7), Color(0xFF38BDF8))
}

@Composable
fun HiveTheme(content: @Composable () -> Unit) {
    val scheme = dynamicColorScheme(LocalContext.current) ?: ColorScheme()
    MaterialTheme(colorScheme = scheme) {
        content()
    }
}

/**
 * Animated luminous trefoil mark inside an iridescent aura ring — the AgentHive
 * take on Gemini's orb. Ring spins on an infinite transition; the trefoil itself
 * is a [HiveMark], which never stops animating.
 */
@Composable
fun GeminiOrb(
    size: Dp = 44.dp,
    active: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val tr = rememberInfiniteTransition(label = "geminiOrb")
    val spin by tr.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            tween(if (active) 2600 else 8000, easing = LinearEasing),
            RepeatMode.Restart,
        ),
        label = "spin",
    )
    val pulse by tr.animateFloat(
        initialValue = if (active) 0.88f else 0.94f,
        targetValue = if (active) 1.14f else 1.05f,
        animationSpec = infiniteRepeatable(
            tween(if (active) 650 else 1800, easing = LinearEasing),
            RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
    Canvas(modifier = Modifier.matchParentSize()) {
        val cx = this.size.width / 2f
        val cy = this.size.height / 2f
        val r = (this.size.minDimension / 2f) * pulse

        // Soft outer aurora glow
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    HiveColors.Violet.copy(alpha = if (active) 0.42f else 0.28f),
                    HiveColors.Cyan.copy(alpha = 0.14f),
                    Color.Transparent,
                ),
                center = Offset(cx, cy),
                radius = r * 1.15f,
            ),
            radius = r * 1.15f,
            center = Offset(cx, cy),
        )

        // Rotating iridescent ring
        rotate(spin, pivot = Offset(cx, cy)) {
            drawCircle(
                brush = Brush.sweepGradient(
                    colors = listOf(
                        HiveColors.Violet,
                        HiveColors.Cyan,
                        HiveColors.Pink,
                        HiveColors.Blue,
                        HiveColors.Violet,
                    ),
                    center = Offset(cx, cy),
                ),
                radius = r * 0.72f,
                center = Offset(cx, cy),
                style = Stroke(width = (this.size.minDimension * 0.065f), cap = StrokeCap.Round),
            )
        }

    }
    HiveMark(size = size * 0.52f)
    }
}
