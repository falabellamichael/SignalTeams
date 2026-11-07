"""Local + per-agent API LLM proxy for the agent playground and in-channel summons.

Supports:
- Per-agent / server / user endpoints: OpenAI-compatible ('openai'), Anthropic ('anthropic'),
  Ollama ('ollama'), and custom JSON webhooks ('webhook').
- Auto-detected local LM Studio (:1234) and Ollama (:11434) fallbacks.
Override with AGENTHIVE_LMSTUDIO / AGENTHIVE_OLLAMA env vars.
"""
import json
import os
import urllib.request

LMSTUDIO = os.environ.get("AGENTHIVE_LMSTUDIO", "http://127.0.0.1:1234")
OLLAMA = os.environ.get("AGENTHIVE_OLLAMA", "http://127.0.0.1:11434")
TIMEOUT = float(os.environ.get("AGENTHIVE_LLM_TIMEOUT", "90"))


def _ep_headers(endpoint):
    """Merge a custom endpoint's extra headers (e.g. X-Api-Key) into requests."""
    try:
        h = endpoint.get("headers")
        return {str(k): str(v) for k, v in (json.loads(h) if isinstance(h, str) else h or {}).items()}
    except Exception:
        return {}


def _post(url, payload, timeout, key=None, extra=None):
    headers = {"Content-Type": "application/json", **(extra or {})}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _get(url, timeout=3, key=None, extra=None):
    req = urllib.request.Request(url, headers={
        **({"Authorization": f"Bearer {key}"} if key else {}), **(extra or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _oai_base(url: str) -> str:
    """Normalize an OpenAI-compatible base URL so both '.../v1' and bare hosts work."""
    u = (url or "").strip().rstrip("/")
    if u.endswith("/chat/completions"):
        u = u[: -len("/chat/completions")].rstrip("/")
    if not u.endswith("/v1"):
        u = f"{u}/v1"
    return u


def _anth_base(url: str) -> str:
    u = (url or "https://api.anthropic.com").strip().rstrip("/")
    if u.endswith("/v1/messages"):
        u = u[: -len("/v1/messages")].rstrip("/")
    if not u.endswith("/v1"):
        u = f"{u}/v1"
    return u


def lmstudio_models():
    try:
        d = _get(f"{LMSTUDIO}/v1/models")
        return [m["id"] for m in d.get("data", [])]
    except Exception:
        return []


def ollama_models():
    try:
        d = _get(f"{OLLAMA}/api/tags")
        return [m["name"] for m in d.get("models", [])
                if "embed" not in m["name"].lower()]
    except Exception:
        return []


def custom_models(endpoint):
    """Model list for an OpenAI-compatible, Anthropic, Ollama, or Webhook endpoint."""
    if not endpoint or not endpoint.get("url"):
        return []
    kind = endpoint.get("kind") or "openai"
    extra = _ep_headers(endpoint)
    if kind == "webhook":
        return [endpoint["model"]] if endpoint.get("model") else ["webhook"]
    if kind == "ollama":
        try:
            d = _get(f"{endpoint['url'].rstrip('/')}/api/tags", timeout=5, key=endpoint.get("key"), extra=extra)
            return [m["name"] for m in d.get("models", []) if "embed" not in m["name"].lower()]
        except Exception:
            return [endpoint["model"]] if endpoint.get("model") else []
    if kind == "anthropic":
        try:
            hdrs = {"anthropic-version": "2023-06-01", **extra}
            if endpoint.get("key"):
                hdrs["x-api-key"] = endpoint["key"]
            d = _get(f"{_anth_base(endpoint['url'])}/models", timeout=6, extra=hdrs)
            models = [m["id"] for m in d.get("data", []) if m.get("id")]
            if models:
                return models
        except Exception:
            pass
        return [endpoint["model"]] if endpoint.get("model") else [
            "claude-sonnet-4-20250514", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"
        ]
    try:
        d = _get(f"{_oai_base(endpoint['url'])}/models", timeout=6, key=endpoint.get("key"), extra=extra)
        return [m["id"] for m in d.get("data", [])]
    except Exception:
        return [endpoint["model"]] if endpoint.get("model") else ["default"]


def providers(endpoint=None):
    out = []
    for name, models in (("lmstudio", lmstudio_models()), ("ollama", ollama_models())):
        if models:
            out.append({"name": name, "models": models})
    if endpoint and endpoint.get("url"):
        models = custom_models(endpoint)
        out.append({"name": "custom", "models": models or ["default"]})
    return out


def _wh_text(d):
    """Fish a reply string out of any harness's response shape —
    covers {reply|content|text|response|output|result|message|answer},
    OpenAI-ish {choices:[{message|text|delta}]}, nested {data:{...}},
    {messages:[...]}, a bare list, or a raw string body."""
    if isinstance(d, str):
        return d.strip()
    if isinstance(d, list):
        return " ".join(str(x) for x in d if x).strip()
    if not isinstance(d, dict):
        return ""
    for k in ("reply", "content", "text", "response", "output", "result", "answer"):
        if d.get(k):
            return str(d[k]).strip()
    m = d.get("message")
    if isinstance(m, str) and m.strip():
        return m.strip()
    if isinstance(m, dict) and m.get("content"):
        return str(m["content"]).strip()
    if d.get("choices"):
        c = d["choices"][0] or {}
        for sub in (c.get("message", {}), c.get("delta", {}), c):
            if isinstance(sub, dict) and (sub.get("content") or sub.get("text")):
                return str(sub.get("content") or sub.get("text")).strip()
    if isinstance(d.get("data"), dict):
        return _wh_text(d["data"])
    if d.get("messages"):
        ms = d["messages"]
        last = ms[-1] if isinstance(ms, list) and ms else None
        if isinstance(last, dict) and last.get("content"):
            return str(last["content"]).strip()
        return str(last or "").strip()
    return ""


def _custom_chat(endpoint, model, msgs, temp):
    """One-shot reply from an OpenAI-compatible, Anthropic, Ollama, or Webhook endpoint."""
    kind = endpoint.get("kind") or "openai"
    use = model or endpoint.get("model") or ("claude-3-7-sonnet-latest" if kind == "anthropic" else "default")
    extra = _ep_headers(endpoint)
    label = endpoint.get("label") or kind
    if kind == "webhook":
        d = _post(endpoint["url"], {
            "system_prompt": msgs[0]["content"] if msgs and msgs[0]["role"] == "system" else "",
            "messages": [m for m in msgs if m["role"] != "system"],
            "model": use, "temperature": temp}, TIMEOUT, endpoint.get("key"), extra)
        return _wh_text(d), label, use
    if kind == "ollama":
        d = _post(f"{endpoint['url'].rstrip('/')}/api/chat", {
            "model": use, "messages": msgs, "stream": False,
            "options": {"temperature": temp}}, TIMEOUT, endpoint.get("key"), extra)
        return d["message"]["content"].strip(), label, use
    if kind == "anthropic":
        sys_txt = msgs[0]["content"] if msgs and msgs[0]["role"] == "system" else ""
        chat_msgs = [m for m in msgs if m["role"] != "system"]
        hdrs = {"anthropic-version": "2023-06-01", **extra}
        if endpoint.get("key"):
            hdrs["x-api-key"] = endpoint["key"]
        body = {"model": use, "max_tokens": 1024, "temperature": min(1.0, temp), "messages": chat_msgs}
        if sys_txt:
            body["system"] = sys_txt
        d = _post(f"{_anth_base(endpoint['url'])}/messages", body, TIMEOUT, None, hdrs)
        blocks = d.get("content") or []
        txt = "".join(b.get("text", "") for b in blocks if isinstance(b, dict)).strip()
        return txt or _wh_text(d), label, use
    d = _post(f"{_oai_base(endpoint['url'])}/chat/completions", {
        "model": use, "messages": msgs, "temperature": temp,
        "max_tokens": 800, "stream": False}, TIMEOUT, endpoint.get("key"), extra)
    return d["choices"][0]["message"]["content"].strip(), label, use


def _temp(t):
    if t is None:
        return 0.7
    try:
        return max(0.0, min(2.0, float(t)))
    except (TypeError, ValueError):
        return 0.7


def chat(system_prompt, history, message, model=None, provider=None, temperature=None,
         endpoint=None):
    """Return (reply, provider, model). Raises RuntimeError if all providers fail."""
    msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else [])
    msgs += [{"role": h.get("role", "user"), "content": h.get("content", "")}
             for h in history[-20:]]
    msgs.append({"role": "user", "content": message})
    temp = _temp(temperature)

    errors = []

    def pick(model, models, default):
        return model if model in models else (models[0] if models else default)

    if endpoint and endpoint.get("url") and provider in (None, "custom"):
        try:
            return _custom_chat(endpoint, model, msgs, temp)
        except Exception as e:
            errors.append(f"custom: {e}")
            if provider == "custom":
                raise RuntimeError("custom endpoint failed — " + str(e))

    if provider in (None, "lmstudio"):
        try:
            models = lmstudio_models()
            use = pick(model, models, "local-model")
            d = _post(f"{LMSTUDIO}/v1/chat/completions", {
                "model": use, "messages": msgs, "temperature": temp,
                "max_tokens": 800, "stream": False}, TIMEOUT)
            return d["choices"][0]["message"]["content"].strip(), "lmstudio", use
        except Exception as e:
            errors.append(f"lmstudio: {e}")

    if provider in (None, "ollama"):
        try:
            models = ollama_models()
            if not models:
                raise RuntimeError("no chat models loaded")
            use = pick(model, models, models[0])
            d = _post(f"{OLLAMA}/api/chat", {
                "model": use, "messages": msgs, "stream": False,
                "options": {"temperature": temp}}, TIMEOUT)
            return d["message"]["content"].strip(), "ollama", use
        except Exception as e:
            errors.append(f"ollama: {e}")

    raise RuntimeError("No LLM reachable — " + "; ".join(errors))


def chat_stream(system_prompt, history, message, model=None, provider=None, temperature=None,
                endpoint=None):
    """Yield (kind, data): ('meta', {provider,model}), ('token', text), ('done', {})."""
    msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else [])
    msgs += [{"role": h.get("role", "user"), "content": h.get("content", "")}
             for h in history[-20:]]
    msgs.append({"role": "user", "content": message})
    temp = _temp(temperature)

    if endpoint and endpoint.get("url") and provider in (None, "custom") \
            and (endpoint.get("kind") or "openai") == "openai":
        use = model or endpoint.get("model") or "default"
        label = endpoint.get("label") or "custom"
        yield ("meta", {"provider": label, "model": use})
        try:
            req = urllib.request.Request(
                f"{_oai_base(endpoint['url'])}/chat/completions",
                data=json.dumps({"model": use, "messages": msgs, "temperature": temp,
                                 "stream": True}).encode(),
                headers={"Content-Type": "application/json",
                         **({"Authorization": f"Bearer {endpoint['key']}"}
                            if endpoint.get("key") else {}), **_ep_headers(endpoint)},
                method="POST")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                for line in r:
                    line = line.strip()
                    if not line.startswith(b"data:"):
                        continue
                    data = line[5:].strip()
                    if data == b"[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except Exception:
                        continue
                    piece = (chunk.get("choices") or [{}])[0] \
                        .get("delta", {}).get("content", "")
                    if piece:
                        yield ("token", piece)
            yield ("done", {})
            return
        except Exception:
            reply, _p, _m = _custom_chat(endpoint, model, msgs, temp)
            yield ("token", reply)
            yield ("done", {})
            return

    if endpoint and endpoint.get("url") and provider in (None, "custom") \
            and (endpoint.get("kind") or "openai") != "openai":
        reply, prov, use = _custom_chat(endpoint, model, msgs, temp)
        yield ("meta", {"provider": prov, "model": use})
        yield ("token", reply)
        yield ("done", {})
        return

    def pick(model, models, default):
        return model if model in models else (models[0] if models else default)

    # Ollama streams natively; LM Studio gets buffered reply as one token.
    models = ollama_models()
    if provider in (None, "ollama") and models:
        use = pick(model, models, models[0])
        yield ("meta", {"provider": "ollama", "model": use})
        req = urllib.request.Request(
            f"{OLLAMA}/api/chat",
            data=json.dumps({"model": use, "messages": msgs, "stream": True,
                             "options": {"temperature": temp}}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            for line in r:
                line = line.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except Exception:
                    continue
                piece = chunk.get("message", {}).get("content", "")
                if piece:
                    yield ("token", piece)
                if chunk.get("done"):
                    break
        yield ("done", {})
        return

    if provider in (None, "lmstudio"):
        models = lmstudio_models()
        if models:
            reply, prov, use = chat(system_prompt, history, message, model=model,
                                    provider="lmstudio", temperature=temperature)
            yield ("meta", {"provider": prov, "model": use})
            yield ("token", reply)
            yield ("done", {})
            return

    raise RuntimeError("No LLM reachable for streaming")
