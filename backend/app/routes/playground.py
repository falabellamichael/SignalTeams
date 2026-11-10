"""LLM endpoints + agent playground (try/stream/connect)."""
import json
import re
import time
import urllib.parse as _up
import urllib.request as _u

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from ..auth import current_user
from ..db import db, now, row_to_dict

from ..helpers import _agent_llm, _grounding, _memories, _server_llm, _split_model, _sysprompt, _user_llm, agent_json, can_see_agent, can_use_agent
from ..schemas import ActIn, AgentConnectIn, EmbedIn, LlmConfigIn, MemIn, TryIn, TtsIn
from ..services import WEB_TOOLS, _ai_web_tool
from .. import connections as cx
from .. import workspace as wsx

router = APIRouter()


def _probe_endpoint(ep: dict, model_override: str = "") -> dict:
    """Test an OpenAI-compatible, Anthropic, Ollama, or Webhook endpoint."""
    from ..llm import _anth_base, _ep_headers, _extract_chat_models, _get, _oai_base, _post
    ekind = (ep.get("kind") or "openai").strip().lower() or "openai"
    extra = _ep_headers(ep)
    mdl = (model_override or ep.get("model") or "").strip()
    if ekind == "webhook":
        d = _post(ep["url"], {"system_prompt": "ping", "messages": [
            {"role": "user", "content": "ping"}], "model": mdl or "default",
            "temperature": 0}, 15, ep.get("key"), extra)
        return {"ok": True, "kind": ekind, "url": ep["url"], "models": [], "sample": str(d)[:220]}
    if ekind == "ollama":
        d = _get(f"{ep['url'].rstrip('/')}/api/tags", timeout=8, key=ep.get("key"), extra=extra)
        models = [m["name"] for m in d.get("models", []) if "embed" not in m.get("name", "").lower()][:50]
        return {"ok": True, "kind": ekind, "url": ep["url"], "models": models}
    if ekind == "anthropic":
        ah = {"anthropic-version": "2023-06-01", **extra}
        if ep.get("key"):
            ah["x-api-key"] = ep["key"]
        d = _get(f"{_anth_base(ep['url'])}/models", timeout=8, extra=ah)
        models = [m["id"] for m in d.get("data", []) if m.get("id")][:50]
        return {"ok": True, "kind": ekind, "url": ep["url"], "models": models}
    try:
        d = _get(f"{_oai_base(ep['url'])}/models", timeout=10, key=ep.get("key"), extra=extra)
        models = _extract_chat_models(d)[:50]
        return {"ok": True, "kind": ekind, "url": ep["url"], "models": models}
    except Exception as first_err:
        if mdl:
            try:
                d = _post(f"{_oai_base(ep['url'])}/chat/completions", {
                    "model": mdl,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 4,
                    "stream": False,
                }, 12, ep.get("key"), extra)
                return {"ok": True, "kind": ekind, "url": ep["url"], "models": [mdl], "sample": str(d)[:160]}
            except Exception:
                pass
        raise first_err


@router.get("/api/me/llm")
def get_llm_config(user=Depends(current_user)):
    with db() as conn:
        r = conn.execute(
            "SELECT llm_url, llm_key, llm_model, llm_kind, llm_headers FROM users WHERE id=?",
            (user["id"],)).fetchone()
        return {"base_url": r["llm_url"], "model": r["llm_model"],
                "kind": r["llm_kind"], "has_key": bool(r["llm_key"]),
                "has_headers": bool(r["llm_headers"])}


@router.put("/api/me/llm")
def put_llm_config(body: LlmConfigIn, user=Depends(current_user)):
    url = body.base_url.strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must start with http:// or https://")
    if body.kind not in ("openai", "anthropic", "ollama", "webhook"):
        raise HTTPException(400, "kind must be openai, anthropic, ollama, or webhook")
    hdrs = None
    if body.headers is not None:
        try:
            _d = {str(k): str(v) for k, v in
                  json.loads(body.headers.strip() or "{}").items()}
            hdrs = json.dumps(_d) if _d else None
        except Exception:
            raise HTTPException(400, "headers must be a JSON object")
    with db() as conn:
        if body.api_key is None:
            conn.execute(
                "UPDATE users SET llm_url=?, llm_model=?, llm_kind=? WHERE id=?",
                (url, body.model.strip()[:128], body.kind, user["id"]))
        else:
            conn.execute(
                "UPDATE users SET llm_url=?, llm_key=?, llm_model=?, llm_kind=? WHERE id=?",
                (url, body.api_key.strip()[:256], body.model.strip()[:128],
                 body.kind, user["id"]))
        if body.headers is not None:
            conn.execute("UPDATE users SET llm_headers=? WHERE id=?",
                         (hdrs or None, user["id"]))
    return get_llm_config(user)


