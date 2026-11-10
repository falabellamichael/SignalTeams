package dev.agenthive.watch

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import dev.agenthive.watch.data.Store

/**
 * Context triggers — the same idea as the built-in assistant's
 * ContextTriggerBroadcastReceiver: ambient events write a proactive
 * suggestion the chip/complication/tile surfaces can show. A headphone
 * plug-in is the freshest context there is, so it wins over whatever the
 * mesh last pushed (the next refresh restores calendar suggestions).
 */
class ContextReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        when (i.action) {
            Intent.ACTION_HEADSET_PLUG -> {
                if (i.getIntExtra("state", 0) == 1)
                    suggest(ctx, "Resume my music")
            }
            "android.bluetooth.a2dp.profile.action.CONNECTION_STATE_CHANGED" -> {
                // STATE_CONNECTED = 2 — an audio sink just paired
                if (i.getIntExtra("android.bluetooth.profile.extra.STATE", 0) == 2)
                    suggest(ctx, "Resume my music")
            }
            Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_LOCALE_CHANGED ->
                // clock moved — re-render any time-bearing suggestion
                ComplicationDataSourceUpdateRequester
                    .create(ctx, android.content.ComponentName(ctx,
                        dev.agenthive.watch.complication.HiveComplicationService::class.java))
                    .requestUpdateAll()
        }
    }

    private fun suggest(ctx: Context, label: String) {
        Store(ctx).suggestion = label
        ComplicationDataSourceUpdateRequester
            .create(ctx, android.content.ComponentName(ctx,
                dev.agenthive.watch.complication.HiveComplicationService::class.java))
            .requestUpdateAll()
    }
}
