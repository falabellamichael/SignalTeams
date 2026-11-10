package dev.agenthive.watch.device

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Tile-tap trampoline — tile chips can't run code, they only launch
 * activities, so this one runs the action the tile asks for ("action"
 * extra), shows the result briefly, then disappears.
 */
class QuickActionActivity : ComponentActivity() {

    private val result = mutableStateOf("…")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val action = intent.getStringExtra("action") ?: ""
        setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().padding(24.dp),
                    contentAlignment = Alignment.Center) {
                    Text(result.value, textAlign = TextAlign.Center)
                }
            }
        }
        lifecycleScope.launch {
            result.value = when (action) {
                "find_phone" -> PhoneBridge.findPhone(this@QuickActionActivity)
                "stop_phone" -> PhoneBridge.stopPhone(this@QuickActionActivity)
                "phone_status" -> PhoneBridge.phoneStatus(this@QuickActionActivity)
                "vibrate" -> {
                    runCatching {
                        getSystemService(android.os.Vibrator::class.java)
                            ?.vibrate(android.os.VibrationEffect.createOneShot(
                                600, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                    }
                    "Buzz."
                }
                else -> "Nothing to do."
            }
            delay(4_000)
            finish()
        }
    }
}