@router.post("/api/me/llm/test")
def test_llm_config(user=Depends(current_user)):
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    if not ep or not ep.get("url"):
        raise HTTPException(400, "No endpoint configured")
    t0 = time.time()
    try:
        res = _probe_endpoint(ep)
        res["latency_ms"] = int((time.time() - t0) * 1000)
        return res
    except Exception as e:
        return {"ok": False, "error": str(e)[:300], "latency_ms": int((time.time() - t0) * 1000)}


@router.post("/api/servers/{sid}/llm/test")
def test_server_llm(sid: int, user=Depends(current_user)):
    """Probe the server's shared endpoint — owner only."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        ep = _server_llm(conn, sid)
    if not ep or not ep.get("url"):
        raise HTTPException(400, "No endpoint configured")
    t0 = time.time()
    try:
        res = _probe_endpoint(ep)
        res["latency_ms"] = int((time.time() - t0) * 1000)
        return res
    except Exception as e:
        return {"ok": False, "error": str(e)[:300], "latency_ms": int((time.time() - t0) * 1000)}


@router.get("/api/llm/providers")
def llm_providers(user=Depends(current_user)):
    from ..llm import providers
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    return providers(ep)


@router.get("/api/llm/capabilities")
def llm_capabilities(user=Depends(current_user)):
    """Which modality models the user's endpoint exposes — clients (watch)
    auto-detect and degrade: no TTS model → text-only replies."""
    from ..llm import modality_models
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    mods = modality_models(ep) if ep else {}
    return {
        "tts": bool(mods.get("tts")),
        "stt": bool(mods.get("stt")),
        "embed": bool(mods.get("embedding")),
        "image": bool(mods.get("image")),
        "models": mods,
    }


@router.post("/api/llm/tts")
def llm_tts(body: TtsIn, user=Depends(current_user)):
    """Synthesize speech via the endpoint's detected TTS model — proxies
    /audio/speech so the provider key never leaves the backend."""
    from ..llm import tts_speech
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text required")
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    if not ep or not ep.get("url"):
        raise HTTPException(404, "no endpoint configured")
    try:
        audio, ctype, model = tts_speech(ep, text, voice=body.voice)
    except RuntimeError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"tts failed: {str(e)[:200]}")
    return Response(content=audio, media_type=ctype,
                    headers={"X-TTS-Model": model})


@router.post("/api/llm/embed")
def llm_embed(body: EmbedIn, user=Depends(current_user)):
    """Embeddings via the endpoint's detected embedding model."""
    from ..llm import embed_texts
    if not body.texts:
        raise HTTPException(400, "texts required")
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    if not ep or not ep.get("url"):
        raise HTTPException(404, "no endpoint configured")
    try:
        return embed_texts(ep, body.texts)
    except RuntimeError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"embed failed: {str(e)[:200]}")


_ACT_SYS = """You are the device driver for a watch assistant. The user gave a task and you drive an Android device step by step.

You get the task, the target app, the list of visible on-screen texts (top-to-bottom), and the actions already tried.

Pick the SINGLE next action. Answer with ONLY a JSON object, no prose:
{"action":"...", "target":"...", "text":"..."}

Actions:
- "launch": the target app is not on screen — set target to its package-safe name.
- "tap": tap the element whose visible text best matches target (short, exact as shown).
- "type": type text into the visible input/search field — put the full query in text. If a previous "type" visibly filled the field but "enter" then searched for nothing (e.g. screen says "Couldn't find \"\""), that app ignores injected text — use "typekeys" instead.
- "typekeys": type by tapping the on-screen keyboard letter-by-letter — real key input for fields that ignore injected text.
- "enter": submit the field after typing. On Wear Spotify's search, results live-filter as you type — do NOT press enter there, it submits an empty query. Just scroll and tap a result.
- "scroll": more results exist off-screen.
- "back": go back one screen — use it to escape a detail/now-playing view into browse lists.
- "home": leave the app for the watch face — only when re-launching cleanly is the only path forward.
- "wait": screen is loading or changing.
- "ask": multiple equally-good options and you cannot decide — put a numbered list in text (e.g. "1. Lex Fridman  2. The AI Daily").
- "done": the task is finished (episode playing, message sent).
- "fail": impossible after the tries so far — explain why in text.

Rules: prefer the most direct path; search before browsing; when several results look right, use ask rather than guessing; never invent UI elements that aren't in the screen list; if a tap did nothing twice, try a different element or scroll.

This is a WATCH — apps are minimal single scroll stacks. The current card (e.g. a now-playing view) usually sits on TOP of the app's home/menu tiles — SCROLL DOWN to reveal search, library and browse sections before backing out; "back" usually exits the whole app. If the screen carries a [hive-ui] marker, the assistant's own UI is covering the screen — launch the target app again. If after honest browsing nothing matches the goal, use ask to list what IS available (names you actually saw) rather than cycling launch/back."""


