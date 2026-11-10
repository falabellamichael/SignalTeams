"""User AI-provider connections + OAuth plugins — Settings → Connections."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..auth import current_user
from ..connections import (PROVIDERS, PLUGINS, app_creds, check_state, detect,
                           endpoint_for, import_cli, oauth_begin, oauth_finish,
                           oauth_poll, plugin, plugin_probe, provider, public)
from ..db import db, now

router = APIRouter()


def _row(conn, uid, pid):
    return conn.execute(
        "SELECT * FROM user_connections WHERE user_id=? AND provider=?",
        (uid, pid)).fetchone()


def _list(uid):
    with db() as conn:
        rows = {r["provider"]: r for r in conn.execute(
            "SELECT * FROM user_connections WHERE user_id=?", (uid,)).fetchall()}
    out = []
    for p in PROVIDERS:
        r = rows.get(p["id"])
        hit = (r is None) and detect(p["id"])
        out.append({
            "id": p["id"], "name": p["name"], "group": p["group"],
            "blurb": p["blurb"], "hue": p["hue"],
            "importable": bool(p.get("cli")),
            "detected": bool(hit),
            "custom": bool(p.get("custom")),
            **(public(r) if r else {"connected": False}),
        })
    for p in PLUGINS:
        r = rows.get(p["id"])
        cid, _ = app_creds(r, p["id"])
        d = {"id": p["id"], "name": p["name"], "group": "plugin",
             "blurb": p["blurb"], "hue": p["hue"], "plugin": True,
             "app": p["app"], "scopes": (p["scopes"] or "").split(),
             "icon": p.get("icon", ""), "flow": p["flow"],
             "configured": bool(cid)}
        if r and r["via"] != "setup":
            d.update(public(r))
        else:
            d["connected"] = False
            d["saved"] = bool(r)
        out.append(d)
    return out


@router.get("/api/connections")
def list_connections(user=Depends(current_user)):
    return _list(user["id"])


class ConnIn(BaseModel):
    api_key: str | None = None
    model: str | None = None
    label: str | None = None
    url: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    tenant: str | None = None


def _put_plugin(pid: str, body: ConnIn, uid: int):
    """Plugin setup: save OAuth app creds, or a manual token as a fallback."""
    key = (body.api_key or "").strip()
    cid = (body.client_id or "").strip()
    csec = (body.client_secret or "").strip()
    tenant = (body.tenant or "").strip()
    if not (key or cid):
        raise HTTPException(400, "Paste an OAuth app client id (or a token)")
    t = now()
    with db() as conn:
        r = _row(conn, uid, pid)
        extra = json.loads(r["extra"] or "{}") if r and r["extra"] else {}
        if cid:
            extra["client_id"] = cid
        if csec:
            extra["client_secret"] = csec
        if tenant:
            extra["tenant"] = tenant
        if key:
            # manual token connect — no OAuth dance
            conn.execute(
                """INSERT INTO user_connections
                   (user_id, provider, via, kind, url, api_key, extra, usable, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,0,?,?)
                   ON CONFLICT(user_id, provider) DO UPDATE SET
                     via='token', api_key=excluded.api_key, extra=excluded.extra,
                     updated_at=excluded.updated_at""",
                (uid, pid, "token", "plugin", "", key[:512],
                 json.dumps(extra), t, t))
        else:
            conn.execute(
                """INSERT INTO user_connections
                   (user_id, provider, via, kind, extra, usable, created_at, updated_at)
                   VALUES (?,?,'setup','plugin',?,0,?,?)
                   ON CONFLICT(user_id, provider) DO UPDATE SET
                     extra=excluded.extra, updated_at=excluded.updated_at""",
                (uid, pid, json.dumps(extra), t, t))
        cid2, _ = app_creds(_row(conn, uid, pid), pid)
        r = _row(conn, uid, pid)
        return {"id": pid, "configured": bool(cid2),
                "connected": bool(r and r["via"] not in ("setup",)) or bool(key)}


@router.put("/api/connections/{pid}")
def put_connection(pid: str, body: ConnIn, user=Depends(current_user)):
    if plugin(pid):
        return _put_plugin(pid, body, user["id"])
    p = provider(pid)
    if not p:
        raise HTTPException(404, "Unknown provider")
    key = (body.api_key or "").strip()
    if not key:
        raise HTTPException(400, "An API key / token is required for a key connection")
    url = p["url"]
    if p.get("custom"):
        url = (body.url or "").strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise HTTPException(400, "A base URL like https://host/v1 is required")
    t = now()
    with db() as conn:
        conn.execute(
            """INSERT INTO user_connections
               (user_id, provider, via, kind, url, api_key, model, label, usable, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,1,?,?)
               ON CONFLICT(user_id, provider) DO UPDATE SET
                 via='key', kind=excluded.kind, url=excluded.url, api_key=excluded.api_key,
                 model=excluded.model, label=excluded.label, usable=1,
                 headers=NULL, refresher=NULL, meta='{}', updated_at=excluded.updated_at""",
            (user["id"], pid, "key", p["kind"], url, key[:512],
             (body.model or "").strip()[:128],
             (body.label or p["name"]).strip()[:128], t, t))
        r = _row(conn, user["id"], pid)
        return {"id": pid, **public(r)}


@router.post("/api/connections/{pid}/import")
def import_connection(pid: str, user=Depends(current_user)):
    p = provider(pid)
    if not p:
        raise HTTPException(404, "Unknown provider")
    res = import_cli(pid)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Import failed"))
    t = now()
    with db() as conn:
        conn.execute(
            """INSERT INTO user_connections
               (user_id, provider, via, kind, url, api_key, headers, model, label, usable,
                refresher, meta, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id, provider) DO UPDATE SET
                 via='cli', kind=excluded.kind, url=excluded.url, api_key=excluded.api_key,
                 headers=excluded.headers, label=excluded.label, usable=excluded.usable,
                 refresher=excluded.refresher,
                 meta=excluded.meta, updated_at=excluded.updated_at""",
            (user["id"], pid, "cli", res["kind"], res["url"], res.get("api_key"),
             res.get("headers"), res.get("model") or "", res.get("label") or "",
             1 if res.get("usable") else 0, res.get("refresher"),
             json.dumps(res.get("meta") or {}), t, t))
        r = _row(conn, user["id"], pid)
        return {"id": pid, **public(r)}


@router.delete("/api/connections/{pid}")
def del_connection(pid: str, user=Depends(current_user)):
    with db() as conn:
        conn.execute(
            "DELETE FROM user_connections WHERE user_id=? AND provider=?",
            (user["id"], pid))
    return {"ok": True}


@router.post("/api/connections/{pid}/test")
def test_connection(pid: str, user=Depends(current_user)):
    from .playground import _probe_endpoint
    from ..connections import fresh
    t0 = time.time()
    with db() as conn:
        r = _row(conn, user["id"], pid)
        if r:
            r = fresh(conn, r)
    if not r:
        raise HTTPException(404, "Not connected")
    if plugin(pid):
        res = plugin_probe(r)
        res["latency_ms"] = int((time.time() - t0) * 1000)
        return res
    ep = endpoint_for(r)
    if not ep:
        return {"ok": True, "stored": True, "kind": r["kind"],
                "note": "Credential stored — this account type isn't chat-routable yet."}
    t0 = time.time()
    try:
        res = _probe_endpoint(ep)
        res["latency_ms"] = int((time.time() - t0) * 1000)
        return res
    except Exception as e:
        return {"ok": False, "error": str(e)[:300],
                "latency_ms": int((time.time() - t0) * 1000)}


@router.post("/api/connections/{pid}/use")
def use_connection(pid: str, user=Depends(current_user)):
    """Promote a connection to the personal endpoint summons/playground use."""
    from ..connections import fresh
    with db() as conn:
        r = _row(conn, user["id"], pid)
        if not r:
            raise HTTPException(404, "Not connected")
        r = fresh(conn, r)
        ep = endpoint_for(r)
        if not ep:
            raise HTTPException(
                400, "This connection type can't drive chat — connect with an API key instead")
        conn.execute(
            "UPDATE users SET llm_url=?, llm_key=?, llm_model=?, llm_kind=?, llm_headers=? WHERE id=?",
            (ep["url"], ep["key"] or "", ep["model"], ep["kind"], ep["headers"], user["id"]))
        u = conn.execute(
            "SELECT llm_url, llm_key, llm_model, llm_kind, llm_headers FROM users WHERE id=?",
            (user["id"],)).fetchone()
        return {"base_url": u["llm_url"], "model": u["llm_model"],
                "kind": u["llm_kind"], "has_key": bool(u["llm_key"]),
                "has_headers": bool(u["llm_headers"])}


def _redirect(request: Request, pid: str) -> str:
    base = str(request.base_url).rstrip("/")
    # Microsoft public clients (Entra "mobile & desktop" platform): any
    # localhost port is allowed but the path must match the registered one —
    # REACH's app is registered for /oauth/callback.
    if (plugin(pid) or {}).get("app") == "microsoft":
        return f"{base.replace('127.0.0.1', 'localhost')}/oauth/callback"
    return f"{base}/api/connections/{pid}/callback"


class BeginIn(BaseModel):
    allow_send: bool = False


@router.post("/api/connections/{pid}/begin")
def begin_connection(pid: str, request: Request, body: BeginIn | None = None,
                     user=Depends(current_user)):
    """Kick off the browser connect flow → consent URL / device code."""
    if not plugin(pid):
        raise HTTPException(404, "Not an OAuth plugin")
    with db() as conn:
        res = oauth_begin(conn, user["id"], pid, _redirect(request, pid),
                          allow_send=bool(body and body.allow_send))
    if res.get("error") == "no_client":
        raise HTTPException(
            400, "No OAuth app configured — save the app's client id on this card "
                 "or set it via backend/.env")
    if res.get("error"):
        raise HTTPException(400, res["error"])
    return res


class PollIn(BaseModel):
    flow: str = ""


def _store_grant(conn, uid, pid, access, refresh, meta, keep_extra):
    """Upsert a completed OAuth grant + return the account label."""
    label = plugin_probe({"provider": pid, "api_key": access}).get("label") or ""
    t = now()
    conn.execute(
        """INSERT INTO user_connections
           (user_id, provider, via, kind, api_key, refresher, meta, label, usable,
            extra, created_at, updated_at)
           VALUES (?,?,'oauth','plugin',?,?,?,?,0,?,?,?)
           ON CONFLICT(user_id, provider) DO UPDATE SET
             via='oauth', api_key=excluded.api_key,
             refresher=COALESCE(excluded.refresher, user_connections.refresher),
             meta=excluded.meta, label=excluded.label,
             updated_at=excluded.updated_at""",
        (uid, pid, access, refresh, json.dumps(meta or {}), label[:128],
         keep_extra, t, t))
    return label


@router.post("/api/connections/{pid}/poll")
def poll_connection(pid: str, body: PollIn, user=Depends(current_user)):
    """Poll a device/hosted flow — completes when the user authorizes."""
    if not plugin(pid):
        raise HTTPException(404, "Not an OAuth plugin")
    with db() as conn:
        res = oauth_poll(conn, body.flow, pid)
        if res.get("done"):
            if res.get("uid") != user["id"]:
                raise HTTPException(400, "Flow belongs to another session")
            row = _row(conn, user["id"], pid)
            label = _store_grant(conn, user["id"], pid, res["access"],
                                 res.get("refresh"), res.get("meta"),
                                 (row["extra"] if row else "{}"))
            return {"connected": True, "label": label}
        if res.get("pending"):
            return {"pending": True}
        raise HTTPException(400, res.get("error") or "connect failed")


_POPUP_OK = """<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#111318;color:#e8eaf0;font:15px/1.5 system-ui">
<div style="text-align:center"><div style="font-size:40px">✓</div>
<p><b>%s</b> connected.<br>You can close this tab.</p></div>
<script>try{window.opener&&window.opener.postMessage({type:'st-plugin-connected'},'*')}catch(e){}setTimeout(()=>window.close(),600)</script>
"""

_POPUP_ERR = """<!doctype html><meta charset="utf-8"><title>Connection failed</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#111318;color:#e8eaf0;font:15px/1.5 system-ui">
<div style="text-align:center"><div style="font-size:40px">✗</div>
<p>Connection failed.<br><small style="color:#9aa3b2">%s</small></p></div>
"""


@router.get("/api/connections/{pid}/callback")
def connection_callback(pid: str, request: Request, code: str = "", state: str = "",
                        error: str = "", error_description: str = ""):
    """Provider redirect target — verify signed state, exchange code, store."""
    if not plugin(pid):
        return HTMLResponse(_POPUP_ERR % "unknown plugin", status_code=400)
    if error:
        return HTMLResponse(_POPUP_ERR % (error_description or error))
    with db() as conn:
        st = check_state(conn, state)
        if not st or st[1] != pid:
            return HTMLResponse(_POPUP_ERR % "invalid or expired state — try Connect again",
                                status_code=400)
        uid, _, nonce = st
        row = _row(conn, uid, pid)
        res = oauth_finish(conn, pid, code, _redirect(request, pid), row, nonce)
        if not res.get("ok"):
            return HTMLResponse(_POPUP_ERR % (res.get("error") or "exchange failed"))
        _store_grant(conn, uid, pid, res["access"], res.get("refresh"),
                     res.get("meta"), (row["extra"] if row else "{}"))
    return HTMLResponse(_POPUP_OK % plugin(pid)["name"])


@router.get("/oauth/callback")
def oauth_loopback_compat(request: Request, code: str = "", state: str = "",
                          error: str = "", error_description: str = ""):
    """Entra-registered loopback path — pid comes from the signed state."""
    if error:
        return HTMLResponse(_POPUP_ERR % (error_description or error))
    with db() as conn:
        st = check_state(conn, state)
        if not st or not plugin(st[1]):
            return HTMLResponse(_POPUP_ERR % "invalid or expired state — try Connect again",
                                status_code=400)
        uid, pid, nonce = st
        row = _row(conn, uid, pid)
        res = oauth_finish(conn, pid, code, _redirect(request, pid), row, nonce)
        if not res.get("ok"):
            return HTMLResponse(_POPUP_ERR % (res.get("error") or "exchange failed"))
        _store_grant(conn, uid, pid, res["access"], res.get("refresh"),
                     res.get("meta"), (row["extra"] if row else "{}"))
    return HTMLResponse(_POPUP_OK % plugin(pid)["name"])
