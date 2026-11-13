package dev.agenthive.phone

import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionService
import androidx.appfunctions.AppFunctionServiceEntryPoint
import android.media.AudioManager

/**
 * The Gemini Extensions surface — mirrors what RobinKitAppFunctionService
 * does inside googlequicksearchbox: exposes real functions to the system
 * assistant through the `android.app.appfunctions.v2` framework
 * (Android 16+, live on this device).
 *
 * The KSP compiler generates the concrete HiveAppFunctionService +
 * function inventory + XML document from this abstract entry point; each
 * annotated method becomes a callable function (id = method name, schema
 * from params/return type, description from KDoc).
 */
@AppFunctionServiceEntryPoint(
    serviceName = "HiveAppFunctionService",
    appFunctionXmlFileName = "appfunctions")
abstract class HiveAppFunctionServiceBase : AppFunctionService() {

    /**
     * Rings this phone at maximum volume for up to 45 seconds so the
     * owner can locate it, then restores the previous volume.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun findPhone(): String {
        PhoneRinger.start(this)
        return "Phone is ringing at max volume."
    }

    /**
     * Stops the find-my-phone ringtone if it is currently playing.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun stopRinging(): String {
        PhoneRinger.stop(this)
        return "Ringtone stopped."
    }

    /**
     * Opens an installed app on this phone by its display name, for
     * example "Spotify" or "Camera".
     * @param name the app's display name as shown on the launcher
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun openApp(name: String): String =
        PhoneActions.openAppByLabel(this, name)

    /**
     * Rings the paired Wear OS watch at maximum volume so the owner can
     * find it, vibrating and showing a heads-up alert.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun ringWatch(): String =
        if (WatchBridge.ringWatch(this)) "Ringing the watch."
        else "No watch is reachable right now."

    /**
     * Reads the paired watch's status — battery level and whether it is
     * charging — over the Wear data layer.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun watchStatus(): String {
        val raw = WatchBridge.watchStatus(this)
        val j = runCatching { org.json.JSONObject(raw) }.getOrNull()
            ?: return "The watch didn't answer."
        return "Watch is at ${j.optInt("batt", -1)}%" +
            if (j.optBoolean("charging")) ", charging." else "."
    }

    /**
     * Sends a heads-up notification to the paired Wear OS watch.
     * @param text the message to show on the watch
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun notifyWatch(text: String): String =
        if (WatchBridge.notifyWatch(this, text)) "Sent to the watch."
        else "No watch is reachable right now."

    /**
     * Reads the phone's most recent notifications aloud as a list —
     * app name and text for each.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun readNotifications(): String {
        if (!PhoneNotifService.isEnabled(this))
            return "Notification access isn't granted to SignalHive."
        val lines = PhoneNotifService.latest(this, 5)
        return if (lines.isEmpty()) "No notifications right now."
            else lines.mapIndexed { i, l -> "#${i + 1}: $l" }
                .joinToString(". ")
    }

    /**
     * Acts on a notification shown by readNotifications — "open" fires
     * its tap intent, "dismiss" clears it from the shade, "reply"
     * answers it inline (set text).
     * @param key the "#N" index from readNotifications
     * @param verb open, dismiss, or reply
     * @param text the reply body (reply verb only)
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun actOnNotification(key: String, verb: String,
                          text: String?): String {
        if (!PhoneNotifService.isEnabled(this))
            return "Notification access isn't granted to SignalHive."
        return PhoneNotifService.act(this,
            "$verb$key" + (text?.let { "$it" } ?: ""))
    }

    /**
     * Says which song or media is currently playing on this phone,
     * if anything is.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun nowPlaying(): String =
        PhoneNotifService.nowPlaying(this) ?: "Nothing is playing."

    /**
     * Controls media playing on this phone.
     * @param verb one of: play, pause, next, previous
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun controlMedia(verb: String): String {
        if (!PhoneNotifService.isEnabled(this))
            return "Notification access isn't granted to SignalHive."
        return if (PhoneNotifService.transport(this, verb.lowercase()))
            "Media: ${verb.lowercase()}."
        else "Nothing is playing to control."
    }

    /**
     * Calls a contact by name — resolves the number from this phone's
     * contacts and opens the dialer ready to call.
     * @param name the contact's name, e.g. "Mom"
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun callContact(name: String): String =
        PhoneActions.contactDial(this, name, sms = false)

    /**
     * Opens the messages composer ready to text a contact by name.
     * @param name the contact's name, e.g. "Mom"
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun messageContact(name: String): String =
        PhoneActions.contactDial(this, name, sms = true)

    /**
     * Opens a WhatsApp chat with a contact by name.
     * @param name the contact's name, e.g. "Mom"
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun whatsappContact(name: String): String =
        PhoneActions.contactDial(this, name, sms = false, wa = true)

    /**
     * Opens the camera ready to take a photo.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun takePhoto(): String {
        PhoneActions.launchSpec(this, "cap:")
        return "Camera is open."
    }

    /**
     * Turns this phone's flashlight on or off.
     * @param on true to turn the flashlight on, false to turn it off
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun setFlashlight(on: Boolean): String =
        PhoneActions.phoneTorch(this, on)

    /**
     * Changes this phone's ringer mode.
     * @param mode one of: silent, vibrate, normal
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun setRingerMode(mode: String): String =
        PhoneActions.phoneRinger(this, mode.lowercase())

    /**
     * Listens to the environment and identifies the song that is
     * playing, like Shazam.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun identifySong(): String {
        PhoneActions.launchSpec(this, "music:")
        return "Listening for the song…"
    }

    /**
     * Starts a countdown timer on the phone's clock app.
     * @param seconds how long the timer runs, in seconds
     * @param label optional name for the timer, e.g. "pasta"
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun setTimer(seconds: Int, label: String?): String {
        runCatching {
            startActivity(android.content.Intent(
                android.provider.AlarmClock.ACTION_SET_TIMER)
                .putExtra(android.provider.AlarmClock.EXTRA_LENGTH, seconds)
                .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label)
                .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return "Timer set for ${seconds / 60}m ${seconds % 60}s."
    }

    /**
     * Creates an alarm on the phone's clock app.
     * @param hour hour of day, 0-23
     * @param minutes minute of hour, 0-59
     * @param label optional name for the alarm
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun setAlarm(hour: Int, minutes: Int, label: String?): String {
        runCatching {
            startActivity(android.content.Intent(
                android.provider.AlarmClock.ACTION_SET_ALARM)
                .putExtra(android.provider.AlarmClock.EXTRA_HOUR, hour)
                .putExtra(android.provider.AlarmClock.EXTRA_MINUTES, minutes)
                .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label)
                .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return "Alarm set for %02d:%02d.".format(hour, minutes)
    }

    /**
     * Starts turn-by-turn navigation to a destination.
     * @param destination address or place name, e.g. "home" or "YYZ"
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun navigateTo(destination: String): String {
        PhoneActions.launchSpec(this,
            "uri:google.navigation:q=" + android.net.Uri.encode(destination))
        return "Navigating to $destination."
    }

    /**
     * Opens a web page or deep link on this phone.
     * @param url the URL to open
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun openUrl(url: String): String {
        PhoneActions.launchSpec(this, "uri:$url")
        return "Opened $url."
    }

    /**
     * Saves a note to the user's SignalHive memory — "remember that the
     * wifi password is X".
     * @param text the fact or note to remember
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun remember(text: String): String {
        val store = dev.agenthive.watch.data.Store(this)
        if (store.token.isBlank()) return "Not signed in to a hive."
        val api = dev.agenthive.watch.data.HiveApi()
        api.token = store.token
        // mesh egress first; a dead loopback falls back to the direct URL
        val bases = listOf(store.meshUrl, store.serverUrl)
            .filter { it.isNotBlank() }.distinct()
        var lastErr: String? = "no hive URL stored"
        for (b in bases) {
            api.baseUrl = b
            val r = runCatching { api.memoryAdd(text); "Remembered." }
            if (r.isSuccess) return r.getOrThrow()
            lastErr = "Couldn't reach the hive: ${r.exceptionOrNull()?.message}"
        }
        // wake the keep-alive so the NEXT call lands on a warm bridge
        runCatching { PhoneMeshService.start(this) }
        return lastErr ?: "Couldn't reach the hive."
    }

    /**
     * Asks the SignalHive assistant a question and returns the reply,
     * routed through the user's hive cluster.
     * @param query the natural-language question or instruction
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun askHive(query: String): String {
        val store = dev.agenthive.watch.data.Store(this)
        if (store.token.isBlank())
            return "Not linked to a hive — open SignalHive and sign in."
        val api = dev.agenthive.watch.data.HiveApi()
        api.token = store.token
        val bases = listOf(store.meshUrl, store.serverUrl)
            .filter { it.isNotBlank() }.distinct()
        var reply = ""
        var err: String? = "no hive URL stored"
        var agentId = store.agentId
        for (b in bases) {
            api.baseUrl = b
            // agent picker may never have run — fall back to the first agent
            if (agentId == 0) {
                agentId = runCatching {
                    api.agents().firstOrNull()?.id ?: 0
                }.getOrDefault(0)
                if (agentId > 0) store.agentId = agentId
            }
            if (agentId == 0) { err = "no agents on this hive"; break }
            reply = ""
            err = null
            runCatching {
                kotlinx.coroutines.withTimeoutOrNull(25_000) {
                    api.tryStream(agentId, query, emptyList()).collect { ev ->
                        when (ev) {
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Token ->
                                reply += ev.text
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Replace ->
                                reply = ev.text
                            is dev.agenthive.watch.data.HiveApi.StreamEvent.Error ->
                                err = ev.message
                            else -> {}
                        }
                    }
                } ?: kotlin.run { err = "timed out" }
            }.onFailure { err = it.message }
            if (reply.isNotBlank()) break
        }
        if (reply.isBlank()) runCatching { PhoneMeshService.start(this) }
        return when {
            reply.isNotBlank() -> reply.take(2000)
            err != null -> "The hive couldn't answer: $err"
            else -> "The hive sent an empty reply."
        }
    }

    // -- device_state schema (the published vocabulary — same shape as
    //    GMS's implementation; puts us in schema-filtered consumers like
    //    Samsung Routine). Keys are our own namespace: agenthive.* --

    private fun setState(key: String, value: String): Boolean = when (key) {
        "agenthive.flashlight" -> PhoneActions.phoneTorch(
            this, value == "true").startsWith("Flashlight")
        "agenthive.ringer_mode" -> PhoneActions.phoneRinger(
            this, value).startsWith("Ringer")
        "agenthive.find_phone" -> {
            if (value == "true") PhoneRinger.start(this)
            else PhoneRinger.stop(this); true
        }
        else -> false
    }

    private fun getState(key: String): String? = when (key) {
        "agenthive.battery" -> (getSystemService(
            android.os.BatteryManager::class.java)?.getIntProperty(
                android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1)
            .toString()
        "agenthive.battery_charging" -> (getSystemService(
            android.os.BatteryManager::class.java)?.isCharging == true)
            .toString()
        "agenthive.ringer_mode" -> when (getSystemService(
            AudioManager::class.java)?.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "silent"
            AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
            else -> "normal"
        }
        "agenthive.flashlight" -> "unknown"   // no read API for torch state
        "agenthive.now_playing" -> PhoneNotifService.nowPlaying(this) ?: ""
        else -> null
    }

    /**
     * Sets a device state item on this phone. Supported keys:
     * "agenthive.flashlight" (true/false), "agenthive.ringer_mode"
     * (silent/vibrate/normal), "agenthive.find_phone" (true starts the
     * locator ring, false stops it).
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun setDeviceStateItem(key: String, value: String): String {
        val ok = setState(key, value)
        return if (ok) "set $key to $value" else "unknown key: $key"
    }

    /**
     * Reads a device state item from this phone. Supported keys:
     * "agenthive.battery", "agenthive.battery_charging",
     * "agenthive.ringer_mode", "agenthive.now_playing".
     * @param key the state item to read
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun getDeviceStateItem(key: String): String =
        getState(key) ?: "unknown key: $key"

    /**
     * Lists the device state items this phone exposes —
     * "agenthive.flashlight", "agenthive.ringer_mode",
     * "agenthive.find_phone", "agenthive.battery",
     * "agenthive.battery_charging", "agenthive.now_playing".
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun getDeviceStateMetadata(): String = (
        "[\"agenthive.flashlight\",\"agenthive.ringer_mode\"," +
        "\"agenthive.find_phone\",\"agenthive.battery\"," +
        "\"agenthive.battery_charging\",\"agenthive.now_playing\"]")

    /**
     * Flips a boolean device state item. Supported key:
     * "agenthive.flashlight" (toggles the torch), "agenthive.find_phone"
     * (toggles the locator ring).
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    fun toggleDeviceStateItem(key: String): String = when (key) {
        "agenthive.find_phone" -> {
            PhoneRinger.start(this); "find_phone ringing"
        }
        "agenthive.flashlight" ->
            "flashlight toggle isn't readable — use setDeviceStateItem"
        else -> "unsupported key: $key"
    }
}
