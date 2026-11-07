"""Incoming channel webhooks — SignalTeams as the harness.

Owners mint a hook per channel; external services POST Discord-style
{content, username, embeds}, Slack-style {text}, or a bare string to
/api/hooks/{token} and the message lands in-channel as a hook:N bot user.
"""
import asyncio
import json
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import current_user
from ..db import db, emit_buzz, now
from ..hub import hub
from ..helpers import audit, can_see_agent, channel_member_ids, hook_bot_user, is_blocked, message_json
from ..services import _agent_cool, agent_reply

router = APIRouter()

HOOKS_PER_CHANNEL = 10
_RATE = defaultdict(deque)          # token -> recent post timestamps
_RATE_N, _RATE_SECS = 8, 10.0


def _hook_json(h):
    return {"id": h["id"], "channel_id": h["channel_id"], "name": h["name"],
            "icon": h["icon"], "token": h["token"], "uses": h["uses"],
            "last_used": h["last_used"], "created_at": h["created_at"]}


def _own_channel(conn, cid, uid):
    ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    if not ch or not ch["server_id"]:
        raise HTTPException(404, "No such channel")
    s = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                     (ch["server_id"],)).fetchone()
    if not s or s["owner_id"] != uid:
        raise HTTPException(403, "Only the server owner manages webhooks")
    return ch


@router.get("/api/channels/{cid}/webhooks")
def list_hooks(cid: int, user=Depends(current_user)):
    with db() as conn:
        _own_channel(conn, cid, user["id"])
        rows = conn.execute(
            "SELECT * FROM channel_hooks WHERE channel_id=? ORDER BY id", (cid,)).fetchall()
        return [_hook_json(h) for h in rows]


