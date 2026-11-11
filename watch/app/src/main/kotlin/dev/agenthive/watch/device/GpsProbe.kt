package dev.agenthive.watch.device

import android.content.Context
import android.location.Location
import android.location.LocationManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * GPS-derived answers — altitude, speed, "where am I" (reverse geocode).
 * Runs inside DeviceCommands' deferred block — network allowed.
 */
object GpsProbe {

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private fun lastFix(ctx: Context): Location? {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return runCatching {
            lm.getProviders(true).firstNotNullOfOrNull { p ->
                runCatching { lm.getLastKnownLocation(p) }.getOrNull()
            }
        }.getOrNull()
    }

    private val noFix = "I can't get a GPS fix — step outside or check location is on."

    fun altitude(ctx: Context): String {
        val loc = lastFix(ctx) ?: return noFix
        return if (loc.hasAltitude())
            "You're at about ${(loc.altitude * 3.281).toInt()} feet."
        else "The fix has no altitude yet — give the GPS a moment."
    }

    fun speed(ctx: Context): String {
        val loc = lastFix(ctx) ?: return noFix
        return if (loc.hasSpeed())
            "You're moving at about ${(loc.speed * 2.237).toInt()} mph."
        else "You're not moving — or the fix has no speed yet."
    }

    /** "Where am I" — reverse geocode the last fix via nominatim. */
    fun whereAmI(ctx: Context): String {
        val loc = lastFix(ctx) ?: return noFix
        val url = "https://nominatim.openstreetmap.org/reverse" +
            "?lat=${loc.latitude}&lon=${loc.longitude}&format=json&zoom=16"
        val body = runCatching {
            client.newCall(Request.Builder().url(url)
                .header("User-Agent", "NexusWatch/1.0").build())
                .execute().use { it.body?.string() }
        }.getOrNull() ?: return "Couldn't reach the map service."
        val j = runCatching { JSONObject(body) }.getOrNull()
            ?: return "The map service didn't answer."
        val addr = j.optJSONObject("address")
        val place = j.optString("name").takeIf { it.isNotBlank() }
            ?: addr?.optString("neighbourhood")?.takeIf { it.isNotBlank() }
            ?: addr?.optString("suburb")?.takeIf { it.isNotBlank() }
            ?: addr?.optString("town")?.takeIf { it.isNotBlank() }
            ?: addr?.optString("city")?.takeIf { it.isNotBlank() }
        val city = addr?.optString("city")?.takeIf { it.isNotBlank() }
            ?: addr?.optString("town") ?: addr?.optString("village") ?: ""
        return when {
            place == null && city.isBlank() -> "I can't place that spot on the map."
            city.isBlank() || place == city -> "You're in $place."
            else -> "You're near $place, $city."
        }
    }
}
