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
  `res/xml/voice_interaction_service.xml` or keyguard blocks it with "Unlock
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
  Watch: `Speaker` plays replies after stream done (markdown stripped, 800ch);
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
  names to the stored URI with no extra model call. Actions include `typekeys`
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
  **Gemini-parity surface**: `CmdReply.deferred` (`suspend () -> String?`)
  runs async follow-ups after the ack line — sensor reads and hive calls
  get a second assistant message + TTS. DeviceCommands covers timers/alarms
  (`android.intent.action.SET_TIMER/SET_ALARM/SHOW_*`, SET_ALARM perm is
  auto-granted), `google.navigation:`/`geo:` deep-links, `tel:`/`smsto:`,
  heart rate + step counter (`device/HealthProbe` — one-shot SensorManager
  reads, needs BODY_SENSORS, replies deep-link to our app-info page when
  ungranted), notification reads (`HiveNotifService.latest()` — bound
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
  spoken aliases in `typeFor`; needs ACTIVITY_RECOGNITION granted).
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
