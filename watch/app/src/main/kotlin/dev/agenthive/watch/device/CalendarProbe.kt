package dev.agenthive.watch.device

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * "What's on my calendar today/tomorrow" — reads CalendarContract instances
 * for the rest of the day. Needs READ_CALENDAR (dangerous); replies deep-link
 * to the app-info page when ungranted.
 */
object CalendarProbe {

    private fun granted(ctx: Context) = ContextCompat.checkSelfPermission(
        ctx, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    fun grantIntent(ctx: Context): Intent = Intent(
        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        android.net.Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Human line for today's remaining events (+ tomorrow's if asked). */
    fun upcoming(ctx: Context, tomorrow: Boolean): String {
        if (!granted(ctx)) {
            ctx.startActivity(grantIntent(ctx))
            return "I need Calendar access — grant it for Nexus Watch here, then ask again."
        }
        val start = Calendar.getInstance().apply {
            if (tomorrow) add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, if (tomorrow) 0 else get(Calendar.HOUR_OF_DAY))
            set(Calendar.MINUTE, if (tomorrow) 0 else get(Calendar.MINUTE))
            if (!tomorrow) timeInMillis = System.currentTimeMillis()
        }.timeInMillis
        val end = Calendar.getInstance().apply {
            if (tomorrow) add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 23); set(Calendar.MINUTE, 59); set(Calendar.SECOND, 59)
        }.timeInMillis

        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
            .appendPath(start.toString()).appendPath(end.toString()).build()
        val out = mutableListOf<String>()
        runCatching {
            ctx.contentResolver.query(uri,
                arrayOf(CalendarContract.Instances.TITLE,
                    CalendarContract.Instances.BEGIN,
                    CalendarContract.Instances.ALL_DAY),
                null, null, "startDay ASC, startMinute ASC")?.use { c ->
                val fmt = SimpleDateFormat("h:mm a", Locale.US)
                while (c.moveToNext() && out.size < 6) {
                    val title = c.getString(0)?.ifBlank { "Untitled" } ?: continue
                    val allDay = c.getInt(2) == 1
                    out += if (allDay) "$title (all day)"
                        else "$title at ${fmt.format(Date(c.getLong(1)))}"
                }
            }
        }
        val day = if (tomorrow) "tomorrow" else "today"
        return if (out.isEmpty()) "Nothing else on your calendar $day."
            else "${if (tomorrow) "Tomorrow" else "Today"} you have " + out.joinToString(". ")
    }
}