@router.post("/api/llm/act")
def llm_act(body: ActIn, user=Depends(current_user)):
    """One device-driving step — {goal, app, screen[], steps[]} → a strict
    JSON action for the watch's AccessibilityService to execute. Non-streaming,
    low-temp; keys stay on the backend."""
    from ..llm import chat
    goal = (body.goal or "").strip()
    if not goal:
        raise HTTPException(400, "goal required")
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    screen = [str(x)[:120] for x in (body.screen or [])][:80]
    steps = [str(x)[:160] for x in (body.steps or [])][-12:]
    msg = {
        "goal": goal,
        "app": (body.app or "")[:64],
        "screen": screen,
        "steps": steps,
        "picked": (body.picked or "")[:160],
    }
    try:
        reply, _p, _m = chat(_ACT_SYS, [], json.dumps(msg),
                             model=body.model, temperature=0.15, endpoint=ep)
    except Exception as e:
        raise HTTPException(502, f"act failed: {str(e)[:200]}")
    m = re.search(r"\{[^{}]*\}", reply, re.S)
    if not m:
        return {"action": "fail", "text": "model returned no action"}
    try:
        act = json.loads(m.group(0))
    except Exception:
        return {"action": "fail", "text": "model returned bad JSON"}
    a = str(act.get("action") or "").strip().lower()
    if a not in ("launch", "tap", "type", "typekeys", "enter", "scroll", "wait",
                 "back", "home", "done", "ask", "fail"):
        return {"action": "fail", "text": f"unknown action {a!r}"}
    return {
        "action": a,
        "target": str(act.get("target") or "")[:160],
        "text": str(act.get("text") or "")[:2000],
    }


_RESOLVE_SYS = """You pick media for a voice assistant. The user asked to play/listen to something on an app (e.g. spotify).

Reply with ONLY JSON naming up to 3 real, well-known shows/artists/titles matching the request, best first: {"queries":["Lex Fridman Podcast","The TWIML AI Podcast"]}
Use REAL names only — an AI podcast request maps to shows like Lex Fridman Podcast, TWIML AI, Practical AI. Never generic words like "ai podcast" and never placeholders."""


_PICK_SYS = """You pick ONE item for a voice assistant's user, or admit you can't decide.

You get the task and a numbered list of real titles found on the service.

- If one clearly fits best: {"pick": <number>}
- If several fit equally well: {"pick": 0} — the user will choose.

Output ONLY the JSON."""


def _itunes_shows(q):
    """Canonical podcast names from Apple's public lookup — free, unauthed,
    never blocks. Returns [(collectionName, collectionId)]."""
    try:
        req = _u.Request(
            "https://itunes.apple.com/search?term=" + _up.quote(q) +
            "&media=podcast&entity=podcast&limit=3",
            headers={"User-Agent": "Mozilla/5.0"})
        data = json.loads(_u.urlopen(req, timeout=8)
                          .read().decode("utf-8", "replace"))
        return [(r.get("collectionName") or "", r.get("collectionId"))
                for r in data.get("results", [])
                if r.get("collectionName")]
    except Exception:
        return []


