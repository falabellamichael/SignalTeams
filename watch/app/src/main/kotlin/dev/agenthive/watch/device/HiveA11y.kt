package dev.agenthive.watch.device

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The "full access" layer — an AccessibilityService is what lets us act
 * inside other apps like Gemini does: global navigation (home/back/recents/
 * notifications/quick settings/power), reading the screen, typing into
 * fields, and tapping things. Requires a one-time grant in
 * Settings → Accessibility → AgentHive; every caller checks [isEnabled]
 * first and degrades to a spoken hint.
 */
class HiveA11y : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return false
    }

    companion object {
        @Volatile
        private var instance: HiveA11y? = null

        fun isEnabled(ctx: Context): Boolean {
            if (instance != null) return true
            val am = ctx.getSystemService(Context.ACCESSIBILITY_SERVICE)
                    as AccessibilityManager
            return am.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfo.FEEDBACK_ALL_MASK
            ).any { it.resolveInfo.serviceInfo.packageName == ctx.packageName }
        }

        /** Open the accessibility settings page so the user can flip us on. */
        fun settingsIntent(): Intent =
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        fun global(action: Int): Boolean =
            instance?.performGlobalAction(action) ?: false

        /** Roots worth looking at, best-first: the active window, then any
         *  other application windows (Wear OS often reports the sysui or
         *  ambient overlay as "active" while a real app is on screen). */
        private fun roots(svc: HiveA11y): List<AccessibilityNodeInfo> {
            val out = mutableListOf<AccessibilityNodeInfo>()
            val seen = HashSet<Int>()
            // application windows first — system windows (notification shade,
            // sysui overlays) leak phantom rows into reads and scroll/tap can
            // poke them open; only fall back to them when no app is up.
            runCatching {
                val wins = svc.windows ?: emptyList()
                val apps = wins.filter { w -> w.type ==
                    android.view.accessibility.AccessibilityWindowInfo
                        .TYPE_APPLICATION }
                val pick = apps.ifEmpty {
                    runCatching { svc.rootInActiveWindow }.getOrNull()
                        ?.let { out += it; seen += it.windowId }
                    wins
                }
                pick.sortedByDescending { w -> w.layer }
                    .forEach { w ->
                        if (w.id in seen) return@forEach
                        runCatching { w.root }.getOrNull()?.let { r ->
                            out += r; seen += w.id
                        }
                    }
            }
            return out
        }

        /** Package of the topmost application window — tells the agent whose
         *  screen it's actually looking at. */
        fun topPackage(): String? {
            val svc = instance ?: return null
            return runCatching {
                svc.windows
                    ?.filter { w -> w.type ==
                        android.view.accessibility.AccessibilityWindowInfo
                            .TYPE_APPLICATION }
                    ?.maxByOrNull { w -> w.layer }
                    ?.let { w -> w.root?.packageName?.toString() }
            }.getOrNull()
        }

        /** Package owning the highest-layer window of ANY type — unlike
         *  topPackage this sees system overlays (notification shade). */
        fun topWindowPackage(): String? {
            val svc = instance ?: return null
            return runCatching {
                svc.windows?.maxByOrNull { w -> w.layer }
                    ?.let { w -> w.root?.packageName?.toString() }
            }.getOrNull()
        }

        /** True while one of our own windows is on screen — our app only holds
         *  a window while it's foreground, so presence == our UI is showing. */
        fun hasPackage(pkg: String): Boolean {
            val svc = instance ?: return false
            return runCatching {
                svc.windows?.any { w ->
                    w.root?.packageName?.toString() == pkg
                } == true
            }.getOrDefault(false)
        }

        // ---- screen sensing ---------------------------------------------------

        /** Walk the visible tree — distinct texts + content descriptions in
         *  screen order, capped for an LLM prompt. */
        fun visibleText(): List<String> {
            val svc = instance ?: return emptyList()
            val roots = roots(svc)
            if (roots.isEmpty()) return emptyList()
            val out = LinkedHashSet<String>()
            fun walk(n: AccessibilityNodeInfo?, depth: Int) {
                if (n == null || depth > 14 || out.size >= 90) return
                val t = n.text?.toString()?.trim()
                if (!t.isNullOrEmpty() && t.length <= 120) out += t
                val d = n.contentDescription?.toString()?.trim()
                if (!d.isNullOrEmpty() && d.length <= 120) out += d
                for (i in 0 until n.childCount) {
                    runCatching { walk(n.getChild(i), depth + 1) }
                }
                runCatching { n.recycle() }
            }
            for (r in roots) runCatching { walk(r, 0) }
            return out.toList()
        }

        // ---- actions -----------------------------------------------------------

        /** Tap the first visible node whose text/description contains [query]
         *  — walks up to the nearest clickable ancestor. */
        fun clickText(query: String): Boolean {
            val svc = instance ?: return false
            for (root in roots(svc))
                if (clickIn(root, query.lowercase())) return true
            return false
        }

        private fun clickIn(node: AccessibilityNodeInfo, q: String): Boolean {
            val nodes = node.findAccessibilityNodeInfosByText(q)
                ?: emptyList()
            val all = nodes + findByDesc(node, q)
            // prefer result/suggestion rows over the input field — when the
            // field echoes the typed query, tapping it just refocuses.
            for (n in all.sortedBy { it.isEditable }) {
                if (clickable(n)?.performAction(
                        AccessibilityNodeInfo.ACTION_CLICK) == true)
                    return true
            }
            return false
        }

        private fun clickable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            var target: AccessibilityNodeInfo? = n
            var hops = 0
            while (target != null && !target.isClickable && hops++ < 6)
                target = target.parent
            return target
        }

        private fun allNodes(root: AccessibilityNodeInfo, depth: Int = 0)
                : List<AccessibilityNodeInfo> {
            if (depth > 14) return emptyList()
            val out = mutableListOf(root)
            for (i in 0 until root.childCount) {
                runCatching { root.getChild(i) }.getOrNull()
                    ?.let { out += allNodes(it, depth + 1) }
            }
            return out
        }

        /** Type by tapping the on-screen keyboard letter-by-letter — real key
         *  input for fields where ACTION_SET_TEXT fills the box visually but
         *  never reaches the app's search state (Wear Spotify: SET_TEXT showed
         *  the query yet enter submitted ""). */
        fun typeKeys(text: String): Boolean {
            val svc = instance ?: return false
            var taps = 0
            for (raw in text.lowercase()) {
                if (raw == '\n') continue
                val c = raw.toString()
                var hit = false
                for (root in roots(svc)) {
                    for (n in allNodes(root)) {
                        val t = n.text?.toString()?.lowercase()
                        val d = n.contentDescription?.toString()?.lowercase()
                        val match = if (raw == ' ')
                            t == "space" || d == "space" || t == "␣" || d == "␣"
                        else t == c || d == c || d == "key $c"
                        if (match && clickable(n)?.performAction(
                                AccessibilityNodeInfo.ACTION_CLICK) == true) {
                            hit = true; break
                        }
                    }
                    if (hit) break
                }
                if (hit) taps++
                android.os.SystemClock.sleep(70)
            }
            return taps > 0
        }

        private fun findByDesc(
            node: AccessibilityNodeInfo,
            q: String,
            depth: Int = 0,
        ): List<AccessibilityNodeInfo> {
            if (depth > 14) return emptyList()
            val out = mutableListOf<AccessibilityNodeInfo>()
            val d = node.contentDescription?.toString()?.lowercase() ?: ""
            val t = node.text?.toString()?.lowercase() ?: ""
            if (q in d || q in t) out += node
            for (i in 0 until node.childCount) {
                runCatching { node.getChild(i) }.getOrNull()?.let {
                    out += findByDesc(it, q, depth + 1)
                }
            }
            return out
        }

        /** Type into the first editable field (or the focused one). */
        fun setText(text: String): Boolean {
            val svc = instance ?: return false
            val field = roots(svc).firstNotNullOfOrNull { findEditable(it) }
                ?: return false
            val args = Bundle().apply {
                putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            return field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }

        /** Submit the field (search/IME action) — presses enter if the app
         *  exposes an IME action, else taps a "Search"-labelled node. */
        fun imeEnter(): Boolean {
            val svc = instance ?: return false
            val field = roots(svc).firstNotNullOfOrNull { findEditable(it) }
            if (field != null &&
                field.performAction(AccessibilityNodeInfo.AccessibilityAction
                    .ACTION_IME_ENTER.id)) return true
            return clickText("search") || global(GLOBAL_ACTION_BACK)
        }

        private fun findEditable(node: AccessibilityNodeInfo, depth: Int = 0)
                : AccessibilityNodeInfo? {
            if (depth > 14) return null
            val cls = node.className?.toString() ?: ""
            if (node.isEditable || "EditText" in cls || "SearchBox" in cls ||
                node.isFocusable && node.isEnabled && node.isClickable.not() &&
                node.isLongClickable) return node
            for (i in 0 until node.childCount) {
                val c = runCatching { node.getChild(i) }.getOrNull() ?: continue
                findEditable(c, depth + 1)?.let { return it }
            }
            return null
        }

        /** Scroll forward for more results. */
        fun scrollForward(): Boolean {
            val svc = instance ?: return false
            for (root in roots(svc))
                if (scrollNode(root, AccessibilityNodeInfo.ACTION_SCROLL_FORWARD))
                    return true
            return false
        }

        private fun scrollNode(node: AccessibilityNodeInfo, action: Int, depth: Int = 0): Boolean {
            if (depth > 14) return false
            if (node.isScrollable && node.performAction(action)) return true
            for (i in 0 until node.childCount) {
                val c = runCatching { node.getChild(i) }.getOrNull() ?: continue
                if (scrollNode(c, action, depth + 1)) return true
            }
            return false
        }
    }
}
