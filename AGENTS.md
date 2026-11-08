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
  when it exists (single-port mode — `start-lan.bat` does build+serve).
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
