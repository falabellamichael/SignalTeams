"""Local + per-agent API LLM proxy for the agent playground and in-channel summons.

Supports:
- Per-agent / server / user endpoints: OpenAI-compatible ('openai'), Anthropic ('anthropic'),
  Ollama ('ollama'), and custom JSON webhooks ('webhook').
- Auto-detected local LM Studio (:1234) and Ollama (:11434) fallbacks.
Override with AGENTHIVE_LMSTUDIO / AGENTHIVE_OLLAMA env vars.
"""
import json
import os
import time
import urllib.request

from .config import LMSTUDIO, MODELDIR, OLLAMA, LLM_TIMEOUT as TIMEOUT

_dir_cache = {"t": 0.0, "models": []}


def modeldir_models():
    """Local model files under AGENTHIVE_MODELDIR: .gguf artifacts plus HF-format
    dirs (config.json + safetensors), up to 3 levels deep. Cached 60s."""
    if _dir_cache["models"] and time.time() - _dir_cache["t"] < 60:
        return _dir_cache["models"]
    out = []
    try:
        for root, dirs, files in os.walk(MODELDIR):
            out += [f for f in files if f.lower().endswith(".gguf")]
            if "config.json" in files and any(
                    f.lower().endswith(".safetensors") for f in files):
                out.append(os.path.basename(root))
            if root[len(MODELDIR):].count(os.sep) >= 3:
                dirs[:] = []
            else:
                dirs[:] = [d for d in dirs
                           if not d.startswith((".", "_"))
                           and d.lower() not in ("__pycache__", "node_modules", ".git")]
    except Exception:
        return []
    _dir_cache["t"], _dir_cache["models"] = time.time(), sorted(set(out))
    return _dir_cache["models"]


DEFAULT_UA = "SignalTeams/1.0"
_PLACEHOLDER_MODELS = {
    "", "any", "default", "local-llm", "local-model", "local-embeddings", "crew-model"
}
_NON_CHAT_MODALITIES = {
    "image", "tts", "stt", "audio", "speech", "embedding", "embeddings", "rerank", "moderation"
}
_NON_CHAT_TOKENS = (
    "embed", "whisper", "tts", "kokoro", "sd-turbo", "stable-diffusion", "flux-", "moonshine", "bge-", "rerank"
)


def _ep_headers(endpoint):
    """Merge a custom endpoint's extra headers (e.g. X-Api-Key) into requests."""
    try:
        h = endpoint.get("headers")
        return {str(k): str(v) for k, v in (json.loads(h) if isinstance(h, str) else h or {}).items()}
    except Exception:
        return {}


def _post(url, payload, timeout, key=None, extra=None):
    headers = {"User-Agent": DEFAULT_UA, "Content-Type": "application/json", **(extra or {})}
    if key and "Authorization" not in headers and "authorization" not in headers:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _get(url, timeout=3, key=None, extra=None):
    headers = {"User-Agent": DEFAULT_UA, **(extra or {})}
    if key and "Authorization" not in headers and "authorization" not in headers:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _extract_chat_models(d, preferred=""):
    """Extract chat/text model IDs from a /v1/models payload, filtering out
    image, TTS, STT, and embedding models when modality or naming indicates non-chat."""
    raw = [m for m in (d.get("data") or []) if isinstance(m, dict) and m.get("id")]
    if not raw:
        return []
    chat_only = []
    for m in raw:
        mid = str(m["id"])
        mod = str(m.get("modality") or m.get("type") or "").lower()
        labels = {str(x).lower() for x in (m.get("labels") or []) if x}
        if mod and mod in _NON_CHAT_MODALITIES:
            continue
        if labels and (labels & _NON_CHAT_MODALITIES) and not (labels & {"text", "chat", "llm"}):
            continue
        if not mod and any(tok in mid.lower() for tok in _NON_CHAT_TOKENS):
            continue
        chat_only.append(mid)
    out = chat_only or [str(m["id"]) for m in raw]
    out.sort(key=lambda x: (0 if preferred and x == preferred else 1, 1 if "gguf" in x.lower() else 0))
    return out


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
        models = _extract_chat_models(d, preferred=endpoint.get("model") or "")
        if models:
            return models
    except Exception:
        pass
    return [endpoint["model"]] if endpoint.get("model") else ["default"]


