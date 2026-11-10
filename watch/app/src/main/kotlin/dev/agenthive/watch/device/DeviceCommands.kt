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
        if (t == "call" || t == "phone" || t == "dialer" || t == "open phone") {
            val ok = fire(ctx, Intent(Intent.ACTION_DIAL))
            return CmdReply(if (ok) "Opening the dialer" else "No dialer here.", ok = ok)
        }
        Regex("^(?:text|sms|message)\\s+([+0-9() .-]{5,})$").find(t)?.let { m ->
            val num = m.groupValues[1].trim()
            val ok = fire(ctx, Intent(Intent.ACTION_SENDTO,
                android.net.Uri.parse("smsto:${android.net.Uri.encode(num)}")))
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
            .find(t)?.let {
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
                "your heart rate and steps, remember things you tell me, read " +
                "your battery and screen, work the flashlight, change volume, " +
                "tap things — and answer anything through the hive.")
        }
        if (t == "what apps can you open" || t == "what apps are installed") {
            val names = launchables(ctx).map { it.second }
                .filter { it.isNotBlank() }.distinct().sorted().take(24)
            return CmdReply(if (names.isEmpty()) "No launchable apps found."
                else "I can open: " + names.joinToString(", "))
        }

        return null
    }
}
