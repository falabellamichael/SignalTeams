package dev.agenthive.watch.ui

import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.agenthive.watch.Phase
import dev.agenthive.watch.UiState

@Composable
fun HiveScreen(
    state: UiState,
    modifier: Modifier = Modifier,
    onCode: (String) -> Unit,
    onLinkCode: (String) -> Unit,
    onLinkHive: (String) -> Unit,
    onInput: (String) -> Unit,
    onSend: (String) -> Unit,
    onMic: () -> Unit,
    onStop: () -> Unit = {},
    onPickAgent: (Int) -> Unit,
    onRefreshAgents: () -> Unit,
    onRelinkMesh: () -> Unit,
    onClearChat: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val bg = Modifier.background(HiveColors.Bg)
    when (state.phase) {
        Phase.READY -> ChatScreen(
            state = state,
            onInput = onInput,
            onSend = onSend,
            onMic = onMic,
            onStop = onStop,
            onPickAgent = onPickAgent,
            onRefreshAgents = onRefreshAgents,
            onRelinkMesh = onRelinkMesh,
            onClearChat = onClearChat,
            onDisconnect = onDisconnect,
            onCode = onCode,
            onLinkCode = onLinkHive,
            modifier = modifier.then(bg),
        )
        else -> SetupScreen(
            state = state,
            onCode = onCode,
            onLinkCode = onLinkCode,
            modifier = modifier.then(bg),
        )
    }
}
