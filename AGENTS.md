# SignalTeams dev stack

| service  | port  | launched by                                        |
|----------|-------|----------------------------------------------------|
| backend  | :8075 | `backend/.venv/Scripts/python.exe backend/run.py`  |
| frontend | :5175 | `npm run dev` in `frontend/`                       |

`start.bat` launches both minimized.

- Always use `backend/.venv/Scripts/python.exe` — bare `python` may lack fastapi/uvicorn.
- DB: `backend/agenthive.db` (SQLite WAL). Reset = delete file + run `seed.py`.
- Demo logins: mike / nova / juno, password `password`. Invite code: `signal-demo`.
- Vite proxies `/api` and `/ws` to :8075; `VITE_API_TARGET` overrides.
- `AGENTHIVE_HOST=0.0.0.0` exposes the backend to LAN; backend also serves `frontend/dist`
  when it exists (single-port mode — `start-lan.bat` does build+serve). The mount is a
  `StaticFiles` subclass (`_DistFiles` in `app/main.py`): `index.html`/extension-less
  paths get `Cache-Control: no-cache` (stale HTML 404s hashed chunks after rebuilds —
  note `path` arrives OS-native: `"."` root, `assets\x.js` on Windows) and `/assets/*`
  get `max-age=31536000, immutable`.
