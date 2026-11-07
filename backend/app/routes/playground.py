"""LLM endpoints + agent playground (try/stream/connect)."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from ..auth import current_user
from ..db import db, now, row_to_dict

from ..helpers import _agent_llm, _grounding, _server_llm, _split_model, _sysprompt, _user_llm, agent_json, can_see_agent
from ..schemas import AgentConnectIn, LlmConfigIn, TryIn

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
        if not a or not can_see_agent(conn, a, user["id"]):
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
    """NDJSON stream: {t:'meta'|'token'|'done', ...} one JSON object per line."""
    from ..llm import chat_stream
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        ep = _agent_llm(agent) or _user_llm(conn, user["id"])
    if body.provider == "custom" and not ep:
        raise HTTPException(400, "Configure an API connection on this agent or in Settings → LLM")
    _aprov, _amdl = _split_model(agent.get("model"))

    def gen():
        try:
            for kind, data in chat_stream(
                    _sysprompt(agent, _grounding(agent["context_url"], agent.get("context_method", "GET"),
                               body.message, agent.get("context_headers")) if agent["context_url"] else ""),
                    body.history, body.message,
                    model=body.model or _amdl,
                    provider=body.provider or _aprov,
                    temperature=agent.get("temperature"), endpoint=ep):
                if kind == "meta":
                    yield json.dumps({"t": "meta", **data}) + "\n"
                elif kind == "token":
                    yield json.dumps({"t": "token", "c": data}) + "\n"
                else:
                    yield json.dumps({"t": "done"}) + "\n"
        except Exception as e:
            yield json.dumps({"t": "error", "message": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
