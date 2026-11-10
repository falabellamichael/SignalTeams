package dev.agenthive.watch.device

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.provider.Settings
import android.util.Log

/**
 * Gemini-style on-device commands — matched locally so "open Spotify" doesn't
 * pay a mesh round-trip. Anything unrecognized returns null and the query
 * goes to the LLM as usual.
 */
object DeviceCommands {

    data class CmdReply(
        val text: String,
        val ok: Boolean = true,
        /** Optional async follow-up — sensor reads, hive calls. Its result
         *  (if non-blank) is appended as a second assistant message. */
        val deferred: (suspend () -> String?)? = null,
    )

    private fun am(ctx: Context) =
        ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /** Fire an intent if anything on the watch can handle it. */
    private fun fire(ctx: Context, intent: Intent): Boolean = runCatching {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(ctx.packageManager) != null) {
            ctx.startActivity(intent); true
        } else false
    }.getOrDefault(false)

    /** launchable apps on the device — label → launch intent. */
    private fun launchables(ctx: Context): List<Triple<String, String, Intent>> {
        val pm = ctx.packageManager
        val probe = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(probe, PackageManager.MATCH_ALL)
            .mapNotNull { ri ->
                val label = ri.loadLabel(pm)?.toString()?.takeIf { it.isNotBlank() }
                    ?: ri.activityInfo.packageName
                pm.getLaunchIntentForPackage(ri.activityInfo.packageName)
                    ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ?.let { Triple(label.lowercase(), label, it) }
            }
    }

    private fun openApp(ctx: Context, name: String): CmdReply {
        val q = name.trim().lowercase().removeSuffix(" app").trim()
        val apps = launchables(ctx)
        val hit = apps.firstOrNull { it.first == q }
            ?: apps.firstOrNull { it.first.startsWith(q) || q.startsWith(it.first) }
            ?: apps.firstOrNull { it.first.contains(q) || q.contains(it.first) }
            ?: return CmdReply(
                "No app called “$name” on this watch. Try “what apps can you open”.",
                ok = false)
        return try {
            ctx.startActivity(hit.third)
            CmdReply("Opening ${hit.second}")
        } catch (e: Exception) {
            CmdReply("Couldn't open ${hit.second} — ${e.message}", ok = false)
        }
    }

    private fun settingsDeep(ctx: Context, which: String): Boolean = runCatching {
        val intent = when (which) {
            "wifi" -> Intent(Settings.ACTION_WIFI_SETTINGS)
            "bluetooth", "bt" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            "battery" -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            "display" -> Intent(Settings.ACTION_DISPLAY_SETTINGS)
            "airplane" -> Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
            "date" -> Intent(Settings.ACTION_DATE_SETTINGS)
            "locate", "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            else -> Intent(Settings.ACTION_SETTINGS)
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(ctx.packageManager) == null &&
            which != "settings") {
            ctx.startActivity(Intent(Settings.ACTION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
            ctx.startActivity(intent)
        }
    }.isSuccess

    /** media transport via the notification-listener service. */
    private fun media(ctx: Context, verb: String): CmdReply {
        if (!HiveNotifService.isEnabled(ctx)) {
            runCatching { ctx.startActivity(HiveNotifService.settingsIntent()) }
            return CmdReply(
                "I need notification access to control media — granted? enable AgentHive here, then ask again.",
                ok = false)
        }
        val done = when (verb) {
            "pause", "stop" -> HiveNotifService.transport(ctx) { it.pause() }
            "play", "resume" -> HiveNotifService.transport(ctx) { it.play() }
            "next" -> HiveNotifService.transport(ctx) { it.skipToNext() }
            "prev" -> HiveNotifService.transport(ctx) { it.skipToPrevious() }
            else -> false
        }
        if (!done) return CmdReply("Nothing playing to control.", ok = false)
        return CmdReply(
            when (verb) {
                "pause", "stop" -> "Paused."
                "play", "resume" -> "Playing."
                "next" -> "Skipping."
                else -> "Back a track."
            })
    }

    private fun a11y(action: Int, ctx: Context, okText: String): CmdReply {
        if (!HiveA11y.isEnabled(ctx)) {
            runCatching { ctx.startActivity(HiveA11y.settingsIntent()) }
            return CmdReply(
                "For that I need Accessibility — enable AgentHive here and ask again.",
                ok = false)
        }
        return if (HiveA11y.global(action)) CmdReply(okText)
        else CmdReply("Couldn't do that right now.", ok = false)
    }

    /** Null → not a device command, hand to the LLM. */
    fun handle(ctx: Context, raw: String): CmdReply? {
        val t = raw.trim().lowercase().trimEnd('.', '!', '?')
        if (t.isBlank()) return null

        // ---- "on my phone" forwards (before the local open-app matcher) ---
        Regex("^(?:open|launch|start|load|pull up|bring up)\\s+(.+?)\\s+on (?:my|the) phone$")
            .find(t)?.let { m ->
                val name = m.groupValues[1].trim()
                return CmdReply("Opening $name on your phone…",
                    deferred = { PhoneBridge.phoneIntent(
                        ctx, "app:$name", "Sent “$name” to your phone.") })
            }
        Regex("^navigate (?:to |me to )?(.+?) on (?:my|the) phone$")
            .find(t)?.let { m ->
                val dest = m.groupValues[1].trim()
                return CmdReply("Sending directions…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "uri:google.navigation:q=" +
                            android.net.Uri.encode(dest),
                        "Navigating to $dest on your phone.") })
            }
        Regex("^(?:turn|switch|toggle)?\\s*(?:my |the )?phone('s)? (?:torch|flashlight|light|flash) (on|off)$|^(?:torch|flashlight|flash) (on|off) on (?:my|the) phone$")
            .find(t)?.let { m ->
                val on = m.groupValues[2] == "on" || m.groupValues[3] == "on"
                return CmdReply(if (on) "Lighting it up…" else "Killing it…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "torch:${if (on) "on" else "off"}",
                        "Phone torch ${if (on) "on" else "off"}.") })
            }
        Regex("^(?:put|set|switch|silence|mute|unmute)\\s*(?:my |the )?phone (?:on |to )?(silent|vibrate|normal|sound|loud|mute|unmute)$")
            .find(t)?.let { m ->
                val mode = when (m.groupValues[1]) {
                    "mute" -> "silent"; "unmute", "sound", "loud" -> "normal"
                    else -> m.groupValues[1] }
                return CmdReply("Setting the ringer…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "ringer:$mode", "Phone ringer → $mode.") })
            }
        // "what's this song on my phone" → phone-side Google Sound Search.
        // Needs an ID verb — "next track on my phone" is media transport.
        Regex("^(?:what'?s|what is|which|identify|name|shazam|recognize|tell me|find|listen for)\\b.*\\b(?:song|track|music|tune)\\b.* on (?:my|the) phone$|^(?:what song|what track|what tune|shazam|identify|recognize|name|listen to)\\b.* on (?:my|the) phone$")
            .find(t)?.let {
                return CmdReply("Waking the song finder…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "music:", "Song search is listening on your phone.") })
            }
        Regex("^(?:take|open|launch|snap)?\\s*(?:a )?(photo|picture|selfie|camera|the camera) on (?:my|the) phone$|^camera on (?:my|the) phone$")
            .find(t)?.let {
                return CmdReply("Opening the camera…",
                    deferred = { PhoneBridge.phoneIntent(
                        ctx, "cap:camera", "Camera's up on your phone.") })
            }
        Regex("^(?:call|dial|phone) (.+?) on (?:my|the) phone$")
            .find(t)?.let { m ->
                val who = m.groupValues[1].trim()
                return CmdReply("Passing the call…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "call:$who", "Dialing $who on your phone.") })
            }
        Regex("^(?:text|sms|message) (.+?) on (?:my|the) phone$")
            .find(t)?.let { m ->
                val who = m.groupValues[1].trim()
                return CmdReply("Opening the composer…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "sms:$who", "Text composer is up for $who on your phone.") })
            }
        // WhatsApp — mirrors Google's /whatsappmessage channel; the phone
        // resolves the name and opens the WhatsApp send sheet.
        Regex("^(?:whatsapp|wa) (?:call |message |text )?(.+?)(?: on (?:my|the) phone)?$")
            .find(t)?.let { m ->
                val who = m.groupValues[1].trim()
                return CmdReply("Opening WhatsApp…",
                    deferred = { PhoneBridge.phoneIntent(ctx,
                        "wa:$who", "WhatsApp chat with $who is up on your phone.") })
            }

        // ---- open / launch apps -------------------------------------------
        Regex("^(?:open|launch|start|run|load|bring up|fire up|go to|pull up)\\s+(?:the\\s+|up\\s+)?(.+)$")
            .find(t)?.let { m ->
                val name = m.groupValues[1]
                // settings deep-links before generic app search
                if (name == "settings") {
                    settingsDeep(ctx, "settings")
                    return CmdReply("Opening settings")
                }
                Regex("^(wifi|bluetooth|bt|battery|display|airplane|date|location|locate)\\s+settings$")
                    .find(name)?.let { s ->
                        settingsDeep(ctx, s.groupValues[1])
                        return CmdReply("Opening ${s.groupValues[1]} settings")
                    }
                if (name == "notification access" || name == "notification settings") {
                    runCatching { ctx.startActivity(HiveNotifService.settingsIntent()) }
                    return CmdReply("Opening notification access")
                }
                // "start a run"/"track a walk" — workout verbs defer to the
                // HealthWorkout matcher below, not the app opener.
                if (t.matches(Regex("^(?:start|begin|track|log|record)\\s+.*"))) {
                    val exercise = HealthWorkout.typeFor(
                        name.removePrefix("a ").removePrefix("an ")
                            .removePrefix("my "))
                    if (exercise != null) return@let null
                }
                return openApp(ctx, name)
            }

        // ---- settings (bare form) ------------------------------------------
        if (t == "settings") {
            settingsDeep(ctx, "settings"); return CmdReply("Opening settings")
        }

        // ---- media transport -----------------------------------------------
        Regex("^(pause|stop|play|resume|unpause)(?:\\s+(?:the\\s+)?(?:music|audio|media|song|track|it))?$")
            .find(t)?.let { m -> return media(ctx, m.groupValues[1].let {
                if (it == "unpause") "resume" else it }) }
        Regex("^(next|skip)(?:\\s+(?:the\\s+)?(?:track|song|music))?$")
            .find(t)?.let { return media(ctx, "next") }
        Regex("^(?:previous|prev|back)(?:\\s+(?:the\\s+)?(?:track|song|music))$")
            .find(t)?.let { return media(ctx, "prev") }

        // ---- volume ---------------------------------------------------------
        when (t) {
            "volume up", "louder", "turn it up", "turn up", "volume up a bit" -> {
                am(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
                return CmdReply("Volume up")
            }
            "volume down", "quieter", "turn it down", "turn down", "volume down a bit" -> {
                am(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                return CmdReply("Volume down")
            }
            "volume max", "max volume", "full volume", "loudest" -> {
                am(ctx).setStreamVolume(AudioManager.STREAM_MUSIC,
                    am(ctx).getStreamMaxVolume(AudioManager.STREAM_MUSIC),
                    AudioManager.FLAG_SHOW_UI)
                return CmdReply("Volume maxed")
            }
            "volume", "volume settings", "volume level" -> {
                am(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_SAME, AudioManager.FLAG_SHOW_UI)
                return CmdReply("There's the volume slider.")
            }
            "mute", "mute volume", "volume mute" -> {
                am(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI)
                return CmdReply("Muted")
            }
            "unmute", "unmute volume" -> {
                am(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI)
                return CmdReply("Unmuted")
            }
        }
        Regex("^volume (?:to )?(\\d+)$").find(t)?.let { m ->
            val pct = m.groupValues[1].toIntOrNull()?.coerceIn(0, 100) ?: 50
            am(ctx).setStreamVolume(AudioManager.STREAM_MUSIC,
                am(ctx).getStreamMaxVolume(AudioManager.STREAM_MUSIC) * pct / 100,
                AudioManager.FLAG_SHOW_UI)
            return CmdReply("Volume set to $pct%")
        }
        // per-stream volumes — ring/alarm like Gemini's audio controls
        Regex("^(alarm|ringer|notification) volume\\s*(up|down|to \\d+|max)?$")
            .find(t)?.let { m ->
                val stream = when (m.groupValues[1]) {
                    "alarm" -> AudioManager.STREAM_ALARM
                    else -> AudioManager.STREAM_RING
                }
                when (m.groupValues[2].trim()) {
                    "up" -> am(ctx).adjustStreamVolume(stream,
                        AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
                    "down" -> am(ctx).adjustStreamVolume(stream,
                        AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                    "max" -> am(ctx).setStreamVolume(stream,
                        am(ctx).getStreamMaxVolume(stream), AudioManager.FLAG_SHOW_UI)
                    "" -> am(ctx).adjustStreamVolume(stream,
                        AudioManager.ADJUST_SAME, AudioManager.FLAG_SHOW_UI)
                    else -> Regex("\\d+").find(m.groupValues[2])?.value?.toIntOrNull()
                        ?.let { pct ->
                            am(ctx).setStreamVolume(stream,
                                am(ctx).getStreamMaxVolume(stream) *
                                    pct.coerceIn(0, 100) / 100,
                                AudioManager.FLAG_SHOW_UI)
                        }
                }
                return CmdReply("Adjusting ${m.groupValues[1]} volume.")
            }

        // ---- navigation (needs AccessibilityService) ------------------------
        when (t) {
            "go home", "home", "home screen", "watch face", "go to watch face" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_HOME, ctx, "Going home")
            "go back", "back", "navigate back" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_BACK, ctx, "Going back")
            "notifications", "open notifications", "show notifications" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS,
                    ctx, "Opening notifications")
            "quick settings", "open quick settings", "control center" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS,
                    ctx, "Opening quick settings")
            "recent apps", "app switcher", "recents", "open recents" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_RECENTS,
                    ctx, "Opening recents")
            "power menu", "power options", "shut down menu" ->
                return a11y(AccessibilityService.GLOBAL_ACTION_POWER_DIALOG,
                    ctx, "Opening power menu")
        }

        // ---- clock: timers / alarms (SET_ALARM is auto-granted) ---------------
        Regex("^(?:set (?:a )?)?timer(?:\\s+for)?\\s+(\\d+)\\s*(second|sec|minute|min|hour|hr)s?\\b")
            .find(t)?.let { m ->
                val n = m.groupValues[1].toIntOrNull() ?: 0
                val secs = when (m.groupValues[2].first()) {
                    's' -> n
                    'm' -> n * 60
                    else -> n * 3600
                }
                val ok = fire(ctx, Intent("android.intent.action.SET_TIMER")
                    .putExtra("android.intent.extra.alarm.LENGTH", secs)
                    .putExtra("android.intent.extra.alarm.MESSAGE",
                        "$n ${m.groupValues[2]} timer"))
                return CmdReply(if (ok) "Timer set for $n ${m.groupValues[2]}s"
                    else "No clock app here handles timers.", ok = ok)
            }
        Regex("^(?:set (?:an )?)?alarm\\s+(?:for|at)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?")
            .find(t)?.let { m ->
                var h = m.groupValues[1].toInt()
                val ap = m.groupValues[3]
                if (ap == "pm" && h < 12) h += 12
                if (ap == "am" && h == 12) h = 0
                val mins = m.groupValues[2].toIntOrNull() ?: 0
                val ok = fire(ctx, Intent("android.intent.action.SET_ALARM")
                    .putExtra("android.intent.extra.alarm.HOUR", h)
                    .putExtra("android.intent.extra.alarm.MINUTES", mins))
                return CmdReply(
                    if (ok) "Alarm set for %d:%02d %s".format(
                        if (h % 12 == 0) 12 else h % 12, mins,
                        if (h < 12) "am" else "pm")
                    else "No clock app here handles alarms.", ok = ok)
            }
        Regex("^(?:set (?:an )?)?alarm (\\d{1,2})(\\d{2})\\s*(am|pm)?").find(t)
            ?.let { m ->
                var h = m.groupValues[1].toInt()
                if (m.groupValues[3] == "pm" && h < 12) h += 12
                val ok = fire(ctx, Intent("android.intent.action.SET_ALARM")
                    .putExtra("android.intent.extra.alarm.HOUR", h)
                    .putExtra("android.intent.extra.alarm.MINUTES",
                        m.groupValues[2].toInt()))
                return CmdReply(if (ok) "Alarm set" else "No clock app here.", ok = ok)
            }
        // Samsung's TimerAssistantHandleActivity exposes pause/resume/reset/
        // dismiss — real timer control, not just a UI hop (Gemini parity).
        Regex("^(?:pause|hold|resume|restart|reset|stop|cancel|dismiss|snooze)\\s+(?:the |my )?timer\\b.*$")
            .find(t)?.let { m ->
                val action = when (m.groupValues[0].split(Regex("\\s+"))[0]) {
                    "pause", "hold" -> "com.samsung.android.watch.timer.action.PAUSE_TIMER"
                    "resume", "restart" -> "com.samsung.android.watch.timer.action.RESUME_TIMER"
                    "reset" -> "com.samsung.android.watch.timer.action.RESET_TIMER"
                    else -> "android.intent.action.DISMISS_TIMER"
                }
                val ok = fire(ctx, Intent(action))
                return CmdReply(when (m.groupValues[0].split(Regex("\\s+"))[0]) {
                    "pause", "hold" -> if (ok) "Timer paused." else "No running timer to pause."
                    "resume", "restart" -> if (ok) "Timer resumed." else "No paused timer."
                    "reset" -> if (ok) "Timer reset." else "No running timer."
                    else -> if (ok) "Timer dismissed." else "No timer running."
                }, ok = ok)
            }
        Regex("^(?:dismiss|stop|cancel|turn off)\\s+(?:the |my )?alarm\\b.*$|^alarm off$")
            .find(t)?.let {
                val ok = fire(ctx, Intent("android.intent.action.DISMISS_ALARM"))
                return CmdReply(if (ok) "Alarm dismissed." else "No ringing alarm.", ok = ok)
            }
        Regex("^(?:snooze)\\s*(?:the |my )?alarm\\b.*$|^snooze$")
            .find(t)?.let {
                val ok = fire(ctx, Intent("android.intent.action.SNOOZE_ALARM"))
                return CmdReply(if (ok) "Snoozed." else "No ringing alarm.", ok = ok)
            }
        Regex("^(?:how long|how much time|time left|what'?s left|remaining)(?:\\s+(?:is\\s+)?(?:left\\s+)?on)?\\s*(?:my |the )?timer\\b.*$|^timer left$")
            .find(t)?.let {
                val ok = fire(ctx, Intent(
                    "com.samsung.android.app.wear.timer.SHOW_REMAINING_TIME"))
                    || fire(ctx, Intent("android.intent.action.SHOW_TIMERS"))
                return CmdReply(if (ok) "Showing your timer." else "No timer view here.", ok = ok)
            }
        when (t) {
            "wake me", "set an alarm", "open alarms", "alarms", "my alarms" -> {
                if (fire(ctx, Intent("android.intent.action.SHOW_ALARMS")))
                    return CmdReply("Opening alarms")
                return openApp(ctx, "clock")
            }
            "timers", "my timers", "open timer" -> {
                if (fire(ctx, Intent("android.intent.action.SHOW_TIMERS")))
                    return CmdReply("Opening timers")
                return openApp(ctx, "clock")
            }
        }

        // ---- reminders (alarm/timer carrying your message) ----------------------
        Regex("^remind me to\\s+(.+?)\\s+in\\s+(\\d+)\\s*(second|sec|minute|min|hour|hr)s?\\b")
            .find(t)?.let { m ->
                val what = m.groupValues[1]
                val n = m.groupValues[2].toIntOrNull() ?: 0
                val secs = when (m.groupValues[3].first()) {
                    's' -> n
                    'm' -> n * 60
                    else -> n * 3600
                }
                val ok = fire(ctx, Intent("android.intent.action.SET_TIMER")
                    .putExtra("android.intent.extra.alarm.LENGTH", secs)
                    .putExtra("android.intent.extra.alarm.MESSAGE", what))
                return CmdReply(if (ok) "I'll remind you to $what in $n ${m.groupValues[3]}s."
                    else "No clock app here handles reminders.", ok = ok)
            }
        Regex("^remind me to\\s+(.+?)\\s+at\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?")
            .find(t)?.let { m ->
                val what = m.groupValues[1]
                var h = m.groupValues[2].toInt()
                val ap = m.groupValues[4]
                if (ap == "pm" && h < 12) h += 12
                if (ap == "am" && h == 12) h = 0
                val ok = fire(ctx, Intent("android.intent.action.SET_ALARM")
                    .putExtra("android.intent.extra.alarm.HOUR", h)
                    .putExtra("android.intent.extra.alarm.MINUTES",
                        m.groupValues[3].toIntOrNull() ?: 0)
                    .putExtra("android.intent.extra.alarm.MESSAGE", what))
                return CmdReply(if (ok) "Reminder set — I'll nudge you to $what."
                    else "No clock app here handles reminders.", ok = ok)
            }
        // "remind me to call mom when i get to the office" — geofence reminder.
        Regex("^remind me (?:to )?(.+?)\\s+when i (?:get|arrive|reach)(?: to)?\\s+(.+)$")
            .find(t)?.let { m ->
                val what = m.groupValues[1].trim()
                val place = m.groupValues[2].trim()
                return CmdReply("Finding that place…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        val query = if (place.matches(Regex(
                                "home|work|office|the office|school|the gym|gym"))) {
                            // resolve through memory ("my home address is …")
                            val api = (ctx.applicationContext as?
                                dev.agenthive.watch.HiveApp)?.api
                            val key = place.removePrefix("the ").trim()
                            val arr = runCatching { api?.memoryList() }.getOrNull()
                            val hit = arr?.let { a ->
                                (0 until a.length()).map { a.getJSONObject(it) }
                                    .map { it.optString("t") }
                                    .firstOrNull { s ->
                                        s.contains(key, true) &&
                                            s.contains(Regex("address|is at|lives at|is ")) }
                            }
                            hit?.let { s ->
                                Regex("(?:is at|lives at|address:? is|is|:)\\s*(.+)$")
                                    .find(s)?.groupValues?.get(1)?.trim()
                            } ?: place
                        } else place
                        val geo = GeoReminder.geocode(ctx, query)
                        if (geo == null) {
                            "Couldn't place “$query” — try a fuller address."
                        } else {
                            val here = GeoReminder.lastLocation(ctx)
                            val dist = here?.let {
                                FloatArray(1).also { d ->
                                    android.location.Location.distanceBetween(
                                        it.latitude, it.longitude,
                                        geo.lat, geo.lon, d) }[0]
                            } ?: Float.MAX_VALUE
                            if (dist < 150) "You're already at ${geo.label}."
                            else GeoReminder.arm(ctx, what, geo.lat, geo.lon)
                                ?: "I'll remind you to $what when you get to ${geo.label}."
                        }
                    }
                })
            }
        if (t == "remind me" || t == "reminders" || t == "my reminders") {
            val ok = fire(ctx, Intent("android.intent.action.SHOW_ALARMS"))
            return CmdReply(if (ok) "Opening your reminders" else openApp(ctx, "clock").text)
        }

        // ---- calendar (INSERT intent — no calendar permission needed) ------------
        Regex("^(?:create|add|schedule|make)(?:\\s+(?:a|an|me a))?\\s+(?:calendar\\s+)?(?:event|appointment|meeting)\\s*(?:called|named|titled)?\\s*(.*)$")
            .find(t)?.let { m ->
                val title = m.groupValues[1].trim()
                    .removeSurrounding("\"").ifBlank { "New event" }
                val ok = fire(ctx, Intent(Intent.ACTION_INSERT)
                    .setData(android.provider.CalendarContract.Events.CONTENT_URI)
                    .putExtra(android.provider.CalendarContract.Events.TITLE, title))
                return CmdReply(if (ok) "Opening a new event: $title"
                    else "No calendar app on this watch.", ok = ok)
            }

        // ---- places / navigation ----------------------------------------------
        Regex("^(?:navigate (?:me )?to|directions to|take me to|guide me to)\\s+(.+)$")
            .find(t)?.let { m ->
                val q = android.net.Uri.encode(m.groupValues[1])
                val ok = fire(ctx, Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("google.navigation:q=$q")))
                        || fire(ctx, Intent(Intent.ACTION_VIEW,
                            android.net.Uri.parse("geo:0,0?q=$q")))
                return CmdReply(if (ok) "Navigating to ${m.groupValues[1]}"
                    else "No maps app on this watch.", ok = ok)
            }

        // ---- calls / texts ----------------------------------------------------
        Regex("^(?:call|dial|phone)\\s+([+0-9() .-]{5,})$").find(t)?.let { m ->
            val num = m.groupValues[1].trim()
            val ok = fire(ctx, Intent(Intent.ACTION_DIAL,
                android.net.Uri.parse("tel:${android.net.Uri.encode(num)}")))
            return CmdReply(if (ok) "Dialing $num" else "No dialer here.", ok = ok)
        }
        // "call mike" — spoken name → contact lookup → dial
        Regex("^(?:call|dial|phone)\\s+(.+)$").find(t)?.let { m ->
            val who = m.groupValues[1].trim()
            val (hit, err) = ContactsProbe.lookup(ctx, who)
            if (err != null) return CmdReply(err, ok = false)
            if (hit == null) return CmdReply("No contact named “$who”.", ok = false)
            val ok = fire(ctx, Intent(Intent.ACTION_DIAL,
                android.net.Uri.parse("tel:${android.net.Uri.encode(hit.number)}")))
            return CmdReply(if (ok) "Dialing ${hit.name}" else "No dialer here.", ok = ok)
        }
        if (t == "call" || t == "phone" || t == "dialer" || t == "open phone") {
            val ok = fire(ctx, Intent(Intent.ACTION_DIAL))
            return CmdReply(if (ok) "Opening the dialer" else "No dialer here.", ok = ok)
        }
        // "text mike saying on my way" / "sms 5551234"
        Regex("^(?:text|sms|message)\\s+(.+?)(?:\\s+(?:saying|with|say)\\s+(.+))?$")
            .find(t)?.let { m ->
                var target = m.groupValues[1].trim()
                val body = m.groupValues[2].trim().removeSurrounding("\"")
                if (target == "me") target = "my number"
                val num = if (target.matches(Regex("[+0-9() .-]{5,}"))) target
                    else {
                        val (hit, err) = ContactsProbe.lookup(ctx, target)
                        if (err != null) return CmdReply(err, ok = false)
                        hit?.number ?: return CmdReply(
                            "No contact named “$target”.", ok = false)
                    }
                val ok = fire(ctx, Intent(Intent.ACTION_SENDTO,
                    android.net.Uri.parse("smsto:${android.net.Uri.encode(num)}"))
                    .apply { if (body.isNotBlank()) putExtra("sms_body", body) })
                return CmdReply(if (ok) "Opening a text to $num" else "No messages app here.", ok = ok)
            }

        // ---- health -----------------------------------------------------------
        Regex("^(?:what'?s|check|read|show)?\\s*(?:my )?(heart rate|pulse|bpm)\\b.*$")
            .find(t)?.let {
                return CmdReply("Checking your heart rate…", deferred = {
                    val bpm = HealthProbe.heartRate(ctx)
                    if (bpm == null) {
                        runCatching { ctx.startActivity(HealthProbe.grantIntent(ctx)) }
                        "Couldn't get a reading — grant Body sensors for AgentHive, and keep the watch snug."
                    } else "Your heart rate is ${bpm.toInt()} beats per minute."
                })
            }
        Regex("^(?:what'?s|check|read|show)?\\s*(?:the |my )?(air pressure|barometric pressure|barometer|pressure)\\b.*$")
            .find(t)?.let {
                return CmdReply("Reading the barometer…", deferred = {
                    val hpa = HealthProbe.pressure(ctx)
                    if (hpa == null) "This watch has no barometer reading right now."
                    else "Air pressure is ${hpa.toInt()} hectopascals."
                })
            }
        Regex("^(?:what'?s|how many|check|show)?\\s*(?:my )?(step count|steps)( today)?\\b.*$")
            .find(t)?.let {
                return CmdReply("Checking your steps…", deferred = {
                    val s = HealthProbe.steps(ctx)
                    if (s == null) {
                        runCatching { ctx.startActivity(HealthProbe.grantIntent(ctx)) }
                        "Couldn't read the step sensor — grant Body sensors for AgentHive."
                    } else "Step counter reads $s steps since the watch last restarted."
                })
            }

        // ---- flashlight --------------------------------------------------------
        if (t == "flashlight" || t == "torch" || t == "turn on the flashlight" ||
            t == "turn on flashlight" || t == "light" || t == "flashlight on") {
            val ok = fire(ctx, Intent(ctx, TorchActivity::class.java))
            return CmdReply(if (ok) "Flashlight on — tap the screen to turn it off."
                else "Couldn't open the flashlight.", ok = ok)
        }

        // ---- workouts (Health Services) -----------------------------------------
        Regex("^(?:start|begin|track|log|record)\\s+(?:a |an |my )?([a-z ]+?)\\s*(?:workout|exercise|session)?$")
            .find(t)?.let { m ->
                val kind = HealthWorkout.typeFor(m.groupValues[1].trim())
                    ?: return@let null
                return CmdReply("Starting your ${m.groupValues[1].trim()}…", deferred = {
                    HealthWorkout.start(ctx, kind, m.groupValues[1].trim())
                })
            }
        Regex("^(?:pause|hold)\\s+(?:my |the )?(?:workout|exercise|run|walk|ride|swim|session).*$")
            .find(t)?.let {
                return CmdReply("Pausing…", deferred = { HealthWorkout.pause(ctx) })
            }
        Regex("^(?:resume|continue|unpause)\\s+(?:my |the )?(?:workout|exercise|run|walk|ride|swim|session).*$")
            .find(t)?.let {
                return CmdReply("Resuming…", deferred = { HealthWorkout.resume(ctx) })
            }
        Regex("^(?:end|stop|finish|complete)\\s+(?:my |the )?(?:workout|exercise|run|walk|ride|swim|session).*$")
            .find(t)?.let {
                return CmdReply("Ending your workout…", deferred = { HealthWorkout.end(ctx) })
            }
        Regex("^(?:workout|exercise)\\s+status$|^am i working out.*$|^(?:my )?workout.*$")
            .find(t)?.let {
                return CmdReply("Checking…", deferred = { HealthWorkout.status(ctx) })
            }

        // ---- what's playing ----------------------------------------------------
        Regex("^(?:what'?s|what is|what song is)?\\s*(?:this|playing|this song|this track|the song|now playing)\\b.*$|^what am i listening to.*$|^song.*$")
            .find(t)?.takeIf { !t.endsWith(" on my phone") &&
                             !t.endsWith(" on the phone") }?.let {
                if (!HiveNotifService.isEnabled(ctx))
                    return CmdReply("I need notification access to see media — enable AgentHive in Special app access.", ok = false)
                val np = HiveNotifService.nowPlaying(ctx)
                return CmdReply(np ?: "Nothing is playing right now.")
            }

        // ---- reply to a notification --------------------------------------------
        Regex("^(?:reply|respond|answer)(?:\\s+to)?(?:\\s+(?:it|that|the (?:latest|last) (?:message|notification|text)))?\\s+(?:saying|with|say)\\s+(.+)$")
            .find(t)?.let { m ->
                if (!HiveNotifService.isEnabled(ctx)) {
                    runCatching { ctx.startActivity(HiveNotifService.settingsIntent()) }
                    return CmdReply("I need notification access — enable AgentHive here.", ok = false)
                }
                return CmdReply(HiveNotifService.replyToLatest(
                    ctx, m.groupValues[1].trim().removeSurrounding("\"")))
            }

        // ---- notifications -----------------------------------------------------
        Regex("^(?:read|show|what(?:'s| are))\\s+(?:my )?(?:new )?notifications?.*$|^any notifications.*$")
            .find(t)?.let {
                if (!HiveNotifService.isEnabled(ctx)) {
                    runCatching { ctx.startActivity(HiveNotifService.settingsIntent()) }
                    return CmdReply("I need notification access — enable AgentHive here, then ask again.", ok = false)
                }
                val items = HiveNotifService.latest(ctx)
                return CmdReply(if (items.isEmpty()) "No notifications right now."
                    else "You have ${items.size}: " + items.joinToString(". "))
            }

        // ---- screen awareness ---------------------------------------------------
        Regex("^(?:what'?s|what is|describe|read)\\s+(?:on )?my screen.*$|^what am i looking at.*$")
            .find(t)?.let {
                if (!HiveA11y.isEnabled(ctx)) {
                    runCatching { ctx.startActivity(HiveA11y.settingsIntent()) }
                    return CmdReply("I need Accessibility to see your screen — enable AgentHive here.", ok = false)
                }
                val lines = HiveA11y.visibleText().filter { it.isNotBlank() }.take(14)
                return CmdReply(if (lines.isEmpty()) "I can't read the screen right now."
                    else "I see: " + lines.joinToString(" · "))
            }

        // ---- device status ------------------------------------------------------
        // "phone battery" — ask the phone over the Wear data layer first
        // (real value, like Assistant); fall back to mining the battery
        // notification the system posts.
        Regex("^(?:what'?s|how'?s|check)?\\s*(?:my )?phone('s| is)? (battery|charge)\\b.*$|^phone battery$")
            .find(t)?.let {
                return CmdReply("Asking your phone…", deferred = {
                    val viaBridge = PhoneBridge.phoneStatus(ctx)
                    if (viaBridge.startsWith("Your phone")) viaBridge
                    else if (HiveNotifService.isEnabled(ctx))
                        HiveNotifService.latest(ctx)
                            .firstOrNull { it.contains("battery", true) ||
                                           it.contains("%") }
                            ?: viaBridge
                    else viaBridge
                })
            }
        Regex("^(?:turn|set|make|crank)?\\s*(?:my |the )?phone('s)? (?:media )?volume (up|down|louder|quieter|lower)\\b.*$")
            .find(t)?.let {
                val up = !it.groupValues[2].let { d ->
                    d.contains("down") || d.contains("quieter") || d.contains("lower") }
                return CmdReply(
                    if (up) "Turning the phone up…" else "Turning the phone down…",
                    deferred = { PhoneBridge.phoneVolume(ctx, up) })
            }
        Regex("^(?:what'?s|how'?s|check)?\\s*(?:my )?(battery|battery level|charge|charge level)\\b.*$")
            .find(t)?.let {
                val bm = ctx.getSystemService(Context.BATTERY_SERVICE)
                    as android.os.BatteryManager
                val pct = bm.getIntProperty(
                    android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
                return CmdReply(if (pct > 0) "Battery is at $pct%." else "Can't read the battery.")
            }
        if (t == "what time is it" || t == "the time" || t == "time" ||
            t == "what day is it" || t == "what's the date" || t == "today's date") {
            val now = java.time.LocalDateTime.now()
            return CmdReply(now.format(
                java.time.format.DateTimeFormatter.ofPattern(
                    if (t.contains("day") || t.contains("date"))
                        "EEEE, MMMM d" else "h:mm a")))
        }

        // ---- weather (open-meteo, no key needed) ------------------------------
        Regex("^will it (rain|snow)( today| tonight| tomorrow)?.*$|^(?:chance|odds) of (rain|snow).*$")
            .find(t)?.let { m ->
                val tomorrow = m.groupValues[0].contains("tomorrow")
                return CmdReply("Checking…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        WeatherProbe.forecast(ctx, tomorrow)
                            ?: WeatherProbe.current(ctx)
                            ?: "I couldn't get the weather."
                    }
                })
            }
        Regex("^.*weather.*tomorrow.*$|^tomorrow'?s (?:weather|forecast).*$|^(?:weather|forecast) (?:for )?tomorrow.*$")
            .find(t)?.let {
                return CmdReply("Checking tomorrow…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        WeatherProbe.forecast(ctx, true)
                            ?: "I couldn't get the forecast."
                    }
                })
            }
        Regex("^(?:what'?s|what is|how'?s|check|tell me)?\\s*(?:the\\s+)?(weather|forecast|temperature)(?:\\s+(?:like|outside|today|now|here))?$")
            .find(t)?.let {
                return CmdReply("Checking the weather…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        WeatherProbe.current(ctx) ?: "I couldn't get the weather."
                    }
                })
            }

        // ---- GPS reads (altitude / speed / where am I) --------------------------
        Regex("^(?:how (?:high|far up)|what'?s (?:my|the) (?:altitude|elevation)|elevation|altitude)\\b.*$")
            .find(t)?.let {
                return CmdReply("Checking the GPS…", deferred = {
                    GpsProbe.altitude(ctx)
                })
            }
        Regex("^(?:how fast|what'?s my speed|current speed|how fast am (?:i|we))\\b.*$")
            .find(t)?.let {
                return CmdReply("Checking the GPS…", deferred = {
                    GpsProbe.speed(ctx)
                })
            }
        Regex("^(?:where am i|what'?s my location|where are we)\\b.*$")
            .find(t)?.let {
                return CmdReply("Working out where you are…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        GpsProbe.whereAmI(ctx)
                    }
                })
            }

        // ---- calendar reads (READ_CALENDAR) -------------------------------------
        Regex("^(?:what'?s|what is|show|read|check)?\\s*(?:on )?my (?:calendar|schedule|agenda)( today| tomorrow)?$|^(?:any|what) (?:events|meetings|appointments)( today| tomorrow)?.*$")
            .find(t)?.let { m ->
                val tomorrow = m.groupValues.any { it.contains("tomorrow") }
                return CmdReply("Checking your calendar…", deferred = {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        CalendarProbe.upcoming(ctx, tomorrow)
                    }
                })
            }

        // ---- countdown to a time --------------------------------------------------
        Regex("^how long (?:till|until|to)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*$")
            .find(t)?.let { m ->
                val now = java.time.LocalDateTime.now()
                var h = m.groupValues[1].toInt()
                val ap = m.groupValues[3]
                if (ap == "pm" && h < 12) h += 12
                if (ap == "am" && h == 12) h = 0
                if (ap.isBlank() && h <= now.hour) h += 12
                var target = now.toLocalDate().atTime(h % 24,
                    m.groupValues[2].toIntOrNull() ?: 0)
                if (target.isBefore(now)) target = target.plusDays(1)
                val d = java.time.Duration.between(now, target)
                val hh = d.toHours(); val mm = d.toMinutes() % 60
                return CmdReply("That's in " + when {
                    hh > 0 -> "${hh}h ${mm}m"
                    else -> "${mm} minutes"
                } + ".")
            }

        // ---- uptime / mesh status / identity --------------------------------------
        Regex("^(?:how long (?:has|have) (?:this watch|it|you) been (?:on|running)|uptime|watch uptime).*$")
            .find(t)?.let {
                val ms = android.os.SystemClock.elapsedRealtime()
                val h = ms / 3_600_000; val mm = (ms / 60_000) % 60
                return CmdReply("This watch has been up for ${h}h ${mm}m.")
            }
        Regex("^(?:mesh|hive|link) status$|^are we (?:linked|connected)\\b.*$|^is the mesh (?:up|working)\\b.*$")
            .find(t)?.let {
                val s = runCatching {
                    (ctx.applicationContext as? dev.agenthive.watch.HiveApp)?.store
                }.getOrNull()
                return if (s != null && s.paired && s.egressPort > 0)
                    CmdReply("Mesh link is up — egress on port ${s.egressPort}.")
                else if (s != null && s.paired)
                    CmdReply("Paired, but the egress bridge isn't up.")
                else CmdReply("Not paired to a hive.", ok = false)
            }
        Regex("^(?:who am i|what'?s my name|what do you call me)$")
            .find(t)?.let {
                val name = runCatching {
                    (ctx.applicationContext as? dev.agenthive.watch.HiveApp)?.store
                        ?.displayName
                }.getOrNull()
                return CmdReply(if (!name.isNullOrBlank()) "You're $name."
                    else "I don't know your name yet.")
            }

        // ---- phone media + notifications (Wear bridge, needs phone NL access) ----
        Regex("^(play|pause|stop|resume|unpause|next|skip|previous|prev|back)(?:\\s+(?:the\\s+)?(?:music|audio|media|song|track|it))? on (?:my|the) phone$")
            .find(t)?.let { m ->
                val verb = when (m.groupValues[1]) {
                    "unpause" -> "play"; "skip" -> "next"; "back" -> "prev"
                    else -> m.groupValues[1] }
                return CmdReply("Sending it…",
                    deferred = { PhoneBridge.phoneMedia(ctx, verb) })
            }
        Regex("^what'?s playing on (?:my|the) phone$|^what (?:is|was) playing on (?:my|the) phone$")
            .find(t)?.let {
                return CmdReply("Asking your phone…",
                    deferred = { PhoneBridge.phonePlaying(ctx) })
            }
        Regex("^(?:read|check|show|what are|any)(?:\\s+my)? phone'?s? notifications\\b.*$|^(?:any|what) notifications? on (?:my|the) phone\\b.*$")
            .find(t)?.let {
                return CmdReply("Checking your phone…",
                    deferred = { PhoneBridge.phoneNotifs(ctx) })
            }

        // ---- dice / coins / picks ------------------------------------------------
        Regex("^(?:flip|toss)\\s+(?:a )?coin.*$|^coin flip$|^heads or tails.*$")
            .find(t)?.let {
                return CmdReply(if (Math.random() < 0.5) "Heads." else "Tails.")
            }
        Regex("^(?:roll|throw)\\s+(?:a |an |the )?(?:(\\d+)[- ]?sided )?(?:dice|die|d(\\d+)).*$|^roll (\\d+)$")
            .find(t)?.let { m ->
                val sides = m.groupValues[1].toIntOrNull()
                    ?: m.groupValues[2].toIntOrNull()
                    ?: m.groupValues[3].toIntOrNull() ?: 6
                val n = sides.coerceIn(2, 1000)
                return CmdReply("🎲 ${(1..n).random()} of $n.")
            }
        Regex("^(?:pick|choose|random)\\s+(?:a )?(?:number )?between\\s+(\\d+)\\s+(?:and|to)\\s+(\\d+).*$")
            .find(t)?.let { m ->
                val a = m.groupValues[1].toIntOrNull() ?: 1
                val b = m.groupValues[2].toIntOrNull() ?: a + 10
                val (lo, hi) = if (a <= b) a to b else b to a
                return CmdReply("${(lo..hi).random()}.")
            }

        // ---- time in another city --------------------------------------------------
        Regex("^(?:what time is it in|time in|what'?s the time in)\\s+(.+)$")
            .find(t)?.let { m ->
                val zone = cityZone(m.groupValues[1])
                return if (zone == null) {
                    CmdReply("I don't know that city's timezone.", ok = false)
                } else {
                    val now = java.time.ZonedDateTime.now(zone)
                    CmdReply("In ${m.groupValues[1].replaceFirstChar { it.uppercase() }} it's " +
                        now.format(java.time.format.DateTimeFormatter.ofPattern("h:mm a")) + ".")
                }
            }

        // ---- stopwatch / clock ---------------------------------------------------
        when (t) {
            "stopwatch", "start stopwatch", "open stopwatch", "start a stopwatch" -> {
                val ok = runCatching {
                    ctx.packageManager.getLaunchIntentForPackage(
                        "com.samsung.android.watch.timer")
                        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        ?.let { ctx.startActivity(it); true } ?: false
                }.getOrDefault(false) || openApp(ctx, "clock").ok
                return CmdReply(if (ok) "Opening the stopwatch" else "No clock app here.", ok = ok)
            }
            "clock", "open clock" -> return openApp(ctx, "clock")
            "world clock", "open world clock" -> {
                val ok = runCatching {
                    ctx.packageManager.getLaunchIntentForPackage(
                        "com.samsung.android.watch.worldclock")
                        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        ?.let { ctx.startActivity(it); true } ?: false
                }.getOrDefault(false)
                return CmdReply(if (ok) "Opening world clock" else "No world clock here.", ok = ok)
            }
        }

        // ---- clear notifications -------------------------------------------------
        Regex("^(?:clear|dismiss|wipe|sweep)(?:\\s+(?:all\\s+)?(?:my\\s+)?)(?:the\\s+)?notifications\\b.*$")
            .find(t)?.let {
                if (!HiveNotifService.isEnabled(ctx))
                    return CmdReply("I need notification access to clear those — enable AgentHive.", ok = false)
                val n = HiveNotifService.clearAll()
                return CmdReply(if (n > 0) "Cleared $n notifications." else "Nothing to clear.")
            }

        // ---- haptics -------------------------------------------------------------
        Regex("^(?:vibrate|buzz|test vibration|haptic test)\\b.*$")
            .find(t)?.let {
                runCatching {
                    val vib = ctx.getSystemService(android.os.Vibrator::class.java)
                    vib?.vibrate(android.os.VibrationEffect.createOneShot(
                        600, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                }
                return CmdReply("Buzz.")
            }

        // ---- find my phone (Wear data layer → phone app) --------------------------
        Regex("^(?:find|ring|locate|where'?s|where is|ping)\\s*(?:my |the )?(phone|mobile)\\b.*$|^find my phone$")
            .find(t)?.let {
                return CmdReply("Looking for your phone…", deferred = {
                    PhoneBridge.findPhone(ctx)
                })
            }
        Regex("^(?:stop|silence|cancel|quiet) (?:my |the )?phone('s| is)? ?(?:alarm|ringing|ringtone)?$|^found it$|^stop (?:the )?ringing$")
            .find(t)?.let {
                return CmdReply("Silencing it…", deferred = {
                    PhoneBridge.stopPhone(ctx)
                })
            }

        // ---- voice memo (Samsung recorder) ----------------------------------------
        Regex("^(?:record|take|make|start|open)?\\s*(?:a )?(voice memo|voice note|voice recording|memo|recording|voice recorder)$")
            .find(t)?.let {
                val ok = runCatching {
                    ctx.packageManager.getLaunchIntentForPackage(
                        "com.samsung.android.wear.voicerecorder")
                        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        ?.let { ctx.startActivity(it); true } ?: false
                }.getOrDefault(false) || openApp(ctx, "recorder").ok
                return CmdReply(if (ok) "Opening the voice recorder" else "No voice recorder here.", ok = ok)
            }

        // ---- device info ----------------------------------------------------------
        Regex("^(?:what'?s|what is|how much|check)?\\s*(?:my )?(?:free |available )?(storage|disk space|space left|free space)\\b.*$")
            .find(t)?.let {
                val fs = android.os.StatFs(android.os.Environment.getDataDirectory().path)
                val free = fs.availableBytes / 1_000_000_000.0
                val total = fs.totalBytes / 1_000_000_000.0
                return CmdReply("%.1f GB free of %.0f GB.".format(free, total))
            }
        Regex("^(?:what (?:watch|device|model) (?:is this|am i wearing)|about (?:this|my) watch|watch info|device info)$")
            .find(t)?.let {
                return CmdReply("This is a ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} running Wear OS (API ${android.os.Build.VERSION.SDK_INT}).")
            }
        Regex("^(?:what'?s|what is)?\\s*(?:my )?(?:ip|ip address|wifi address)$")
            .find(t)?.let {
                val ip = runCatching {
                    java.net.NetworkInterface.getNetworkInterfaces().toList()
                        .flatMap { it.inetAddresses.toList() }
                        .firstOrNull { !it.isLoopbackAddress && it is java.net.Inet4Address }
                        ?.hostAddress
                }.getOrNull()
                return CmdReply(if (ip != null) "Your IP is $ip." else "No network address right now.")
            }

        // ---- system toggles (deep-link — Wear keeps toggles privileged) ---------------
        when (t) {
            "do not disturb", "dnd", "do not disturb on", "turn on do not disturb",
            "turn on dnd", "silence notifications", "focus mode", "theater mode", "goodnight mode" -> {
                val ok = fire(ctx, Intent("android.settings.ZEN_MODE_SETTINGS"))
                    || fire(ctx, Intent(Settings.ACTION_SETTINGS))
                return CmdReply(if (ok) "Opening modes — toggle from there." else "Couldn't open modes.", ok = ok)
            }
            "airplane mode", "turn on airplane mode", "airplane mode on" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS))
                return CmdReply(if (ok) "Opening airplane mode." else "Couldn't open settings.", ok = ok)
            }
            "wifi", "wi-fi", "wifi settings" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_WIFI_SETTINGS))
                return CmdReply(if (ok) "Opening Wi-Fi settings." else "Couldn't open settings.", ok = ok)
            }
            "bluetooth", "bluetooth settings" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                return CmdReply(if (ok) "Opening Bluetooth settings." else "Couldn't open settings.", ok = ok)
            }
            "brightness", "screen brightness", "display settings", "adjust brightness" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_DISPLAY_SETTINGS))
                return CmdReply(if (ok) "Opening display settings." else "Couldn't open settings.", ok = ok)
            }
            "battery saver", "turn on battery saver", "power saving mode" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS))
                return CmdReply(if (ok) "Opening battery saver settings." else "Couldn't open settings.", ok = ok)
            }
            "location settings", "turn on location" -> {
                val ok = fire(ctx, Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                return CmdReply(if (ok) "Opening location settings." else "Couldn't open settings.", ok = ok)
            }
        }

        // ---- memory ("remember this", Personal Context) -----------------------
        Regex("^(?:remember|note that|note|jot down|keep in mind(?: that)?)\\s*(?:that\\s+|to\\s+)?(.+)$")
            .find(t)?.let { m ->
            val what = m.groupValues[1].trim()
            if (what.isBlank()) return null
            return CmdReply("I'll remember that.", deferred = {
                val api = (ctx.applicationContext as? dev.agenthive.watch.HiveApp)?.api
                if (api == null || api.token.isBlank())
                    "No hive link — I kept it for this session only."
                else runCatching { api.memoryAdd(what); "Noted — I'll keep that in mind for everything you ask." }
                    .getOrElse { "Couldn't reach the hive to save it." }
            })
        }
        // "forget 2" drops item 2; "forget the wifi password" drops by match.
        Regex("^forget\\s+(?:that\\s+|about\\s+|item\\s+|number\\s+|#\\s*)?(.+)$")
            .find(t)?.let { m ->
            val what = m.groupValues[1].trim()
            if (what.isBlank()) return null
            return CmdReply("Checking what to forget…", deferred = {
                val api = (ctx.applicationContext as? dev.agenthive.watch.HiveApp)?.api
                if (api == null || api.token.isBlank())
                    "No hive link right now."
                else runCatching {
                    val arr = api.memoryList()
                    val idx = what.toIntOrNull()
                        ?: (1..arr.length()).firstOrNull { i ->
                            arr.getJSONObject(i - 1).optString("t")
                                .contains(what, ignoreCase = true)
                        }
                    if (idx == null || idx < 1 || idx > arr.length())
                        "I don't have that on my list — say \"what did I ask you to remember\" to see it."
                    else {
                        api.memoryForget(idx)
                        "Forgotten."
                    }
                }.getOrElse { "Couldn't reach the hive." }
            })
        }
        if (t == "what did i ask you to remember" || t == "my notes" ||
            t == "what do you remember" || t == "list my reminders" ||
            t == "recall" || t == "what do you remember about me") {
            return CmdReply("Checking…", deferred = {
                val api = (ctx.applicationContext as? dev.agenthive.watch.HiveApp)?.api
                if (api == null || api.token.isBlank())
                    "No hive link right now."
                else runCatching {
                    val arr = api.memoryList()
                    if (arr.length() == 0) "You haven't asked me to remember anything yet."
                    else "You asked me to remember: " +
                        (0 until arr.length()).joinToString(". ") { i ->
                            arr.getJSONObject(i).optString("t") }
                }.getOrElse { "Couldn't reach the hive." }
            })
        }

        // ---- tap by text -----------------------------------------------------
        Regex("^(?:tap|press|click|hit)\\s+(?:on\\s+|the\\s+)?(.+)$")
            .find(t)?.let { m ->
                if (!HiveA11y.isEnabled(ctx)) {
                    runCatching { ctx.startActivity(HiveA11y.settingsIntent()) }
                    return CmdReply(
                        "I need Accessibility to tap things — enable AgentHive here.",
                        ok = false)
                }
                val q = m.groupValues[1]
                return if (HiveA11y.clickText(q)) CmdReply("Tapped “$q”")
                else CmdReply("Can't see “$q” on screen.", ok = false)
            }

        // ---- self-describe ----------------------------------------------------
        if (t == "what can you do" || t == "help" || t == "commands") {
            return CmdReply(
                "I can open apps, play and identify music, run tasks inside " +
                "apps, set timers and alarms, navigate, call and text, reply " +
                "to your notifications, track workouts “start a run”, check " +
                "your heart rate, steps, weather and calendar, remember " +
                "things you tell me, read your battery and screen, work the " +
                "flashlight, flip coins and roll dice, change volume, ring " +
                "your phone, tap things — and answer anything through the hive.")
        }
        if (t == "what apps can you open" || t == "what apps are installed") {
            val names = launchables(ctx).map { it.second }
                .filter { it.isNotBlank() }.distinct().sorted().take(24)
            return CmdReply(if (names.isEmpty()) "No launchable apps found."
                else "I can open: " + names.joinToString(", "))
        }

        return null
    }

    /** spoken city → IANA zone for "what time is it in X". */
    private fun cityZone(city: String): java.time.ZoneId? {
        val c = city.trim().lowercase()
        val map = mapOf(
            "london" to "Europe/London", "paris" to "Europe/Paris",
            "berlin" to "Europe/Berlin", "madrid" to "Europe/Madrid",
            "rome" to "Europe/Rome", "amsterdam" to "Europe/Amsterdam",
            "moscow" to "Europe/Moscow", "athens" to "Europe/Athens",
            "zurich" to "Europe/Zurich", "dublin" to "Europe/Dublin",
            "new york" to "America/New_York", "nyc" to "America/New_York",
            "boston" to "America/New_York", "miami" to "America/New_York",
            "toronto" to "America/Toronto", "chicago" to "America/Chicago",
            "denver" to "America/Denver", "los angeles" to "America/Los_Angeles",
            "la" to "America/Los_Angeles", "san francisco" to "America/Los_Angeles",
            "seattle" to "America/Los_Angeles", "vancouver" to "America/Vancouver",
            "phoenix" to "America/Phoenix", "dallas" to "America/Chicago",
            "austin" to "America/Chicago", "anchorage" to "America/Anchorage",
            "honolulu" to "Pacific/Honolulu", "hawaii" to "Pacific/Honolulu",
            "mexico city" to "America/Mexico_City", "sao paulo" to "America/Sao_Paulo",
            "buenos aires" to "America/Argentina/Buenos_Aires",
            "tokyo" to "Asia/Tokyo", "seoul" to "Asia/Seoul",
            "beijing" to "Asia/Shanghai", "shanghai" to "Asia/Shanghai",
            "hong kong" to "Asia/Hong_Kong", "singapore" to "Asia/Singapore",
            "bangkok" to "Asia/Bangkok", "mumbai" to "Asia/Kolkata",
            "delhi" to "Asia/Kolkata", "dubai" to "Asia/Dubai",
            "tel aviv" to "Asia/Jerusalem", "istanbul" to "Europe/Istanbul",
            "sydney" to "Australia/Sydney", "melbourne" to "Australia/Melbourne",
            "auckland" to "Pacific/Auckland", "cairo" to "Africa/Cairo",
            "lagos" to "Africa/Lagos", "nairobi" to "Africa/Nairobi",
            "johannesburg" to "Africa/Johannesburg",
            "reykjavik" to "Atlantic/Reykjavik", "lisbon" to "Europe/Lisbon",
            "stockholm" to "Europe/Stockholm", "oslo" to "Europe/Oslo",
            "helsinki" to "Europe/Helsinki", "warsaw" to "Europe/Warsaw",
            "vienna" to "Europe/Vienna", "prague" to "Europe/Prague",
            "budapest" to "Europe/Budapest", "brussels" to "Europe/Brussels",
        )
        return map[c]?.let { java.time.ZoneId.of(it) }
    }
}