- Settings → Connections (`app/connections.py` catalog + `app/routes/connections.py` +
  `modals/connections.jsx`): 25 AI providers in `user_connections` — subscription cards
  import local CLI logins (`~/.codex/auth.json`, `~/.claude/.credentials.json`,
  `~/.gemini/oauth_creds.json`, `~/.qwen/oauth_creds.json`, github-copilot
  `apps/hosts.json` → api.github.com token exchange, `~/.cache/huggingface/token`),
  the rest take API keys; `custom` accepts any OpenAI-compatible URL.
  `public()` never returns secrets; `usable=0` means stored-but-not-chat-routable
  (ChatGPT OAuth); POST `/api/connections/{id}/use` promotes a usable connection onto
  `users.llm_*` so summons/playground pick it up. Short-lived tokens (Copilot ~30min)
  keep refresh material in `user_connections.refresher` — `fresh(conn,row)`
  re-exchanges it, wired into the routes and `_user_llm` so promoted Copilot
  connections self-heal. The page has an **A.I | Plugins** toggle — Plugins are
  OAuth app connections (gmail, gcal, gdrive, outlook, m365, github in `PLUGINS`):
  each stores client creds from `AGENTHIVE_{GOOGLE,AZURE,GITHUB}_CLIENT_*` env or
  per-user in `user_connections.extra` (never returned), `POST …/begin` builds a
  signed-state consent URL for a popup, `GET …/callback` (unauthed, verifies the
  HMAC state) exchanges the code and postMessages the opener to refresh.
  Access tokens in `api_key`, refresh tokens in `refresher`; `fresh()` and
  `plugin_probe()` handle expiry + account labels.
  **REACH model (ported from D:\SimpleREACH\studio\agent\app-connections.cjs):**
  publisher-registered clients ship in `backend/plugin-clients.json`
  (google desktop client+secret, github, microsoft public, slack/notion/discord
  via the user's ngrok broker) → Connect needs zero user setup. Three flows by
  `p["flow"]`: `redirect` = loopback+PKCE popup (microsoft redirects force
  `localhost`), `device` = GitHub device-code (`begin` returns {device}, frontend
  polls `POST …/poll`), `hosted` = broker `start`/`exchange`/`refresh` JSON calls
  at brokerOrigin (pending flow state in `kv` as `oauth_flow:{nonce}`).
  **Agents can use plugins**: `connected_plugins(conn, uid)` feeds the
  summoner's grants into `agent_reply`'s system prompt (`PLUGIN_USAGE` doc
  lines per provider); the model replies `{"tool":"plugin","args":{plugin,
  action,…}}` → `plugin_tool()` runs read-only actions (gmail search/read,
  gcal/outlook/m365 mail+events, gdrive/m365 files, todo lists/tasks, github
  repos/search, slack/notion search, discord guilds) **strictly as the
  summoner** — only their own `user_connections` row is ever touched, tokens
  never reach the model or frontend. `plugin` is in `workspace._TOOL_NAMES`
  so `parse_tool_calls`/`strip_tool_calls` handle it. E2E:
  `qa/agent_plugin.py` (+ `qa/stub_llm_plugin.py`, port 8098).
  Discord gotcha: Cloudflare 1010-bans `User-Agent: SignalTeams/1.0` — discord
  calls must send `DiscordBot (<url>, <ver>)` (see `probe_headers` +
  `_plugin_action`); `guilds` needs the `guilds` OAuth scope on the grant.
  Google granular consent can return a token missing a requested scope
  (e.g. gmail.readonly unchecked) → API 403 `insufficient authentication
  scopes`; fix is re-consent, not refresh.
  **Agent capability flags**: `agents.ai_flags` (JSON, keys from `AI_FLAG_KEYS`
  in routes/engage.py: web/stt/tts/vision/translate/summarize/github) carries
  per-agent capabilities — `agent_reply` and `/api/agents/{id}/try_stream`
  merge them over `channels.ai_flags`, so a web/github-capable agent keeps its
  tools in any channel or DM. `try_stream` (the watch/Try-tab path) runs the
  same tool loop as `agent_reply` — NDJSON adds `{"t":"tool",name,ok,secs}`
  progress events and `{"t":"replace",c}` which swaps streamed tool-call
  scaffolding for stripped text (clients must apply it before appending the
  next round's tokens). `github` flag offers the github plugin even without a
  connection: `plugin_tool` falls back to unauthenticated GitHub API (public
  `search` works; `/user/repos` 401s into an honest "connect GitHub" error).
  Tool-call parser (`workspace.parse_tool_calls`) also accepts bare
  `{"plugin":"github","action":…}` shorthand; `_canon_args` folds `q`→`query`
  so `_plugin_action` reads either. PATCH `/api/agents/{id}` uses `AgentPatch`
  (all-Optional + `model_fields_set`) — only sent keys are written, partial
  bodies are safe.
  **Watch account binding**: `watch_bound:{node_id}` `{uid,secret}` decides
  which user a paired watch acts as — uid comes from the pair-code minter.
  Re-point a watch by updating `uid` + deleting its `sessions` row; next
  `watch_session` reconnect mints a token for the new uid (secret stays).
  Plugins follow the bound uid via `connected_plugins`, NOT the device.
  **Watch stays linked**: `BootReceiver` → `MeshService` (FGS, dataSync) owns
  the mesh for the watch's uptime — `ensureLinked` rejoins+rediscovers via the
  shared `nexus/MeshLinker` headless path, `warmEgress` keeps the loopback
  bridge hot every 30s, `MainActivity` skips `nexus.suspendMesh()` while
  `MeshService.running`, and `restore()`'s warm path probes `store.meshUrl`
  for a ready bridge before paying a relink. `disconnect()` clears store +
  stops the service — boot receiver no-ops until re-paired.
  **Watch as button assistant** (`assist/` package): a `VoiceInteractionService`
  stub registers the app as the default digital assistant (Gemini's slot —
  center-button press-and-hold). Samsung's Wear OS requires the service to
  declare `android.permission.BIND_VOICE_INTERACTION` (the privileged string,
  NOT the public `_SERVICE` variant — aapt accepts either, Wear validates the
  former) and `supportsLaunchVoiceAssistFromKeyguard="true"` in
  Every assistant-invocation action (ASSIST, VOICE_ASSIST, VOICE_COMMAND,
  WEB_SEARCH, VOICE_SEARCH_HANDS_FREE, GLOBAL_SEARCH, START_HOTWORD_QUERY)
  gets the same treatment in MainActivity.handleIntent: setShowWhenLocked +
  setTurnScreenOn + straight to the mic; a carried `query` extra answers
  directly without opening the mic. `res/xml/voice_interaction_service.xml` or keyguard blocks it with "Unlock
  the watch to use Hive". Samsung's WearAssistManager never surfaces the
  session window, so `onPrepareToShowSession`/`onLaunchVoiceAssistFromKeyguard`/
  `onShowSessionFailed` ALL launch `MainActivity` with `ACTION_ASSIST` directly
  (session `startAssistantActivity` kept as backup). Activity handles ASSIST →
  `setShowWhenLocked`/`setTurnScreenOn` + `startVoice()` (1.5s dedupe — both
  paths fire ~40ms apart). Bind once per device: `settings put secure
  assistant|voice_interaction_service|voice_recognition_service
  dev.agenthive.watch/.assist.*` or Settings → Digital assistant.
  **Watch modality + device control**: `GET /api/llm/capabilities` reports the
  bound endpoint's non-chat models (auto-detected via `/v1/models` modality /
  labels / name tokens — `llm.modality_models`, 60s cache): tts/stt/embed/image.
  `POST /api/llm/tts` {text,voice?} proxies `/audio/speech` (kokoro → mp3,
  keys stay server-side; 404 = no model → client falls back to text);
  `POST /api/llm/embed` proxies `/embeddings` (Qwen3-Embedding, 1024-dim).
  Watch: `Speaker(api, ctx)` plays replies after stream done (markdown
  stripped, 800ch) — hive kokoro first, then the on-device TextToSpeech
  engine (com.google.android.tts ships on every Wear watch) so replies
  still speak when mesh/backend TTS is unreachable — same offline-voice
  path the built-in assistant takes; `ContextReceiver` writes ambient
  triggers into `store.suggestion` — HEADSET_PLUG/A2DP-connected →
  "Resume my music" chip, TIME_SET/TIMEZONE/LOCALE → complication
  re-render (freshest context wins; mesh refresh restores calendar
  suggestions within ~10min); `device/GpsProbe` adds altitude, speed,
  and reverse-geocoded "where am I" via nominatim;
  `device/DeviceCommands` is a local NLU dispatcher inside `send()` — open
  apps (PackageManager launch intents + manifest `<queries>` MAIN/LAUNCHER),
  Settings deep-links, volume (AudioManager), media transport
  (`HiveNotifService` NotificationListenerService → MediaSessionManager,
  grant via `enabled_notification_listeners`), and global actions /
  tap-by-text (`HiveA11y` AccessibilityService, grant via
  `enabled_accessibility_services`). Commands work unlinked — no mesh needed.
  **In-app task agent** (`device/DeviceAgent.kt` + `POST /api/llm/act`): for
  utterances like "play a podcast about ai on spotify" (`deviceGoal()` needs a
  task verb + an installed app name) the agent runs a sense→decide→act loop on
  the watch: `HiveA11y.visibleText()` dumps the top application window's node
  texts (multi-window via `FLAG_RETRIEVE_INTERACTIVE_WINDOWS`; system windows
  like the notification shade are skipped when an app window exists — their
  scrollables steal actions and their rows poison the model), `api.act` POSTs
  {goal,app,screen,steps,picked} to the hive which returns strict JSON
  {launch|tap|type|enter|scroll|back|home|wait|ask|done|fail} via the user's
  own LLM endpoint (keys never leave the backend; slow OkHttp client ~90s
  because decisions take 15-20s+). `ask` parks (`awaitingPick`) and the next
  utterance resumes with the pick; stop-words abort; a NEW send does NOT kill
  a running task (it runs on `HiveApp.appScope`, not viewModelScope — the VM
  dying used to cancel jobs mid-drive). **Resolve-first**: fresh tasks call
  `POST /api/llm/resolve` (`isResume` flag, not `resumedTask()` — appName is
  extracted from the goal first, which broke that check) before stepping; the
  backend runs model-propose → iTunes canonicalize (`_itunes_shows`, free
  unauthed JSON) → DDG-lite grounding to `spotify:{show|episode}:id` URIs
  (calls spaced 1.2s — bursting soft-blocks the IP for minutes; DDG lite/html,
  Bing, Brave, Yahoo, Mojeek, Startpage, Qwant, pod.link are ALL
  anti-bot/rate-limited from this box — only DDG-lite works and only under
  ~1qps) → model pick or `ask` with labeled options. Watch side: `deeplink`
  → `openUri` (the picked option's label is injected into step history so the
  model knows which page it's on), `search` → `spotify:search:` URI, `ask` →
  parks for a spoken pick; `matchOption` maps "2"/"the second one"/partial
  names to the stored URI with no extra model call. Watch hardware: Galaxy
  Watch8 Classic (product `pa3q`, serial suffix B7MA, 438×438, Wear OS 5);
  the paired phone is an SM-S938W (S25 Ultra) running `dev.agenthive.phone`.
  **Hardware adb-testing traps (Galaxy Watch):** the watch PIN-locks the moment it leaves the wrist
  (`dumpsys trust` → `deviceLocked=1`) — a keyguard overlay then eats EVERY
  tap while uiautomator dumps still show the app's windows, so input looks
  like a flaky IME (fragments like 'yj', taps landing on apps underneath).
  Check `dumpsys trust | grep deviceLocked` before any input-driven test and
  keep it on-wrist or enter the PIN first. `KEYCODE_VOICE_ASSIST` is eaten
  by Bixby (`OnboardingActivity`) regardless of the assistant role — our
  VIVS registers fine (`dumpsys voiceinteraction` shows it + session
  service) but Samsung's keycode path never reaches it; invoke assist via
  in-app mic or the tile's Ask chip. Actions include `typekeys`
  (`HiveA11y.typeKeys` taps on-screen keyboard letters — Wear Spotify's search
  IGNORES ACTION_SET_TEXT for its query state: the box fills visually but
  enter submits "" — typekeys is real key input) and `clickText` prefers
  non-editable matches (the input field echoes the query — tapping it
  refocuses instead of opening the suggestion row). Guards baked into the loop: waits for
  the session claim (45s), keyguard → speaks "unlock the watch" + idle-waits
  2min, notification shade/sysui topmost → GLOBAL_ACTION_BACK before each
  model step, own-app UI on top → `[hive-ui]` marker so the model relaunches
  instead of tapping our chrome, identical screen ≥2 → "[no new content]"
  hint, `act` retries 4× on bridge flaps (egress listeners churn — the
  keepalive now probe-Hives the existing baseUrl before re-bridging so a
  healthy bridge isn't swapped every 30s cycle), 4 net-fails → 8s re-sense
  before giving up. `spotify:search:<q>` URI brings Spotify up but lands on
  its home tiles, NOT the query's results — navigate Search manually. Typed
  queries live-filter results WITHOUT enter (enter submits "" — never press
  it on Wear Spotify). Its now-playing is the top card of a scroll stack —
  scroll reveals Search+Library tiles. Wear Spotify DOES have search (tap 🔍 on home) but
  Wear apps are minimal — the model is told to ask with names it actually
  saw rather than cycle launch/back.
  **Headless watch QA via intent extras** (no UI driving needed):
  `am start -n dev.agenthive.phone/dev.agenthive.watch.MainActivity --es code <8-digit>`
  runs the real `linkWithCode` (invite → mesh join → discover → egress →
  `/api/watch/session` claim); `--es server/u/p` runs `connectWith`;
  `--es ask "<q>"` calls `vm.send`. Codes come from
  `POST /api/nexus/watch-pair` (admin token) — a `/api/nexus/invite` code
  redeems mesh membership but the session claim 403s on it. The Wear
  emulator (`Wear_OS_XL_Round`, x86_64) runs the real Nexus .so — full
  pair+ask E2E works over its tunnel; `adb shell input keyevent
  KEYCODE_SLEEP` puts it into STATE_DOZE to exercise ambient/deep-idle.
  Fire `--es ask` only after READY — earlier it logs `send: no agent`.
  **Reverse-engineered assistant surface** (live `dumpsys package` of
  `com.google.android.wearable.assistant` + `com.samsung.android.bixby.agent`
  on the Galaxy Watch): Google's Wear assistant = `EdorasVoiceInteractionService`
  VIVS + `AssistantTileProviderService` + a second Glance-bound
  `AssistantWidgetService` + TWO complications (`AssistantComplicationService`
  + `.proactive.ProactiveComplicationService`, both legacy
  `android.support.wearable.complications` API under
  BIND_COMPLICATION_PROVIDER) + `ProactiveWearableListenerService` (phone→watch
  data layer) + `ContextTriggerBroadcastReceiver` (BOOT/LOCALE/GEOFENCE/
  AWARENESS/HEADPHONE/MEDIA/NETWORK triggers) + `CalendarUpdatedAppSearch`-
  BroadcastReceiver (calendar indexed via appsearch) + `FcmService` +
  `RttNudgeActivity`/`SettingsActivity`/`JokerActivity`. MainActivity filters:
  ASSIST/VOICE_ASSIST/START_HOTWORD_QUERY/GLOBAL_SEARCH (+DEFAULT). Bixby adds
  VOICE_COMMAND/SVOICE/WEB_SEARCH/VOICE_SEARCH_HANDS_FREE. Its requested
  permissions reveal vendor controls: `com.samsung.android.watch.timer.
  permission.{READ,EDIT}_TIMER` + `alarm.permission.EDIT_ALARM`, Google
  deskclock `{READ_PERMISSION,MUTATE_TIMER,REMOVE_ALARM}`,
  `com.google.wear.permission.{READ,WRITE}_{FOCUS_MODES,TOUCH_LOCK,
  BATTERY_SAVER}`, `com.google.android.wearable.{READ,WRITE}_SETTINGS`,
  `EXECUTE_APP_FUNCTIONS` (AppFunctions), `CAPTURE_AUDIO_HOTWORD` (sig-only —
  hotword is why third-party can't do wake word). **Samsung's timer app
  (`com.samsung.android.watch.timer`) exports `TimerAssistantHandleActivity`
  — built FOR assistants — honoring `com.samsung.android.watch.timer.action.
  {PAUSE,RESUME,RESET,MUTATE}_TIMER` intents + `TimerCTSHandleActivity` for
  `android.intent.action.DISMISS_TIMER`; `DISMISS_ALARM`/`SNOOZE_ALARM` are
  stock intents.** Samsung gates TYPE_HEART_RATE behind
  `android.permission.health.READ_HEART_RATE` (stock Wear uses BODY_SENSORS);
  barometer TYPE_PRESSURE is permission-free; skin-temp needs sig-level
  `com.samsung.permission.SSENSOR`.
  **Gemini architecture (aapt-dumped from the phone's googlequicksearchbox
  261MB base.apk — bard/`com.google.android.apps.bard` is only a 5MB shell
  delegating to GSA + searchlite):** the watch is a thin client, the phone
  GSA is the brain — same split as our watch↔hive. Their watch↔phone
  channel: `WdlTriggerListener` handles `REQUEST_RECEIVED` on
  `wear://*/gemini/wearservice` (GMS request/response API — richer than
  MESSAGE_RECEIVED; we use message+reply-path which is equivalent but
  hand-rolled). `wear-trusted-peer-packages` meta-data cert-pins
  `com.google.android.wearable.assistant` — third parties can't call their
  endpoint. `WearAssistantEndpointService` exposes gRPC
  `WearAssistantInitService` over the Wearable channel.
  `MANAGE_WEARABLE_SENSING_SERVICE` + `WearableSensingService` is how
  Gemini gets ambient context (raise-to-talk etc.) — sig-gated, dead end
  for us. `RobinKitAppFunctionService` declares
  `android.app.appfunctions.v2` + `android.app.appfunctions.schema`
  meta-data — **AppFunctions is the Gemini Extensions mechanism**
  (androidx.appfunctions:appfunctions:1.0.0-rc01 exists on maven; a
  provider service could expose our functions to the system assistant —
  worth adding to the PHONE module if an Android-16 host ever needs it;
  dead weight on this Wear OS). `robin_android.location`/`.audio`
  uses-feature tags gate surface availability. `AssistantWearableListenerService`
  handles NODE_MIGRATED for watch-switching.
  **Gemini-parity surface**: `CmdReply.deferred` (`suspend () -> String?`)
  runs async follow-ups after the ack line — sensor reads and hive calls
  get a second assistant message + TTS. DeviceCommands covers timers/alarms
  (`android.intent.action.SET_TIMER/SET_ALARM/SHOW_*`, SET_ALARM perm is
  auto-granted), `google.navigation:`/`geo:` deep-links, `tel:`/`smsto:`,
  heart rate + step counter (`device/HealthProbe` — one-shot SensorManager
  reads; Samsung Wear gates `TYPE_HEART_RATE` behind
  `android.permission.health.READ_HEART_RATE`, Pixel/stock behind
  BODY_SENSORS — HealthProbe accepts either; replies deep-link to our
  app-info page when ungranted), notification reads (`HiveNotifService.latest()` — bound
  instance → `activeNotifications` title+text), screen reads
  (`HiveA11y.visibleText`), battery (`BatteryManager`), time/date,
  "what's playing" (`HiveNotifService.nowPlaying` — MediaController
  metadata + playback state), notification inline reply (`replyToLatest`
  — RemoteInput on newest actionable notification), flashlight
  (`TorchActivity` — BRIGHTNESS_OVERRIDE_FULL white panel, tap exits),
  reminders (`remind me to X in T`/`at T` → SET_TIMER/SET_ALARM with the
  message as the label), calendar insert (`ACTION_INSERT` into
  `CalendarContract.Events` — no calendar perm needed), workouts
  (`device/HealthWorkout` — androidx.health 1.1.0 `ExerciseClient`
  start/pause/resume/end/status; `ExerciseInfo.exerciseTrackedStatus` is
  an int enum — `OWNED_EXERCISE_IN_PROGRESS` etc., duration/state live in
  `ExerciseUpdate` via callback only; `ELLIPTICAL` not `_MACHINE`; 15
  spoken aliases in `typeFor`; needs ACTIVITY_RECOGNITION granted), weather
  (`device/WeatherProbe` — open-meteo unauthed + last-known location, WMO
  decode), calendar reads (`device/CalendarProbe` — `CalendarContract.
  Instances` today/tomorrow, needs READ_CALENDAR), contact dialing/texting
  (`device/ContactsProbe` — name→number via `ContactsContract.Phone`, needs
  READ_CONTACTS; "call mike" / "text mike saying on my way"), barometer
  (`HealthProbe.pressure`, no perm), real timer control (Samsung
  PAUSE/RESUME/RESET_TIMER + DISMISS_TIMER intents), alarm dismiss/snooze
  (stock DISMISS_ALARM/SNOOZE_ALARM intents), coin/dice/random picks,
  "time in <city>" (~50-city IANA map in `cityZone`), stopwatch/world-clock
  deep-links (`com.samsung.android.watch.{timer,worldclock}` launcher
  intents), voice-memo (`com.samsung.android.wear.voicerecorder`), storage
  (StatFs), device model/IP, settings toggles (DND/airplane/wifi/bt/
  brightness/battery-saver deep-links), per-stream volumes (alarm/ringer),
  timer-remaining view (`SHOW_REMAINING_TIME`), vibration test, and
  geofence reminders (`device/GeoReminder` — "remind me to X when I get to
  Y": OSM nominatim geocoding (custom UA required) → GeofencingClient
  enter-fence 200m/24h → `GeoReceiver` posts a heads-up notification;
  home/work/office/etc resolve through memory lines like "my home address
  is …"; needs ACCESS_BACKGROUND_LOCATION for the trip to fire unattended).
  **Wear data-layer bridge (watch↔phone, mesh-independent)** —
  `device/PhoneBridge` + `device/WatchWearService` on the watch,
  `phone/FindPhone.kt` (`FindPhoneService`/`FindStopReceiver`/`PhoneRinger`)
  on the phone; both modules dep `play-services-wearable:19.0.0`, services
  declare `com.google.android.gms.wearable.MESSAGE_RECEIVED` filters on
  `wear://*/hive/*` paths. Paths: `/hive/find/start|stop` → phone blasts
  the alarm ringtone at max STREAM_ALARM (saved+restored, 45s auto-stop,
  heads-up notif with Stop action); `/hive/status` → phone answers
  `/hive/status/reply` with `{batt,charging,net,dnd}` JSON (watch `WatchWearService`
  completes the pending deferred → real "phone battery" answer, notif-mining
  fallback); `/hive/volume` up|down → phone `adjustStreamVolume(STREAM_MUSIC)`.
  Commands: "find/ring/locate/ping my phone", "stop my phone (alarm|ringing)|found it",
  "phone volume up|down". `/hive/intent` specs: `app:<label>` → phone launches
  by launcher label; `uri:<uri>` → ACTION_VIEW ("navigate to X on my phone");
  `call:|sms:<who>` → phone resolves its own contacts → tel:/smsto:;
  `cap:camera` → IMAGE_CAPTURE; `torch:on|off` → phone CameraManager LED;
  `ringer:silent|vibrate|normal` → ringerMode, falling back to the DND policy
  settings page when the grant is missing; `music:` →
  `com.google.android.googlequicksearchbox.MUSIC_SEARCH` (exported
  `MusicSearchGatewayInternal` alias — verified live on the S25 Ultra:
  fires Sound Search which heard ambient audio and identified "HUTA MEDIA
  CALMING…" through the phone mic — real song-ID, not media metadata).
  Watch phrasings: "open X on my
  phone", "call/text X on my phone", "phone torch on|off", "put my phone on
  silent|vibrate|normal", "what song is playing on my phone". Phone-side
  notification listener `phone/PhoneNotifService` (declared
  BIND_NOTIFICATION_LISTENER_SERVICE — grant via
  `adb shell cmd notification allow_listener dev.agenthive.phone/dev.agenthive.phone.PhoneNotifService`,
  NOT `pm grant` and NOT raw `settings put` — allow_listener updates the
  parsed managed-services set and binds it; verified live bound) powers
  `/hive/media` (play|pause|stop|next|prev verbs → MediaSessionManager
  transport), `/hive/playing` → `/hive/playing/reply` `{now}` now-playing
  metadata, `/hive/notif` → `/hive/notif/reply` JSONArray of latest shade
  entries. Watch commands: "pause/next/resume on my phone", "what's
  playing on my phone" (session metadata — distinct from song-ID which
  needs an ID-verb), "read my phone's notifications". Reverse direction:
  watch `WatchWearService` accepts `/hive/ask` (launches MainActivity
  with the ask extra → auto-fires the query) and `/hive/launch`
  (DeviceCommands "open X") — nothing phone-side sends these yet but the
  surface exists for phone-UI/Tasker automation. Pair verified live: Galaxy Watch8 Classic (B7MA)
  bonded with com.google.android.gms on its ACL link — bridge routes
  whenever the watch is awake. Second tile provider `.tile.HiveControlsTileService`
  (MultiButtonLayout: ✦Ask →MainActivity, 🔦Torch→TorchActivity,
  📱Find phone+Buzz→`device.QuickActionActivity` trampoline — tile chips
  can only launch activities; extras ride `addKeyToExtraMapping` with
  `AndroidStringExtra`; both trampoline + TorchActivity are exported=true
  so the tile host can launch them).
  Proactive suggestions (parity with Google's ProactiveComplicationService):
  `GET /api/assistant/next` reads the bound user's gcal plugin for the
  next event ≤6h → `{label:"Team sync in 35m"}` (graceful "" on expired
  grants); MeshService.refreshSuggestion pulls ~10min after each link pass
  into `store.suggestion` + `ComplicationDataSourceUpdateRequester` nudge;
  complication LONG_TEXT shows it under "✦ Next", the tile shows it over
  lastReply, and ChatScreen turns it into a prompt chip.
  **GSA dex protocol map** (strings-mined from the pulled base.apk —
  `qa/` dex dumps): the Gemini watch↔phone RPC prefix is
  `wear://*/gemini/weargeminiservice` with sub-paths
  `/settingssync` (pref sync), `/whatsappcall` + `/whatsappmessage`
  (WhatsApp bridge — we mirror with `wa:<who>` →
  `api.whatsapp.com/send?phone=` after phone-side contact resolution;
  watch phrasings "whatsapp mom"/"whatsapp call mom"),
  `/media` (cross-device media — our `/hive/media`),
  `/gethostdeviceid` (watch fetches a stable phone id), plus
  `/gemini/wearservice` (WdlTriggerListener) and
  `/assistant/wearables/setup`. Hotword: they run a real
  DSP/always-on pipeline (`AlwaysOnHotwordDetectorManager`,
  `HDM_TRUSTED_DSP_HOTWORD_DETECTED`, `SodaHotwordDetectionController`)
  — needs `CAPTURE_AUDIO_HOTWORD` (signature|privileged) + SoundTrigger
  HAL; a third-party VIVS can't reproduce it — dead end, documented.
  Reverse-direction bridge completed: watch `WatchWearService` now also
  answers `/hive/find/start|stop` (find-my-watch → `device/WatchRinger`:
  alarm tone + 500/300ms vibration loop + heads-up notif with
  `WatchStopReceiver` Stop action, 30s auto-stop) and `/hive/notify`
  (payload text → heads-up). Phone `phone/WatchBridge` sends
  (`Tasks.await` on IO — the phone module lacks
  kotlinx-coroutines-play-services); `PhoneBatteryReceiver`
  (ACTION_BATTERY_LOW, manifest-registered) pushes "Phone battery low"
  to the watch — the proactive phone→watch nudge Google's ambient layer
  does internally. Command-regex order checker: `qa/rxcheck.py`
  extracts every `Regex("...").find(t)` from DeviceCommands and reports
  first-match order for canonical phrases — run it after touching the
  chain (fixed two real shadowing bugs with it: local "what's playing"
  ate the phone variant; "what song is playing on my phone" matched
  nothing and fell to the LLM).
  **AppFunctions implemented** (`phone/HiveAppFunctionService.kt`,
  androidx.appfunctions 1.0.0-rc01 + KSP `appfunctions-compiler`):
  the real Gemini Extensions mechanism, verified on-device. Shape the
  KSP compiler demands (each error taught one constraint): annotated
  class must be ABSTRACT (compiler generates the concrete
  `HiveAppFunctionService` named by `serviceName` — simple class name,
  no package/`/`/`.` allowed); it must not implement `onExecuteFunction`
  (generated dispatcher does); functions are METHODS on the base —
  `@AppFunctionDeclaration(isDescribedByKDoc=true)` targets FUNCTION,
  functionId = `BaseClass#method`, schema from params/return type, KDoc
  = description. `findPhone`/`stopRinging` ship (ring PhoneRinger). KSP
  needs `android.disallowKotlinSourceSets=false` (gradle.properties) —
  KSP registers generated dirs via the old kotlin.sourceSets DSL AGP's
  built-in Kotlin forbids. Generated `appfunctions.xml` can't be wired
  from `build/` (AGP rejects build-dir assets srcDirs) — checked into
  `phone/src/main/res/xml/` and pointed at by service meta-data
  `android.app.appfunctions.v2` `android:resource` (the framework calls
  `loadXmlMetaData`). Manifest: action
  `android.app.appfunctions.AppFunctionService` + legacy
  `android.app.appsearch.functions.AppFunctionService` (Samsung's
  indexed services carry both), perm `BIND_APP_FUNCTION_SERVICE`;
  uses-library `com.android.extensions.appfunctions` auto-merged.
  **INDEXING SOLVED — functions live in the system index and EXECUTE.**
  The indexer does NOT read the androidx meta-data — it reads
  `assets/app_function.xml` (v1 snake_case doc: `<version>`,
  `<function_id>`, `enabled_by_default`,
  `restrict_callers_with_execute_app_functions`,
  `display_name_string_res` — no params/response) located via
  `<property android:name="android.app.appfunctions"
  android:value="app_function.xml"/>` INSIDE the service element.
  That recipe was reverse-engineered from Samsung Clock's APK
  (`com.sec.android.app.clockpackage` — its service declares Google's
  `com.google.android.appfunctions.service.MainAppFunctionService`
  proxy class resolved via uses-library
  `com.android.extensions.appfunctions`; we keep our own service and
  just mirror the property). Sideloaded apps DO index —
  `mobileApplicationQualifiedId` auto-populates without a Play join.
  Schema fields (`schema_category/name/version`) are optional for
  indexing; all 216 indexed entries carry them only because their
  publishers chose to (schema-tagging matters only for
  schema-filtered consumers like Samsung Routine).
  **The property can point at the v2 doc too** — `android:value=
  "appfunctions.xml"` naming the KSP-generated asset indexes WITH
  parameters/description/response types (GSA's entries are rich
  because its property names a v2-format asset, e.g.
  `assets/robinkit_app_function_service.xml`). We ship the generated
  doc as `src/main/assets/appfunctions.xml` — regenerate by copying
  `build/generated/ksp/debug/resources/assets/appfunctions.xml` after
  changing annotated functions. `res/xml/appfunctions.xml` stays for
  the `android.app.appfunctions.v2` meta-data path.
  Verified end-to-end on the S25U: **16 functions indexed and
  executable** — `findPhone`/`stopRinging` (real ringer),
  `openApp(name)` (launched Settings), `ringWatch`/`watchStatus`/
  `notifyWatch(text)` (cross-device Wear sends + suspend support),
  `readNotifications`/`nowPlaying`/`controlMedia(verb)` (live
  notification-shade reads + transport via PhoneNotifService),
  `callContact`/`messageContact`/`whatsappContact(name)` (contact
  resolve → dialer/composer/WhatsApp), `takePhoto`,
  `setFlashlight(on)` (real LED toggled), `setRingerMode(mode)`,
  `identifySong` (Sound Search). `is-enabled`=true;
  `cmd app_function execute-app-function` ran them live incl. String/
  Boolean params. Shared spec logic lives in `PhoneActions`
  (FindPhone.kt) so /hive/intent and AppFunctions drive one codebase.
  The WATCH module ships the same surface
  (`WatchAppFunctionService` — KSP+appfunctions added to :app):
  `askHive(query)` streams the mesh LLM (Store creds +
  `api.tryStream`, 25s bound) — "watch uses AI through the mesh" as
  a system-callable function — plus `ringPhone`/`stopPhoneRinging`/
  `phoneStatus`/`nowPlayingOnPhone`/`controlPhoneMedia(verb)`/
  `readPhoneNotifications`/`openWatchApp(name)`.
  Phone module function list now also: `setTimer`/`setAlarm`
  (AlarmClock intents — verified live in dumpsys alarm),
  `navigateTo`, `openUrl`, `remember(text)` (POST /api/memory through
  the mesh), `askHive(query)` (try_stream). **PhoneMeshService +
  PhoneBootReceiver keep the phone's Nexus node + egress warm**
  (30s cycle → idempotent `Linker.relink`, started at boot when
  paired + after every link) — the gap that made headless calls fail:
  `server_url`/`mesh_url` are loopback ports that die with the app.
  Verified end-to-end: `remember` hit a dead port → the function's
  failure path calls `PhoneMeshService.start` (internal FGS start IS
  allowed from an AppFunctions-bound context) → node rejoined +
  egress re-opened → a retry 60s later returned "Remembered." — a
  system-assistant call reaching the hive over the encrypted mesh
  with no UI involved. `askHive` verified too: after the
  `api.agents()` fallback (agent_id pref is unset on the phone —
  it uses servers, not the picker) it streamed a real LLM reply
  over the mesh. Params may NOT have Kotlin defaults
  (`Type cannot be optional`) — use `String?` for optional params.
  **`device_state` key namespace** — `setDeviceStateItem(key,value)`/
  `getDeviceStateItem(key)`/`getDeviceStateMetadata()`/
  `toggleDeviceStateItem(key)` expose `agenthive.*` keys
  (flashlight, ringer_mode, find_phone, battery, battery_charging,
  now_playing) — verified live (LED toggled, battery read 89%).
  Learned limits: `@AppFunctionSerializable` OBJECT params are
  silently DROPPED from the generated inventory/doc in rc01 —
  schema-exact params like `{setDeviceStateItemParams:{key,value}}`
  need `@AppFunctionSchemaDefinition`-annotated INTERFACES (targets
  classes — schema-library authors, not app devs) whose concrete
  types Google keeps internal (`com.android.appfunctions.schema.
  devicestate.v1.*` — GMS's impl; not in any public artifact).
  Serializable types must also be TOP-LEVEL (nested are skipped).
  Our flat key/value signature is the rc01-compatible approximation.
  **Notification mirroring** — `PhoneNotifService.onNotificationPosted`
  pushes `app: title — text` over `/hive/notify` (watch-side
  `PhoneBridge` already routed it to `WatchRinger.notify` heads-up).
  Filters: own pkg, ongoing, GROUP_SUMMARY, SERVICE/PROGRESS/
  TRANSPORT/NAV categories; 60s dedupe on `sbn.key`; logs
  `PhoneNotifService: mirror → watch` (sent = queued on the Wear
  channel, not acked). Verified: `cmd notification post` triggered a
  live send. **Action bridge** — payload is `sbnKeyline` (sbn
  keys contain `|` so the delimiter is ); watch posts each
  mirrored notif under `NOTIF_ID+1+(key.hash&0xff)` with an
  "Open on phone" action → `WatchNotifReceiver` (goAsync +
  GlobalScope) → `PhoneBridge.phoneAction` → new `/hive/notifact`
  path → `PhoneNotifService.act` fires the original `contentIntent`
  ("open") or `cancelNotification` ("dismiss"), result on
  `/hive/notifact/reply`. **Inline reply** — the mirrored notif
  also carries a Wear RemoteInput action (FLAG_MUTABLE PI —
  required for RemoteInput delivery): voice/canned text →
  `WatchNotifReceiver` (ACTION_REPLY) → `replykeytext`
  → phone `replyTo` finds the original notification's action with
  `remoteInputs`, `RemoteInput.addResultsToIntent` +
  `actionIntent.send` — identical to replying in the shade.
  Gemini's reply-from-wrist. Spec split is `limit=3` (text may
  itself contain -free content; key never does).
  `act` also accepts "#N" keys → Nth-newest active notification,
  which powers `actOnNotification(key,verb,text?)` + the numbered
  `readNotifications` output — verified live: `dismiss #3`
  cleared a real notification from the shade via a system
  AppFunctions call. **Wear OS hard gates (verified on the
  Watch5)**: (1) the Wear data layer is PACKAGE-SCOPED — messages
  deliver only to the same applicationId on the peer; the watch
  app now ships `applicationId=dev.agenthive.phone` (Kotlin
  namespace stays dev.agenthive.watch — manifest component names
  must then be ABSOLUTE since `.x` resolves to applicationId).
  Every phone→watch send was silently dropped before this; after
  the rename /hive/find/start, /hive/notify and mirrored notifs
  deliver instantly. (2) The Wear app_function indexer accepts
  ONLY the v1 doc (`<version>1</version>` + `<function_id>`
  snake_case — the KSP v2 doc throws "Missing functionId" in
  AppFunctionDocumentParserImpl); indexed entries show
  `packageName` under dumpsys app_function — no `cmd
  app_function` shell exists on Wear (dumpsys-only introspection).
  (3) Manifest MESSAGE_RECEIVED delivery can still lag for
  sideloaded apps — MeshService registers a runtime
  `MessageClient.addListener` fallback into the same
  `WatchWearService.handleMessage` dispatch.
  Swipe-away on the watch also dismisses
  the phone shade (setDeleteIntent → ACTION_DISMISS_PHONE →
  `dismisskey`) — full bidirectional clear.
  Phone's shared `assets.srcDir("../app/src/main/assets")` means
  same-named watch assets collide — watch's doc is
  `watch_appfunctions.xml`.
  Prior note (kept for the search trail): the index shows 216 docs
  (~108 unique functions × static+runtime) — GSA
  (`intelligent_assist/invokeTextQueryIntelligentAssist`), GMS
  (`device_state/setDeviceStateItem` etc. via its own v2
  `GmsAppFunctionService`), Samsung calendar/clock/notes/tasks/photos
  via `MainAppFunctionService`; Samsung Routine is a consumer
  (`AppFunctionsMetadataCollector`).
  Wear UX parity: `MainActivity` registers a public-API
  `AmbientLifecycleObserver` (wear 1.4 — the Impl class is internal,
  use the top-level factory) → `UiState.ambient` → ChatScreen swaps its
  radial gradient for flat black (OLED burn-in) so the last reply stays
  glanceable on AOD like Gemini. `ScalingLazyColumn` in
  wear-compose-foundation 1.7 takes `rotaryScrollableBehavior` directly —
  `RotaryScrollableDefaults.behavior(state)` gives continuous fling
  (snap behavior is wrong for chat); no manual focusRequester needed.
  `TimeText` (material3) sits at the top arc above the status pill —
  canonical Wear placement.
  **Workout-verb fix**: "start a run"
  used to die in openApp — the open/launch regex now yields to the workout
  matcher when the verb is start|begin|track|log|record AND the noun resolves
  via `HealthWorkout.typeFor`. Watch-face complication:
  `complication/HiveComplicationService` (androidx.wear.watchface
  complications-data-source 1.2.1 — SHORT_TEXT "✦ Ask" + monochromatic icon,
  LONG_TEXT title + `store.lastReply`, RANGED_VALUE live battery; tap →
  MainActivity VOICE_ASSIST; meta-data SUPPORTED_TYPES + UPDATE_PERIOD 600s;
  same legacy action Google's assistant uses).
  Memory:
  `GET|POST /api/memory` (kv `mem:{uid}`, 50 cap, idx is 1-based — `idx`
  present means delete even when falsy/0-invalid → text never appends on a
  delete call) + `_memories()` injected into both `try_stream` and
  `agent_reply` prompts ("remember/note/keep in mind X" and "forget N|X"
  are watch-local commands hitting the API via `api.memoryAdd`/`memoryForget`).
  Glanceable tile: `tile/HiveTileService` (androidx.wear.tiles 1.5.0 —
  hybrid API: `req.deviceConfiguration` is protolayout DeviceParameters,
  `onTileResourcesRequest` returns protolayout Resources, Tile.Builder is
  tiles-ns; inside `Column.Builder.apply{}` `this` is the Builder — capture
  ctx for `Text.Builder(ctx,…)`) shows paired status + `store.lastReply`
  (persisted on every assistant reply/device ack) + "✦ Ask" chip launching
  MainActivity.
- Settings → Permissions (`modals/permissions.jsx`) — device rows query
  `navigator.permissions` live + run real requests; agent rows set
  `agents.use_who` ('' follows visibility | public|friends|people|private),
  `agents.use_when` (always|online|off) and `agent_allowed_users` via PATCH.
  `can_use_agent` (helpers.py) gates every generation path — @summons, agent
  DMs, hooks, engage roster, Try tab, workspace agent desk — while
  `can_see_agent` stays the view/library gate. `use_when='online'` checks
  `users.status != 'offline'` (ws presence).
- **Nexus mesh** (lemonade-nexus, `app/nexus.py` + `app/routes/nexus.py` +
  `modals/mesh.jsx` at Settings → Nexus Mesh): the backend joins the
  `lemonade-nexus.io` mesh as ONE host-level node over the SDK's userspace
  WireGuard dataplane (ctypes → `backend/nexus/bin/lemonade_nexus_sdk.dll`,
  fetched by `backend/nexus/fetch.py`, pinned release 2026.11.08.2; override
  `AGENTHIVE_NEXUS_SDK`). No TUN/admin. Flow in `_connect`: SEIP DNS
  discovery (`ln_discover_servers`, health-walks candidates — individual
  sn0X nodes ARE flaky) → pin stored genesis key or TOFU
  `ln_discover_genesis_key` (≥3 agreeing hosts) → Ed25519 identity
  (`backend/nexus/data/identity.json`, gitignored — it's the node key) →
  `ln_join_network` ×3 → `ln_mesh_enable` → `ln_mesh_expose_service(vport,
  tcp:127.0.0.1:PORT)` publishes the whole app (API + dist UI + /ws) at
  `<tunnel_ip>:<vport>`. Peers = devices in our account group; mint invites
  via POST `/api/nexus/invite` (`ln_link_token_create`, 8-digit code + lnk_
  token) — friend pastes it into their Mesh settings (or any nexus client)
  and joins as a peer. `POST /api/nexus/egress` {ip,port} → loopback bridge
  to a peer's published service (their hive at http://127.0.0.1:<lp> —
  login still required). `DELETE /api/nexus/devices/{node_id|ed25519:pk}`
  revokes a member (trash icon per peer): `ln_remove_group_member` on our
  group node — we can't delete their node (`ln_delete_node` is refused,
  it belongs to their identity), we strip our group's grant instead;
  node_id→mgmt_pubkey resolves via peers then `ln_get_group_devices`
  so offline members can still be kicked. kv: `nexus:cfg` (enabled/domain/region/server/
  device_name/vport — enabled rejoins on boot via main startup),
  `nexus:net` (genesis_pubkey + chain + epoch floor — trust anchors,
  `ln_set_epoch_floor` on next boot). FFI serialized under one lock;
  routes run blocking joins via `asyncio.to_thread` (first join ~30s:
  Tier-1 chain walk). **`GET status`/`GET peers` are any-login reads;
  every mutating `/api/nexus/*` route is `require_admin`** — the node is
  shared infra. The Mesh page shows for all users: admins get the full
  console, others get a view-only status/peers readout with a "redeem
  codes on your own client" hint. Site admins = `users.is_admin` flag +
  `AGENTHIVE_ADMINS` env (comma-separated usernames, re-promoted every
  boot in `db.init()` and honored by `require_admin` even if the flag is
  wiped → permanent; currently `MichaelAnthony`). `is_admin` rides
  `public_user` so `/api/me` and login expose it. `AGENTHIVE_NEXUS=1`
  forces autostart, `=0` disables;
  `AGENTHIVE_NEXUS_{DOMAIN,REGION,SERVER,VPORT}` overrides.
- **Tauri desktop shell** (`frontend/src-tauri`, `start-tauri.bat`): the WebView2
  denies popups outright — `main.rs` `on_new_window`/`on_navigation` hand
  external URLs to the system browser via explorer, and `on_permission_request`
  auto-grants Microphone/Camera/DisplayCapture/Notifications/ClipboardRead.
  Frontend detects the shell via `window.__TAURI__` (connections.jsx skips the
  dead popup and polls `GET /api/connections` until the card flips connected —
  the OAuth callback can't postMessage across browsers). Rebuild with
  `cargo build --release` in `frontend/src-tauri`.
- Local LLM playground proxies Ollama :11434 / LM Studio :1234 — override with
  `AGENTHIVE_OLLAMA` / `AGENTHIVE_LMSTUDIO`. `AGENTHIVE_MODELDIR` (default
  `D:/AI-Models`) is scanned for .gguf/HF models → `/api/llm/providers` returns
  them as the `modeldir` provider (bare model names, 60s cache).
- Backend layout: `app/config.py` holds every env tunable (`AGENTHIVE_*`,
  `SUPABASE_*`) and loads `backend/.env`; `app/main.py` is a thin factory;
  request models in
  `app/schemas.py`, serializers/lookups in `app/helpers.py`, async bot/starboard/
  agent-reply/reminder tasks in `app/services.py`, endpoints by domain in
  `app/routes/{auth,friends,servers,dms,messages,engage,agents,playground,packs,hooks,misc,ws}.py`.
- Incoming webhooks live in `app/routes/hooks.py` — `channel_hooks` rows mint
  `/api/hooks/{token}` URLs (owner-only CRUD via `/api/channels/{cid}/webhooks`
  and `/api/webhooks/{wid}`); posts land as `hook:<id>` bot users with optional
  `author_name` overrides + `allowed_mentions` gating (8 posts/10s per hook).
- Frontend modals live in `frontend/src/components/modals/*.jsx` — shared bits
  (`Modal`, `ModelField`, `useLlmProviders`, presets/consts) in `_shared.jsx`;
  `components/Modals.jsx` is just a re-export barrel (import sites unchanged).
  Chat pieces live in `components/chat/` (`Message`, `ChannelTools`, `ThreadPanel`,
  `consts.js`); `ChatView.jsx` is the orchestrator that imports them.
- QA scripts/screenshots live under `qa/`.
- Uploads live in `backend/uploads/` — served at `/api/files/{id}?token=` (auth via query
  for `<img>` tags). `agent_history` snapshots the previous agent on every PATCH.
- Git Bash `/tmp` is invisible to Windows python.exe — use paths under `D:\AgentHive`
  for QA fixtures, and open JSON files with `encoding='utf-8'` (emoji in payloads).
- uvicorn --reload is flaky on this box — WatchFiles misses saves, and killing the
  reloader leaves an orphan worker that keeps serving STALE code on the same port
  (netstat then shows phantom LISTENING PIDs that taskkill can't find — the socket
  was inherited). Symptoms: requests answer 200 with old routes. Fix: find workers
  via `Get-CimInstance Win32_Process` looking for `multiprocessing.spawn` children
  whose parent_pid is a dead reloader, kill them, then run WITHOUT --reload:
  `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8075`
  and verify `netstat -ano | grep :8075` shows exactly one listener.
  `run.py` now defaults to reload OFF — opt in with `AGENTHIVE_RELOAD=1`.
- Agents are summonable in chat: `@agentname` posts spawn a `agent:<slug>` bot user
  and an async LLM reply (typing indicator → reply quoting the trigger → mention
  ping). Deduped by slug (same-named forks = one bot); 8s per-agent-channel cooldown;
  requires a local LLM up or the bot replies with an "offline" fallback line.
  `agents.ai_flags` carries channel-AI capabilities WITH the agent (`{"web":true}`
  grants web_search/web_fetch wherever it's summoned — merged over
  `channels.ai_flags` in agent_reply; PATCHable, shown as `ai` in agent_json,
  "Live web access" checkbox in the publish modal).
- Directed buzz events (`payload.to`) reach the target even when the actor isn't a
  friend (that's how bot-mention pings reach the asker through /api/buzz).
- Workspaces (`app/workspace.py` + `app/routes/workspaces.py`): a server can link a
  folder on the host (`workspaces.root`) that members and their agents read/edit.
  Every path is resolved inside the root (`norm_rel`/`resolve` reject `..`, absolute
  paths and escaping symlinks); `.git`, `node_modules`, `.env` etc. are hidden.
  Per-user grants `read|write|admin` (`workspace_grants`); the server owner is always
  admin; **agents inherit the summoner's level**, so they can never exceed it.
  Every write snapshots the old bytes into `workspace_revisions` (25/path) and every
  action lands in `workspace_audit` with `agent_id` attached. `AGENTHIVE_WORKSPACE_ROOTS`
  (comma list) allow-lists roots, `AGENTHIVE_WORKSPACE_EXEC=0` kills the terminal,
  `AGENTHIVE_WORKSPACE_AGENT_TOOLS=0` disables agent file tools.
  Channels wire to a workspace via `channels.workspace_id` (channel edit modal) —
  agents summoned there get the tool prompt and run `read_file`/`write_file`/…
  through `workspace.parse_tool_calls` (JSON `{"tool","args"}` replies).
  `GET /api/workspaces/{wid}/chat` find-or-creates the workspace's own agent
  channel (`workspaces.chat_channel_id`, slugified name, `workspace_id` wired) —
  that channel is the shared Studio↔Chat room every server member can post in,
  and it is hidden from the sidebar's Agent channels list (`!c.workspace` in
  `ServerSidebar`) so it only lives inside its workspace.
  Frontend: `components/Workspace.jsx` (tree/editor/diff/history/activity/access +
  agent desk + terminal; the agent panel's left edge is a drag resizer, width
  persisted as `st.wspanel`). `modals/workspace.jsx` links a folder.
  **Chat is an editor tab, not a mode**: `openChat()` pushes a `{kind:"chat"}`
  tab (sentinel path `CHAT_TAB`) into the same tab list as files, so it opens,
  closes and switches like any file. `WorkspaceChat` mounts the real `ChatView`
  on the workspace channel and registers it in `guestchan.js` — App's WS
  dispatcher then routes message/typing/reaction/read events to it and skips
  unread badges while it's open (`st:guestchan` clears on mount). In chat mode
  the file tree + agent desk hide (`.ws-body.chat-mode`) so chat gets full width.
  The active file is stamped into `workspace_sessions.path` via
  `POST /api/workspaces/{wid}/focus`; `services._focus_for` reads it so a chat
  summon hands the agent the same file the agent desk would.
  Agent toolset (level-gated): `list_files`, `read_file`, `search_files`,
  `file_info` (read) · `write_file`, `edit_file`, `delete_file`, `move_file`,
  `make_dir` (write) · `run_command` (admin). `edit_file` replaces exactly one
  occurrence and refuses missing/ambiguous matches. `workspace.agent_prompt()`
  is the single shared prompt for both the agent desk and chat summons.
- QA: `node <browser-automation-skill>/browser.mjs http://localhost:5175 --script qa.mjs`.
  This box has Supabase configured, so QA scripts must click the "crew account" tab
  before filling mike/password. `qa/agent_ws.py` drives the agent tool loop against
  `qa/stub_llm.py` (a fake OpenAI endpoint) — no real model needed.
- Backend smoke test (zero deps, temp DB): `cd backend && .venv/Scripts/python.exe -m unittest tests.test_smoke`.
  Workspace suite: `-m unittest tests.test_workspaces`.
- Conventions mirror MedicalApp: same CSS vars (--bg/--panel/--accent/--honey),
  dark default + warm light theme via `[data-theme]` on `<html>`.
