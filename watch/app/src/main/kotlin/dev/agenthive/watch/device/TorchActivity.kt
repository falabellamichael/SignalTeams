package dev.agenthive.watch.device

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity

/** Screen flashlight — Wear hardware has no LED, so the torch is a
 *  full-brightness white panel. Any tap exits. */
class TorchActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply {
            screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        }
        setContentView(View(this).apply {
            setBackgroundColor(Color.WHITE)
            setOnClickListener { finish() }
        })
    }
}
