package dev.agenthive.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agenthive.phone.AppViewModel
import dev.agenthive.phone.UiState

@Composable
private fun Field(
    label: String, value: String, onChange: (String) -> Unit,
    password: Boolean = false, numPad: Boolean = false,
) {
    Text(
        label, color = DcSub, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp, modifier = Modifier.padding(bottom = 6.dp),
    )
    Box(
        Modifier.fillMaxWidth().height(42.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(DcChat)
            .border(1.dp, DcBorder, RoundedCornerShape(6.dp))
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        BasicTextField(
            value = value, onValueChange = onChange,
            textStyle = TextStyle(color = DcText, fontSize = 14.sp),
            cursorBrush = SolidColor(DcAccent),
            singleLine = true,
            visualTransformation = if (password) PasswordVisualTransformation()
                                   else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (numPad) KeyboardType.NumberPassword else KeyboardType.Text),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Tab(text: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.clip(RoundedCornerShape(6.dp))
            .background(if (on) DcAccent else Color.Transparent)
            .border(1.dp, if (on) DcAccent else DcBorder, RoundedCornerShape(6.dp))
            .padding(vertical = 8.dp)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (on) Color.White else DcSub,
             fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun LoginScreen(state: UiState, vm: AppViewModel) {
    var mode by remember { mutableStateOf("login") }        // login | register
    var prov by remember { mutableStateOf("supabase") }     // supabase | crew
    var email by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var display by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var invCode by remember { mutableStateOf("") }
    var invRole by remember { mutableStateOf<String?>(null) }
    var invBad by remember { mutableStateOf(false) }

    val connected = state.serverUrl.isNotBlank() || state.paired
    val supaOn = state.authCfg?.optBoolean("supabase") == true

    // pull the hive's auth providers once we're connected
    LaunchedEffect(connected) { if (connected) vm.fetchAuthConfig() }
    LaunchedEffect(supaOn) { if (!supaOn) prov = "crew" }

    Column(
        Modifier.fillMaxSize().background(DcRail)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(44.dp))

        Box(
            Modifier.size(54.dp).clip(CircleShape).background(Color(0xFF262015))
                .border(1.5.dp, DcHoney.copy(alpha = 0.5f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("✦", color = DcHoney, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Signal", color = DcText, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(2.dp))
            Text("Hive", color = DcHoney, fontSize = 26.sp,
                 fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic)
        }
        Text(
            "your hive, on your phone.",
            color = DcSub, fontSize = 13.sp, fontStyle = FontStyle.Italic,
            modifier = Modifier.padding(top = 4.dp, bottom = 22.dp),
        )

        Column(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DcSidebar)
                .border(1.dp, DcBorder, RoundedCornerShape(12.dp))
                .padding(18.dp),
        ) {
            if (!connected) {
                // ---- step one: reach your hive. Pairing hands us the address.
                Text(
                    "Connect to your hive",
                    color = DcText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                Field("8-DIGIT PAIR CODE", code, { code = it }, numPad = true)
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { vm.linkMesh(code) }, enabled = !state.busy,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DcAccent, contentColor = Color.White),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                ) {
                    Text(if (state.busy) "Joining mesh…" else "Pair to Mesh",
                         fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                }
                Text(
                    "mint a code on the hive: Settings → Nexus Mesh → pair a device",
                    color = DcMuted, fontSize = 11.sp,
                    modifier = Modifier.padding(top = 10.dp),
                )
            } else {
                // ---- connected: Supabase or crew account, no URLs.
                Text(
                    if (mode == "login") "Welcome back" else "Join your team",
                    color = DcText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(bottom = 12.dp),
                )

                if (supaOn) {
                    Row(Modifier.fillMaxWidth()) {
                        Tab("Supabase", prov == "supabase", { prov = "supabase" },
                            Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        Tab("Crew account", prov == "crew", { prov = "crew" },
                            Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(14.dp))
                }

                if (prov == "supabase" && supaOn) {
                    Field("EMAIL", email, { email = it })
                    if (mode == "register") {
                        Spacer(Modifier.height(14.dp))
                        Field("DISPLAY NAME", display, { display = it })
                    }
                } else {
                    Field("USERNAME", user, { user = it })
                    if (mode == "register") {
                        Spacer(Modifier.height(14.dp))
                        Field("DISPLAY NAME", display, { display = it })
                    }
                }
                Spacer(Modifier.height(14.dp))
                Field("PASSWORD", pass, { pass = it }, password = true)

                if (mode == "register") {
                    Spacer(Modifier.height(14.dp))
                    Field("MESH INVITE CODE — OPTIONAL", invCode, { v ->
                        invCode = v; invRole = null; invBad = false
                        if (v.trim().length >= 6) {
                            // preview the grant this code carries
                            vm.previewInviteRole(v.trim()) { role, bad ->
                                invRole = role; invBad = bad
                            }
                        }
                    }, numPad = true)
                    invRole?.let {
                        Text("✓ grants $it on this hive", color = DcGreen,
                             fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                    if (invBad) Text("that code is expired or already used",
                                     color = DcRed, fontSize = 12.sp,
                                     modifier = Modifier.padding(top = 6.dp))
                }
                Spacer(Modifier.height(18.dp))

                Button(
                    onClick = {
                        if (prov == "supabase" && supaOn) {
                            if (mode == "login") vm.signInSupa(email, pass)
                            else vm.signUpSupa(email, pass, display)
                        } else {
                            if (mode == "login") vm.signIn(user, pass)
                            else vm.signUp(user, pass, display, invCode)
                        }
                    },
                    enabled = !state.busy,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DcAccent, contentColor = Color.White),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                ) {
                    Text(
                        when {
                            state.busy -> "…"
                            mode == "login" -> "Sign in"
                            else -> "Create account"
                        },
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    )
                }

                Row(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (mode == "login") "New here? " else "Already on the team? ",
                        color = DcSub, fontSize = 12.sp,
                    )
                    Text(
                        if (mode == "login") "Create an account" else "Sign in",
                        color = DcAccent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable {
                            mode = if (mode == "login") "register" else "login"
                        },
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(vertical = 18.dp),
                ) {
                    HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
                    Text("  connected to your hive  ", color = DcMuted, fontSize = 11.sp)
                    HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (state.meshUp) "mesh link up" else "paired to your hive",
                        color = if (state.meshUp) DcGreen else DcSub,
                        fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("switch hive", color = DcSub, fontSize = 12.sp,
                         modifier = Modifier.clickable { vm.forgetHive() })
                }
            }

            if (state.status.isNotBlank())
                Text(state.status, color = DcSub, fontSize = 12.sp,
                     modifier = Modifier.padding(top = 12.dp))
            if (state.error.isNotBlank())
                Text(state.error, color = DcRed, fontSize = 12.sp,
                     modifier = Modifier.padding(top = 8.dp))
        }

        Spacer(Modifier.height(30.dp))
    }
}
