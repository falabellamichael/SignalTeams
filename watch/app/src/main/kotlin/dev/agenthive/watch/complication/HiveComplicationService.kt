package dev.agenthive.watch.complication

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.BatteryManager
import android.content.Context
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.EmptyComplicationData
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import dev.agenthive.watch.HiveApp
import dev.agenthive.watch.MainActivity
import dev.agenthive.watch.R

/**
 * Watch-face data source, mirroring Google's own assistant surface: a
 * glanceable "✦ Ask" entry point plus live battery as a ranged value and the
 * last assistant reply as long text. Tap launches MainActivity in assist mode
 * (same handling as the hardware/VIVS path).
 */
class HiveComplicationService : ComplicationDataSourceService() {

    private fun tap(): PendingIntent {
        val i = Intent(this, MainActivity::class.java)
            .setAction("android.intent.action.VOICE_ASSIST")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            this, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun text(s: String) = PlainComplicationText.Builder(s).build()

    private fun icon() = MonochromaticImage.Builder(
        Icon.createWithResource(this, R.drawable.hive_mark))
        .build()

    private fun battery(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun lastReply(): String = runCatching {
        (applicationContext as HiveApp).store.lastReply
    }.getOrDefault("")

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val data = when (request.complicationType) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(
                text("✦ Ask"), text("Ask Nexus Watch"))
                .setMonochromaticImage(icon())
                .setTapAction(tap())
                .build()

            ComplicationType.LONG_TEXT -> {
                val suggest = runCatching {
                    (applicationContext as HiveApp).store.suggestion
                }.getOrDefault("")
                val body = suggest.ifBlank {
                    lastReply().ifBlank { "Ask Scout anything" } }
                LongTextComplicationData.Builder(
                    text(body.take(80)), text("Nexus Watch — $body"))
                    .setTitle(text(if (suggest.isNotBlank()) "✦ Next"
                        else if (body == "Ask Scout anything") "✦ Ask" else "✦ Nexus"))
                    .setMonochromaticImage(icon())
                    .setTapAction(tap())
                    .build()
            }

            ComplicationType.RANGED_VALUE -> {
                val pct = battery().coerceIn(0, 100)
                RangedValueComplicationData.Builder(
                    pct.toFloat(), 0f, 100f, text("Battery $pct%"))
                    .setText(text("$pct%"))
                    .setTitle(text("Battery"))
                    .setMonochromaticImage(icon())
                    .setTapAction(tap())
                    .build()
            }

            else -> EmptyComplicationData()
        }
        listener.onComplicationData(data)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? = when (type) {
        ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(
            text("✦ Ask"), text("Ask Nexus Watch"))
            .setMonochromaticImage(icon())
            .setTapAction(tap())
            .build()
        ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(
            text("Ask Scout anything"), text("Nexus Watch"))
            .setTitle(text("✦ Nexus"))
            .setMonochromaticImage(icon())
            .setTapAction(tap())
            .build()
        ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(
            72f, 0f, 100f, text("Battery"))
            .setText(text("72%"))
            .setTitle(text("Battery"))
            .setMonochromaticImage(icon())
            .setTapAction(tap())
            .build()
        else -> null
    }
}
