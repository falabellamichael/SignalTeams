package dev.agenthive.watch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import androidx.wear.ambient.AmbientLifecycleObserver
import kotlinx.coroutines.launch
import dev.agenthive.watch.nexus.NexusState
import dev.agenthive.watch.ui.HiveScreen
import dev.agenthive.watch.ui.HiveTheme

class MainActivity : ComponentActivity() {

    private val vm: HiveViewModel by viewModels()
    private var lastAssistAt = 0L
    private var speech: SpeechRecognizer? = null

    // Wear ambient (always-on display) — keeps the last reply glanceable
    // on AOD like Gemini; the UI flips to a burn-in-safe black surface.
    private val ambientDelegate = AmbientLifecycleObserver(this,
        object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(
                ambientDetails: AmbientLifecycleObserver.AmbientDetails) =
                vm.setAmbient(true)
            override fun onExitAmbient() {
                vm.setAmbient(false)
                // Kick the keep-alive — a bridge that died during doze gets
                // re-verified now, so the first ask doesn't pay discovery.
                (application as HiveApp).kickMesh()
            }
            override fun onUpdateAmbient() {}
        })

    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startVoice() else vm.setListening(false)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onError(error: Int) {
            vm.setListening(false)
            // ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT just means silence — stay quiet.
        }
        override fun onResults(results: Bundle?) {
            vm.setListening(false)
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull().orEmpty()
            vm.voiceResult(text)
        }
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull().orEmpty()
            if (text.isNotBlank()) vm.setInput(text)
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            val state by vm.ui.collectAsState()
            // Keep the screen awake while a link is in flight — Wear dozes
            // fast, and a sleeping screen froze restores mid-join. Ambient
            // overrides it: the partial linkWake keeps the CPU for the join,
            // a pinned full-brightness panel doesn't need to. Keyed so stream
            // patches (~13/s) don't re-write window flags every frame.
            val keepOn = state.phase == Phase.LINKING && !state.ambient
            LaunchedEffect(keepOn) {
                if (keepOn) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
            // Bound callable references (vm::x) mint a new function object
            // each recomposition — every stream patch would churn all ten
            // props. remember{} pins them for the activity's lifetime.
            val onCode = remember { vm::setInviteCode }
            val onLinkCode = remember { vm::linkWithCode }
            val onLinkHive = remember { vm::linkHive }
            val onInput = remember { vm::setInput }
            val onSend = remember { vm::send }
            val onMic = remember { ::startVoice }
            val onStop = remember { ::stopAll }
            val onPickAgent = remember { vm::pickAgent }
            val onRefreshAgents = remember { vm::refreshAgents }
            val onRelinkMesh = remember { vm::relinkMesh }
            val onClearChat = remember { vm::clearChat }
            val onDisconnect = remember { vm::disconnect }
            HiveTheme {
                HiveScreen(
                    state = state,
                    onCode = onCode,
                    onLinkCode = onLinkCode,
                    onLinkHive = onLinkHive,
                    onInput = onInput,
                    onSend = onSend,
                    onMic = onMic,
                    onStop = onStop,
                    onPickAgent = onPickAgent,
                    onRefreshAgents = onRefreshAgents,
                    onRelinkMesh = onRelinkMesh,
                    onClearChat = onClearChat,
                    onDisconnect = onDisconnect,
                )
            }
        }

        lifecycle.addObserver(ambientDelegate)

        // Mesh suspend/resume rides the activity lifecycle (SDK contract).
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            val app = application as HiveApp
            when (event) {
                Lifecycle.Event.ON_START -> {
                    if (app.nexus.state == NexusState.RUNNING) {
                        lifecycleScope.launch { app.nexus.resume() }
                    }
                    app.kickMesh()   // wake-verify the bridge while the user looks
                }
                Lifecycle.Event.ON_STOP ->
                    // a doze mid-link must not suspend the dataplane under us;
                    // while MeshService owns the link it stays up full-time so
                    // the next app open (or assistant call) is instant
                    if (vm.ui.value.phase != Phase.LINKING && !MeshService.running) {
                        lifecycleScope.launch { app.nexus.suspendMesh() }
                    }
                else -> {}
            }
        })
    }

    private fun startVoice() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        val sr = speech ?: SpeechRecognizer.createSpeechRecognizer(this).also {
            it.setRecognitionListener(listener)
            speech = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        runCatching { sr.startListening(intent) }
            .onSuccess { vm.setListening(true) }
            .onFailure { vm.setListening(false) }
    }

    /** Dock Stop button — cancels the mic session plus whatever the
     *  assistant is doing (stream, playback, in-app task). */
    private fun stopAll() {
        runCatching { speech?.cancel() }
        vm.stopAll()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        val srv = i?.getStringExtra("server")
        val usr = i?.getStringExtra("user")
        val pwd = i?.getStringExtra("pass")
        val code = i?.getStringExtra("code")
        val ask = i?.getStringExtra("ask")
        if (!code.isNullOrBlank()) {
            vm.linkWithCode(code)
        } else if (!srv.isNullOrBlank() && !usr.isNullOrBlank() && !pwd.isNullOrBlank()) {
            vm.connectWith(srv, usr, pwd)
        }
        if (!ask.isNullOrBlank()) {
            vm.send(ask)
            return
        }
        // digital-assistant invocation (center-button long-press, hotword,
        // global search, voice-command intents) — land straight on the mic,
        // over the keyguard, like Gemini. A WEB_SEARCH/GLOBAL_SEARCH intent
        // may already carry the query — answer it without opening the mic.
        // Both the session path and the service fallback can deliver within
        // ms of each other — collapse repeats into one mic start.
        val isAssist = i?.action in ASSIST_ACTIONS
        setShowWhenLocked(isAssist)
        setTurnScreenOn(isAssist)
        if (isAssist) {
            val query = i?.getStringExtra(android.app.SearchManager.QUERY)
                ?: i?.getStringExtra("query")
            val now = SystemClock.elapsedRealtime()
            if (now - lastAssistAt > 1500) {
                lastAssistAt = now
                if (!query.isNullOrBlank()) vm.send(query)
                else window.decorView.post { startVoice() }
            }
        }
    }

    companion object {
        /** Every invocation action our manifest claims → the same
         *  "open over keyguard + start listening" treatment as ASSIST. */
        private val ASSIST_ACTIONS = setOf(
            Intent.ACTION_ASSIST,
            "android.intent.action.VOICE_ASSIST",
            "android.intent.action.VOICE_COMMAND",
            "android.speech.action.WEB_SEARCH",
            "android.speech.action.VOICE_SEARCH_HANDS_FREE",
            "android.search.action.GLOBAL_SEARCH",
            "android.intent.action.START_HOTWORD_QUERY")
    }

    override fun onDestroy() {
        speech?.destroy()
        speech = null
        super.onDestroy()
    }
}
