package dev.agenthive.watch.device

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat

/**
 * "Call Mike" / "text Dana" — resolves a spoken name to a phone number via
 * ContactsContract. Needs READ_CONTACTS (dangerous); replies deep-link to the
 * app-info page when ungranted.
 */
object ContactsProbe {

    data class Hit(val name: String, val number: String)

    private fun granted(ctx: Context) = ContextCompat.checkSelfPermission(
        ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    fun grantIntent(ctx: Context): Intent = Intent(
        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        android.net.Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Best number for a spoken name: exact-insensitive match first, then
     *  contains-match. Null when nothing resembles it. */
    fun lookup(ctx: Context, spoken: String): Pair<Hit?, String?> {
        if (!granted(ctx)) {
            ctx.startActivity(grantIntent(ctx))
            return null to "I need Contacts access — grant it for Nexus Watch here, then ask again."
        }
        val q = spoken.trim().lowercase().removePrefix("to ").trim()
        if (q.isBlank()) return null to null
        var exact: Hit? = null
        var partial: Hit? = null
        runCatching {
            ctx.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER),
                null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(0) ?: continue
                    val num = c.getString(1)?.ifBlank { null } ?: continue
                    val ln = name.lowercase()
                    if (exact == null && ln == q) exact = Hit(name, num)
                    else if (partial == null &&
                        (ln.split(" ").contains(q) || ln.contains(q))) {
                        partial = Hit(name, num)
                    }
                    if (exact != null) break
                }
            }
        }
        return (exact ?: partial) to null
    }
}
