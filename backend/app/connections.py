"""AI provider connections — catalog, local CLI-login importers, OAuth plugins,
and turning a saved connection into an llm.py `endpoint` dict.

Two ways to connect a provider:
- "key": paste an API key / bearer token (every provider supports this).
- "cli": import the subscription login the user's coding CLI already holds
  (~/.codex/auth.json, ~/.claude/.credentials.json, ~/.gemini/oauth_creds.json,
  ~/.qwen/oauth_creds.json) — no API key needed.

PLUGINS are OAuth app connections (Gmail, Outlook, GitHub…) — the browser
authorize dance: /begin builds the provider's consent URL for a popup,
/callback exchanges the code and stores access+refresh tokens.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request

from . import config

# kind/url are the llm.py endpoint protocol + base the connection materializes as.
# `cli` lists local credential files importable as a "subscription" connection.
PROVIDERS = [
    {"id": "openai", "name": "OpenAI · ChatGPT / Codex", "group": "subscription",
     "kind": "openai", "url": "https://api.openai.com/v1",
     "hue": "#10a37f",
     "blurb": "Codex CLI sign-in (ChatGPT Plus/Pro) or a platform API key.",
     "cli": [{"path": "~/.codex/auth.json", "flavor": "codex"}]},
    {"id": "anthropic", "name": "Claude · Anthropic", "group": "subscription",
     "kind": "anthropic", "url": "https://api.anthropic.com",
     "hue": "#d97757",
     "blurb": "Claude Pro/Max subscription via Claude Code login, or console API key.",
     "cli": [{"path": "~/.claude/.credentials.json", "flavor": "claude"}]},
    {"id": "google", "name": "Google · Gemini", "group": "subscription",
     "kind": "openai", "url": "https://generativelanguage.googleapis.com/v1beta/openai",
     "hue": "#4285f4",
     "blurb": "Gemini subscription via Gemini CLI login, or AI Studio API key.",
     "cli": [{"path": "~/.gemini/oauth_creds.json", "flavor": "gemini"}]},
    {"id": "qwen", "name": "Qwen · Alibaba", "group": "subscription",
     "kind": "openai", "url": "https://portal.qwen.ai/v1",
     "hue": "#a259ff",
     "blurb": "Qwen subscription via Qwen Code login, or a DashScope API key.",
     "cli": [{"path": "~/.qwen/oauth_creds.json", "flavor": "qwen"}]},
    {"id": "copilot", "name": "GitHub Copilot", "group": "subscription",
     "kind": "openai", "url": "https://api.githubcopilot.com",
     "hue": "#9ecbff",
     "blurb": "Copilot Individual/Business via your existing Copilot CLI or IDE "
              "sign-in — session tokens refresh themselves.",
     "cli": [{"path": "~/.config/github-copilot/apps.json", "flavor": "copilot"},
             {"path": "~/.config/github-copilot/hosts.json", "flavor": "copilot"},
             {"path": "~/AppData/Local/github-copilot/apps.json", "flavor": "copilot"},
             {"path": "~/AppData/Local/github-copilot/hosts.json", "flavor": "copilot"}]},
    {"id": "huggingface", "name": "Hugging Face", "group": "subscription",
     "kind": "openai", "url": "https://router.huggingface.co/v1",
     "hue": "#ffb41f",
     "blurb": "HF Pro/Enterprise inference via your `hf auth login` token, or a "
              "manually-pasted token.",
     "cli": [{"path": "~/.cache/huggingface/token", "flavor": "rawtoken"},
             {"path": "~/.huggingface/token", "flavor": "rawtoken"}]},
    {"id": "xai", "name": "xAI · Grok", "group": "key",
     "kind": "openai", "url": "https://api.x.ai/v1", "hue": "#e7e9ea",
     "blurb": "Grok models via an xAI console API key."},
    {"id": "mistral", "name": "Mistral", "group": "key",
     "kind": "openai", "url": "https://api.mistral.ai/v1", "hue": "#ff7000",
     "blurb": "La Plateforme API key — Mistral Large, Codestral, Devstral…"},
    {"id": "deepseek", "name": "DeepSeek", "group": "key",
     "kind": "openai", "url": "https://api.deepseek.com/v1", "hue": "#4d6bfe",
     "blurb": "DeepSeek-V3 / R1 via platform API key."},
    {"id": "groq", "name": "Groq", "group": "key",
     "kind": "openai", "url": "https://api.groq.com/openai/v1", "hue": "#f55036",
     "blurb": "Ultra-fast Llama / Qwen inference via console key."},
    {"id": "cohere", "name": "Cohere", "group": "key",
     "kind": "openai", "url": "https://api.cohere.com/compatibility/v1", "hue": "#39c5aa",
     "blurb": "Command R / R+ via an OpenAI-compatible key."},
    {"id": "together", "name": "Together AI", "group": "key",
     "kind": "openai", "url": "https://api.together.xyz/v1", "hue": "#0f6fff",
     "blurb": "Open-weight models hosted — Llama, Qwen, DeepSeek…"},
    {"id": "openrouter", "name": "OpenRouter", "group": "key",
     "kind": "openai", "url": "https://openrouter.ai/api/v1", "hue": "#94b3fd",
     "blurb": "One key for hundreds of models across providers."},
    {"id": "moonshot", "name": "Moonshot · Kimi", "group": "key",
     "kind": "openai", "url": "https://api.moonshot.ai/v1", "hue": "#1e88e5",
     "blurb": "Kimi K2 long-context models via platform key."},
    {"id": "zhipu", "name": "Zhipu · GLM", "group": "key",
     "kind": "openai", "url": "https://open.bigmodel.cn/api/paas/v4", "hue": "#4f8cf9",
     "blurb": "GLM-4.x models via BigModel console key."},
    {"id": "minimax", "name": "MiniMax", "group": "key",
     "kind": "openai", "url": "https://api.minimax.io/v1", "hue": "#f43f5e",
     "blurb": "MiniMax-Text via platform API key."},
    {"id": "perplexity", "name": "Perplexity", "group": "key",
     "kind": "openai", "url": "https://api.perplexity.ai", "hue": "#20b8cd",
     "blurb": "Sonar online-search models via API key."},
    {"id": "fireworks", "name": "Fireworks AI", "group": "key",
     "kind": "openai", "url": "https://api.fireworks.ai/inference/v1",
     "hue": "#e0447a",
     "blurb": "Fast open-weight inference — Llama, Qwen, DeepSeek…"},
    {"id": "cerebras", "name": "Cerebras", "group": "key",
     "kind": "openai", "url": "https://api.cerebras.ai/v1", "hue": "#f4703a",
     "blurb": "Wafer-scale fast Llama/Qwen inference via API key."},
    {"id": "sambanova", "name": "SambaNova", "group": "key",
     "kind": "openai", "url": "https://api.sambanova.ai/v1", "hue": "#ff8c42",
     "blurb": "RDU-accelerated open models via API key."},
    {"id": "deepinfra", "name": "DeepInfra", "group": "key",
     "kind": "openai", "url": "https://api.deepinfra.com/v1/openai",
     "hue": "#5ec2a6",
     "blurb": "Low-cost hosted open models via API key."},
    {"id": "nvidia", "name": "NVIDIA NIM", "group": "key",
     "kind": "openai", "url": "https://integrate.api.nvidia.com/v1",
     "hue": "#76b900",
     "blurb": "NIM-hosted models via build.nvidia.com key."},
    {"id": "siliconflow", "name": "SiliconFlow", "group": "key",
     "kind": "openai", "url": "https://api.siliconflow.cn/v1", "hue": "#7c9bff",
     "blurb": "Qwen/GLM/DeepSeek hosting via API key."},
    {"id": "modelscope", "name": "ModelScope", "group": "key",
     "kind": "openai", "url": "https://api-inference.modelscope.cn/v1",
     "hue": "#6f62f4",
     "blurb": "Alibaba ModelScope inference via API key."},
    {"id": "custom", "name": "Other / OpenAI-compatible", "group": "key",
     "kind": "openai", "url": "", "custom": True, "hue": "#8a97a8",
     "blurb": "Any OpenAI-compatible endpoint — paste its base URL and a token."},
]

_by_id = {p["id"]: p for p in PROVIDERS}


def provider(pid):
    return _by_id.get(pid)


def _jwt_payload(tok):
    """Decode a JWT payload without verifying — just for an account hint."""
    try:
        seg = str(tok).split(".")[1]
        seg += "=" * (-len(seg) % 4)
        return json.loads(base64.urlsafe_b64decode(seg.encode()))
    except Exception:
        return {}


def _read(path):
    p = os.path.expanduser(path)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _read_text(path):
    p = os.path.expanduser(path)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return None


def _exists(path):
    return os.path.isfile(os.path.expanduser(path))


def _walk_oauth(obj):
    """Find an oauth_token anywhere in a github-copilot creds blob."""
    if isinstance(obj, dict):
        if isinstance(obj.get("oauth_token"), str):
            return obj["oauth_token"]
        for v in obj.values():
            hit = _walk_oauth(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _walk_oauth(v)
            if hit:
                return hit
    return None


def _copilot_exchange(oauth):
    """Swap a github.com oauth_token for a short-lived Copilot API token."""
    import urllib.request
    req = urllib.request.Request(
        "https://api.github.com/copilot_internal/v2/token",
        headers={
            "Authorization": f"token {oauth}",
            "Accept": "application/json",
            "User-Agent": "GithubCopilot/1.250.0",
        })
    with urllib.request.urlopen(req, timeout=12) as r:
        data = json.loads(r.read().decode())
    return data.get("token"), data.get("expires_at")


def detect(pid):
    """True when a local CLI login for this provider exists on this machine."""
    p = provider(pid) or {}
    return any(_exists(c["path"]) for c in p.get("cli") or [])


def cli_probe(pid):
    """Where the import would read from (for the UI hint) — None if absent."""
    p = provider(pid) or {}
    for c in p.get("cli") or []:
        if _exists(c["path"]):
            return {"path": os.path.expanduser(c["path"]), "flavor": c["flavor"]}
    return None


def import_cli(pid):
    """Read the provider's local CLI credentials and return connection fields:
    {ok, usable, label, kind, url, api_key, headers, model, meta, error}."""
    p = provider(pid)
    hit = cli_probe(pid)
    if not p or not hit:
        return {"ok": False, "error": "No local login found for this provider"}

    flavor = hit["flavor"]
    data = _read(hit["path"]) or {}
    out = {"ok": True, "via": "cli", "kind": p["kind"], "url": p["url"],
           "api_key": None, "headers": None, "model": "", "label": "",
           "usable": False, "meta": {"source": hit["path"], "flavor": flavor}}

    if flavor == "codex":
        toks = data.get("tokens") or {}
        claims = _jwt_payload(toks.get("id_token") or "")
        plan = (claims.get("chatgpt_plan_type") or "").replace("_", " ")
        out["label"] = claims.get("email") or (f"ChatGPT {plan}" if plan else "Codex login")
        if data.get("OPENAI_API_KEY"):
            out["api_key"] = data["OPENAI_API_KEY"]
            out["usable"] = True
        elif toks.get("access_token"):
            # ChatGPT-account OAuth — not an OpenAI-platform key; stored so the
            # account shows connected, routed once the Codex API shape is wired.
            out["meta"]["has_oauth"] = True
        else:
            return {"ok": False, "error": "auth.json has no tokens — sign in via `codex login`"}
        return out

    if flavor == "claude":
        oa = data.get("claudeAiOauth") or {}
        tok = oa.get("accessToken")
        if not tok:
            return {"ok": False, "error": "credentials file has no Claude OAuth token"}
        # Anthropic OAuth needs Bearer + the oauth beta header, not x-api-key.
        out["headers"] = json.dumps({
            "Authorization": f"Bearer {tok}",
            "anthropic-beta": "oauth-2025-04-20",
        })
        sub = (oa.get("subscriptionType") or "").replace("_", " ").title()
        out["label"] = f"Claude {sub}".strip() or "Claude login"
        exp = oa.get("expiresAt")
        if exp and exp / 1000 < time.time():
            out["meta"]["expired"] = True
        out["usable"] = True
        return out

    if flavor in ("gemini", "qwen"):
        tok = data.get("access_token")
        if not tok:
            return {"ok": False, "error": "oauth_creds.json has no access_token"}
        out["api_key"] = tok
        out["usable"] = True
        exp = data.get("expiry_date")
        if exp and exp / 1000 < time.time():
            out["meta"]["expired"] = True
        out["label"] = "Gemini CLI login" if flavor == "gemini" else "Qwen Code login"
        return out

    if flavor == "copilot":
        oauth = _walk_oauth(data)
        if not oauth:
            return {"ok": False, "error": "no oauth_token in the Copilot creds — sign in via Copilot first"}
        try:
            tok, exp = _copilot_exchange(oauth)
        except Exception as e:
            return {"ok": False, "error": f"Copilot token exchange failed: {e}"}
        if not tok:
            return {"ok": False, "error": "GitHub returned no Copilot token — is the subscription active?"}
        out["api_key"] = tok
        out["refresher"] = oauth          # kept server-side for auto-refresh
        out["usable"] = True
        out["meta"]["expires_at"] = exp
        out["label"] = "GitHub Copilot"
        return out

    if flavor == "rawtoken":
        tok = _read_text(hit["path"])
        if not tok:
            return {"ok": False, "error": "token file is empty"}
        out["api_key"] = tok
        out["usable"] = True
        out["label"] = f"{p['name']} CLI token"
        return out

    return {"ok": False, "error": f"unsupported importer '{flavor}'"}


def fresh(conn, row):
    """Return the row with a still-valid credential — for short-lived session
    tokens (Copilot: ~30min, OAuth plugins ~1h), re-exchange the stored refresh
    material and update the row when it has expired."""
    if not row or not row["refresher"]:
        return row
    if plugin(row["provider"]):
        meta = json.loads(row["meta"] or "{}")
        exp = meta.get("expires_at") or 0
        if exp and exp > time.time() + 90:
            return row
        return oauth_refresh(conn, row) or row
    if row["provider"] != "copilot":
        return row
    exp = (json.loads(row["meta"] or "{}") or {}).get("expires_at") or 0
    if exp and exp > time.time() + 90:
        return row
    try:
        tok, new_exp = _copilot_exchange(row["refresher"])
    except Exception:
        return row                     # leave the stale token — probe reports it
    if not tok:
        return row
    meta = json.loads(row["meta"] or "{}")
    meta["expires_at"] = new_exp
    meta.pop("expired", None)
    conn.execute(
        "UPDATE user_connections SET api_key=?, meta=?, updated_at=? WHERE id=?",
        (tok, json.dumps(meta), time.time(), row["id"]))
    return conn.execute(
        "SELECT * FROM user_connections WHERE id=?", (row["id"],)).fetchone()


def endpoint_for(row):
    """Materialize a user_connections row as an llm.py endpoint dict."""
    if not row or not row["usable"]:
        return None
    return {
        "kind": row["kind"] or "openai",
        "url": row["url"],
        "key": row["api_key"] or "",
        "model": row["model"] or "",
        "headers": row["headers"],
        "label": f"conn:{row['provider']}",
    }


def public(row):
    """Shape a user_connections row for the client — never leaks secrets."""
    if not row:
        return {}
    p = provider(row["provider"]) or {}
    return {
        "connected": True,
        "via": row["via"],
        "label": row["label"],
        "model": row["model"] or "",
        "usable": bool(row["usable"]),
        "has_key": bool(row["api_key"]),
        "has_headers": bool(row["headers"]),
        "kind": row["kind"], "url": row["url"], "hue": p.get("hue", "#888"),
        "meta": json.loads(row["meta"] or "{}"),
        "updated_at": row["updated_at"],
    }


# ── OAuth plugins (Settings → Connections → Plugins) ──────────────────────────
# Each plugin needs an OAuth app client_id. Resolved per user: env config wins,
# else creds saved on the connection row (`extra` — never returned to clients).
# flow: "redirect" (loopback+PKCE popup) · "device" (GitHub device code) ·
#       "hosted" (publisher callback service — start/exchange against broker).
PLUGINS = [
    {"id": "gmail", "icon": "📧", "name": "Gmail", "group": "plugin", "app": "google",
     "hue": "#ea4335", "kind": "plugin", "flow": "redirect", "send_scope": "https://www.googleapis.com/auth/gmail.send",
     "blurb": "Let agents read your inbox — search mail, see threads.",
     "scopes": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
     "auth": "https://accounts.google.com/o/oauth2/v2/auth",
     "token": "https://oauth2.googleapis.com/token",
     "probe": "https://gmail.googleapis.com/gmail/v1/users/me/profile",
     "probe_field": "emailAddress"},
    {"id": "gcal", "icon": "📅", "name": "Google Calendar", "group": "plugin", "app": "google",
     "hue": "#4285f4", "kind": "plugin", "flow": "redirect",
     "blurb": "Let agents see your schedule and upcoming events.",
     "scopes": "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email",
     "auth": "https://accounts.google.com/o/oauth2/v2/auth",
     "token": "https://oauth2.googleapis.com/token",
     "probe": "https://www.googleapis.com/oauth2/v3/userinfo",
     "probe_field": "email"},
    {"id": "gdrive", "icon": "📁", "name": "Google Drive", "group": "plugin", "app": "google",
     "hue": "#f7b500", "kind": "plugin", "flow": "redirect",
     "blurb": "Let agents browse and read files in your Drive.",
     "scopes": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email",
     "auth": "https://accounts.google.com/o/oauth2/v2/auth",
     "token": "https://oauth2.googleapis.com/token",
     "probe": "https://www.googleapis.com/oauth2/v3/userinfo",
     "probe_field": "email"},
    {"id": "outlook", "icon": "📨", "name": "Outlook Mail", "group": "plugin", "app": "microsoft",
     "hue": "#0078d4", "kind": "plugin", "flow": "redirect", "send_scope": "https://graph.microsoft.com/Mail.Send",
     "blurb": "Let agents read your Microsoft/Outlook inbox.",
     "scopes": "https://graph.microsoft.com/Mail.Read User.Read offline_access",
     "auth": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
     "token": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
     "probe": "https://graph.microsoft.com/v1.0/me",
     "probe_field": "mail"},
    {"id": "m365", "icon": "🪟", "name": "Microsoft 365", "group": "plugin", "app": "microsoft",
     "hue": "#d83b01", "kind": "plugin", "flow": "redirect",
     "blurb": "Mail, calendar and OneDrive through Microsoft Graph.",
     "scopes": "Mail.Read Calendars.Read Files.Read User.Read offline_access",
     "auth": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
     "token": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
     "probe": "https://graph.microsoft.com/v1.0/me",
     "probe_field": "userPrincipalName"},
    {"id": "todo", "icon": "✅", "name": "Microsoft To Do", "group": "plugin", "app": "microsoft",
     "hue": "#286efc", "kind": "plugin", "flow": "redirect",
     "blurb": "Let agents read and manage your To Do lists and tasks.",
     "scopes": "https://graph.microsoft.com/Tasks.ReadWrite User.Read offline_access",
     "auth": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
     "token": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
     "probe": "https://graph.microsoft.com/v1.0/me",
     "probe_field": "userPrincipalName"},
    {"id": "github", "icon": "🐙", "name": "GitHub", "group": "plugin", "app": "github",
     "hue": "#c9d1d9", "kind": "plugin", "flow": "device",
     "blurb": "Let agents see your repos, issues and PRs — sign in with a device code.",
     "scopes": "repo read:user offline_access",
     "token": "https://github.com/login/oauth/access_token",
     "device": "https://github.com/login/device/code",
     "probe": "https://api.github.com/user",
     "probe_field": "login"},
    {"id": "slack", "icon": "💬", "name": "Slack", "group": "plugin", "app": "slack",
     "hue": "#611f69", "kind": "plugin", "flow": "hosted",
     "blurb": "Let agents search your Slack workspace (with your sign-in).",
     "scopes": "search:read",
     "probe": "https://slack.com/api/auth.test", "probe_field": "user"},
    {"id": "notion", "icon": "📝", "name": "Notion", "group": "plugin", "app": "notion",
     "hue": "#a4a29e", "kind": "plugin", "flow": "hosted",
     "blurb": "Let agents read your Notion pages and databases.",
     "scopes": "read_content",
     "probe": "https://api.notion.com/v1/users/me", "probe_field": "name",
     "probe_headers": {"Notion-Version": "2022-06-28"}},
    {"id": "discord", "icon": "🎮", "name": "Discord", "group": "plugin", "app": "discord",
     "hue": "#5865f2", "kind": "plugin", "flow": "hosted",
     "blurb": "Link Discord — authorizes the companion app for your server.",
     "scopes": "identify guilds bot",
     "probe": "https://discord.com/api/v10/users/@me", "probe_field": "username",
     "probe_headers": {"User-Agent": "DiscordBot (https://lemonade-nexus.io, 1.0)"}},
]
_plugin_by_id = {p["id"]: p for p in PLUGINS}

# Publisher-registered OAuth apps bundled with the build (same model REACH
# uses): backend/plugin-clients.json — {provider: {clientId, clientSecret?,
# brokerOrigin?}}. Env vars and per-user saved creds still override.
def _load_clients():
    try:
        with open(os.path.join(config.BASE_DIR, "plugin-clients.json"),
                  encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def plugin(pid):
    return _plugin_by_id.get(pid)


def _env_creds(app):
    return {
        "google": (config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET),
        "microsoft": (config.AZURE_CLIENT_ID, config.AZURE_CLIENT_SECRET),
        "github": (config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET),
    }.get(app, ("", ""))


def _bundled_creds(app):
    ent = _load_clients().get(app) or {}
    return ent.get("clientId") or "", ent.get("clientSecret") or ""


def _broker(pid):
    """brokerOrigin for a hosted plugin — bundled publisher config only."""
    p = plugin(pid) or {}
    return (_load_clients().get(p.get("app")) or {}).get("brokerOrigin") or ""


def app_creds(row, pid):
    """(client_id, client_secret) — env, then bundled publisher clients, then
    creds the user saved on the card."""
    p = plugin(pid) or {}
    cid, csec = _env_creds(p.get("app"))
    if not cid:
        cid, csec = _bundled_creds(p.get("app"))
    if cid:
        return cid, csec
    extra = json.loads(row["extra"] or "{}") if row and row["extra"] else {}
    return extra.get("client_id") or "", extra.get("client_secret") or ""


def _server_secret(conn):
    r = conn.execute("SELECT value FROM kv WHERE key='oauth_secret'").fetchone()
    if r:
        return r["value"]
    v = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO kv (key, value) VALUES ('oauth_secret', ?)", (v,))
    return v


def oauth_state(conn, uid, pid, nonce):
    """Stateless signed state: uid.pid.nonce.expiry.sig — 15 min validity."""
    exp = int(time.time()) + 900
    body = f"{uid}.{pid}.{nonce}.{exp}"
    sig = hmac.new(_server_secret(conn).encode(), body.encode(),
                   hashlib.sha256).hexdigest()[:32]
    return f"{body}.{sig}"


def check_state(conn, state):
    """Verify signature+expiry → (uid, pid, nonce) or None."""
    try:
        uid, pid, nonce, exp, sig = str(state).rsplit(".", 4)
        body = f"{uid}.{pid}.{nonce}.{exp}"
        want = hmac.new(_server_secret(conn).encode(), body.encode(),
                        hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, want) or int(exp) < time.time():
            return None
        return int(uid), pid, nonce
    except Exception:
        return None


def _oauth_urls(pid, row):
    p = plugin(pid) or {}
    tenant = config.AZURE_TENANT
    if row and row["extra"]:
        tenant = (json.loads(row["extra"]) or {}).get("tenant") or tenant
    return (p.get("auth", "").replace("{tenant}", tenant),
            p.get("token", "").replace("{tenant}", tenant))


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def _flow_put(conn, nonce, data):
    conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
                 (f"oauth_flow:{nonce}", json.dumps(data)))


def _flow_get(conn, nonce):
    r = conn.execute("SELECT value FROM kv WHERE key=?",
                     (f"oauth_flow:{nonce}",)).fetchone()
    if not r:
        return None
    d = json.loads(r["value"])
    if (d.get("exp") or 0) < time.time():
        conn.execute("DELETE FROM kv WHERE key=?", (f"oauth_flow:{nonce}",))
        return None
    return d


def oauth_begin(conn, uid, pid, redirect, allow_send=False):
    """Kick off a connect flow → {url} popup / {device:{...}} / {error}."""
    p = plugin(pid)
    if not p:
        return {"error": "Unknown plugin"}
    row = conn.execute(
        "SELECT * FROM user_connections WHERE user_id=? AND provider=?",
        (uid, pid)).fetchone()
    cid, csec = app_creds(row, pid)
    if not cid:
        return {"error": "no_client", "app": p["app"]}
    flow = p.get("flow") or "redirect"
    scopes = p["scopes"]
    if allow_send and p.get("send_scope"):
        scopes = scopes + " " + p["send_scope"]

    if flow == "device":                                   # GitHub device code
        try:
            data = _post_form(p["device"],
                              {"client_id": cid, "scope": scopes})
        except Exception as e:
            return {"error": str(e)[:200]}
        if not data.get("device_code"):
            return {"error": data.get("error") or "provider refused a device code"}
        nonce = secrets.token_urlsafe(10)
        _flow_put(conn, nonce, {"uid": uid, "pid": pid, "mode": "device",
                                "device_code": data["device_code"],
                                "exp": time.time() + min(900, data.get("expires_in", 900))})
        return {"device": {"verify": data.get("verification_uri") or "https://github.com/login/device",
                           "code": data.get("user_code"),
                           "interval": max(5, int(data.get("interval") or 5)),
                           "flow": nonce}}

    verifier, challenge = _pkce()
    if flow == "hosted":                                   # REACH callback service
        broker = _broker(pid)
        if not broker:
            return {"error": "no_client", "app": p["app"]}
        try:
            data = _post_form(f"{broker}/oauth/{p['app']}/start",
                              {"codeChallenge": challenge},
                              {"Content-Type": "application/json",
                               "ngrok-skip-browser-warning": "1"},
                              raw=True)
        except Exception as e:
            return {"error": str(e)[:200]}
        if not data.get("authorizeUrl") or not data.get("flowId"):
            return {"error": data.get("error") or "connection service refused"}
        nonce = secrets.token_urlsafe(10)
        _flow_put(conn, nonce, {"uid": uid, "pid": pid, "mode": "hosted",
                                "verifier": verifier, "flowId": data["flowId"],
                                "broker": broker, "exp": time.time() + 600})
        return {"url": data["authorizeUrl"], "flow": nonce}

    # redirect: loopback + PKCE (Google Desktop / Microsoft public clients)
    nonce = secrets.token_urlsafe(10)
    _flow_put(conn, nonce, {"uid": uid, "pid": pid, "mode": "redirect",
                            "verifier": verifier, "exp": time.time() + 900})
    auth, _ = _oauth_urls(pid, row)
    q = {"client_id": cid, "redirect_uri": redirect,
         "response_type": "code", "scope": scopes,
         "state": oauth_state(conn, uid, pid, nonce),
         "code_challenge": challenge, "code_challenge_method": "S256"}
    if p["app"] == "google":
        q.update({"access_type": "offline", "prompt": "select_account consent"})
    if p["app"] == "microsoft":
        q.update({"prompt": "select_account", "response_mode": "query"})
    return {"url": f"{auth}?{urllib.parse.urlencode(q)}"}


def _post_form(url, fields, headers=None, raw=False):
    body = (json.dumps(fields) if raw else urllib.parse.urlencode(fields)).encode()
    h = {"Accept": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def oauth_finish(conn, pid, code, redirect, row, nonce=None):
    """Exchange a code for tokens → {ok, fields} — caller stores them."""
    p = plugin(pid) or {}
    cid, csec = app_creds(row, pid)
    if not cid:
        return {"ok": False, "error": "no client credentials configured"}
    _, tok_url = _oauth_urls(pid, row)
    fields = {"client_id": cid, "code": code, "redirect_uri": redirect,
              "grant_type": "authorization_code"}
    if csec:
        fields["client_secret"] = csec
    if nonce:
        fl = _flow_get(conn, nonce)
        if fl and fl.get("verifier"):
            fields["code_verifier"] = fl["verifier"]
            conn.execute("DELETE FROM kv WHERE key=?", (f"oauth_flow:{nonce}",))
    try:
        data = _post_form(tok_url, fields)
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    if not data.get("access_token"):
        return {"ok": False, "error": data.get("error_description") or
                data.get("error") or "no access_token in response"}
    meta = {"scopes": p.get("scopes", ""),
            "app": p.get("app")}
    if data.get("expires_in"):
        meta["expires_at"] = time.time() + float(data["expires_in"])
    return {"ok": True, "access": data["access_token"],
            "refresh": data.get("refresh_token"), "meta": meta}


def oauth_poll(conn, flow_key, pid):
    """Poll a device/hosted flow → {pending} or {done,access,refresh,meta}."""
    fl = _flow_get(conn, flow_key)
    if not fl or fl.get("pid") != pid:
        return {"error": "flow expired — press Connect again"}
    row = conn.execute(
        "SELECT * FROM user_connections WHERE user_id=? AND provider=?",
        (fl["uid"], pid)).fetchone()
    cid, csec = app_creds(row, pid)
    if fl["mode"] == "device":
        data = _post_form(plugin(pid)["token"], {
            "client_id": cid, "device_code": fl["device_code"],
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
        if data.get("error") == "authorization_pending":
            return {"pending": True}
        if data.get("error") == "slow_down":
            return {"pending": True, "slow": True}
        if data.get("error"):
            return {"error": data.get("error_description") or data["error"]}
    else:  # hosted — the broker completes provider callback + token exchange
        try:
            data = _post_form(f"{fl['broker']}/oauth/{plugin(pid)['app']}/exchange",
                              {"flowId": fl["flowId"], "verifier": fl["verifier"]},
                              {"Content-Type": "application/json",
                               "ngrok-skip-browser-warning": "1"}, raw=True)
        except Exception as e:
            return {"error": str(e)[:200]}
        if data.get("pending"):
            return {"pending": True}
        if data.get("error"):
            return {"error": data["error"]}
    if not data.get("access_token"):
        return {"error": "provider returned no access token"}
    conn.execute("DELETE FROM kv WHERE key=?", (f"oauth_flow:{flow_key}",))
    meta = {"scopes": plugin(pid).get("scopes", ""), "app": plugin(pid)["app"]}
    if data.get("expires_in"):
        meta["expires_at"] = time.time() + float(data["expires_in"])
    return {"done": True, "uid": fl["uid"], "access": data["access_token"],
            "refresh": data.get("refresh_token"), "meta": meta}


def oauth_refresh(conn, row):
    """Refresh an OAuth access token → updated row or None."""
    p = plugin(row["provider"]) or {}
    cid, csec = app_creds(row, row["provider"])
    if not (row["refresher"] and cid):
        return None
    if p.get("flow") == "hosted":
        broker = _broker(row["provider"])
        if not broker:
            return None
        try:
            data = _post_form(
                f"{broker}/oauth/{p['app']}/refresh",
                {"refreshToken": row["refresher"]},
                {"Content-Type": "application/json",
                 "ngrok-skip-browser-warning": "1"}, raw=True)
        except Exception:
            return None
        data = data.get("authed_user") or data
    else:
        _, tok_url = _oauth_urls(row["provider"], row)
        fields = {"client_id": cid, "grant_type": "refresh_token",
                  "refresh_token": row["refresher"]}
        if csec:
            fields["client_secret"] = csec
        try:
            data = _post_form(tok_url, fields)
        except Exception:
            return None
    if not data.get("access_token"):
        return None
    meta = json.loads(row["meta"] or "{}")
    if data.get("expires_in"):
        meta["expires_at"] = time.time() + float(data["expires_in"])
    refresh = data.get("refresh_token") or row["refresher"]
    conn.execute(
        "UPDATE user_connections SET api_key=?, refresher=?, meta=?, updated_at=? WHERE id=?",
        (data["access_token"], refresh, json.dumps(meta), time.time(), row["id"]))
    return conn.execute(
        "SELECT * FROM user_connections WHERE id=?", (row["id"],)).fetchone()


def plugin_probe(row):
    """GET the plugin's probe endpoint → {ok, label} account hint."""
    p = plugin(row["provider"]) or {}
    url = (p.get("probe") or "").replace("{tenant}", config.AZURE_TENANT)
    if not url or not row["api_key"]:
        return {"ok": False, "error": "nothing to probe"}
    try:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {row['api_key']}",
            "Accept": "application/json",
            "User-Agent": "SignalTeams/1.0",
            **(p.get("probe_headers") or {})})
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read().decode())
        label = data.get(p.get("probe_field") or "")
        if not label:
            label = (data.get("mail") or data.get("userPrincipalName")
                     or data.get("email") or data.get("login") or "connected")
        return {"ok": True, "label": label}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ── agent plugin tools — read-only, always AS THE SUMMONER ──────────────────
