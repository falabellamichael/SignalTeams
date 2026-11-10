package dev.agenthive.watch.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import dev.agenthive.watch.R

/**
 * The AgentHive trefoil — always in motion, like Devin's thinking mark.
 * rememberInfiniteTransition runs for the composable's whole lifetime:
 * the mark never stops animating unless the caller removes it.
 */
@Composable
fun HiveMark(size: Dp, modifier: Modifier = Modifier, tint: ColorFilter? = null) {
    val t = rememberInfiniteTransition(label = "hive_mark")
    val spin by t.animateFloat(
        0f, 360f,
        infiniteRepeatable(tween(3600, easing = LinearEasing), RepeatMode.Restart),
        label = "spin",
    )
    val breathe by t.animateFloat(
        0.94f, 1.06f,
        infiniteRepeatable(tween(1400), RepeatMode.Reverse),
        label = "breathe",
    )
    val glow by t.animateFloat(
        0.8f, 1f,
        infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "glow",
    )
    Image(
        painter = painterResource(R.drawable.hive_mark),
        contentDescription = "AgentHive",
        colorFilter = tint,
        modifier = modifier
            .size(size)
            .scale(breathe)
            .rotate(spin)
            .alpha(glow),
    )
}
