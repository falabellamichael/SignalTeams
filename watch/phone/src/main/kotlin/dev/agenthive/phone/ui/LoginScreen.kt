package dev.agenthive.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
fun LoginScreen(state: UiState, vm: AppViewModel) {
    var server by remember(state.serverUrl) { mutableStateOf(state.serverUrl) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().background(DcRail)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(44.dp))

        // SignalTeams Brand Header
        Box(
            Modifier.size(54.dp).clip(CircleShape).background(Color(0xFF262015))
                .border(1.5.dp, DcHoney.copy(alpha = 0.5f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("🐝", fontSize = 28.sp)
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Signal",
                color = DcText,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(2.dp))
            Text(
                "Teams",
                color = DcHoney,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                fontStyle = FontStyle.Italic,
            )
        }
        Text(
            "where your crew's agents live.",
            color = DcSub,
            fontSize = 13.sp,
            fontStyle = FontStyle.Italic,
            modifier = Modifier.padding(top = 4.dp, bottom = 22.dp),
        )

        // Card Container
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DcSidebar)
                .border(1.dp, DcBorder, RoundedCornerShape(12.dp))
                .padding(18.dp),
        ) {
            Field("HIVE URL", server, { server = it })
            Spacer(Modifier.height(14.dp))
            Field("USERNAME", user, { user = it })
            Spacer(Modifier.height(14.dp))
            Field("PASSWORD", pass, { pass = it }, password = true)
            Spacer(Modifier.height(18.dp))

            Button(
                onClick = { vm.signIn(server, user, pass) }, enabled = !state.busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = DcAccent, contentColor = Color.White),
                shape = RoundedCornerShape(6.dp),
                modifier = Modifier.fillMaxWidth().height(44.dp),
            ) {
                Text(
                    if (state.busy) "Signing in…" else "Sign In",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            if (state.status.isNotBlank())
                Text(state.status, color = DcSub, fontSize = 12.sp,
                     modifier = Modifier.padding(top = 12.dp))
            if (state.error.isNotBlank())
                Text(state.error, color = DcRed, fontSize = 12.sp,
                     modifier = Modifier.padding(top = 8.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(vertical = 18.dp),
            ) {
                HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
                Text("  or connect via mesh  ", color = DcMuted, fontSize = 11.sp)
                HorizontalDivider(color = DcBorder, modifier = Modifier.weight(1f))
            }

            Field("8-DIGIT PAIR CODE", code, { code = it }, numPad = true)
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { vm.linkMesh(code) }, enabled = !state.busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = DcRail, contentColor = DcText),
                shape = RoundedCornerShape(6.dp),
                modifier = Modifier.fillMaxWidth().height(42.dp)
                    .border(1.dp, DcBorder, RoundedCornerShape(6.dp)),
            ) {
                Text("Pair to Mesh", fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
            Text(
                "mint a code on the hive: Settings → Nexus Mesh → pair a device",
                color = DcMuted, fontSize = 11.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        Spacer(Modifier.height(30.dp))
    }
}

