package dev.agenthive.watch.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Icon
import dev.agenthive.watch.R

/** Material Symbols bundled as vectors so every watch surface works offline. */
@Composable
internal fun WatchIcon(
    @DrawableRes resource: Int,
    description: String? = null,
    tint: Color = HiveColors.Cyan,
    size: Dp = 16.dp,
    modifier: Modifier = Modifier,
) {
    Icon(
        painter = painterResource(resource),
        contentDescription = description,
        tint = tint,
        modifier = modifier.size(size),
    )
}

/** Keep server-supplied agent identities; render their category as a real icon. */
@DrawableRes
internal fun agentIcon(symbol: String): Int = when (symbol.trim().removeSuffix("\uFE0F")) {
    "🔍", "🔎" -> R.drawable.ic_symbol_search
    "⚡" -> R.drawable.ic_symbol_bolt
    "💻", "🧑‍💻" -> R.drawable.ic_symbol_code
    "📝", "✍", "📚" -> R.drawable.ic_symbol_description
    "🎵", "🎶" -> R.drawable.ic_symbol_music_note
    "🌐", "🌍", "🌎", "🌏" -> R.drawable.ic_symbol_public
    "⚙", "🛠" -> R.drawable.ic_symbol_settings
    "✦", "✨", "" -> R.drawable.ic_symbol_auto_awesome
    else -> R.drawable.ic_symbol_smart_toy
}