# An agent may act on a plugin only for the person who summoned it and only
# against that person's own connected account — never the owner's, never
# anyone else's. Everything here is GET/read-only on purpose.

def connected_plugins(conn, uid):
    """Provider ids the user has a completed grant for (oauth or manual token)."""
    return [r["provider"] for r in conn.execute(
        "SELECT provider FROM user_connections WHERE user_id=? AND kind='plugin' "
        "AND via IN ('oauth','token') AND api_key IS NOT NULL AND api_key<>''",
        (uid,)).fetchall()]


PLUGIN_USAGE = {
    "gmail":   '{"plugin":"gmail","action":"search","q":"gmail search"} '
               'or {"action":"read","id":"messageId"}',
    "gcal":    '{"plugin":"gcal","action":"events","days":7}',
    "gdrive":  '{"plugin":"gdrive","action":"search","q":"filename"}',
    "outlook": '{"plugin":"outlook","action":"mail","q":"search"} '
               'or {"action":"events","days":7}',
    "m365":    '{"plugin":"m365","action":"mail","q":"…"} '
               'or {"action":"files","q":"…"} or {"action":"events","days":7}',
    "todo":    '{"plugin":"todo","action":"lists"} '
               'or {"action":"tasks","list":"listId"}',
    "github":  '{"plugin":"github","action":"repos"} '
               'or {"action":"search","q":"repo search"}',
    "slack":   '{"plugin":"slack","action":"search","q":"search"}',
    "notion":  '{"plugin":"notion","action":"search","q":"search"}',
    "discord": '{"plugin":"discord","action":"guilds"}',
}


