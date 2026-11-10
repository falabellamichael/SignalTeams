package dev.agenthive.watch.device

import android.content.Context
import android.location.LocationManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Weather via open-meteo (free, unauthed) using the watch's last-known
 * location. Runs inside DeviceCommands' deferred block — network allowed.
 */
object WeatherProbe {

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    /** WMO weather-code → spoken phrase. */
    private fun describe(code: Int): String = when (code) {
        0 -> "clear skies"
        1 -> "mostly clear"
        2 -> "partly cloudy"
        3 -> "overcast"
        45, 48 -> "fog"
        51, 53, 55, 56, 57 -> "drizzle"
        61, 63, 66, 80 -> "light rain"
        65, 67, 81, 82 -> "heavy rain"
        71, 73, 77 -> "light snow"
        75, 85, 86 -> "heavy snow"
        95, 96, 99 -> "thunderstorms"
        else -> "mixed conditions"
    }

    /** Today's forecast (max/min + rain chance) or tomorrow's. */
    fun forecast(ctx: Context, tomorrow: Boolean): String? {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val loc = runCatching {
            lm.getProviders(true).firstNotNullOfOrNull { p ->
                runCatching { lm.getLastKnownLocation(p) }.getOrNull()
            }
        }.getOrNull() ?: return "I can't read your location — turn on location and try again."
        val url = "https://api.open-meteo.com/v1/forecast" +
            "?latitude=${loc.latitude}&longitude=${loc.longitude}" +
            "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max" +
            "&temperature_unit=fahrenheit&forecast_days=2&timezone=auto"
        val body = runCatching {
            client.newCall(Request.Builder().url(url).build())
                .execute().use { it.body?.string() }
        }.getOrNull() ?: return "Couldn't reach the weather service."
        val d = runCatching { JSONObject(body).getJSONObject("daily") }
            .getOrNull() ?: return "The weather service didn't answer."
        val i = if (tomorrow) 1 else 0
        if (d.getJSONArray("time").length() <= i) return "No forecast for then."
        val hi = d.getJSONArray("temperature_2m_max").optDouble(i)
        val lo = d.getJSONArray("temperature_2m_min").optDouble(i)
        val code = d.getJSONArray("weather_code").optInt(i, -1)
        val rain = d.getJSONArray("precipitation_probability_max").optDouble(i, -1.0)
        val day = if (tomorrow) "Tomorrow" else "Today"
        return "$day: ${describe(code)}, high ${hi.toInt()}° low ${lo.toInt()}°" +
            if (rain >= 0) " — ${rain.toInt()}% chance of precipitation." else "."
    }

    /** Null → caller falls back to a guidance line. */
    fun current(ctx: Context): String? {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val loc = runCatching {
            lm.getProviders(true).firstNotNullOfOrNull { p ->
                runCatching { lm.getLastKnownLocation(p) }.getOrNull()
            }
        }.getOrNull() ?: return "I can't read your location — turn on location and try again."

        val url = "https://api.open-meteo.com/v1/forecast" +
            "?latitude=${loc.latitude}&longitude=${loc.longitude}" +
            "&current=temperature_2m,apparent_temperature,weather_code" +
            "&temperature_unit=fahrenheit"
        val body = runCatching {
            client.newCall(Request.Builder().url(url).build())
                .execute().use { it.body?.string() }
        }.getOrNull() ?: return "Couldn't reach the weather service."

        val cur = runCatching {
            JSONObject(body).getJSONObject("current")
        }.getOrNull() ?: return "The weather service didn't answer."

        val temp = cur.optDouble("temperature_2m")
        val feels = cur.optDouble("apparent_temperature", temp)
        val code = cur.optInt("weather_code", -1)
        return "It's ${temp.toInt()}°F with ${describe(code)}" +
            if (kotlin.math.abs(feels - temp) >= 4) " — feels like ${feels.toInt()}°." else "."
    }
}