@router.post("/api/channels/{cid}/webhooks")
def create_hook(cid: int, body: dict, user=Depends(current_user)):
    name = str(body.get("name") or "").strip()[:48]
    icon = str(body.get("icon") or "").strip()[:8] or "🪝"
    if not name:
        raise HTTPException(400, "Give the hook a name")
    with db() as conn:
        _own_channel(conn, cid, user["id"])
        n = conn.execute(
            "SELECT COUNT(*) c FROM channel_hooks WHERE channel_id=?", (cid,)).fetchone()["c"]
        if n >= HOOKS_PER_CHANNEL:
            raise HTTPException(400, f"{HOOKS_PER_CHANNEL} hooks per channel max")
        cur = conn.execute(
            "INSERT INTO channel_hooks(channel_id, name, icon, token, creator_id, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (cid, name, icon, secrets.token_urlsafe(24), user["id"], now()))
        h = conn.execute("SELECT * FROM channel_hooks WHERE id=?",
                         (cur.lastrowid,)).fetchone()
        ch = conn.execute("SELECT server_id FROM channels WHERE id=?", (cid,)).fetchone()
        audit(conn, ch["server_id"], user["id"], "hook.create",
              name, f"in #{conn.execute('SELECT name FROM channels WHERE id=?', (cid,)).fetchone()['name']}")
        return _hook_json(h)


@router.patch("/api/webhooks/{wid}")
def edit_hook(wid: int, body: dict, user=Depends(current_user)):
    with db() as conn:
        h = conn.execute("SELECT * FROM channel_hooks WHERE id=?", (wid,)).fetchone()
        if not h:
            raise HTTPException(404, "No such webhook")
        _own_channel(conn, h["channel_id"], user["id"])
        name = str(body.get("name", h["name"]) or h["name"]).strip()[:48] or h["name"]
        icon = str(body.get("icon", h["icon"]) or h["icon"]).strip()[:8] or h["icon"]
        token = secrets.token_urlsafe(24) if body.get("rotate") else h["token"]
        conn.execute(
            "UPDATE channel_hooks SET name=?, icon=?, token=? WHERE id=?",
            (name, icon, token, wid))
        h = conn.execute("SELECT * FROM channel_hooks WHERE id=?", (wid,)).fetchone()
        hook_bot_user(conn, h)                     # keep the bot user in sync
        ch = conn.execute("SELECT server_id, name cname FROM channels WHERE id=?",
                          (h["channel_id"],)).fetchone()
        audit(conn, ch["server_id"], user["id"],
              "hook.rotate" if body.get("rotate") else "hook.update",
              name, f"in #{ch['cname']}" if ch else "")
        return _hook_json(h)


@router.delete("/api/webhooks/{wid}")
def delete_hook(wid: int, user=Depends(current_user)):
    with db() as conn:
        h = conn.execute("SELECT * FROM channel_hooks WHERE id=?", (wid,)).fetchone()
        if not h:
            raise HTTPException(404, "No such webhook")
        _own_channel(conn, h["channel_id"], user["id"])
        conn.execute("DELETE FROM channel_hooks WHERE id=?", (wid,))
        ch = conn.execute("SELECT server_id, name cname FROM channels WHERE id=?",
                          (h["channel_id"],)).fetchone()
        audit(conn, ch["server_id"], user["id"], "hook.delete",
              h["name"], f"in #{ch['cname']}" if ch else "")
        return {"deleted": wid}


@router.get("/api/hooks/{token}")
def hook_info(token: str):
    """Token-gated info probe — lets a remote verify the hook before posting."""
    with db() as conn:
        h = conn.execute("SELECT * FROM channel_hooks WHERE token=?", (token,)).fetchone()
        if not h:
            raise HTTPException(404, "No such webhook")
        ch = conn.execute("SELECT name FROM channels WHERE id=?",
                          (h["channel_id"],)).fetchone()
        return {"ok": True, "name": h["name"],
                "channel": ch["name"] if ch else "?", "uses": h["uses"]}


def _hook_text(body):
    """Normalize Discord/Slack/generic payloads to (content, username, parse)."""
    if isinstance(body, str):
        return body, "", set()
    if not isinstance(body, dict):
        return "", "", set()
    text = str(body.get("content") or body.get("text") or
               body.get("message") or body.get("msg") or "")
    uname = str(body.get("username") or body.get("name") or "")[:80]
    for e in body.get("embeds") or []:
        if not isinstance(e, dict):
            continue
        parts = [f"**{e['title']}**" if e.get("title") else "",
                 str(e.get("description") or ""), str(e.get("url") or "")]
        parts += [f"**{f.get('name', '')}:** {f.get('value', '')}"
                  for f in (e.get("fields") or []) if isinstance(f, dict)]
        text += "\n" + "\n".join(p for p in parts if p)
    am = body.get("allowed_mentions")
    if isinstance(am, dict):
        parse = {str(x).lower() for x in (am.get("parse") or [])}
        if am.get("users") is True:
            parse.add("users")
    else:
        parse = {str(x).lower() for x in am} if isinstance(am, list) else set()
    return text, uname, parse


@router.post("/api/hooks/{token}")
async def post_hook(token: str, request: Request):
    with db() as conn:
        h = conn.execute("SELECT * FROM channel_hooks WHERE token=?", (token,)).fetchone()
        if not h:
            raise HTTPException(404, "No such webhook")

    # rate limit: 8 posts / 10s per hook (keyed by id — bad tokens never fill the map)
    q = _RATE[h["id"]]
    t_now = time.time()
    while q and q[0] < t_now - _RATE_SECS:
        q.popleft()
    if len(q) >= _RATE_N:
        raise HTTPException(429, "Hook is rate limited — slow down")
    q.append(t_now)

    # body: JSON dict, JSON string, form `payload`/`text`, or raw text
    raw = (await request.body())[:32_768]
    body = None
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        pass
    if body is None:
        ct = request.headers.get("content-type", "")
        if "form" in ct:
            form = await request.form()
            v = form.get("payload") or form.get("content") or form.get("text") or ""
            try:
                body = json.loads(v)
            except Exception:
                body = {"content": str(v)}
        else:
            body = raw.decode("utf-8", "replace").strip()

    content, uname, parse = _hook_text(body)
    content = content.strip()[:3600]
    if not content:
        raise HTTPException(400, "Nothing to post — send {content|text|message}")

    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?",
                          (h["channel_id"],)).fetchone()
        if not ch:
            raise HTTPException(404, "Channel is gone")
        bot = hook_bot_user(conn, h)
        members = channel_member_ids(conn, ch)
        cur = conn.execute(
            "INSERT INTO messages(channel_id, author_id, content, webhook_id, author_name, "
            "created_at) VALUES (?,?,?,?,?,?)",
            (ch["id"], bot["id"], content, h["id"], uname or None, now()))
        mid = cur.lastrowid
        conn.execute("UPDATE channel_hooks SET uses=uses+1, last_used=? WHERE id=?",
                     (now(), h["id"]))

        # mentions — only the classes the poster opted into
        names = {n.lower() for n in re.findall(r"@(\w+)", content)}
        pinged, hit_agents = [], []
        if names:
            rows = conn.execute(
                "SELECT id, username FROM users WHERE id IN (%s)" %
                ",".join("?" * len(members)), members).fetchall() if members else []
            if "users" in parse:
                pinged += [r["id"] for r in rows if r["username"].lower() in names]
            if "everyone" in parse:
                if "everyone" in names:
                    pinged += [r["id"] for r in rows if r["id"] not in pinged]
                elif "here" in names:
                    online = set(hub.online_ids())
                    pinged += [r["id"] for r in rows if r["id"] in online
                               and r["id"] not in pinged]
            if "roles" in parse and ch["server_id"]:
                role_slugs = {}
                for r in conn.execute(
                        "SELECT id, name FROM server_roles WHERE server_id=?",
                        (ch["server_id"],)).fetchall():
                    role_slugs[re.sub(r"[^a-z0-9]+", "", r["name"].lower())] = r["id"]
                hit = {role_slugs[s] for s in
                       {re.sub(r"[^a-z0-9]+", "", n) for n in names} & set(role_slugs)}
                if hit:
                    mset = set(members)
                    for r in conn.execute(
                            "SELECT DISTINCT user_id FROM member_roles "
                            "WHERE server_id=? AND role_id IN (%s)" %
                            ",".join("?" * len(hit)),
                            (ch["server_id"], *hit)).fetchall():
                        if r["user_id"] in mset and r["user_id"] not in pinged:
                            pinged.append(r["user_id"])
            pinged = [u for u in pinged
                      if u != bot["id"] and not is_blocked(conn, u, h["creator_id"])]
            for uid in pinged:
                emit_buzz(conn, bot["id"], "mentioned", {
                    "to": uid, "channel_id": ch["id"], "server_id": ch["server_id"],
                    "channel": ch["name"], "msg_id": mid,
                    "excerpt": content[:100]})
        # leftover @tokens → agent summons (gated by the hook creator's visibility)
        cand = names - {"everyone", "here"} - \
            {r["username"].lower() for r in rows} if names else set()
        if cand:
            seen = {}
            for a in conn.execute("SELECT * FROM agents ORDER BY id").fetchall():
                slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())
                if slug in {re.sub(r"[^a-z0-9]+", "", n) for n in cand} \
                        and can_see_agent(conn, a, h["creator_id"]):
                    if slug not in seen or a["owner_id"] == h["creator_id"]:
                        seen[slug] = a
            hit_agents = [dict(a) for a in seen.values()]
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        payload = {"type": "message", "channel_id": ch["id"],
                   "message": message_json(conn, m, h["creator_id"]),
                   "mentions": pinged}

    await hub.send_many(members, payload)
    for uid in pinged:
        await hub.send(uid, {"type": "buzz"})
    for a in hit_agents[:2]:
        key = (a["id"], ch["id"])
        if time.time() - _agent_cool.get(key, 0) < 8:
            continue
        _agent_cool[key] = time.time()
        asyncio.create_task(agent_reply(ch["id"], a["id"], h["creator_id"], mid))
    return {"ok": True, "id": mid}