def _pget(tok, url, extra_headers=None):
    headers = {"Accept": "application/json", "User-Agent": "SignalTeams/1.0",
               **(extra_headers or {})}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def _ppost(tok, url, fields, extra_headers=None):
    req = urllib.request.Request(
        url, data=json.dumps(fields).encode(), method="POST", headers={
            "Authorization": f"Bearer {tok}", "Accept": "application/json",
            "Content-Type": "application/json", "User-Agent": "SignalTeams/1.0",
            **(extra_headers or {})})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def _gmail_headers(md):
    return {h.get("name"): h.get("value")
            for h in ((md.get("payload") or {}).get("headers") or [])}


def _ms_mail(tok, args, lim):
    q = str(args.get("q") or "").strip()[:300]
    params = {"$top": lim,
              "$select": "subject,from,receivedDateTime,bodyPreview,isRead"}
    if q:
        params["$search"] = f'"{q}"'
    d = _pget(tok, "https://graph.microsoft.com/v1.0/me/messages?"
              + urllib.parse.urlencode(params))
    return [{"subject": m.get("subject"),
             "from": ((m.get("from") or {}).get("emailAddress") or {}).get("address"),
             "date": m.get("receivedDateTime"),
             "preview": (m.get("bodyPreview") or "")[:200],
             "read": m.get("isRead")} for m in d.get("value", [])]


