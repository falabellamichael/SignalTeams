package dev.agenthive.watch

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Fires MeshService at watch boot so the mesh link + egress bridge come up
 * before the app is ever opened — the assistant is already connected when
 * the user raises their wrist. Skips entirely on a never-paired watch (no
 * point burning radio for a link that can't authenticate).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED &&
            a != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = ctx.applicationContext as? HiveApp ?: return
        if (!app.store.paired && !app.store.meshEnabled) return
        Log.i("BootReceiver", "$a — starting MeshService")
        runCatching {
            ctx.startForegroundService(Intent(ctx, MeshService::class.java))
        }.onFailure {
            Log.w("BootReceiver", "FGS start refused: ${it.message}")
        }
    }
}