def _spotify_candidates(queries):
    """Ground candidate names to real open.spotify.com links via DDG-lite.
    Returns [{label, uri}] with spotify: deep links, deduped by uri.
    Calls are spaced — bursting gets DDG to soft-block the IP for minutes."""
    out, seen = [], set()
    for q in queries[:3]:
        res = _ai_web_tool("web_search", {"q": f"{q} spotify"})
        time.sleep(1.2)  # stay under DDG-lite's burst limit
        for hit in (res.get("results") or []):
            m = re.search(
                r"open\.spotify\.com/(show|episode|playlist|album|track|artist)"
                r"/([A-Za-z0-9]+)", hit)
            if not m:
                continue
            kind, oid = m.group(1), m.group(2)
            uri = f"spotify:{kind}:{oid}"
            if uri in seen:
                continue
            seen.add(uri)
            label = hit.split("—")[0].strip()[:80] or q
            out.append({"label": label, "uri": uri})
            if len(out) >= 6:
                return out
    return out


@router.post("/api/llm/resolve")
def llm_resolve(body: ActIn, user=Depends(current_user)):
    """Resolve a play/listen goal into a concrete deep link — the backend
    does the thinking so the watch only opens a URI and taps play.
    {goal:"play a podcast about ai on spotify"} →
    {action:"deeplink", uri:"spotify:show:…"} or
    {action:"ask", options:[{label,uri}]} when picks are genuinely tied."""
    from ..llm import chat
    goal = (body.goal or "").strip()
    if not goal:
        raise HTTPException(400, "goal required")
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    # 1) goal → specific show/artist candidates
    try:
        reply, _p, _m = chat(_RESOLVE_SYS, [], goal,
                             temperature=0.3, endpoint=ep)
    except Exception as e:
        raise HTTPException(502, f"resolve failed: {str(e)[:200]}")
    m = re.search(r"\{[^{}]*\}", reply, re.S)
    queries = []
    if m:
        try:
            queries = [str(x)[:80] for x in
                       json.loads(m.group(0)).get("queries") or []
                       if "<" not in str(x) and "…" not in str(x)
                       and str(x).strip() != "..."][:3]
        except Exception:
            pass
    if not queries:
        cleaned = re.sub(r"(?i)\b(play|listen( to)?|put on|a|the|on|spotify|"
                         r"podcast(s)?|about|music|song)\b", " ", goal)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        queries = [cleaned or goal]
    # canonicalize podcast names through Apple's public catalog — the model's
    # names are usually right but iTunes confirms and fixes small errors.
    for i, q in enumerate(queries):
        shows = _itunes_shows(q)
        if shows:
            queries[i] = shows[0][0]
    # 2) ground to real open.spotify.com links
    cands = _spotify_candidates(queries)
    if not cands:
        # no grounded links — still far better than blind browsing: a
        # precise search query the watch can fire at the app's search page.
        return {"action": "search", "query": queries[0],
                "options": [{"label": q, "uri": ""} for q in queries]}
    if len(cands) == 1:
        return {"action": "deeplink", "uri": cands[0]["uri"],
                "options": cands}
    # 3) model picks — or defers to the user when tied
    listing = "\n".join(f"{i+1}. {c['label']}" for i, c in enumerate(cands))
    try:
        reply, _p, _m = chat(_PICK_SYS, [],
                             f"task: {goal}\n\n{listing}",
                             temperature=0.1, endpoint=ep)
        pm = re.search(r"\{[^{}]*\}", reply, re.S)
        pick = int(json.loads(pm.group(0)).get("pick", 0)) if pm else 0
    except Exception:
        pick = 0
    if 1 <= pick <= len(cands):
        return {"action": "deeplink", "uri": cands[pick - 1]["uri"],
                "options": cands}
    return {"action": "ask",
            "text": "\n".join(f"{i+1}. {c['label']}"
                              for i, c in enumerate(cands[:5])),
            "options": cands[:5]}


@router.get("/api/memory")
def memory_list(user=Depends(current_user)):
    """Personal-context memory — things the user asked the assistant to keep."""
    with db() as conn:
        r = conn.execute("SELECT value FROM kv WHERE key=?",
                         (f"mem:{user['id']}",)).fetchone()
    return json.loads(r["value"]) if r and r["value"] else []


