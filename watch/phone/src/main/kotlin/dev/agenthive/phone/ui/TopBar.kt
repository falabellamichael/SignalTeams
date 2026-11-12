package dev.agenthive.phone.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** One top bar for every page — the same sectioned-off band the main page
 *  uses: circular icon buttons, a bottom divider separating it from the
 *  content, identical padding everywhere. Pages supply their own title and
 *  trailing actions. */
@Composable
fun PageTopBar(
    navIcon: ImageVector? = null,
    navDesc: String = "back",
    navIconSize: Dp = 20.dp,
    onNav: () -> Unit = {},
    navTint: androidx.compose.ui.graphics.Color = DcIcon,
    onBarClick: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    below: (@Composable ColumnScope.() -> Unit)? = null,
    title: @Composable RowScope.() -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth()
                .let { m -> if (onBarClick != null) m.clickable(onClick = onBarClick) else m }
                .padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (navIcon != null) {
                TopBarIconBtn(navIcon, navDesc, tint = navTint,
                              size = navIconSize, onClick = onNav)
                Spacer(Modifier.width(6.dp))
            }
            title()
            actions()
        }
        if (below != null) below()
        HorizontalDivider(color = DcBorder, thickness = 1.dp)
    }
}

/** The 36dp circular icon button every top-bar action uses. */
@Composable
fun TopBarIconBtn(
    icon: ImageVector,
    desc: String? = null,
    tint: androidx.compose.ui.graphics.Color = DcIcon,
    size: Dp = 20.dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(36.dp).clip(CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = desc, tint = tint,
             modifier = Modifier.size(size))
    }
}