def _resolve_endpoint_model(model, endpoint, provider=None):
    """Choose the right model for a custom/agent/server/user endpoint."""
    kind = (endpoint.get("kind") or "openai") if endpoint else "openai"
    m = (model or "").strip()
    if m.lower() in _PLACEHOLDER_MODELS:
        m = ""
    em = ((endpoint.get("model") if endpoint else "") or "").strip()
    if em.lower() in _PLACEHOLDER_MODELS:
        em = ""
    is_agent_ep = str((endpoint or {}).get("label") or "").startswith("agent:")
    # When inheriting a Server or User endpoint that has an explicit model set,
    # prefer the endpoint's configured model unless the caller explicitly asked for custom:<model>.
    if not is_agent_ep and em and provider != "custom":
        use = em
    else:
        use = m or em
    if not use:
        if kind == "anthropic":
            return "claude-3-7-sonnet-latest"
        if kind == "webhook":
            return "webhook"
        avail = custom_models(endpoint)
        use = avail[0] if avail else "default"
    return use


def providers(endpoint=None):
    out = []
    for name, models in (("lmstudio", lmstudio_models()),
                         ("ollama", ollama_models()),
                         ("modeldir", modeldir_models())):
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


def _oai_text(d):
    """Reply text from a chat/completions body — tolerates content:null from
    reasoning models (vLLM puts the answer in 'reasoning' when the token
    budget runs out mid-thought) and raises a clear error on empty replies."""
    c = (d.get("choices") or [{}])[0] or {}
    msg = c.get("message") or {}
    txt = (msg.get("content") or "").strip()
    if not txt and (msg.get("reasoning") or msg.get("reasoning_content")):
        txt = str(msg.get("reasoning") or msg.get("reasoning_content")).strip()
    if not txt:
        raise RuntimeError(
            f"endpoint returned an empty reply (finish_reason={c.get('finish_reason')})")
    return txt


def _custom_chat(endpoint, model, msgs, temp, provider=None):
    """One-shot reply from an OpenAI-compatible, Anthropic, Ollama, or Webhook endpoint."""
    kind = endpoint.get("kind") or "openai"
    use = _resolve_endpoint_model(model, endpoint, provider)
    extra = _ep_headers(endpoint)
    label = endpoint.get("label") or kind
    if kind == "webhook":
        d = _post(endpoint["url"], {
            "system_prompt": msgs[0]["content"] if msgs and msgs[0]["role"] == "system" else "",
            "messages": [m for m in msgs if m["role"] != "system"],
            "model": use, "temperature": temp}, TIMEOUT, endpoint.get("key"), extra)
        return _wh_text(d), label, use
    if kind == "ollama":
        try:
            d = _post(f"{endpoint['url'].rstrip('/')}/api/chat", {
                "model": use, "messages": msgs, "stream": False,
                "options": {"temperature": temp}}, TIMEOUT, endpoint.get("key"), extra)
        except Exception:
            avail = custom_models(endpoint)
            if avail and avail[0] != use:
                use = avail[0]
                d = _post(f"{endpoint['url'].rstrip('/')}/api/chat", {
                    "model": use, "messages": msgs, "stream": False,
                    "options": {"temperature": temp}}, TIMEOUT, endpoint.get("key"), extra)
            else:
                raise
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
    try:
        d = _post(f"{_oai_base(endpoint['url'])}/chat/completions", {
            "model": use, "messages": msgs, "temperature": temp,
            "max_tokens": 2048, "stream": False}, TIMEOUT, endpoint.get("key"), extra)
    except Exception:
        em = (endpoint.get("model") or "").strip()
        avail = ([em] if em and em.lower() not in _PLACEHOLDER_MODELS else []) + custom_models(endpoint)
        alt = next((x for x in avail if x and x != use and x != "default"), None)
        if not alt:
            raise
        use = alt
        d = _post(f"{_oai_base(endpoint['url'])}/chat/completions", {
            "model": use, "messages": msgs, "temperature": temp,
            "max_tokens": 2048, "stream": False}, TIMEOUT, endpoint.get("key"), extra)
    return _oai_text(d), label, use


def _temp(t):
    if t is None:
        return 0.7
    try:
        return max(0.0, min(2.0, float(t)))
    except (TypeError, ValueError):
        return 0.7


_mod_cache = {"t": 0.0, "url": "", "mods": {}}

