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
- Backend layout: `app/main.py` is a thin factory; request models in
  `app/schemas.py`, serializers/lookups in `app/helpers.py`, async bot/starboard/
  agent-reply/reminder tasks in `app/services.py`, endpoints by domain in
  `app/routes/{auth,friends,servers,dms,messages,engage,agents,playground,packs,misc,ws}.py`.
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
- QA: `node <browser-automation-skill>/browser.mjs http://localhost:5175 --script qa.mjs`.
- Conventions mirror MedicalApp: same CSS vars (--bg/--panel/--accent/--honey),
  dark default + warm light theme via `[data-theme]` on `<html>`.
