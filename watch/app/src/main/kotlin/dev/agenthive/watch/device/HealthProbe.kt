package dev.agenthive.watch.device

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One-shot body-sensor reads — "what's my heart rate" / "my step count".
 * Needs BODY_SENSORS; without it the reply points at the grant page.
 */
object HealthProbe {

    /** Samsung Wear gates heart_rate behind health.READ_HEART_RATE; Pixel/
     *  stock Wear uses BODY_SENSORS. Either unlocks the sensor. */
    /** Barometer — TYPE_PRESSURE needs no permission on Wear. hPa or null. */
    suspend fun pressure(ctx: Context): Float? = sample(ctx, Sensor.TYPE_PRESSURE)

    private fun granted(ctx: Context): Boolean {
        fun has(p: String) = ContextCompat.checkSelfPermission(ctx, p) ==
            PackageManager.PERMISSION_GRANTED
        return has(Manifest.permission.BODY_SENSORS) ||
            has("android.permission.health.READ_HEART_RATE")
    }

    /** Deep-link to our own permissions page so the grant is one tap away. */
    fun grantIntent(ctx: Context) = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        android.net.Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Latest sample for [type] — waits up to [ms] for the sensor to fire. */
    private suspend fun sample(ctx: Context, type: Int, ms: Long = 8000): Float? {
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(type) ?: return null
        val got = CompletableDeferred<Float>()
        val l = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                if (e.values.isNotEmpty() && e.values[0] > 0f)
                    got.complete(e.values[0])
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        sm.registerListener(l, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        val v = withTimeoutOrNull(ms) { got.await() }
        sm.unregisterListener(l)
        return v
    }

    /** Heart rate in bpm — waits for a real reading (wrist contact takes a
     *  moment). Null → no sensor, no grant, or no reading in time. */
    suspend fun heartRate(ctx: Context): Float? {
        if (!granted(ctx)) return null
        return sample(ctx, Sensor.TYPE_HEART_RATE, 12000)
    }

    /** Steps — TYPE_STEP_COUNTER counts since boot; report it as-is and let
     *  the reply phrase it. */
    suspend fun steps(ctx: Context): Int? {
        if (!granted(ctx)) return null
        return sample(ctx, Sensor.TYPE_STEP_COUNTER, 4000)?.toInt()
    }
}