_MOD_TOKEN_MAP = (
    (("tts", "kokoro", "orpheus", "piper"), "tts"),
    (("whisper", "stt", "moonshine"), "stt"),
    (("embed", "bge-", "e5-", "gte-"), "embedding"),
    (("sd-turbo", "sd-", "flux", "stable-diffusion"), "image"),
)


def modality_models(endpoint):
    """Non-chat models an OpenAI-compatible endpoint exposes, grouped by
    modality: {'tts': [ids], 'stt': [...], 'embedding': [...], 'image': [...]}.
    Uses declared `modality`/`type`/`labels` first, model-id tokens as fallback.
    Cached 60s per base URL."""
    if not endpoint or not endpoint.get("url") \
            or (endpoint.get("kind") or "openai") != "openai":
        return {}
    base = _oai_base(endpoint["url"])
    if _mod_cache["mods"] and _mod_cache["url"] == base \
            and time.time() - _mod_cache["t"] < 60:
        return _mod_cache["mods"]
    try:
        d = _get(f"{base}/models", timeout=8,
                 key=endpoint.get("key"), extra=_ep_headers(endpoint))
    except Exception:
        return {}
    out = {}
    for m in d.get("data") or []:
        if not isinstance(m, dict) or not m.get("id"):
            continue
        mod = str(m.get("modality") or m.get("type") or "").lower()
        labels = {str(x).lower() for x in (m.get("labels") or []) if x}
        bucket = ""
        for want in ("tts", "stt", "embedding", "image"):
            if mod == want or want in labels or \
                    (want == "embedding" and "embeddings" in labels) or \
                    (want == "tts" and "speech" in labels):
                bucket = want
                break
        if not bucket:
            mid = str(m["id"]).lower()
            for toks, want in _MOD_TOKEN_MAP:
                if any(t in mid for t in toks):
                    bucket = want
                    break
        if bucket:
            out.setdefault(bucket, []).append(str(m["id"]))
    _mod_cache.update(t=time.time(), url=base, mods=out)
    return out


def tts_speech(endpoint, text, voice=None, model=None):
    """POST /audio/speech on an OpenAI-compatible endpoint.
    Returns (audio_bytes, content_type, model_used).
    Raises RuntimeError when the endpoint exposes no TTS model."""
    mods = modality_models(endpoint)
    use = (model or "").strip() or (mods.get("tts") or [""])[0]
    if not use:
        raise RuntimeError("endpoint exposes no TTS model")
    hdrs = {"User-Agent": DEFAULT_UA, "Content-Type": "application/json",
            **_ep_headers(endpoint)}
    if endpoint.get("key") and "Authorization" not in hdrs \
            and "authorization" not in hdrs:
        hdrs["Authorization"] = f"Bearer {endpoint['key']}"
    payload = {"model": use, "input": (text or "")[:4096],
               "response_format": "mp3"}
    if voice:
        payload["voice"] = voice
    req = urllib.request.Request(
        f"{_oai_base(endpoint['url'])}/audio/speech",
        data=json.dumps(payload).encode(), headers=hdrs, method="POST")
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read(), r.headers.get("Content-Type") or "audio/mpeg", use


