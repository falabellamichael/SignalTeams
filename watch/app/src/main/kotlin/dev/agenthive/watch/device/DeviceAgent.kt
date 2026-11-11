package dev.agenthive.watch.device

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.agenthive.watch.data.HiveApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Persistent in-app task driver — "play a podcast about AI on Spotify".
 *
 * Loop: launch app → read screen (AccessibilityService) → ask the hive for
 * the next action (/api/llm/act) → execute → repeat until done. When the
 * model can't decide it returns "ask" — the loop parks itself, lists the
 * options to the user, and resumes when they answer. "stop"/"cancel" aborts.
 */
class DeviceAgent(
    private val ctx: Context,
    private val api: HiveApi,
    private val scope: CoroutineScope,
) {

    data class AgentMsg(val text: String, val meta: String = "⌁ device")

    /** Emit replies back to the chat surface. */
    var onMsg: ((AgentMsg) -> Unit)? = null

    private var job: Job? = null
    private var goal = ""
    private var appName = ""
    private var isResume = false
    private val steps = ArrayDeque<String>()
    private var awaitingPick = false
    private var launches = 0
    private var pendingOptions: List<Pair<String, String>> = emptyList()

    val active get() = job?.isActive == true || awaitingPick

    fun stop(silent: Boolean = false) {
        job?.cancel()
        job = null
        val wasAwaiting = awaitingPick
        awaitingPick = false
        if (!silent && (goal.isNotBlank() || wasAwaiting))
            onMsg?.invoke(AgentMsg("Stopped."))
        goal = ""; appName = ""; steps.clear()
    }

    /** A follow-up utterance while a task is parked on an "ask" — the user's
     *  pick feeds straight back into the loop. */
    fun feedPick(text: String): Boolean {
        if (!awaitingPick) return false
        awaitingPick = false
        run(text = text, picked = text, resumed = true)
        return true
    }

    fun run(text: String, picked: String = "", resumed: Boolean = false) {
        isResume = resumed
        if (!resumed) {
            goal = text
            appName = ""
            steps.clear()
            launches = 0
        }
        job = scope.launch {
            try {
                drive(picked)
            } catch (e: Exception) {
                onMsg?.invoke(AgentMsg("Stopped — ${e.message?.take(60) ?: "error"}", "⌁ device"))
            }
        }
    }

    // ---- the loop ------------------------------------------------------------

    private suspend fun drive(picked: String) {
        if (!HiveA11y.isEnabled(ctx)) {
            runCatching { ctx.startActivity(HiveA11y.settingsIntent()) }
            onMsg?.invoke(AgentMsg(
                "For in-app tasks I need Accessibility — enable Nexus Watch here and ask again."))
            return
        }
        // The ask may arrive while the mesh restore is still in flight —
        // wait for the session claim instead of failing the task instantly.
        var waited = 0L
        while ((api.token.isBlank() || api.baseUrl.isBlank()) && waited < 45_000) {
            delay(1000); waited += 1000
        }
        if (api.token.isBlank() || api.baseUrl.isBlank()) {
            onMsg?.invoke(AgentMsg("In-app tasks need the hive link up.", "⌁ device"))
            return
        }
        // "... on spotify" / "in the spotify app" → the target app name; the
        // resolve call and later act steps both need it before any launch runs.
        if (appName.isBlank()) {
            appName = Regex("(?i)\\b(?:on|in|using|from)\\s+(?:the\\s+)?([\\w .'-]{2,24}?)(?:\\s+app)?\\s*$")
                .find(goal)?.groupValues?.get(1)?.trim() ?: ""
        }
        // backend resolution first — the hive picks the concrete target
        // (grounded against real service links) and hands back a deep link or
        // an option list. This collapses ~15 UI steps into open+play.
        if (picked.isBlank() && !isResume) {
            val p = api.resolve(goal, appName)
            android.util.Log.i("DeviceAgent", "resolve -> ${p?.toString()?.take(200)}")
            p?.let {
                when (it.optString("action")) {
                    "deeplink" -> {
                        val uri = it.optString("uri")
                        pendingOptions = parseOptions(it)
                        if (uri.isNotBlank() && openUri(uri)) {
                            val lbl = pendingOptions
                                .firstOrNull { o -> o.second == uri }?.first
                                ?.take(60) ?: ""
                            steps.addLast("resolve: opened \"$lbl\" — " +
                                "the show/episode page should be on screen; " +
                                "tap its play button or the latest episode")
                            android.util.Log.i("DeviceAgent", "resolve openUri ok: $uri")
                        } else android.util.Log.w("DeviceAgent", "resolve openUri failed: $uri")
                    }
                    "search" -> {
                        val q = it.optString("query").trim()
                        if (q.isNotBlank() &&
                            openUri("spotify:search:${Uri.encode(q)}")) {
                            steps.addLast("resolve-search: $q")
                            android.util.Log.i("DeviceAgent", "resolve openUri search: $q")
                        }
                    }
                    "ask" -> {
                        pendingOptions = parseOptions(p)
                        awaitingPick = true
                        onMsg?.invoke(AgentMsg(
                            p.optString("text").ifBlank { "Which one?" } +
                                "\n(say a number or name)"))
                        return
                    }
                }
            }
        }
        // a user's pick from a resolve-option list — open that URI directly,
        // no model roundtrip needed.
        if (picked.isNotBlank()) {
            matchOption(picked)?.let { uri ->
                if (openUri(uri)) steps.addLast("picked: ${uri.take(70)}")
            }
        }
        val maxSteps = 26
        var n = 0
        var netFails = 0
        var lastScreen: List<String> = emptyList()
        var sameScreen = 0
        if (!isResume) onMsg?.invoke(AgentMsg("Working on it — \"$goal\""))
        var lockWarned = false
        while (n++ < maxSteps) {
            if (api.token.isBlank()) break
            // a PIN keyguard buries every foreign app — surface the need once,
            // then idle-wait for the unlock instead of stepping blind.
            val km = ctx.getSystemService(Context.KEYGUARD_SERVICE)
                    as android.app.KeyguardManager
            if (km.isKeyguardLocked) {
                if (!lockWarned) {
                    lockWarned = true
                    onMsg?.invoke(AgentMsg(
                        "Unlock the watch and I'll keep going.", "⌁ device"))
                }
                var lockWait = 0
                while (km.isKeyguardLocked && lockWait++ < 60) delay(2000)
                if (km.isKeyguardLocked) {
                    awaitingPick = true
                    onMsg?.invoke(AgentMsg(
                        "Still locked — unlock it (or say \"stop\").", "⌁ device"))
                    return
                }
                lockWarned = false
            }
            // system overlays (notification shade) swallow every action while
            // up — dismiss mechanically before asking the model anything.
            var shadeTries = 0
            while (shadeTries++ < 3) {
                val pkg = HiveA11y.topWindowPackage() ?: break
                val shade = pkg.contains("sysui") ||
                        pkg.contains("systemui") ||
                        pkg == "com.google.android.wearable.ambient" ||
                        HiveA11y.visibleText().firstOrNull() == "New notifications"
                if (!shade) break
                HiveA11y.global(android.accessibilityservice.AccessibilityService
                    .GLOBAL_ACTION_BACK)
                delay(700)
            }

            var screen = HiveA11y.visibleText()
            // back/nav can land on the assistant's own chat chrome — flag it so
            // the model relaunches the target app instead of tapping our icons.
            val ourUi = HiveA11y.hasPackage(ctx.packageName) || screen.any {
                it == "MESH" || it == "✦ Ask" || it == "● Listening" ||
                    it.startsWith("⌁ device")
            }
            if (ourUi)
                screen = listOf("[hive-ui: the assistant's own screen is on " +
                    "top — the target app is NOT visible]") + screen
            if (screen == lastScreen) sameScreen++ else sameScreen = 0
            lastScreen = screen
            Log.i("DeviceAgent", "screen$n: ${screen.take(14).joinToString(" | ").take(240)}")
            // scroll reached the list's end — tell the model to pick from what
            // it's already seen instead of scrolling forever.
            if (sameScreen >= 2)
                screen = screen + "[no new content — nothing left to scroll]"

            val res = api.act(
                goal = goal,
                app = appName,
                screen = screen,
                steps = steps.toList(),
                picked = picked.takeIf { n == 1 } ?: "",
            ) ?: run {
                // bridge flaps happen — the service re-warms it in ~30s.
                // hold the task and re-sense instead of dying on one flap.
                if (++netFails >= 4) {
                    onMsg?.invoke(AgentMsg(
                        "Can't reach the hive for the next step.", "⌁ device"))
                    return
                }
                delay(8000)
                continue
            }
            netFails = 0
            val action = res.optString("action")
            val target = res.optString("target")
            val text = res.optString("text")
            Log.i("DeviceAgent", "step$n $action target='$target' text='${text.take(40)}'")
            when (action) {
                "launch" -> {
                    val ok = launchApp(target.ifBlank { appName })
                    steps.addLast("launch ${target.ifBlank { appName }} -> $ok")
                }
                "tap" -> {
                    val ok = target.isNotBlank() && HiveA11y.clickText(target)
                    steps.addLast("tap $target -> $ok")
                    if (!ok && sameScreen > 1) HiveA11y.scrollForward()
                }
                "type" -> {
                    val ok = HiveA11y.setText(text.ifBlank { target })
                    steps.addLast("type '${text.take(30)}' -> $ok")
                }
                "typekeys" -> {
                    val ok = HiveA11y.typeKeys(text.ifBlank { target })
                    steps.addLast("typekeys '${text.take(30)}' -> $ok")
                }
                "enter" -> {
                    val ok = HiveA11y.imeEnter()
                    steps.addLast("enter -> $ok")
                }
                "scroll" -> {
                    val ok = HiveA11y.scrollForward()
                    steps.addLast("scroll -> $ok")
                }
                "back" -> {
                    val ok = HiveA11y.global(
                        android.accessibilityservice.AccessibilityService
                            .GLOBAL_ACTION_BACK)
                    steps.addLast("back -> $ok")
                }
                "home" -> {
                    val ok = HiveA11y.global(
                        android.accessibilityservice.AccessibilityService
                            .GLOBAL_ACTION_HOME)
                    steps.addLast("home -> $ok")
                }
                "wait" -> steps.addLast("wait")
                "done" -> {
                    onMsg?.invoke(AgentMsg(text.ifBlank { "Done — $goal." }))
                    return
                }
                "ask" -> {
                    awaitingPick = true
                    onMsg?.invoke(AgentMsg(
                        text.ifBlank { "Which one?" } + "\n(say a number or name)"))
                    return
                }
                "fail" -> {
                    // "keep trying until i say stop" — one reorient pass, then
                    // park and ask whether to keep going.
                    steps.addLast("failed: ${text.take(60)}")
                    if (steps.count { it.startsWith("failed") } < 2) {
                        delay(1200)
                        continue
                    }
                    awaitingPick = true
                    onMsg?.invoke(AgentMsg(
                        "I'm stuck — ${text.take(80)}\nSay \"keep trying\" or \"stop\"."))
                    return
                }
            }
            if (steps.size > 14) steps.removeFirst()
            delay(1400)   // let the UI settle before re-reading
        }
        onMsg?.invoke(AgentMsg("Out of moves — say \"keep trying\" or \"stop\"."))
        awaitingPick = true
    }


    private fun openUri(uri: String): Boolean = runCatching {
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(uri))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.isSuccess

    private fun parseOptions(plan: org.json.JSONObject): List<Pair<String, String>> {
        val arr = plan.optJSONArray("options") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val uri = o.optString("uri")
            if (uri.isBlank()) null
            else o.optString("label").ifBlank { uri } to uri
        }
    }

    /** Map "2" / "the second one" / a partial name onto a stored option URI. */
    private fun matchOption(pick: String): String? {
        if (pendingOptions.isEmpty()) return null
        val num = Regex("\\b(\\d{1,2})\\b").find(pick)?.groupValues?.get(1)
            ?.toIntOrNull()
        if (num != null && num in 1..pendingOptions.size)
            return pendingOptions[num - 1].second
        val ord = mapOf("first" to 1, "second" to 2, "third" to 3,
            "fourth" to 4, "fifth" to 5)
        ord.entries.firstOrNull { pick.lowercase().contains(it.key) }
            ?.let { if (it.value <= pendingOptions.size)
                return pendingOptions[it.value - 1].second }
        val q = pick.lowercase()
        return pendingOptions.firstOrNull { (label, _) ->
            label.lowercase().let { q.contains(it) || it.contains(q) }
        }?.second
    }

    /** Open the named app — spotify URIs jump straight to search. */
    private fun launchApp(name: String): Boolean {
        val q = name.trim().lowercase()
        appName = name.ifBlank { appName }
        if (++launches > 8) return false
        // spotify deep links land inside the app at content — "play X on spotify"
        if (q.contains("spotify")) {
            val query = goal
                .replace(Regex("(?i)^\\s*(please\\s+)?(play|listen( to)?|put on|find|search( for)?)\\s+"), "")
                .replace(Regex("(?i)\\s*(on|in|using|from)\\s+(spotify|the app|it|spotify app)\\s*[.!?]*$"), "")
                .trim()
            val uri = if (query.isNotBlank())
                "spotify:search:${Uri.encode(query)}"
            else "spotify:"
            return runCatching {
                ctx.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(uri))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.isSuccess
        }
        // generic launcher lookup
        val pm = ctx.packageManager
        val probe = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val hit = pm.queryIntentActivities(probe, android.content.pm.PackageManager.MATCH_ALL)
            .firstOrNull { ri ->
                val label = ri.loadLabel(pm)?.toString()?.lowercase() ?: ""
                label == q || label.contains(q) || q.contains(label) ||
                        ri.activityInfo.packageName.contains(q)
            } ?: return false
        return runCatching {
            ctx.startActivity(
                pm.getLaunchIntentForPackage(hit.activityInfo.packageName)!!
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
    }
}