@router.post("/api/memory")
def memory_add(body: MemIn, user=Depends(current_user)):
    """Store a memory line ("remember that …"), or forget item idx."""
    key = f"mem:{user['id']}"
    with db() as conn:
        r = conn.execute("SELECT value FROM kv WHERE key=?",
                         (key,)).fetchone()
        items = json.loads(r["value"]) if r and r["value"] else []
        if body.idx is not None:
            if 1 <= body.idx <= len(items):
                items.pop(body.idx - 1)
        elif body.text.strip():
            items.append({"t": body.text.strip(), "ts": now()})
        items = items[-50:]
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
                     (key, json.dumps(items)))
    return {"ok": True, "items": items}


@router.get("/api/assistant/next")
def assistant_next(user=Depends(current_user)):
    """Proactive glanceable — the next real thing on the user's calendar.
    Mirrors Google's ProactiveComplicationService: a watch-face/Tile line like
    "Team sync in 35m". Empty label when nothing is due within 6h, the
    calendar plugin isn't connected, or its grant lapsed — the caller just
    shows the default face."""
    try:
        with db() as conn:
            r = cx.plugin_tool(conn, user["id"], "gcal",
                               {"action": "events", "days": 1})
    except Exception:
        r = {"ok": False}
    if not r.get("ok") or not isinstance(r.get("result"), list):
        return {"label": "", "kind": ""}
    import datetime as _dt
    now_dt = _dt.datetime.now(_dt.timezone.utc)
    horizon = now_dt + _dt.timedelta(hours=6)
    best = None
    summary = ""
    for e in r["result"]:
        st = e.get("start") or ""
        try:
            dt = _dt.datetime.fromisoformat(st.replace("Z", "+00:00"))
        except Exception:
            continue                     # all-day events carry date only
        if now_dt <= dt <= horizon and (best is None or dt < best):
            best = dt
            summary = (e.get("summary") or "").strip()
    if best is None or not summary:
        return {"label": "", "kind": ""}
    mins = int((best - now_dt).total_seconds() // 60)
    when = (f"in {mins}m" if mins < 60 else
            "at " + best.astimezone().strftime("%I:%M %p").lstrip("0"))
    return {"label": f"{summary[:28]} {when}", "kind": "calendar",
            "at": best.isoformat()}


@router.put("/api/agents/{aid}/connect")
def put_agent_connect(aid: int, body: AgentConnectIn, user=Depends(current_user)):
    """Configure an individual agent's API / LLM / Webhook / Grounding connection."""
    kind = (body.api_kind or "").strip().lower()
    if kind not in ("", "openai", "anthropic", "ollama", "webhook"):
        raise HTTPException(400, "api_kind must be openai, anthropic, ollama, webhook, or empty")
    url = (body.api_url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "api_url must start with http:// or https://")
    ctx_url = body.context_url.strip()[:512] if body.context_url is not None else None
    if ctx_url and not ctx_url.startswith(("http://", "https://")):
        raise HTTPException(400, "context_url must start with http:// or https://")

    def _norm_hdrs(raw, label):
        if raw is None:
            return None, False
        s = raw.strip()
        if not s:
            return None, True
        try:
            obj = json.loads(s)
            if not isinstance(obj, dict):
                raise ValueError()
            clean = {str(k): str(v) for k, v in obj.items()}
            return (json.dumps(clean) if clean else None), True
        except Exception:
            raise HTTPException(400, f"{label} must be a valid JSON object")

    api_hdrs, set_api_hdrs = _norm_hdrs(body.api_headers, "api_headers")
    ctx_hdrs, set_ctx_hdrs = _norm_hdrs(body.context_headers, "context_headers")

    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        new_key = a["api_key"] if body.api_key is None else body.api_key.strip()[:256]
        new_model = a["model"] if body.model is None else body.model.strip()[:128]
        new_ctx_url = a["context_url"] if ctx_url is None else ctx_url
        new_ctx_method = (body.context_method or a["context_method"] or "GET").strip().upper()
        if new_ctx_method not in ("GET", "POST"):
            new_ctx_method = "GET"
        final_api_hdrs = api_hdrs if set_api_hdrs else a["api_headers"]
        final_ctx_hdrs = ctx_hdrs if set_ctx_hdrs else a["context_headers"]
        conn.execute(
            "UPDATE agents SET api_kind=?, api_url=?, api_key=?, model=?, api_headers=?, "
            "context_url=?, context_method=?, context_headers=?, updated_at=? WHERE id=?",
            (kind, url[:512], new_key, new_model, final_api_hdrs,
             new_ctx_url, new_ctx_method, final_ctx_hdrs, now(), aid))
        updated = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        return agent_json(conn, updated, user["id"])


@router.post("/api/agents/{aid}/connect/test")
def test_agent_connect(aid: int, body: AgentConnectIn | None = None, user=Depends(current_user)):
    """Probe an agent's individual API connection and/or grounding webhook live."""
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        fallback_ep = _user_llm(conn, user["id"])

    # Merge inline form values if testing unsaved settings
    kind = ((body.api_kind if body and body.api_kind is not None else agent.get("api_kind")) or "").strip().lower()
    url = ((body.api_url if body and body.api_url is not None else agent.get("api_url")) or "").strip().rstrip("/")
    key = (agent.get("api_key") or "") if (not body or body.api_key is None) else body.api_key.strip()
    model = ((body.model if body and body.model is not None else agent.get("model")) or "").strip()
    hdrs = agent.get("api_headers") if (not body or body.api_headers is None) else (body.api_headers.strip() or None)
    ctx_url = ((body.context_url if body and body.context_url is not None else agent.get("context_url")) or "").strip()
    ctx_method = ((body.context_method if body and body.context_method is not None else agent.get("context_method")) or "GET").strip().upper()
    ctx_hdrs = agent.get("context_headers") if (not body or body.context_headers is None) else (body.context_headers.strip() or None)

    ep = {"url": url, "key": key, "model": model, "kind": kind or "openai", "headers": hdrs} if url else fallback_ep
    out = {
        "ok": False,
        "kind": ep["kind"] if ep else "local",
        "url": ep["url"] if ep else "",
        "inherited": not bool(url) and bool(fallback_ep and fallback_ep.get("url")),
        "inherited_model": (fallback_ep or {}).get("model") or "",
        "models": [],
    }

    t0 = time.time()
    try:
        if ep and ep.get("url"):
            probe = _probe_endpoint(ep, model_override=model)
            out.update(probe)
        else:
            from ..llm import providers as _provs
            ps = _provs()
            out["models"] = [f"{p['name']}:{m}" for p in ps for m in p.get("models", [])]
            out["ok"] = len(out["models"]) > 0 or bool(ctx_url)
            if not out["ok"]:
                out["error"] = "No dedicated API URL set and no local Ollama/LM Studio models detected."
    except Exception as e:
        out["ok"] = False
        out["error"] = str(e)[:300]
    out["latency_ms"] = int((time.time() - t0) * 1000)

    if ctx_url:
        ct0 = time.time()
        preview = _grounding(ctx_url, ctx_method, "ping", ctx_hdrs)
        out["context_tested"] = True
        out["context_ok"] = bool(preview)
        out["context_ms"] = int((time.time() - ct0) * 1000)
        out["context_preview"] = preview[:240] if preview else ""

    return out


@router.post("/api/agents/{aid}/try")
def try_agent(aid: int, body: TryIn, user=Depends(current_user)):
    from ..llm import chat
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_use_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        ep = _agent_llm(agent) or _user_llm(conn, user["id"])
    if body.provider == "custom" and not ep:
        raise HTTPException(400, "Configure an API connection on this agent or in Settings → LLM")
    _aprov, _amdl = _split_model(agent.get("model"))
    try:
        reply, provider, model = chat(
            _sysprompt(agent, _grounding(agent["context_url"], agent.get("context_method", "GET"),
                       body.message, agent.get("context_headers")) if agent["context_url"] else ""),
            body.history, body.message,
            model=body.model or _amdl,
            provider=body.provider or _aprov,
            temperature=agent.get("temperature"), endpoint=ep)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"reply": reply, "provider": provider, "model": model}