def embed_texts(endpoint, texts):
    """POST /embeddings with the endpoint's detected embedding model.
    Returns the response payload plus `_model` = the model used."""
    mods = modality_models(endpoint)
    use = (mods.get("embedding") or [""])[0]
    if not use:
        raise RuntimeError("endpoint exposes no embedding model")
    d = _post(f"{_oai_base(endpoint['url'])}/embeddings",
              {"model": use,
               "input": [str(t)[:8000] for t in (texts or [])][:32]},
              45, endpoint.get("key"), _ep_headers(endpoint))
    d["_model"] = use
    return d


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
            return _custom_chat(endpoint, model, msgs, temp, provider=provider)
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
                "max_tokens": 2048, "stream": False}, TIMEOUT)
            return _oai_text(d), "lmstudio", use
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
                endpoint=None, images=None):
    """Yield (kind, data): ('meta', {provider,model}), ('token', text), ('done', {}).

    `images` = [{"mime","b64"}] — attaches vision content to the LAST user
    message for OpenAI-compatible endpoints and Ollama (both accept inline
    images); other provider shapes just don't see them."""
    msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else [])
    msgs += [{"role": h.get("role", "user"), "content": h.get("content", "")}
             for h in history[-20:]]
    msgs.append({"role": "user", "content": message})
    temp = _temp(temperature)

    def _oai_msgs():
        if not images:
            return msgs
        parts = [{"type": "text", "text": message}] + [
            {"type": "image_url",
             "image_url": {"url": f"data:{im['mime']};base64,{im['b64']}"}}
            for im in images]
        return msgs[:-1] + [{"role": "user", "content": parts}]

    if endpoint and endpoint.get("url") and provider in (None, "custom") \
            and (endpoint.get("kind") or "openai") == "openai":
        use = _resolve_endpoint_model(model, endpoint, provider)
        label = endpoint.get("label") or "custom"
        yield ("meta", {"provider": label, "model": use})
        try:
            hdrs = {"User-Agent": DEFAULT_UA, "Content-Type": "application/json", **_ep_headers(endpoint)}
            if endpoint.get("key") and "Authorization" not in hdrs and "authorization" not in hdrs:
                hdrs["Authorization"] = f"Bearer {endpoint['key']}"
            req = urllib.request.Request(
                f"{_oai_base(endpoint['url'])}/chat/completions",
                data=json.dumps({"model": use, "messages": _oai_msgs(), "temperature": temp,
                                 "max_tokens": 2048, "stream": True}).encode(),
                headers=hdrs,
                method="POST")
            emitted = False
            reasoning_buf = []
            reasoning_n = think_sent = 0
            raw_lines = []
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                for line in r:
                    line = line.strip()
                    if not line:
                        continue
                    if not line.startswith(b"data:"):
                        raw_lines.append(line)
                        continue
                    data = line[5:].strip()
                    if data == b"[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except Exception:
                        continue
                    delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
                    piece = delta.get("content") or ""
                    if piece:
                        if not emitted:
                            piece = piece.lstrip("\r\n")
                        if piece:
                            emitted = True
                            yield ("token", piece)
                    elif delta.get("reasoning") or delta.get("reasoning_content"):
                        piece_r = str(delta.get("reasoning") or delta.get("reasoning_content"))
                        reasoning_buf.append(piece_r)
                        reasoning_n += len(piece_r)
                        if reasoning_n - think_sent >= 160:
                            think_sent = reasoning_n
                            yield ("thinking", reasoning_n)
            if not emitted:
                if reasoning_buf:
                    yield ("token", "".join(reasoning_buf).strip())
                elif raw_lines:
                    body = json.loads(b"\n".join(raw_lines).decode("utf-8", "replace"))
                    yield ("token", (_oai_text(body) or _wh_text(body)).strip())
            yield ("done", {})
            return
        except Exception:
            reply, _p, _m = _custom_chat(endpoint, model, msgs, temp, provider=provider)
            if _m != use:
                yield ("token", f"⚠ `{use}` unavailable on this endpoint — answered by `{_m}`:\n\n")
            yield ("token", reply.lstrip("\r\n"))
            yield ("done", {})
            return

    if endpoint and endpoint.get("url") and provider in (None, "custom") \
            and (endpoint.get("kind") or "openai") != "openai":
        reply, prov, use = _custom_chat(endpoint, model, msgs, temp, provider=provider)
        yield ("meta", {"provider": prov, "model": use})
        yield ("token", reply.lstrip("\r\n"))
        yield ("done", {})
        return

    def pick(model, models, default):
        return model if model in models else (models[0] if models else default)

    # Ollama streams natively; LM Studio gets buffered reply as one token.
    models = ollama_models()
    if provider in (None, "ollama") and models:
        use = pick(model, models, models[0])
        yield ("meta", {"provider": "ollama", "model": use})
        o_msgs = ([dict(m, images=[im["b64"] for im in images])
                   if m is msgs[-1] else m for m in msgs] if images else msgs)
        req = urllib.request.Request(
            f"{OLLAMA}/api/chat",
            data=json.dumps({"model": use, "messages": o_msgs, "stream": True,
                             "options": {"temperature": temp}}).encode(),
            headers={"User-Agent": DEFAULT_UA, "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            othink_n = othink_sent = 0
            for line in r:
                line = line.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except Exception:
                    continue
                msg_o = chunk.get("message", {})
                piece = msg_o.get("content", "")
                if piece:
                    yield ("token", piece)
                th = msg_o.get("thinking", "")
                if th:
                    othink_n += len(th)
                    if othink_n - othink_sent >= 160:
                        othink_sent = othink_n
                        yield ("thinking", othink_n)
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
