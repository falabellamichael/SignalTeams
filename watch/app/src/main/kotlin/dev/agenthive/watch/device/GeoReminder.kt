package dev.agenthive.watch.device

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/**
 * "Remind me when I get to <place>" — Gemini-style location reminders.
 * OpenStreetMap nominatim geocodes the place; Google Play Services
 * GeofencingClient fires a broadcast on GEOFENCE_TRANSITION_ENTER which
 * posts a heads-up notification carrying the reminder text.
 */
object GeoReminder {

    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    data class Place(val lat: Double, val lon: Double, val label: String)

    /** Geocode a spoken place name via nominatim (unauthed; needs a real UA). */
    fun geocode(ctx: Context, place: String): Place? {
        val url = "https://nominatim.openstreetmap.org/search" +
            "?q=${java.net.URLEncoder.encode(place, "UTF-8")}" +
            "&format=json&limit=1&accept-language=en"
        val req = Request.Builder().url(url)
            .header("User-Agent", "AgentHive-Watch/1.0 (contact: dev@agenthive.dev)")
            .build()
        val body = runCatching {
            client.newCall(req).execute().use { it.body?.string() }
        }.getOrNull() ?: return null
        val arr = runCatching { JSONArray(body) }.getOrNull() ?: return null
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        return Place(o.getDouble("lat"), o.getDouble("lon"),
            o.optString("display_name", place).substringBefore(","))
    }

    /** Current position (last known) — to sanity-check "I'm already there". */
    fun lastLocation(ctx: Context): Location? {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return runCatching {
            lm.getProviders(true).firstNotNullOfOrNull { p ->
                runCatching { lm.getLastKnownLocation(p) }.getOrNull()
            }
        }.getOrNull()
    }

    private fun geoClient(ctx: Context): GeofencingClient =
        LocationServices.getGeofencingClient(ctx)

    private fun pending(ctx: Context, text: String): PendingIntent {
        val i = Intent(ctx, GeoReceiver::class.java)
            .setAction(ACTION).putExtra(EXTRA_TEXT, text)
        return PendingIntent.getBroadcast(ctx, text.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
    }

    /** Arm an enter-geofence (~200m, 24h expiry) that shows `text` on arrival. */
    fun arm(ctx: Context, text: String, lat: Double, lon: Double,
            radiusM: Float = 200f): String? {
        val fine = ContextCompat.checkSelfPermission(ctx,
            android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val bg = ContextCompat.checkSelfPermission(ctx,
            "android.permission.ACCESS_BACKGROUND_LOCATION") ==
            PackageManager.PERMISSION_GRANTED
        if (!fine) return "I need location access for that."
        if (!bg) return "I need 'always' location so the reminder fires later — " +
            "grant location 'Allow all the time' for AgentHive."
        val fence = Geofence.Builder()
            .setRequestId(text.hashCode().toString())
            .setCircularRegion(lat, lon, radiusM)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
            .setExpirationDuration(24 * 3600_000L)
            .setNotificationResponsiveness(60_000)
            .build()
        return runCatching {
            geoClient(ctx).addGeofences(
                GeofencingRequest.Builder()
                    .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
                    .addGeofence(fence).build(),
                pending(ctx, text))
            null
        }.getOrElse { "Geofencing isn't available on this watch — ${it.message}" }
    }

    const val ACTION = "dev.agenthive.watch.action.GEO_REMINDER"
    const val EXTRA_TEXT = "text"
}

/** Receives the geofence trip → posts the reminder as a heads-up notification. */
class GeoReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != GeoReminder.ACTION) return
        val text = intent.getStringExtra(GeoReminder.EXTRA_TEXT) ?: return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
            as NotificationManager
        nm.createNotificationChannel(NotificationChannel(
            "hive_geo", "Location reminders", NotificationManager.IMPORTANCE_HIGH))
        nm.notify(text.hashCode(), Notification.Builder(ctx, "hive_geo")
            .setContentTitle("✦ Reminder")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .build())
    }
}