@router.post("/api/agents/{aid}/try_stream")
def try_agent_stream(aid: int, body: TryIn, user=Depends(current_user)):
    """NDJSON stream: {t:'meta'|'token'|'tool'|'done', ...} one JSON object per
    line. Agents carrying ai.web get the web tools; the caller's connected
    plugins (github, gmail, …) act strictly as the caller — same tool loop the
    channel summon path uses, so watch clients see ⚙ tool events."""
    from ..llm import chat_stream
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_use_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        ep = _agent_llm(agent) or _user_llm(conn, user["id"])
        try:
            ai_flags = json.loads(a["ai_flags"] or "{}") \
                if "ai_flags" in a.keys() else {}
        except Exception:
            ai_flags = {}
        ai_web = bool(ai_flags.get("web"))
        plugs = set(cx.connected_plugins(conn, user["id"]))
        gh_public = False
        if ai_flags.get("github") and "github" not in plugs:
            plugs.add("github")
            gh_public = True
        uid = user["id"]
        uname = user["display_name"] or user["username"]
        mem_line = _memories(conn, uid, uname)
    if body.provider == "custom" and not ep:
        raise HTTPException(400, "Configure an API connection on this agent or in Settings → LLM")
    _aprov, _amdl = _split_model(agent.get("model"))

    sysp = _sysprompt(agent, _grounding(
        agent["context_url"], agent.get("context_method", "GET"),
        body.message, agent.get("context_headers")) if agent["context_url"] else "")
    if ai_web:
        sysp += ("\n\nYou may also use web tools — reply with ONLY JSON like "
                 '{"tool":"web_search","args":{"q":"query"}} to search, or '
                 '{"tool":"web_fetch","args":{"url":"https://…"}} to read a '
                 "live page. Use them when fresh info would help.")
    if plugs:
        conn_plugs = sorted(plugs - ({"github"} if gh_public else set()))
        if conn_plugs:
            sysp += (f"\n\n{uname} has these accounts connected in Settings → "
                     "Connections → Plugins: " + ", ".join(conn_plugs))
        else:
            sysp += f"\n\n{uname} has no external accounts connected."
        sysp += ('. You may READ them with {"tool":"plugin","args":{…}} — '
            "strictly the asker's own accounts, never anyone else's, and "
            "never claim access to services not listed here. Calls:\n"
            + "\n".join(f"- {p}: {cx.PLUGIN_USAGE[p]}"
                        + (" (public data only — no GitHub account connected; "
                           "say so if private repos are needed)"
                           if p == "github" and gh_public else "")
                        for p in sorted(plugs) if p in cx.PLUGIN_USAGE))
    sysp += mem_line

    def gen():
        hist = [dict(h) for h in (body.history or [])]
        try:
            for rnd in range(4):
                reply = ""
                msg = body.message if rnd == 0 else hist[-1]["content"]
                ctx = hist if rnd == 0 else hist[:-1]
                for kind, data in chat_stream(
                        sysp, ctx, msg,
                        model=body.model or _amdl,
                        provider=body.provider or _aprov,
                        temperature=agent.get("temperature"), endpoint=ep):
                    if kind == "meta":
                        yield json.dumps({"t": "meta", **data}) + "\n"
                    elif kind == "thinking":
                        yield json.dumps({"t": "thinking", "n": data}) + "\n"
                    elif kind == "token":
                        reply += data
                        yield json.dumps({"t": "token", "c": data}) + "\n"
                calls = wsx.parse_tool_calls(reply) if (ai_web or plugs) else []
                if not calls:
                    break
                # the round just streamed raw {"tool":…} scaffolding — tell the
                # client to swap it for the stripped text before tool events
                yield json.dumps({"t": "replace",
                                  "c": wsx.strip_tool_calls(reply).strip()}) + "\n"
                hist.append({"role": "assistant", "content": reply})
                results = []
                for c in calls[:3]:
                    t0 = time.time()
                    if c["name"] in WEB_TOOLS:
                        res = _ai_web_tool(c["name"], c["args"]) if ai_web else \
                            {"ok": False, "error": "web tools are off for this agent"}
                    elif c["name"] == "plugin":
                        p_args = c["args"] or {}
                        with db() as conn:
                            res = cx.plugin_tool(
                                conn, uid,
                                str(p_args.get("plugin") or ""), p_args)
                    else:
                        res = {"ok": False, "error": f"unknown tool {c['name']}"}
                    yield json.dumps({"t": "tool", "name": c["name"],
                                      "ok": bool(res.get("ok")),
                                      "secs": round(time.time() - t0, 1)}) + "\n"
                    results.append(
                        f"TOOL RESULT {c['name']}: {json.dumps(res)[:4000]}")
                hist.append({"role": "user", "content":
                    "(tool output — your calls just ran; quote these results, "
                    "don't claim you can't see them)\n\n"
                    + "\n\n".join(results) + "\n\nAnswer in plain text."})
            yield json.dumps({"t": "done"}) + "\n"
        except Exception as e:
            yield json.dumps({"t": "error", "message": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
