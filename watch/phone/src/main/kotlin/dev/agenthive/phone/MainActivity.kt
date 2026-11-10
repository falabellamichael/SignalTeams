package dev.agenthive.phone

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agenthive.phone.ui.ChatScreen
import dev.agenthive.phone.ui.DcBlurple
import dev.agenthive.phone.ui.DcChat
import dev.agenthive.phone.ui.DcRail
import dev.agenthive.phone.ui.DcSub
import dev.agenthive.phone.ui.HomeScreen
import dev.agenthive.phone.ui.LoginScreen
import dev.agenthive.phone.ui.PhoneTheme
import dev.agenthive.phone.ui.SettingsScreen
import dev.agenthive.phone.ui.VoiceScreen

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PhoneTheme {
                val state by vm.ui.collectAsState()
                // Edge-to-edge: paint the current screen's surface under the
                // status/camera bar so the whole top strip is themed, not black.
                val scrim = when (state.route) {
                    Route.CHAT, Route.SETTINGS -> DcChat
                    else -> DcRail
                }
                Box(Modifier.fillMaxSize().background(scrim)) {
                    Box(Modifier.systemBarsPadding()) {
                        when (state.route) {
                            Route.LOGIN -> LoginScreen(state, vm)
                            Route.LINKING -> LinkingScreen(state.status)
                            Route.HOME -> HomeScreen(state, vm)
                            Route.CHAT -> {
                                BackHandler { vm.backHome() }
                                ChatScreen(state, vm)
                            }
                            Route.SETTINGS -> SettingsScreen(state, vm)
                        }
                    }
                    // Voice room overlays whichever screen you're on — like
                    // Discord's call screen; the chevron minimizes to a bar.
                    if (state.voiceOpen && state.voiceCid > 0) {
                        BackHandler { vm.closeVoicePanel() }
                        VoiceScreen(state, vm)
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // fresh poll when returning to the app
        if (vm.ui.value.route == Route.HOME) vm.refreshHome()
    }
}

@Composable
private fun LinkingScreen(status: String) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        CircularProgressIndicator(color = DcBlurple, modifier = Modifier.size(36.dp))
        Spacer(Modifier.height(16.dp))
        Text(status.ifBlank { "connecting…" }, color = DcSub, fontSize = 14.sp)
    }
}