def _ms_events(tok, args):
    days = min(max(int(args.get("days") or 7), 1), 30)
    nowz = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    maxz = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                         time.gmtime(time.time() + days * 86400))
    d = _pget(tok, "https://graph.microsoft.com/v1.0/me/events?"
              + urllib.parse.urlencode({
                  "$top": 12, "$orderby": "start/dateTime",
                  "$select": "subject,start,end,location,isAllDay",
                  "$filter": f"start/dateTime ge '{nowz}' and start/dateTime lt '{maxz}'"}))
    return [{"subject": e.get("subject"),
             "start": (e.get("start") or {}).get("dateTime"),
             "end": (e.get("end") or {}).get("dateTime"),
             "location": (e.get("location") or {}).get("displayName") or "",
             "all_day": e.get("isAllDay")} for e in d.get("value", [])]


def _plugin_action(pid, tok, args):
    a = args or {}
    # tool-loop canonicalization folds q→query; accept either
    q = str(a.get("q") or a.get("query") or "").strip()[:300]
    act = str(a.get("action") or "").strip().lower()
    lim = min(max(int(a.get("limit") or 8), 1), 12)

    if pid == "gmail":
        base = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        if act == "read":
            mid = str(a.get("id") or "")[:64]
            md = _pget(tok, f"{base}/{mid}?format=full")
            h = _gmail_headers(md)
            return {"subject": h.get("Subject"), "from": h.get("From"),
                    "date": h.get("Date"), "snippet": md.get("snippet", "")[:500]}
        d = _pget(tok, base + "?" + urllib.parse.urlencode(
            {"q": q, "maxResults": lim}))
        out = []
        for m in (d.get("messages") or [])[:lim]:
            md = _pget(tok, f"{base}/{m['id']}?format=metadata"
                            "&metadataHeaders=Subject&metadataHeaders=From"
                            "&metadataHeaders=Date")
            h = _gmail_headers(md)
            out.append({"id": m["id"], "subject": h.get("Subject"),
                        "from": h.get("From"), "date": h.get("Date"),
                        "snippet": md.get("snippet", "")[:160]})
        return {"count": d.get("resultSizeEstimate"), "messages": out}

    if pid == "gcal":
        days = min(max(int(a.get("days") or 7), 1), 30)
        nowz = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        maxz = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                             time.gmtime(time.time() + days * 86400))
        d = _pget(tok, "https://www.googleapis.com/calendar/v3/calendars/primary/events?"
                  + urllib.parse.urlencode({"timeMin": nowz, "timeMax": maxz,
                                            "maxResults": 12, "singleEvents": "true",
                                            "orderBy": "startTime"}))
        return [{"summary": e.get("summary"),
                 "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
                 "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
                 "location": e.get("location") or ""} for e in d.get("items", [])]

    if pid == "gdrive":
        params = {"pageSize": 12,
                  "fields": "files(id,name,mimeType,modifiedTime,size)",
                  "orderBy": "modifiedTime desc"}
        if q:
            params["q"] = f"name contains '{q.replace(chr(39), '')}'"
        d = _pget(tok, "https://www.googleapis.com/drive/v3/files?"
                  + urllib.parse.urlencode(params))
        return d.get("files", [])

    if pid == "outlook":
        if act == "events":
            return _ms_events(tok, a)
        return _ms_mail(tok, a, lim)

    if pid == "m365":
        if act == "files":
            url = ("https://graph.microsoft.com/v1.0/me/drive/root/search(q='%s')"
                   % q.replace("'", "")) if q \
                else "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=12"
            d = _pget(tok, url)
            return [{"name": f.get("name"), "id": f.get("id"),
                     "size": f.get("size"),
                     "modified": f.get("lastModifiedDateTime")}
                    for f in d.get("value", [])]
        if act == "events":
            return _ms_events(tok, a)
        return _ms_mail(tok, a, lim)

    if pid == "todo":
        if act == "tasks":
            lid = str(a.get("list") or a.get("list_id") or "")[:64]
            d = _pget(tok, f"https://graph.microsoft.com/v1.0/me/todo/lists/"
                           f"{lid}/tasks?$top=12")
            return [{"title": t.get("title"), "status": t.get("status"),
                     "due": (t.get("dueDateTime") or {}).get("dateTime")}
                    for t in d.get("value", [])]
        d = _pget(tok, "https://graph.microsoft.com/v1.0/me/todo/lists?$top=20")
        return [{"id": l.get("id"), "name": l.get("displayName")}
                for l in d.get("value", [])]

    if pid == "github":
        if act == "search":
            # sort/order are params on the API, not in-query qualifiers —
            # models commonly emit "q": "… sort:stars", so hoist them out
            params = {"q": q or "", "per_page": lim}
            for k in ("sort", "order"):
                v = a.get(k)
                m = re.search(rf"\b{k}:(\w+)", params["q"])
                if m:
                    v = v or m.group(1)
                    params["q"] = params["q"].replace(m.group(0), "").strip()
                if v:
                    params[k] = v
            d = _pget(tok, "https://api.github.com/search/repositories?"
                      + urllib.parse.urlencode(params))
            return [{"name": r.get("full_name"), "desc": r.get("description"),
                     "stars": r.get("stargazers_count"),
                     "lang": r.get("language")} for r in d.get("items", [])]
        d = _pget(tok, f"https://api.github.com/user/repos"
                       f"?sort=updated&per_page={lim}")
        return [{"name": r.get("full_name"), "private": r.get("private"),
                 "desc": r.get("description"), "updated": r.get("updated_at")}
                for r in d]

    if pid == "slack":
        d = _pget(tok, "https://slack.com/api/search.messages?"
                  + urllib.parse.urlencode({"query": q, "count": lim}))
        if not d.get("ok"):
            raise RuntimeError(d.get("error") or "slack search failed")
        return [{"text": (m.get("text") or "")[:200],
                 "user": m.get("username") or m.get("user"),
                 "channel": (m.get("channel") or {}).get("name"),
                 "ts": m.get("ts")}
                for m in ((d.get("messages") or {}).get("matches") or [])]

    if pid == "notion":
        d = _ppost(tok, "https://api.notion.com/v1/search",
                   {"query": q, "page_size": lim},
                   {"Notion-Version": "2022-06-28"})
        out = []
        for r in d.get("results", []):
            title = "".join(x.get("plain_text", "")
                            for x in (r.get("title") or []))
            if not title:
                for pval in (r.get("properties") or {}).values():
                    if pval.get("type") == "title":
                        title = "".join(x.get("plain_text", "")
                                        for x in (pval.get("title") or []))
                        break
            out.append({"type": r.get("object"), "title": title[:120],
                        "id": r.get("id"), "edited": r.get("last_edited_time")})
        return out

    if pid == "discord":
        d = _pget(tok, "https://discord.com/api/v10/users/@me/guilds",
                  {"User-Agent": "DiscordBot (https://lemonade-nexus.io, 1.0)"})
        return [{"id": g.get("id"), "name": g.get("name")}
                for g in (d or [])[:20]]

    return {"ok": False, "error": f"no tool action for {pid}"}


def plugin_tool(conn, uid, pid, args):
    """Run a read-only plugin action strictly as uid — the person who asked.
    Returns a small JSON-able result for the tool loop."""
    p = plugin(pid)
    if not p or pid not in PLUGIN_USAGE:
        return {"ok": False, "error": "no such plugin"}
    row = conn.execute(
        "SELECT * FROM user_connections WHERE user_id=? AND provider=?",
        (uid, pid)).fetchone()
    if pid == "github" and (not row or not row["api_key"]):
        # public-data fallback — GitHub's unauthenticated API still answers
        # repo search; /user/repos fails honestly telling the model to say
        # "connect GitHub in Connections for private repos"
        try:
            return {"ok": True,
                    "result": _plugin_action(pid, None, args)}
        except Exception as e:
            return {"ok": False, "error": str(e)[:240]}
    if not row or row["via"] not in ("oauth", "token") or not row["api_key"]:
        return {"ok": False,
                "error": f"you haven't connected {p['name']} — "
                         "Settings → Connections → Plugins"}
    row = fresh(conn, row)          # transparently refresh an expiring token
    try:
        return {"ok": True, "result": _plugin_action(pid, row["api_key"], args)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:240]}
