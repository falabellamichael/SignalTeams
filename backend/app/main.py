"""SignalTeams API — Discord-smooth chat + Buzz feed + shared agent library."""
import asyncio
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db as dbmod
from .auth import (create_session, current_user, get_token, hash_password,
                   optional_user, user_by_token, verify_password)
from .db import db, emit_buzz, init, now, row_to_dict
from .hub import hub

init()
app = FastAPI(title="SignalTeams", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AVATAR_COLORS = ["#4da3ff", "#3fb950", "#d29922", "#f85149", "#a371f7", "#14b8a6", "#e85d75", "#d4af37"]
AVATAR_EMOJIS = ["🐝", "🤖", "🦊", "🐙", "🦉", "🍯", "⚡", "🌙"]


# ---------- helpers ----------

def public_user(u):
    return {
        "id": u["id"], "username": u["username"], "display_name": u["display_name"],
        "avatar_color": u["avatar_color"], "avatar_emoji": u["avatar_emoji"],
        "bio": u["bio"], "status": u["status"],
        "status_text": u["status_text"] if "status_text" in u.keys() else "",
        "seen_buzz": u["seen_buzz"] if "seen_buzz" in u.keys() else 0,
        "muted": json.loads(u["muted"]) if "muted" in u.keys() and u["muted"] else [],
        "server_muted": (json.loads(u["server_muted"])
                         if "server_muted" in u.keys() and u["server_muted"] else []),
        "notify_mentions": (json.loads(u["notify_mentions"])
                            if "notify_mentions" in u.keys() and u["notify_mentions"] else []),
    }


def friend_ids(conn, uid):
    rows = conn.execute(
        "SELECT CASE WHEN user_id=? THEN friend_id ELSE user_id END AS fid "
        "FROM friendships WHERE status='accepted' AND (user_id=? OR friend_id=?)",
        (uid, uid, uid),
    ).fetchall()
    return [r["fid"] for r in rows]


def can_see_agent(conn, agent, uid):
    if agent["visibility"] == "public" or agent["owner_id"] == uid:
        return True
    if agent["visibility"] == "private":
        return False
    return agent["owner_id"] in friend_ids(conn, uid)


def agent_json(conn, a, uid):
    d = row_to_dict(a)
    d["owner"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (a["owner_id"],)).fetchone())
    d["stars"] = conn.execute("SELECT COUNT(*) c FROM agent_stars WHERE agent_id=?", (a["id"],)).fetchone()["c"]
    d["installs"] = conn.execute("SELECT COUNT(*) c FROM agent_installs WHERE agent_id=?", (a["id"],)).fetchone()["c"]
    d["starred"] = bool(conn.execute(
        "SELECT 1 FROM agent_stars WHERE agent_id=? AND user_id=?", (a["id"], uid)).fetchone())
    d["installed"] = bool(conn.execute(
        "SELECT 1 FROM agent_installs WHERE agent_id=? AND user_id=?", (a["id"], uid)).fetchone())
    r = conn.execute(
        "SELECT AVG(rating) avg, COUNT(*) n FROM agent_reviews WHERE agent_id=? AND rating>0",
        (a["id"],)).fetchone()
    d["rating"] = round(r["avg"], 1) if r["avg"] else None
    d["rating_count"] = r["n"]
    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
    d["summons"] = conn.execute(
        "SELECT COUNT(*) c FROM messages m JOIN users u ON u.id=m.author_id "
        "WHERE u.username=?", (f"agent:{slug}",)).fetchone()["c"]
    d["has_api_key"] = bool(d.pop("api_key", None))
    d["has_api_headers"] = bool(d.pop("api_headers", None))
    d["has_context_headers"] = bool(d.pop("context_headers", None))
    d["api_kind"] = d.get("api_kind") or ""
    d["api_url"] = d.get("api_url") or ""
    d["context_method"] = d.get("context_method") or "GET"
    d["connected"] = bool(d["api_url"] or d.get("context_url"))
    return d


def channel_member_ids(conn, ch):
    if ch["server_id"]:
        ids = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?", (ch["server_id"],)).fetchall()]
        rid = ch["role_id"] if "role_id" in ch.keys() else None
        if rid:
            have = {r["user_id"] for r in conn.execute(
                "SELECT user_id FROM member_roles WHERE server_id=? AND role_id=?",
                (ch["server_id"], rid)).fetchall()}
            owner = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                                 (ch["server_id"],)).fetchone()
            if owner:
                have.add(owner["owner_id"])
            have |= {r["user_id"] for r in conn.execute(
                "SELECT user_id FROM channel_members WHERE channel_id=?",
                (ch["id"],)).fetchall()}          # knock-approved members
            ids = [u for u in ids if u in have]
        return ids
    return [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM channel_members WHERE channel_id=?", (ch["id"],)).fetchall()]


def reactions_json(conn, mid, uid):
    rows = conn.execute(
        "SELECT r.emoji, r.user_id, u.display_name FROM message_reactions r "
        "JOIN users u ON u.id=r.user_id WHERE r.message_id=? ORDER BY r.created_at",
        (mid,)).fetchall()
    grouped = {}
    for r in rows:
        g = grouped.setdefault(r["emoji"], {"emoji": r["emoji"], "count": 0, "mine": False, "users": []})
        g["count"] += 1
        g["users"].append(r["display_name"])
        if r["user_id"] == uid:
            g["mine"] = True
    return list(grouped.values())


def pack_agent_ids(conn, pid, uid):
    """Agent ids in a pack that viewer `uid` can actually see."""
    rows = conn.execute(
        "SELECT agent_id FROM pack_items WHERE pack_id=? ORDER BY position, agent_id", (pid,)).fetchall()
    out = []
    for r in rows:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (r["agent_id"],)).fetchone()
        if a and can_see_agent(conn, a, uid):
            out.append(a)
    return out


def can_see_pack(conn, p, uid):
    return p["owner_id"] == uid or p["owner_id"] in friend_ids(conn, uid)


def channel_json(conn, ch, uid=None):
    d = dict(ch)
    try:
        roster = json.loads(d.get("roster") or "[]")
    except Exception:
        roster = []
    out = []
    for aid in roster:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if a and (uid is None or can_see_agent(conn, a, uid)):
            out.append({"id": a["id"], "name": a["name"], "icon": a["icon"],
                        "owner_id": a["owner_id"]})
    d["roster"] = out
    d["locked"] = bool(d.get("role_id")) and uid is not None and \
        uid not in channel_member_ids(conn, ch)
    if d["locked"]:
        d["knocked"] = bool(conn.execute(
            "SELECT 1 FROM channel_knocks WHERE channel_id=? AND user_id=?",
            (d["id"], uid)).fetchone())
    return d


def pack_json(conn, p, uid):
    d = dict(p)
    d["owner"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (p["owner_id"],)).fetchone())
    agents = pack_agent_ids(conn, p["id"], uid)
    d["count"] = len(agents)
    d["icons"] = [a["icon"] for a in agents[:5]]
    return d


def message_json(conn, m, viewer_id=None):
    d = row_to_dict(m)
    d["author"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (m["author_id"],)).fetchone())
    if m["agent_id"]:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (m["agent_id"],)).fetchone()
        d["agent"] = agent_json(conn, a, viewer_id or m["author_id"]) if a else None
    if m["pack_id"]:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (m["pack_id"],)).fetchone()
        d["pack"] = pack_json(conn, p, viewer_id or m["author_id"]) if p else None
    d["thread_count"] = conn.execute(
        "SELECT COUNT(*) c FROM messages WHERE thread_root=?", (m["id"],)).fetchone()["c"]
    if m["reply_to"]:
        r = conn.execute("SELECT * FROM messages WHERE id=?", (m["reply_to"],)).fetchone()
        if r:
            d["reply"] = {"id": r["id"], "content": r["content"][:140],
                          "author": public_user(conn.execute(
                              "SELECT * FROM users WHERE id=?", (r["author_id"],)).fetchone())}
        else:
            d["reply"] = {"id": m["reply_to"], "content": "", "author": None}
    d["reactions"] = reactions_json(conn, m["id"], viewer_id or m["author_id"])
    if "fwd_of" in m.keys() and m["fwd_of"]:
        o = conn.execute("SELECT * FROM messages WHERE id=?", (m["fwd_of"],)).fetchone()
        if o:
            oc = conn.execute("SELECT * FROM channels WHERE id=?", (o["channel_id"],)).fetchone()
            ou = conn.execute("SELECT * FROM users WHERE id=?", (o["author_id"],)).fetchone()
            d["fwd"] = {"msg_id": o["id"], "channel_id": o["channel_id"],
                        "channel": oc["name"] if oc else "?",
                        "server_id": oc["server_id"] if oc else None,
                        "dm": oc["kind"] == "dm" if oc else False,
                        "author": public_user(ou) if ou else None}
        else:
            d["fwd"] = {"msg_id": m["fwd_of"], "channel": "deleted", "author": None}
    if m["embed"]:
        try:
            d["embed"] = json.loads(m["embed"])
        except Exception:
            d["embed"] = None
    if "poll" in m.keys() and m["poll"]:
        try:
            d["poll"] = json.loads(m["poll"])
        except Exception:
            d["poll"] = None
    return d


def _meta_content(html, key):
    """content= value of the <meta> tag whose property/name matches `key`."""
    for tag in re.findall(r"<meta\s[^>]*>", html, re.I):
        if re.search(r'(?:property|name)=["\']%s["\']' % re.escape(key), tag, re.I):
            c = re.search(r'content=["\']([^"\']*)["\']', tag, re.I)
            if c:
                return c.group(1).strip()
    return None


def unfurl(url):
    """Fetch title/description for a public http(s) URL. SSRF-guarded."""
    import html as htmlmod
    import socket
    import urllib.request
    from urllib.parse import urlparse
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            return None
        host = p.hostname.lower().rstrip(".")
        if host == "localhost" or host.endswith((".local", ".internal")):
            return None
        ip = socket.gethostbyname(host)
        o = ip.split(".")
        if ip == "::1" or len(o) == 4 and (
                o[0] in ("127", "10", "0") or
                o[0] == "192" and o[1] == "168" or
                o[0] == "169" and o[1] == "254" or
                o[0] == "172" and 16 <= int(o[1]) <= 31):
            return None
        req = urllib.request.Request(url, headers={"User-Agent": "SignalTeams/1.0 (+unfurl)"})
        with urllib.request.urlopen(req, timeout=5) as r:
            if "html" not in (r.headers.get("content-type") or ""):
                return None
            raw = r.read(300_000).decode("utf-8", "replace")
        title = (_meta_content(raw, "og:title") or
                 (re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S) or [None, ""])[1].strip())
        if not title:
            return None
        clean = lambda s: htmlmod.unescape(re.sub(r"\s+", " ", s or "")).strip()
        return {"url": url[:500], "title": clean(title)[:200],
                "desc": clean(_meta_content(raw, "og:description") or
                              _meta_content(raw, "description") or "")[:300],
                "site": clean(_meta_content(raw, "og:site_name") or "")[:80],
                "image": _meta_content(raw, "og:image")}
    except Exception:
        return None


URL_RE = re.compile(r"https?://[^\s<>'\"]+")


# ---------- schemas ----------

class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    display_name: str = Field(default="", max_length=64)
    password: str = Field(min_length=4, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    display_name: str | None = None
    avatar_emoji: str | None = None
    avatar_color: str | None = None
    bio: str | None = None
    status: str | None = None
    seen_buzz: float | None = None
    muted: list[int] | None = None
    notify_mentions: list[int] | None = None
    server_muted: list[int] | None = None
    server_order: list[int] | None = None
    status_text: str | None = None


class FriendIn(BaseModel):
    username: str


class ServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = "🍯"


class JoinIn(BaseModel):
    invite_code: str


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    kind: str = "text"
    topic: str = ""
    roster: list[int] = []
    category: str = ""
    role_id: int | None = None
    voice_cap: int = 0


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    agent_id: int | None = None
    pack_id: int | None = None
    reply_to: int | None = None
    thread_root: int | None = None
    fwd_of: int | None = None
    attachments: list[dict] = []
    poll: dict | None = None     # {q, options:[str..]} — votes live in message_reactions


class PackIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = Field(default="📦", max_length=8)
    description: str = Field(default="", max_length=400)
    agent_ids: list[int] = []


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = "🤖"
    tagline: str = ""
    description: str = ""
    system_prompt: str = ""
    model: str = ""
    temperature: float | None = None         # NULL → provider default (0.7)
    context_url: str = ""                    # fetched before each reply → grounding
    context_method: str = "GET"
    context_headers: str | None = None
    api_kind: str = ""                       # "" | openai | anthropic | ollama | webhook
    api_url: str = ""
    api_key: str | None = None               # None keeps stored key; "" clears
    api_headers: str | None = None
    tags: list[str] = []
    version: str = "1.0.0"
    visibility: str = "friends"


# ---------- auth ----------

@app.post("/api/register")
def register(body: RegisterIn):
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (body.username,)).fetchone():
            raise HTTPException(409, "Username taken")
        i = secrets.randbelow(len(AVATAR_COLORS))
        cur = conn.execute(
            "INSERT INTO users(username, display_name, avatar_color, avatar_emoji, password_hash, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (body.username, body.display_name or body.username,
             AVATAR_COLORS[i], AVATAR_EMOJIS[i], hash_password(body.password), now()),
        )
        uid = cur.lastrowid
        token = create_session(conn, uid)
        user = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return {"token": token, "user": public_user(user)}


@app.post("/api/login")
def login(body: LoginIn):
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not u or not verify_password(body.password, u["password_hash"]):
            raise HTTPException(401, "Bad username or password")
        token = create_session(conn, u["id"])
        conn.execute("UPDATE users SET status='online' WHERE id=?", (u["id"],))
        return {"token": token, "user": public_user(u)}


# ---------- auth: supabase ----------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON = os.environ.get("SUPABASE_ANON_KEY", "")


@app.get("/api/auth/config")
def auth_config():
    """Public auth-providers config so the login page knows what to offer.
    The anon key is a public client key — safe to expose to the browser."""
    return {"supabase": bool(SUPABASE_URL and SUPABASE_ANON),
            "supabase_url": SUPABASE_URL or None,
            "supabase_anon": SUPABASE_ANON or None}


class SupabaseIn(BaseModel):
    access_token: str = Field(min_length=10)


def _supabase_user(access_token: str) -> dict:
    """Verify a Supabase access token by calling the auth server's /user
    endpoint — works for legacy HS256 and asymmetric JWTs alike."""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"Authorization": f"Bearer {access_token}",
                 "apikey": SUPABASE_ANON})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError:
        raise HTTPException(401, "Supabase rejected that token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "Couldn't reach Supabase")


def _slug_username(base: str, taken) -> str:
    s = re.sub(r"[^a-z0-9_]+", "", (base or "").lower())[:24] or "crew"
    if len(s) < 2:
        s = (s + "crew")[:24]
    cand, i = s, 1
    while taken(cand):
        i += 1
        cand = f"{s}{i}"
    return cand


@app.post("/api/auth/supabase")
def supabase_login(body: SupabaseIn):
    """Exchange a verified Supabase access token for a local session.
    Finds-or-creates the local user keyed on users.supabase_uid (email as the
    link-back for accounts created before Supabase was enabled)."""
    if not (SUPABASE_URL and SUPABASE_ANON):
        raise HTTPException(400, "Supabase auth isn't configured on this server")
    su = _supabase_user(body.access_token)
    sub = su.get("id")
    if not sub:
        raise HTTPException(401, "Supabase rejected that token")
    email = (su.get("email") or "").strip().lower() or None
    meta = su.get("user_metadata") or {}
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE supabase_uid=?", (sub,)).fetchone()
        if not u and email:
            u = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if u:
                conn.execute("UPDATE users SET supabase_uid=? WHERE id=?", (sub, u["id"]))
        if not u:
            uname = _slug_username(
                meta.get("username") or meta.get("preferred_username")
                or (email or "crew").split("@")[0],
                lambda c: conn.execute(
                    "SELECT 1 FROM users WHERE username=?", (c,)).fetchone())
            i = secrets.randbelow(len(AVATAR_COLORS))
            cur = conn.execute(
                "INSERT INTO users(username, display_name, avatar_color, avatar_emoji, "
                "password_hash, email, supabase_uid, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (uname, meta.get("display_name") or meta.get("full_name") or uname,
                 AVATAR_COLORS[i], AVATAR_EMOJIS[i], "!supabase", email, sub, now()))
            u = conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
        elif email and not u["email"]:
            conn.execute("UPDATE users SET email=? WHERE id=?", (email, u["id"]))
        token = create_session(conn, u["id"])
        conn.execute("UPDATE users SET status='online' WHERE id=?", (u["id"],))
        u = conn.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
        return {"token": token, "user": public_user(u)}


@app.post("/api/logout")
def logout(user=Depends(current_user), request=None):
    from fastapi import Request
    with db() as conn:
        conn.execute("UPDATE users SET status='offline' WHERE id=?", (user["id"],))
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    d = public_user(user)
    d["has_password"] = (user.get("password_hash") or "").startswith("pbkdf2")
    d["supabase_linked"] = bool(user.get("supabase_uid"))
    if user.get("email"):
        d["email"] = user["email"]
    return d


class PasswordIn(BaseModel):
    current: str = ""
    next: str = Field(min_length=4, max_length=128)
    kick_others: bool = True


@app.post("/api/me/password")
def change_password(body: PasswordIn, request: Request, user=Depends(current_user)):
    """Set or change the crew password. Passwordless accounts (Supabase-only)
    may set one without a current password — everyone else must prove it.
    Other sessions are revoked by default."""
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        has_pw = (u["password_hash"] or "").startswith("pbkdf2")
        if has_pw and not verify_password(body.current, u["password_hash"]):
            raise HTTPException(403, "Current password is wrong")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?",
                     (hash_password(body.next), u["id"]))
        if body.kick_others:
            conn.execute("DELETE FROM sessions WHERE user_id=? AND token<>?",
                         (u["id"], get_token(request)))
        return {"ok": True}


@app.post("/api/me/signout-others")
def signout_others(request: Request, user=Depends(current_user)):
    """Revoke every session except the caller's — the 'signed in somewhere
    else' escape hatch."""
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token<>?",
                     (user["id"], get_token(request)))
        return {"ok": True}


@app.get("/api/me/export")
def export_me(user=Depends(current_user)):
    """Download-my-data: everything you authored plus your social graph, as a
    JSON attachment. Messages are scoped to what you wrote — never other
    people's content."""
    uid = user["id"]
    with db() as conn:
        msgs = conn.execute(
            "SELECT m.id, m.content, m.created_at, m.edited_at, m.attachments, "
            "m.poll, m.reply_to, m.thread_root, m.pinned, "
            "c.name AS cname, c.kind AS ckind, s.name AS sname "
            "FROM messages m JOIN channels c ON c.id=m.channel_id "
            "LEFT JOIN servers s ON s.id=c.server_id "
            "WHERE m.author_id=? ORDER BY m.id", (uid,)).fetchall()
        # dm labels — resolve "who else was in it" per dm channel
        out_msgs = []
        for m in msgs:
            where = f"{m['sname']} #{m['cname']}" if m["sname"] else None
            if where is None:
                others = conn.execute(
                    "SELECT u.display_name FROM channel_members cm "
                    "JOIN users u ON u.id=cm.user_id "
                    "WHERE cm.channel_id=(SELECT channel_id FROM messages WHERE id=?)"
                    " AND u.id<>?", (m["id"], uid)).fetchall()
                names = ", ".join(o["display_name"] for o in others) or m["cname"] or "?"
                where = ("Group DM: " if len(others) > 1 else "DM: ") + names
            atts = json.loads(m["attachments"] or "[]")
            out_msgs.append({
                "id": m["id"], "where": where, "content": m["content"],
                "ts": m["created_at"], "edited_ts": m["edited_at"],
                "attachments": [a.get("name") for a in atts],
                "pinned": bool(m["pinned"]),
                "reply_to": m["reply_to"], "thread_root": m["thread_root"],
                "poll": json.loads(m["poll"]) if m["poll"] else None})
        friends = {"accepted": [], "outgoing": [], "incoming": []}
        for f in conn.execute("SELECT * FROM friendships WHERE user_id=? OR friend_id=?",
                              (uid, uid)).fetchall():
            other_id = f["friend_id"] if f["user_id"] == uid else f["user_id"]
            other = conn.execute("SELECT username FROM users WHERE id=?",
                                 (other_id,)).fetchone()
            if not other:
                continue
            if f["status"] == "accepted":
                friends["accepted"].append(other["username"])
            elif f["user_id"] == uid:
                friends["outgoing"].append(other["username"])
            else:
                friends["incoming"].append(other["username"])
        agents = []
        for a in conn.execute("SELECT * FROM agents WHERE owner_id=?", (uid,)).fetchall():
            agents.append({k: a[k] for k in
                           ("name", "icon", "tagline", "description", "system_prompt",
                            "model", "temperature", "version", "visibility", "forked_from",
                            "downloads", "created_at", "updated_at")})
            agents[-1]["tags"] = json.loads(a["tags"] or "[]")
        servers = []
        for sm in conn.execute(
                "SELECT s.name, s.icon, sm.role, sm.joined_at FROM server_members sm "
                "JOIN servers s ON s.id=sm.server_id WHERE sm.user_id=?", (uid,)).fetchall():
            servers.append({"name": sm["name"], "icon": sm["icon"],
                            "role": sm["role"], "joined_at": sm["joined_at"]})
        saved = [row_to_dict(s) for s in conn.execute(
            "SELECT s.created_at, m.content, m.channel_id FROM saved s "
            "JOIN messages m ON m.id=s.message_id WHERE s.user_id=? ORDER BY s.id DESC",
            (uid,)).fetchall()]
        blocks = [r["username"] for r in conn.execute(
            "SELECT u.username FROM blocks b JOIN users u ON u.id=b.blocked_id "
            "WHERE b.user_id=?", (uid,)).fetchall()]
        me_row = {k: user[k] for k in
                  ("username", "display_name", "bio", "avatar_emoji", "avatar_color",
                   "status", "created_at") if k in user.keys()}
        me_row["email"] = user["email"] if "email" in user.keys() else None
        me_row["supabase_linked"] = bool(user["supabase_uid"]) if "supabase_uid" in user.keys() else False
    payload = {
        "app": "signalteams", "exported_at": time.time(), "user": me_row,
        "servers": servers, "friends": friends, "agents": agents,
        "saved": saved, "blocks": blocks, "messages": out_msgs,
        "counts": {"messages": len(out_msgs), "agents": len(agents),
                   "friends": len(friends["accepted"]), "saved": len(saved)}}
    return Response(
        json.dumps(payload, ensure_ascii=False, indent=1),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="signalteams-export.json"'})


@app.patch("/api/me")
def update_me(body: ProfileIn, user=Depends(current_user)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "muted" in fields:
        fields["muted"] = json.dumps(fields["muted"][:50])
    if "notify_mentions" in fields:
        fields["notify_mentions"] = json.dumps(fields["notify_mentions"][:50])
    if "server_muted" in fields:
        fields["server_muted"] = json.dumps(fields["server_muted"][:50])
    if "server_order" in fields:
        with db() as conn:
            mine = {r["server_id"] for r in conn.execute(
                "SELECT server_id FROM server_members WHERE user_id=?",
                (user["id"],)).fetchall()}
        fields["server_order"] = json.dumps(
            [sid for sid in fields["server_order"][:50] if sid in mine])
    if fields:
        sql = ", ".join(f"{k}=?" for k in fields)
        with db() as conn:
            conn.execute(f"UPDATE users SET {sql} WHERE id=?", (*fields.values(), user["id"]))
    with db() as conn:
        return public_user(conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())


@app.get("/api/people")
def people(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM users WHERE id != ? ORDER BY username", (user["id"],)).fetchall()
        return [public_user(r) for r in rows]


@app.get("/api/users/{uid}/profile")
def profile(uid: int, user=Depends(current_user)):
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            raise HTTPException(404, "No such user")
        d = {"user": public_user(u)}
        if u["username"].startswith("agent:"):
            slug = u["username"].split(":", 1)[1]
            a = next((r for r in conn.execute("SELECT * FROM agents").fetchall()
                      if re.sub(r"[^a-z0-9]+", "", r["name"].lower()) == slug), None)
            d["is_bot"] = True
            d["agent"] = agent_json(conn, a, user["id"]) if a and can_see_agent(conn, a, user["id"]) else None
            return d
        fr = conn.execute(
            "SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
            (user["id"], uid, uid, user["id"])).fetchone()
        d["friend"] = ({"status": fr["status"], "id": fr["id"],
                        "direction": "out" if fr["user_id"] == user["id"] else "in"}
                       if fr else None)
        d["agents"] = [agent_json(conn, a, user["id"]) for a in conn.execute(
            "SELECT * FROM agents WHERE owner_id=? ORDER BY id DESC", (uid,)).fetchall()
            if can_see_agent(conn, a, user["id"])]
        return d


# ---------- friends ----------

@app.get("/api/friends")
def friends(user=Depends(current_user)):
    with db() as conn:
        uid = user["id"]
        out = {"accepted": [], "incoming": [], "outgoing": []}
        rows = conn.execute(
            "SELECT * FROM friendships WHERE user_id=? OR friend_id=?", (uid, uid)).fetchall()
        for r in rows:
            other_id = r["friend_id"] if r["user_id"] == uid else r["user_id"]
            other = public_user(conn.execute("SELECT * FROM users WHERE id=?", (other_id,)).fetchone())
            other["friendship_id"] = r["id"]
            if r["status"] == "accepted":
                out["accepted"].append(other)
            elif r["user_id"] == uid:
                out["outgoing"].append(other)
            else:
                out["incoming"].append(other)
        return out


@app.post("/api/friends")
def add_friend(body: FriendIn, user=Depends(current_user)):
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not target:
            raise HTTPException(404, "No such user")
        if target["id"] == user["id"]:
            raise HTTPException(400, "That's you")
        if is_blocked(conn, user["id"], target["id"]):
            raise HTTPException(403, "Blocked — unblock them first")
        existing = conn.execute(
            "SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
            (user["id"], target["id"], target["id"], user["id"])).fetchone()
        if existing:
            if existing["status"] == "pending" and existing["friend_id"] == user["id"]:
                conn.execute("UPDATE friendships SET status='accepted' WHERE id=?", (existing["id"],))
                emit_buzz(conn, user["id"], "friended", {"with": target["username"]})
                return {"status": "accepted"}
            raise HTTPException(409, "Already friends or pending")
        conn.execute(
            "INSERT INTO friendships(user_id, friend_id, status, created_at) VALUES (?,?,?,?)",
            (user["id"], target["id"], "pending", now()))
        return {"status": "pending"}


def is_blocked(conn, a: int, b: int):
    """True if either user has the other blocked."""
    return bool(conn.execute(
        "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
        (a, b, b, a)).fetchone())


@app.get("/api/blocks")
def my_blocks(user=Depends(current_user)):
    with db() as conn:
        return [r["blocked_id"] for r in conn.execute(
            "SELECT blocked_id FROM blocks WHERE user_id=?", (user["id"],)).fetchall()]


@app.post("/api/blocks/{uid}")
def toggle_block(uid: int, user=Depends(current_user)):
    if uid == user["id"]:
        raise HTTPException(400, "Can't block yourself")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "No such user")
        have = conn.execute("SELECT id FROM blocks WHERE user_id=? AND blocked_id=?",
                            (user["id"], uid)).fetchone()
        if have:
            conn.execute("DELETE FROM blocks WHERE id=?", (have["id"],))
            return {"blocked": False}
        conn.execute("INSERT INTO blocks(user_id, blocked_id, created_at) VALUES (?,?,?)",
                     (user["id"], uid, now()))
        # blocking severs the friendship + any pending requests, Discord-style
        conn.execute(
            "DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
            (user["id"], uid, uid, user["id"]))
        return {"blocked": True}


@app.post("/api/friends/{friendship_id}/accept")
def accept_friend(friendship_id: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM friendships WHERE id=?", (friendship_id,)).fetchone()
        if not r or r["friend_id"] != user["id"]:
            raise HTTPException(404, "No such request")
        conn.execute("UPDATE friendships SET status='accepted' WHERE id=?", (friendship_id,))
        return {"status": "accepted"}


@app.delete("/api/friends/{friendship_id}")
def remove_friend(friendship_id: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM friendships WHERE id=?", (friendship_id,)).fetchone()
        if not r or user["id"] not in (r["user_id"], r["friend_id"]):
            raise HTTPException(404, "No such friendship")
        conn.execute("DELETE FROM friendships WHERE id=?", (friendship_id,))
        return {"ok": True}


# ---------- servers & channels ----------

@app.get("/api/servers")
def my_servers(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT s.* FROM servers s JOIN server_members m ON m.server_id=s.id "
            "WHERE m.user_id=? ORDER BY s.id", (user["id"],)).fetchall()
        try:
            order = {sid: i for i, sid in enumerate(
                json.loads(user["server_order"] or "[]"))}
        except Exception:
            order = {}
        if order:
            rows.sort(key=lambda r: (order.get(r["id"], 1 << 20), r["id"]))
        return [_pub_server(dict(r)) for r in rows]


@app.post("/api/servers")
def create_server(body: ServerIn, user=Depends(current_user)):
    with db() as conn:
        code = secrets.token_urlsafe(6)
        cur = conn.execute(
            "INSERT INTO servers(name, icon, invite_code, owner_id, created_at) VALUES (?,?,?,?,?)",
            (body.name, body.icon, code, user["id"], now()))
        sid = cur.lastrowid
        conn.execute(
            "INSERT INTO server_members(server_id, user_id, role, joined_at) VALUES (?,?,?,?)",
            (sid, user["id"], "owner", now()))
        conn.execute(
            "INSERT INTO channels(server_id, kind, name, topic, position, created_at) VALUES "
            "(?,?,?,?,?,?), (?,?,?,?,?,?)",
            (sid, "text", "general", "Whatever's on your mind", 0, now(),
             sid, "agents", "agent-drops", "Fresh agent shares land here", 1, now()))
        emit_buzz(conn, user["id"], "joined", {"server": body.name})
        return _pub_server(dict(conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))


@app.get("/api/invite/{code}")
def invite_info(code: str):
    """Public invite preview — a join link shows this before signup."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE invite_code=?", (code,)).fetchone()
        if not s:
            raise HTTPException(404, "Bad invite code")
        n = conn.execute("SELECT COUNT(*) c FROM server_members WHERE server_id=?",
                         (s["id"],)).fetchone()["c"]
        return {"name": s["name"], "icon": s["icon"], "members": n}


@app.post("/api/servers/join")
def join_server(body: JoinIn, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE invite_code=?", (body.invite_code,)).fetchone()
        if not s:
            raise HTTPException(404, "Bad invite code")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (s["id"], user["id"])).fetchone():
            conn.execute(
                "INSERT INTO server_members(server_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (s["id"], user["id"], "member", now()))
            emit_buzz(conn, user["id"], "joined", {"server": s["name"]})
        return dict(s)


class ServerPatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    icon_file: str | None = None               # file id → uploaded icon; "" clears
    star_threshold: int | None = None          # 0 disables the starboard
    llm_url: str | None = None                 # "" clears the shared endpoint
    llm_key: str | None = None                 # write-only — never serialized back
    llm_model: str | None = None
    llm_kind: str | None = None


@app.patch("/api/servers/{sid}")
async def edit_server(sid: int, body: ServerPatch, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        conn.execute("UPDATE servers SET name=?, icon=? WHERE id=?",
                     ((body.name or s["name"]).strip() or s["name"],
                      body.icon or s["icon"], sid))
        if body.star_threshold is not None:
            conn.execute("UPDATE servers SET star_threshold=? WHERE id=?",
                         (max(0, min(20, body.star_threshold)), sid))
        if body.icon_file is not None:
            if body.icon_file and not conn.execute(
                    "SELECT 1 FROM files WHERE id=? AND mime LIKE 'image/%'",
                    (body.icon_file,)).fetchone():
                raise HTTPException(400, "icon must be an uploaded image")
            conn.execute("UPDATE servers SET icon_file=? WHERE id=?",
                         (body.icon_file or None, sid))
        if body.llm_url is not None:
            conn.execute("UPDATE servers SET llm_url=? WHERE id=?",
                         (body.llm_url.rstrip("/") or None, sid))
        if body.llm_key is not None:
            conn.execute("UPDATE servers SET llm_key=? WHERE id=?",
                         (body.llm_key or None, sid))
        if body.llm_model is not None:
            conn.execute("UPDATE servers SET llm_model=? WHERE id=?",
                         (body.llm_model or None, sid))
        if body.llm_kind is not None:
            conn.execute("UPDATE servers SET llm_kind=? WHERE id=?",
                         (body.llm_kind in ("openai", "webhook") and body.llm_kind or "openai", sid))
        out = _pub_server(dict(conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))
    with db() as conn:
        await _server_changed(conn, sid)
    return out


@app.post("/api/servers/{sid}/invite")
async def regen_invite(sid: int, user=Depends(current_user)):
    """Rotate the invite code — old code stops working."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        conn.execute("UPDATE servers SET invite_code=? WHERE id=?",
                     (secrets.token_urlsafe(6), sid))
        out = _pub_server(dict(conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))
    with db() as conn:
        await _server_changed(conn, sid)
    return out


@app.delete("/api/servers/{sid}")
async def delete_server(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?", (sid,)).fetchall()]
        conn.execute("DELETE FROM servers WHERE id=?", (sid,))
    await hub.send_many(members, {"type": "server_deleted", "server_id": sid})
    return {"ok": True}


@app.post("/api/servers/{sid}/leave")
async def leave_server(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s:
            raise HTTPException(404, "No such server")
        if s["owner_id"] == user["id"]:
            raise HTTPException(400, "Owners can't leave — delete the server or hand it off")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(404, "Not a member")
        conn.execute("DELETE FROM server_members WHERE server_id=? AND user_id=?",
                     (sid, user["id"]))
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


@app.delete("/api/servers/{sid}/members/{uid}")
async def kick_member(sid: int, uid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can kick")
        if uid == s["owner_id"]:
            raise HTTPException(400, "Can't kick the owner")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, uid)).fetchone():
            raise HTTPException(404, "Not a member")
        conn.execute("DELETE FROM server_members WHERE server_id=? AND user_id=?",
                     (sid, uid))
    await hub.send_many([uid], {"type": "server_left", "server_id": sid})
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


class NickIn(BaseModel):
    nickname: str = Field(default="", max_length=48)


@app.post("/api/servers/{sid}/nick")
async def set_nick(sid: int, body: NickIn, user=Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(404, "Not a member")
        conn.execute("UPDATE server_members SET nickname=? WHERE server_id=? AND user_id=?",
                     (body.nickname.strip()[:48], sid, user["id"]))
    with db() as conn:
        await _server_changed(conn, sid)
        return {"nickname": body.nickname.strip()[:48]}


class TransferIn(BaseModel):
    user_id: int


@app.post("/api/servers/{sid}/transfer")
async def transfer_server(sid: int, body: TransferIn, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can hand off")
        if body.user_id == user["id"]:
            raise HTTPException(400, "You already own it")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, body.user_id)).fetchone():
            raise HTTPException(404, "Not a member")
        conn.execute("UPDATE servers SET owner_id=? WHERE id=?", (body.user_id, sid))
    with db() as conn:
        await _server_changed(conn, sid)
        return {"ok": True, "owner_id": body.user_id}


@app.get("/api/servers/{sid}")
def get_server(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or not conn.execute(
                "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                (sid, user["id"])).fetchone():
            raise HTTPException(404, "No such server")
        d = _pub_server(dict(s))
        d["channels"] = [channel_json(conn, r, user["id"]) for r in conn.execute(
            "SELECT * FROM channels WHERE server_id=? ORDER BY position, id", (sid,)).fetchall()]
        d["members"] = [
            {**public_user(r), "nickname": r["nickname"],
             "role_ids": [x["role_id"] for x in conn.execute(
                 "SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?",
                 (sid, r["id"])).fetchall()]}
            for r in conn.execute(
                "SELECT u.*, m.nickname FROM users u JOIN server_members m ON m.user_id=u.id "
                "WHERE m.server_id=? ORDER BY u.username", (sid,)).fetchall()]
        d["emojis"] = [dict(r) for r in conn.execute(
            "SELECT id, name, file_id, uploader FROM emojis WHERE server_id=? ORDER BY name",
            (sid,)).fetchall()]
        d["roles"] = [dict(r) for r in conn.execute(
            "SELECT id, name, color FROM server_roles WHERE server_id=? ORDER BY id",
            (sid,)).fetchall()]
        return d


@app.get("/api/servers/{sid}/pulse")
def server_pulse(sid: int, user=Depends(current_user)):
    """Last-7-days activity digest — powers the 📈 server pulse card."""
    with db() as conn:
        if not conn.execute(
                "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                (sid, user["id"])).fetchone():
            raise HTTPException(404, "No such server")
        since = now() - 7 * 86400
        today0 = int(now() // 86400) * 86400
        msgs = conn.execute(
            "SELECT m.id, m.author_id, m.channel_id, m.content, m.created_at, "
            "u.username, u.display_name FROM messages m "
            "JOIN channels c ON c.id=m.channel_id JOIN users u ON u.id=m.author_id "
            "WHERE c.server_id=? AND m.created_at>=?", (sid, since)).fetchall()
        days = [0] * 7
        posters, agents = {}, {}
        human_msgs = 0
        for m in msgs:
            un = m["username"] or ""
            if un.startswith("bot:"):
                continue                                  # system noise (starboard, reminders)
            i = int((m["created_at"] - (today0 - 6 * 86400)) // 86400)
            if 0 <= i < 7:
                days[i] += 1
            if un.startswith("agent:"):
                agents[m["display_name"]] = agents.get(m["display_name"], 0) + 1
            else:
                human_msgs += 1
                key = (m["display_name"] or un, un)
                posters[key] = posters.get(key, 0) + 1
        top_poster = max(posters.items(), key=lambda kv: kv[1], default=None)
        top_agent = max(agents.items(), key=lambda kv: kv[1], default=None)
        top_msg = conn.execute(
            "SELECT m.id, m.channel_id, m.content, COUNT(r.user_id) rc FROM messages m "
            "JOIN channels c ON c.id=m.channel_id "
            "JOIN message_reactions r ON r.message_id=m.id "
            "WHERE c.server_id=? AND m.created_at>=? "
            "GROUP BY m.id ORDER BY rc DESC, m.id DESC LIMIT 1", (sid, since)).fetchone()
        new_members = conn.execute(
            "SELECT COUNT(*) c FROM server_members WHERE server_id=? AND joined_at>=?",
            (sid, since)).fetchone()["c"]
        active = len({m["author_id"] for m in msgs
                      if not (m["username"] or "").startswith(("agent:", "bot:"))})
        return {
            "days": days, "today0": today0,
            "total": len(msgs), "human_msgs": human_msgs,
            "active_members": active, "new_members": new_members,
            "top_poster": top_poster and {
                "name": top_poster[0][0], "username": top_poster[0][1],
                "count": top_poster[1]},
            "top_agent": top_agent and {"name": top_agent[0], "count": top_agent[1]},
            "top_agents": [{"name": n, "count": c} for n, c in
                           sorted(agents.items(), key=lambda kv: -kv[1])][:5],
            "top_message": top_msg and {
                "id": top_msg["id"], "channel_id": top_msg["channel_id"],
                "excerpt": (top_msg["content"] or "")[:120],
                "reactions": top_msg["rc"]},
        }


# ---------- server roles ----------

ROLE_COLORS = ["#e8b339", "#f2644c", "#4cc2f2", "#7ce87c", "#c084fc",
               "#f278b6", "#8f9aa8", "#5eead4"]


class RoleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=24)
    color: str = "#e8b339"


@app.post("/api/servers/{sid}/roles")
async def add_role(sid: int, body: RoleIn, user=Depends(current_user)):
    color = body.color.strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise HTTPException(400, "Color must be #rrggbb")
    with db() as conn:
        s = conn.execute("SELECT owner_id FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner manages roles")
        if conn.execute("SELECT COUNT(*) c FROM server_roles WHERE server_id=?",
                        (sid,)).fetchone()["c"] >= 20:
            raise HTTPException(400, "20 roles max")
        try:
            cur = conn.execute(
                "INSERT INTO server_roles(server_id, name, color, created_at) VALUES (?,?,?,?)",
                (sid, body.name.strip(), color.lower(), now()))
        except Exception:
            raise HTTPException(409, "A role with that name already exists")
        rid = cur.lastrowid
    with db() as conn:
        await _server_changed(conn, sid)
    return {"id": rid, "name": body.name.strip(), "color": color.lower()}


@app.delete("/api/roles/{rid}")
async def del_role(rid: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM server_roles WHERE id=?", (rid,)).fetchone()
        if not r:
            raise HTTPException(404, "No such role")
        s = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                         (r["server_id"],)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner manages roles")
        sid = r["server_id"]
        conn.execute("DELETE FROM server_roles WHERE id=?", (rid,))
    with db() as conn:
        await _server_changed(conn, sid)
    return {"deleted": rid}


class MemberRoleIn(BaseModel):
    role_id: int


@app.post("/api/servers/{sid}/members/{uid}/roles")
async def toggle_member_role(sid: int, uid: int, body: MemberRoleIn,
                             user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT owner_id FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner assigns roles")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, uid)).fetchone():
            raise HTTPException(404, "Not a member")
        if not conn.execute("SELECT 1 FROM server_roles WHERE id=? AND server_id=?",
                            (body.role_id, sid)).fetchone():
            raise HTTPException(404, "No such role")
        has = conn.execute(
            "SELECT 1 FROM member_roles WHERE server_id=? AND user_id=? AND role_id=?",
            (sid, uid, body.role_id)).fetchone()
        if has:
            conn.execute(
                "DELETE FROM member_roles WHERE server_id=? AND user_id=? AND role_id=?",
                (sid, uid, body.role_id))
            on = False
        else:
            conn.execute(
                "INSERT INTO member_roles(server_id, user_id, role_id) VALUES (?,?,?)",
                (sid, uid, body.role_id))
            on = True
    with db() as conn:
        await _server_changed(conn, sid)
    return {"role_id": body.role_id, "on": on}


@app.post("/api/servers/{sid}/channels")
def add_channel(sid: int, body: ChannelIn, user=Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(403, "Not a member")
        pos = conn.execute("SELECT COALESCE(MAX(position),0)+1 p FROM channels WHERE server_id=?",
                           (sid,)).fetchone()["p"]
        roster = [aid for aid in body.roster[:10] if conn.execute(
            "SELECT 1 FROM agents WHERE id=?", (aid,)).fetchone()]
        if body.role_id and not conn.execute(
                "SELECT 1 FROM server_roles WHERE id=? AND server_id=?",
                (body.role_id, sid)).fetchone():
            raise HTTPException(404, "No such role")
        cur = conn.execute(
            "INSERT INTO channels(server_id, kind, name, topic, position, roster, category, role_id, voice_cap, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (sid, body.kind, body.name.lstrip("#"), body.topic, pos,
             json.dumps(roster), body.category[:48], body.role_id or None,
             max(0, min(int(body.voice_cap or 0), 99)), now()))
        return channel_json(conn, conn.execute(
            "SELECT * FROM channels WHERE id=?", (cur.lastrowid,)).fetchone(), user["id"])


class ChannelPatch(BaseModel):
    name: str | None = None
    topic: str | None = None
    roster: list[int] | None = None
    category: str | None = None
    slowmode_secs: int | None = None
    voice_cap: int | None = None  # absent = unchanged · 0 = unlimited voice occupancy
    role_id: int | None = None    # absent = unchanged · 0 = open to all · N = gate to role


async def _server_changed(conn, sid):
    members = [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM server_members WHERE server_id=?", (sid,)).fetchall()]
    await hub.send_many(members, {"type": "server_changed", "server_id": sid})


@app.patch("/api/channels/{cid}")
async def edit_channel(cid: int, body: ChannelPatch, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute(
            "SELECT c.*, s.owner_id so FROM channels c JOIN servers s ON s.id=c.server_id "
            "WHERE c.id=?", (cid,)).fetchone()
        if not ch or ch["so"] != user["id"]:
            raise HTTPException(404, "No such channel")
        name = (body.name or ch["name"]).lstrip("#").strip() or ch["name"]
        topic = ch["topic"] if body.topic is None else body.topic
        cat = ch["category"] if body.category is None else body.category[:48]
        conn.execute("UPDATE channels SET name=?, topic=?, category=? WHERE id=?",
                     (name, topic, cat, cid))
        if body.slowmode_secs is not None:
            conn.execute("UPDATE channels SET slowmode_secs=? WHERE id=?",
                         (max(0, min(int(body.slowmode_secs), 21600)), cid))
        if body.voice_cap is not None:
            conn.execute("UPDATE channels SET voice_cap=? WHERE id=?",
                         (max(0, min(int(body.voice_cap), 99)), cid))
        if body.roster is not None:
            roster = [aid for aid in body.roster[:10] if conn.execute(
                "SELECT 1 FROM agents WHERE id=?", (aid,)).fetchone()]
            conn.execute("UPDATE channels SET roster=? WHERE id=?",
                         (json.dumps(roster), cid))
        if body.role_id is not None:
            if body.role_id and not conn.execute(
                    "SELECT 1 FROM server_roles WHERE id=? AND server_id=?",
                    (body.role_id, ch["server_id"])).fetchone():
                raise HTTPException(404, "No such role")
            conn.execute("UPDATE channels SET role_id=? WHERE id=?",
                         (body.role_id or None, cid))
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
        return channel_json(conn, conn.execute(
            "SELECT * FROM channels WHERE id=?", (cid,)).fetchone(), user["id"])


@app.post("/api/servers/{sid}/channels/order")
async def reorder_channels(sid: int, body: dict, user=Depends(current_user)):
    """Owner submits the full channel id list in display order."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        ids = [int(x) for x in (body.get("order") or [])]
        cur = {r["id"] for r in conn.execute(
            "SELECT id FROM channels WHERE server_id=?", (sid,)).fetchall()}
        if set(ids) != cur or len(ids) != len(cur):
            raise HTTPException(400, "order must list every channel id exactly once")
        for i, cid in enumerate(ids):
            conn.execute("UPDATE channels SET position=? WHERE id=?", (i, cid))
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


@app.delete("/api/channels/{cid}")
async def del_channel(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute(
            "SELECT c.*, s.owner_id so FROM channels c JOIN servers s ON s.id=c.server_id "
            "WHERE c.id=?", (cid,)).fetchone()
        if not ch or ch["so"] != user["id"]:
            raise HTTPException(404, "No such channel")
        left = conn.execute("SELECT COUNT(*) c FROM channels WHERE server_id=?",
                            (ch["server_id"],)).fetchone()["c"]
        if left <= 1:
            raise HTTPException(400, "A server needs at least one channel")
        conn.execute("DELETE FROM channels WHERE id=?", (cid,))
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


# ---------- DMs ----------

@app.get("/api/dms")
def my_dms(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id=c.id "
            "WHERE c.kind='dm' AND m.user_id=? ORDER BY c.id DESC", (user["id"],)).fetchall()
        out = []
        for ch in rows:
            memb = [public_user(u) for u in conn.execute(
                "SELECT u.* FROM users u JOIN channel_members m ON m.user_id=u.id "
                "WHERE m.channel_id=? AND u.id != ?", (ch["id"], user["id"])).fetchall()]
            last = conn.execute(
                "SELECT content, created_at FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT 1",
                (ch["id"],)).fetchone()
            d = {"id": ch["id"], "kind": "dm",
                 "name": ch["name"] if ch["name"] != "dm" else "",
                 "other": memb[0] if len(memb) == 1 else None,
                 "members": memb,
                 "last": dict(last) if last else None,
                 "reads": {r["user_id"]: r["last_read"] for r in conn.execute(
                     "SELECT user_id, last_read FROM channel_members WHERE channel_id=?",
                     (ch["id"],)).fetchall()}}
            out.append(d)
        return out


class GroupDmIn(BaseModel):
    user_ids: list[int]
    name: str = ""


@app.post("/api/dms/group")
def group_dm(body: GroupDmIn, user=Depends(current_user)):
    ids = sorted(set(int(x) for x in body.user_ids) | {user["id"]})
    if len(ids) < 3:
        raise HTTPException(400, "A group needs 3+ people")
    if len(ids) > 9:
        raise HTTPException(400, "Groups are capped at 9 people")
    with db() as conn:
        for uid in ids:
            if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
                raise HTTPException(404, "No such user")
            if uid != user["id"] and is_blocked(conn, user["id"], uid):
                raise HTTPException(403, "Blocked — unblock them first")
        for ch in conn.execute("SELECT * FROM channels WHERE kind='dm'").fetchall():
            have = sorted(r["user_id"] for r in conn.execute(
                "SELECT user_id FROM channel_members WHERE channel_id=?", (ch["id"],)).fetchall())
            if have == ids:
                return {"id": ch["id"]}
        cur = conn.execute(
            "INSERT INTO channels(server_id, kind, name, created_at) VALUES (NULL,'dm',?,?)",
            (body.name[:48], now()))
        cid = cur.lastrowid
        for uid in ids:
            conn.execute("INSERT INTO channel_members(channel_id, user_id) VALUES (?,?)",
                         (cid, uid))
        return {"id": cid}


@app.post("/api/dms/{cid}/add")
def add_to_group_dm(cid: int, body: GroupDmIn, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=? AND kind='dm'", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such DM")
        members = {r["user_id"] for r in conn.execute(
            "SELECT user_id FROM channel_members WHERE channel_id=?", (cid,)).fetchall()}
        if user["id"] not in members:
            raise HTTPException(403, "Not a member")
        new_ids = set(int(x) for x in body.user_ids) - members
        if not new_ids:
            return {"id": cid, "added": 0}
        if len(members) + len(new_ids) > 9:
            raise HTTPException(400, "Groups are capped at 9 people")
        for uid in new_ids:
            if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
                raise HTTPException(404, "No such user")
            if is_blocked(conn, user["id"], uid):
                raise HTTPException(403, "Blocked — unblock them first")
            conn.execute("INSERT INTO channel_members(channel_id, user_id) VALUES (?,?)", (cid, uid))
        return {"id": cid, "added": len(new_ids)}


class AgentDmAddIn(BaseModel):
    agent_id: int


@app.post("/api/dms/{cid}/add-agent")
async def add_agent_to_dm(cid: int, body: AgentDmAddIn, user=Depends(current_user)):
    """Pull an agent's bot user into a DM/group — it answers @-mentions like
    anywhere else. Agents don't count toward the 9-human cap; 3 per group."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=? AND kind='dm'", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such DM")
        members = {r["user_id"] for r in conn.execute(
            "SELECT user_id FROM channel_members WHERE channel_id=?", (cid,)).fetchall()}
        if user["id"] not in members:
            raise HTTPException(403, "Not a member")
        a = conn.execute("SELECT * FROM agents WHERE id=?", (body.agent_id,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        bot = agent_bot_user(conn, a)
        if bot["id"] in members:
            return {"id": cid, "added": 0}
        n_agents = conn.execute(
            "SELECT COUNT(*) n FROM channel_members cm JOIN users u ON u.id=cm.user_id "
            "WHERE cm.channel_id=? AND u.username LIKE 'agent:%'", (cid,)).fetchone()["n"]
        if n_agents >= 3:
            raise HTTPException(400, "3 agents per group is plenty")
        conn.execute("INSERT INTO channel_members(channel_id, user_id) VALUES (?,?)",
                     (cid, bot["id"]))
        member_ids = list(members) + [bot["id"]]
    await bot_post(cid, "bot:system", "System", "📡",
                   f"✦ {user['display_name']} added **{a['name']}** to the group")
    await hub.send_many(member_ids, {"type": "buzz"})
    return {"id": cid, "added": 1}


class DmRenameIn(BaseModel):
    name: str


@app.patch("/api/dms/{cid}")
def rename_group_dm(cid: int, body: DmRenameIn, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=? AND kind='dm'", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such DM")
        if not conn.execute(
                "SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?",
                (cid, user["id"])).fetchone():
            raise HTTPException(403, "Not a member")
        conn.execute("UPDATE channels SET name=? WHERE id=?", (body.name[:48], cid))
        return {"id": cid, "name": body.name[:48]}


@app.post("/api/dms/{cid}/leave")
def leave_group_dm(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=? AND kind='dm'", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such DM")
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM channel_members WHERE channel_id=?", (cid,)).fetchall()]
        if user["id"] not in members:
            raise HTTPException(403, "Not a member")
        if len(members) <= 2:
            raise HTTPException(400, "Only group DMs can be left")
        conn.execute("DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
                     (cid, user["id"]))
        if len(members) - 1 == 0:
            conn.execute("DELETE FROM messages WHERE channel_id=?", (cid,))
            conn.execute("DELETE FROM channels WHERE id=?", (cid,))
        return {"id": cid, "left": True}


@app.post("/api/dms/{other_id}")
def open_dm(other_id: int, user=Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (other_id,)).fetchone():
            raise HTTPException(404, "No such user")
        row = conn.execute(
            "SELECT c.* FROM channels c JOIN channel_members a ON a.channel_id=c.id AND a.user_id=? "
            "JOIN channel_members b ON b.channel_id=c.id AND b.user_id=? WHERE c.kind='dm' "
            "AND (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id=c.id)=2",
            (user["id"], other_id)).fetchone()
        if row:
            return {"id": row["id"]}
        if is_blocked(conn, user["id"], other_id):
            raise HTTPException(403, "Blocked — unblock them first")
        cur = conn.execute(
            "INSERT INTO channels(server_id, kind, name, created_at) VALUES (NULL,'dm','dm',?)", (now(),))
        cid = cur.lastrowid
        conn.execute("INSERT INTO channel_members(channel_id, user_id) VALUES (?,?), (?,?)",
                     (cid, user["id"], cid, other_id))
        return {"id": cid}


@app.post("/api/agents/{aid}/dm")
def open_agent_dm(aid: int, user=Depends(current_user)):
    """1:1 DM with an agent's bot user — every message auto-summons it."""
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        other = agent_bot_user(conn, a)
        row = conn.execute(
            "SELECT c.* FROM channels c JOIN channel_members x ON x.channel_id=c.id AND x.user_id=? "
            "JOIN channel_members y ON y.channel_id=c.id AND y.user_id=? WHERE c.kind='dm' "
            "AND (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id=c.id)=2",
            (user["id"], other["id"])).fetchone()
        if row:
            return {"id": row["id"]}
        cur = conn.execute(
            "INSERT INTO channels(server_id, kind, name, created_at) VALUES (NULL,'dm','dm',?)", (now(),))
        cid = cur.lastrowid
        conn.execute("INSERT INTO channel_members(channel_id, user_id) VALUES (?,?), (?,?)",
                     (cid, user["id"], cid, other["id"]))
        return {"id": cid}


# ---------- messages ----------

@app.get("/api/channels/{cid}/messages")
def get_messages(cid: int, before: int = Query(0), limit: int = Query(50, le=100),
                 user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        q = "SELECT * FROM messages WHERE channel_id=? AND thread_root IS NULL"
        args = [cid]
        if before:
            q += " AND id<?"
            args.append(before)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        rows = conn.execute(q, args).fetchall()
        return [message_json(conn, m, user["id"]) for m in reversed(rows)]


@app.post("/api/channels/{cid}/read")
async def mark_read(cid: int, user=Depends(current_user)):
    """Read-receipt stamp — channel_members only exists for DMs, so this is
    naturally DM-scoped: server channels update zero rows."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        t = now()
        conn.execute(
            "UPDATE channel_members SET last_read=? WHERE channel_id=? AND user_id=?",
            (t, cid, user["id"]))
        memb = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM channel_members WHERE channel_id=?", (cid,)).fetchall()]
    if memb:   # DMs only — echo to the reader's other tabs too
        await hub.send_many(memb, {"type": "read", "channel_id": cid,
                                   "user_id": user["id"], "ts": t})
    return {"read": t}


@app.post("/api/me/read-all")
async def read_all(user=Depends(current_user)):
    """Mark every DM read at once (server-channel unread is client-side)."""
    t = now()
    with db() as conn:
        conn.execute("UPDATE channel_members SET last_read=? WHERE user_id=?",
                     (t, user["id"]))
        memb = [r["channel_id"] for r in conn.execute(
            "SELECT channel_id FROM channel_members WHERE user_id=?",
            (user["id"],)).fetchall()]
    for cid in memb:   # echo to other tabs
        await hub.send(user["id"], {"type": "read", "channel_id": cid,
                                    "user_id": user["id"], "ts": t})
    return {"read": t, "channels": len(memb)}


@app.post("/api/channels/{cid}/mark-unread")
async def mark_unread(cid: int, body: dict, user=Depends(current_user)):
    """Rewind last_read to just before a message — Discord's 'mark unread'.
    DM-scoped like mark_read (server channels keep read state client-side)."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        m = conn.execute("SELECT * FROM messages WHERE id=? AND channel_id=?",
                         (int(body.get("message_id") or 0), cid)).fetchone()
        if not m:
            raise HTTPException(404, "No such message")
        t = m["created_at"] - 0.0001
        conn.execute(
            "UPDATE channel_members SET last_read=? WHERE channel_id=? AND user_id=?",
            (t, cid, user["id"]))
        memb = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM channel_members WHERE channel_id=?", (cid,)).fetchall()]
    if memb:
        await hub.send_many(memb, {"type": "read", "channel_id": cid,
                                   "user_id": user["id"], "ts": t})
    return {"read": t}


@app.post("/api/channels/{cid}/messages")
async def post_message(cid: int, body: MessageIn, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        if ch["kind"] == "dm":
            others = [r["user_id"] for r in conn.execute(
                "SELECT user_id FROM channel_members WHERE channel_id=? AND user_id != ?",
                (cid, user["id"])).fetchall()]
            if len(others) == 1 and is_blocked(conn, user["id"], others[0]):
                raise HTTPException(403, "Blocked — this DM is closed")
        if ch["slowmode_secs"] > 0:
            owner = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                                 (ch["server_id"],)).fetchone()
            if not owner or owner["owner_id"] != user["id"]:
                last = conn.execute(
                    "SELECT created_at FROM messages WHERE channel_id=? AND author_id=? "
                    "ORDER BY id DESC LIMIT 1", (cid, user["id"])).fetchone()
                left = ch["slowmode_secs"] - (now() - (last["created_at"] if last else 0))
                if last and left > 0:
                    raise HTTPException(429, f"Slowmode — {int(left) + 1}s left")
        if body.agent_id:
            a = conn.execute("SELECT * FROM agents WHERE id=?", (body.agent_id,)).fetchone()
            if not a or not can_see_agent(conn, a, user["id"]):
                raise HTTPException(404, "No such agent")
        if body.pack_id:
            p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (body.pack_id,)).fetchone()
            if not p or not can_see_pack(conn, p, user["id"]):
                raise HTTPException(404, "No such pack")
        if body.reply_to:
            rm = conn.execute("SELECT * FROM messages WHERE id=?", (body.reply_to,)).fetchone()
            if not rm or rm["channel_id"] != cid:
                raise HTTPException(404, "No such message")
        if body.thread_root:
            tr = conn.execute("SELECT * FROM messages WHERE id=?", (body.thread_root,)).fetchone()
            if not tr or tr["channel_id"] != cid or tr["thread_root"]:
                raise HTTPException(404, "No such thread")
        poll = None
        if body.poll:
            q = str(body.poll.get("q", "")).strip()[:200]
            opts = [str(o).strip()[:80] for o in (body.poll.get("options") or [])]
            opts = [o for o in opts if o][:9]
            if q and len(opts) >= 2:
                poll = {"q": q, "options": opts}
            else:
                raise HTTPException(400, "Polls need a question and 2+ options")
        if not body.content.strip() and not body.agent_id and not body.pack_id and not body.attachments:
            raise HTTPException(400, "Empty message")
        atts = [{"id": f["id"], "name": str(f.get("name", "file"))[:120],
                 "mime": str(f.get("mime", "application/octet-stream"))[:80],
                 "size": int(f.get("size", 0))} for f in body.attachments[:4]
                if conn.execute("SELECT 1 FROM files WHERE id=?", (f.get("id"),)).fetchone()]
        if body.fwd_of:
            om = conn.execute("SELECT * FROM messages WHERE id=?", (body.fwd_of,)).fetchone()
            och = om and conn.execute(
                "SELECT * FROM channels WHERE id=?", (om["channel_id"],)).fetchone()
            if (not om or not och or om["channel_id"] == cid or
                    user["id"] not in channel_member_ids(conn, och)):
                raise HTTPException(400, "Can't forward that message")
        u = URL_RE.search(body.content)
        jm = u and re.search(r"#/s/(\d+)/c/(\d+)/m/(\d+)", u.group(0))
        if jm:
            tm = conn.execute("SELECT * FROM messages WHERE id=?", (int(jm[3]),)).fetchone()
            tch = tm and conn.execute(
                "SELECT * FROM channels WHERE id=?", (tm["channel_id"],)).fetchone()
            embed = (tm and tch and user["id"] in channel_member_ids(conn, tch)
                     and {"type": "jump", "sid": int(jm[1]), "cid": int(jm[2]),
                          "mid": int(jm[3])} or None)
        else:
            embed = await asyncio.to_thread(unfurl, u.group(0)) if u else None
        cur = conn.execute(
            "INSERT INTO messages(channel_id, author_id, content, agent_id, pack_id, reply_to, "
            "thread_root, attachments, embed, fwd_of, poll, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (cid, user["id"], body.content.strip(), body.agent_id, body.pack_id, body.reply_to,
             body.thread_root, json.dumps(atts),
             json.dumps(embed) if embed else None, body.fwd_of,
             json.dumps(poll) if poll else None, now()))
        m = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
        payload = {"type": "message", "channel_id": cid,
                   "message": message_json(conn, m, user["id"])}
        members = channel_member_ids(conn, ch)
        # @username mentions → buzz event ping for each mentioned member
        names = {n.lower() for n in re.findall(r"@(\w+)", body.content)}
        pinged = []
        hit_agents = []
        if names:
            rows = conn.execute(
                "SELECT id, username FROM users WHERE id IN (%s)" %
                ",".join("?" * len(members)), members).fetchall()
            ok_mention = lambda uid: (uid != user["id"]
                                      and not is_blocked(conn, uid, user["id"]))
            pinged = [r["id"] for r in rows
                      if r["username"].lower() in names and ok_mention(r["id"])]
            if "everyone" in names:
                pinged += [r["id"] for r in rows
                           if ok_mention(r["id"]) and r["id"] not in pinged]
            elif "here" in names:
                online = set(hub.online_ids())
                pinged += [r["id"] for r in rows
                           if r["id"] in online and ok_mention(r["id"])
                           and r["id"] not in pinged]
            # @role mentions — slug-matched role names ping every holder
            role_slugs = {}
            if ch["server_id"]:
                for r in conn.execute(
                        "SELECT id, name FROM server_roles WHERE server_id=?",
                        (ch["server_id"],)).fetchall():
                    role_slugs[re.sub(r"[^a-z0-9]+", "", r["name"].lower())] = r["id"]
                hit_rids = {role_slugs[s] for s in
                            {re.sub(r"[^a-z0-9]+", "", n) for n in names}
                            & set(role_slugs)}
                if hit_rids:
                    holders = conn.execute(
                        "SELECT DISTINCT user_id FROM member_roles "
                        "WHERE server_id=? AND role_id IN (%s)" %
                        ",".join("?" * len(hit_rids)),
                        (ch["server_id"], *hit_rids)).fetchall()
                    mset = set(members)
                    pinged += [h["user_id"] for h in holders
                               if h["user_id"] in mset and ok_mention(h["user_id"])
                               and h["user_id"] not in pinged]
            for uid in pinged:
                emit_buzz(conn, user["id"], "mentioned", {
                    "to": uid, "channel_id": cid, "server_id": ch["server_id"],
                    "channel": ch["name"], "msg_id": m["id"],
                    "excerpt": body.content.strip()[:100]})
            # leftover @tokens may be agent names — those agents reply in-channel
            cand = {re.sub(r"[^a-z0-9]+", "", n) for n in names} - {
                r["username"].lower() for r in rows} - {"", "everyone", "here"} \
                - set(role_slugs)
            if cand:
                # dedupe by slug — same-named agents (e.g. an unrenamed fork) are
                # one bot identity; prefer the asker's own copy
                seen = {}
                for a in conn.execute("SELECT * FROM agents ORDER BY id").fetchall():
                    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())
                    if slug in cand and can_see_agent(conn, a, user["id"]):
                        if slug not in seen or a["owner_id"] == user["id"]:
                            seen[slug] = a
                hit_agents = [dict(a) for a in seen.values()]
        # agent DMs — the resident agent answers every human message, no @ needed
        if ch["kind"] == "dm" and not (user["username"] or "").startswith(("agent:", "bot:")):
            other = conn.execute(
                "SELECT u.username FROM channel_members cm JOIN users u ON u.id=cm.user_id "
                "WHERE cm.channel_id=? AND cm.user_id<>? "
                "AND (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id=?)=2 "
                "LIMIT 1", (cid, user["id"], cid)).fetchone()
            if other and (other["username"] or "").startswith("agent:"):
                want = other["username"][6:]
                for a in conn.execute("SELECT * FROM agents ORDER BY id").fetchall():
                    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24]
                    if slug == want and can_see_agent(conn, a, user["id"]):
                        if all(x["id"] != a["id"] for x in hit_agents):
                            hit_agents.append(dict(a))
                        break
    payload["mentions"] = pinged
    await hub.send_many(members, payload)
    for uid in pinged:
        await hub.send_many([uid], {"type": "buzz"})
    for a in hit_agents[:2]:
        key = (a["id"], cid)
        if time.time() - _agent_cool.get(key, 0) < 8:
            continue
        _agent_cool[key] = time.time()
        asyncio.create_task(agent_reply(cid, a["id"], user["id"], m["id"]))
    return payload["message"]


_agent_cool = {}


def agent_bot_user(conn, a):
    """Get-or-create the synthetic chat user that posts as this agent."""
    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
    uname = f"agent:{slug}"
    u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    if not u:
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, avatar_color, "
            "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uname, a["name"], "!", "#d4af37", a["icon"] or "🤖",
             (a["tagline"] or "")[:160], "bot", now()))
        u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    else:
        conn.execute(
            "UPDATE users SET display_name=?, avatar_emoji=?, bio=? WHERE id=?",
            (a["name"], a["icon"] or "🤖", (a["tagline"] or "")[:160], u["id"]))
        u = conn.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    return u


STAR_EMOJI = "⭐"


def starboard_bot_user(conn):
    """Get-or-create the synthetic user that authors starboard reposts."""
    u = conn.execute("SELECT * FROM users WHERE username='bot:starboard'").fetchone()
    if not u:
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, avatar_color, "
            "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            ("bot:starboard", "Starboard", "!", "#d4af37", "⭐",
             "Reposts messages the crew starred.", "bot", now()))
        u = conn.execute("SELECT * FROM users WHERE username='bot:starboard'").fetchone()
    return u


async def starboard_check(mid: int):
    """After a ⭐ reaction toggles, maintain the server's #starboard repost:
    create at threshold, live-update the count, delete at zero."""
    sends = []
    server_changed = None
    try:
        with db() as conn:
            m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            if not m:
                return
            ch = conn.execute("SELECT * FROM channels WHERE id=?",
                              (m["channel_id"],)).fetchone()
            if not ch or not ch["server_id"]:
                return                                     # no starboard in DMs
            s = conn.execute("SELECT * FROM servers WHERE id=?",
                             (ch["server_id"],)).fetchone()
            thresh = s["star_threshold"] or 0
            if not thresh or ch["id"] == s["starboard_cid"]:
                return                                     # disabled, or board posts don't re-board
            stars = conn.execute(
                "SELECT COUNT(*) c FROM message_reactions WHERE message_id=? AND emoji=?",
                (mid, STAR_EMOJI)).fetchone()["c"]
            row = conn.execute(
                "SELECT * FROM starboard_posts WHERE src_msg_id=?", (mid,)).fetchone()
            bcid = s["starboard_cid"]
            bch = bcid and conn.execute(
                "SELECT * FROM channels WHERE id=?", (bcid,)).fetchone()
            members = channel_member_ids(conn, bch) if bch else []
            if stars >= thresh and not row:
                if not bch:                                # find-or-create the board channel
                    cur = conn.execute(
                        "INSERT INTO channels(server_id, kind, name, topic, position, created_at) "
                        "VALUES (?,?,?,?,?,?)",
                        (s["id"], "text", "starboard",
                         f"⭐ hall of fame — {thresh}+ stars land here", 90, now()))
                    bcid = cur.lastrowid
                    conn.execute("UPDATE servers SET starboard_cid=? WHERE id=?",
                                 (bcid, s["id"]))
                    bch = conn.execute("SELECT * FROM channels WHERE id=?", (bcid,)).fetchone()
                    members = channel_member_ids(conn, bch)
                    server_changed = s["id"]
                bot = starboard_bot_user(conn)
                cur = conn.execute(
                    "INSERT INTO messages(channel_id, author_id, content, fwd_of, created_at) "
                    "VALUES (?,?,?,?,?)",
                    (bcid, bot["id"], f"{STAR_EMOJI} **{stars}**", mid, now()))
                conn.execute(
                    "INSERT INTO starboard_posts(src_msg_id, board_msg_id, stars) "
                    "VALUES (?,?,?)", (mid, cur.lastrowid, stars))
                bm = conn.execute("SELECT * FROM messages WHERE id=?",
                                  (cur.lastrowid,)).fetchone()
                sends.append((members, {"type": "message", "channel_id": bcid,
                                        "message": message_json(conn, bm, bot["id"])}))
            elif row and stars == 0:
                conn.execute("DELETE FROM starboard_posts WHERE src_msg_id=?", (mid,))
                conn.execute("DELETE FROM messages WHERE id=?", (row["board_msg_id"],))
                sends.append((members, {"type": "message_deleted", "channel_id": bcid,
                                        "id": row["board_msg_id"]}))
            elif row and stars != row["stars"]:
                conn.execute("UPDATE starboard_posts SET stars=? WHERE src_msg_id=?", (stars, mid))
                conn.execute("UPDATE messages SET content=? WHERE id=?",
                             (f"{STAR_EMOJI} **{stars}**", row["board_msg_id"]))
                bm = conn.execute("SELECT * FROM messages WHERE id=?",
                                  (row["board_msg_id"],)).fetchone()
                sends.append((members, {"type": "message_updated", "channel_id": bcid,
                                        "message": message_json(conn, bm, bm["author_id"])}))
    except Exception:
        return
    for members, payload in sends:
        await hub.send_many(members, payload)
    if server_changed:
        with db() as conn:
            await _server_changed(conn, server_changed)


async def bot_post(cid: int, bot_key: str, bot_name: str, bot_emoji: str,
                   content: str, ping_uid: int | None = None):
    """Post a message as a synthetic bot user, broadcast it, and optionally
    route a real mention ping (inbox/buzz/badge) to ping_uid."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            return None
        u = conn.execute("SELECT * FROM users WHERE username=?", (bot_key,)).fetchone()
        if not u:
            conn.execute(
                "INSERT INTO users(username, display_name, password_hash, avatar_color, "
                "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (bot_key, bot_name, "!", "#d4af37", bot_emoji,
                 "A SignalTeams helper bot.", "bot", now()))
            u = conn.execute("SELECT * FROM users WHERE username=?", (bot_key,)).fetchone()
        cur = conn.execute(
            "INSERT INTO messages(channel_id, author_id, content, created_at) "
            "VALUES (?,?,?,?)", (cid, u["id"], content, now()))
        m = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
        members = channel_member_ids(conn, ch)
        mentions = []
        if ping_uid and ping_uid in members:
            mentions = [ping_uid]
            emit_buzz(conn, u["id"], "mentioned", {
                "to": ping_uid, "channel_id": cid, "server_id": ch["server_id"],
                "channel": ch["name"], "msg_id": m["id"], "excerpt": content[:100]})
        payload = {"type": "message", "channel_id": cid,
                   "message": message_json(conn, m, u["id"]), "mentions": mentions}
    await hub.send_many(members, payload)
    for uid in mentions:
        await hub.send_many([uid], {"type": "buzz"})
    return m["id"]


# ---------- scribe ----------

class SummarizeIn(BaseModel):
    count: int = Field(default=25, ge=5, le=100)


SCRIBE_BOT = ("bot:scribe", "Scribe", "📝")


@app.post("/api/channels/{cid}/summarize")
async def summarize(cid: int, body: SummarizeIn, user=Depends(current_user)):
    """Queue a Scribe recap of the channel's recent messages. The reply posts
    via WS like an agent reply — the endpoint just validates and returns."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
    asyncio.create_task(_summarize_task(cid, user["id"], body.count))
    return {"queued": body.count}


class KnockIn(BaseModel):
    approve: bool = True


def _gated_channel(conn, cid):
    ch = conn.execute("SELECT * FROM channels WHERE id=? AND role_id IS NOT NULL",
                      (cid,)).fetchone()
    return ch


@app.post("/api/channels/{cid}/knock")
async def knock_channel(cid: int, user=Depends(current_user)):
    """Ask the insiders of a role-gated channel to let you in."""
    with db() as conn:
        ch = _gated_channel(conn, cid)
        if not ch or not ch["server_id"]:
            raise HTTPException(404, "No gated channel")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (ch["server_id"], user["id"])).fetchone():
            raise HTTPException(403, "Not a server member")
        insiders = channel_member_ids(conn, ch)
        if user["id"] in insiders:
            raise HTTPException(400, "You already have access")
        dup = conn.execute("SELECT 1 FROM channel_knocks WHERE channel_id=? AND user_id=?",
                           (cid, user["id"])).fetchone()
        if not dup:
            conn.execute("INSERT INTO channel_knocks(channel_id, user_id, created_at) "
                         "VALUES (?,?,?)", (cid, user["id"], now()))
    if not dup:
        await bot_post(cid, "bot:system", "System", "📡",
                       f"🚪 **{user['display_name']}** is knocking — someone with access can let them in")
        await hub.send_many(insiders, {"type": "buzz"})
    return {"knocked": True}


@app.get("/api/channels/{cid}/knocks")
def list_knocks(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        rows = conn.execute(
            "SELECT u.*, k.created_at knocked_at FROM channel_knocks k "
            "JOIN users u ON u.id=k.user_id WHERE k.channel_id=? ORDER BY k.created_at",
            (cid,)).fetchall()
        return [{"user": public_user(r), "knocked_at": r["knocked_at"]} for r in rows]


@app.post("/api/channels/{cid}/knocks/{uid}")
async def resolve_knock(cid: int, uid: int, body: KnockIn, user=Depends(current_user)):
    """Insider approves (channel_members grant) or denies a pending knock."""
    with db() as conn:
        ch = _gated_channel(conn, cid)
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No gated channel")
        k = conn.execute("SELECT 1 FROM channel_knocks WHERE channel_id=? AND user_id=?",
                         (cid, uid)).fetchone()
        if not k:
            raise HTTPException(404, "No pending knock")
        knocker = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        conn.execute("DELETE FROM channel_knocks WHERE channel_id=? AND user_id=?", (cid, uid))
        if body.approve:
            conn.execute("INSERT OR IGNORE INTO channel_members(channel_id, user_id) "
                         "VALUES (?,?)", (cid, uid))
    if body.approve:
        await bot_post(cid, "bot:system", "System", "📡",
                       f"🚪 {user['display_name']} let **{knocker['display_name']}** in")
    await hub.send_many([uid], {"type": "buzz"})
    return {"approved": body.approve}


async def _summarize_task(cid: int, asker_id: int, count: int):
    from .llm import chat as llm_chat
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        asker = conn.execute("SELECT * FROM users WHERE id=?", (asker_id,)).fetchone()
        rows = conn.execute(
            "SELECT m.content, u.display_name dn, u.username un FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE m.channel_id=? "
            "AND m.thread_root IS NULL ORDER BY m.id DESC LIMIT ?",
            (cid, count)).fetchall()
        bot_u = conn.execute(
            "SELECT * FROM users WHERE username=?", (SCRIBE_BOT[0],)).fetchone()
        if not bot_u:
            conn.execute(
                "INSERT INTO users(username, display_name, password_hash, avatar_color, "
                "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (SCRIBE_BOT[0], SCRIBE_BOT[1], "!", "#d4af37", SCRIBE_BOT[2],
                 "Recaps conversations on request.", "bot", now()))
            bot_u = conn.execute(
                "SELECT * FROM users WHERE username=?", (SCRIBE_BOT[0],)).fetchone()
        members = channel_member_ids(conn, ch)
    if not ch or not asker:
        return
    history = [{"role": "user", "content": f"{r['dn'] or r['un']}: {r['content']}"}
               for r in reversed(rows)
               if not (r["un"] or "").startswith("bot:")]
    if len(history) < 3:
        await bot_post(cid, *SCRIBE_BOT,
                       f"@{asker['username']} 📝 not enough here to recap — "
                       "make some conversation first.", ping_uid=asker_id)
        return
    typing = {"type": "typing", "channel_id": cid,
              "user": {"id": bot_u["id"], "display_name": SCRIBE_BOT[1]}}
    await hub.send_many(members, {**typing, "on": True})
    try:
        summary, _prov, _model = await asyncio.to_thread(
            llm_chat,
            "You are Scribe, a chat recapper. Summarize the conversation into "
            "3-6 tight bullets: decisions, plans, who's doing what, open "
            "questions. Be terse, specific, and keep names.",
            history[:-1],
            f"Summarize these {len(history)} messages from #{ch['name']}.")
    except Exception:
        summary = "my brain's offline — no local LLM reachable right now"
    finally:
        await hub.send_many(members, {**typing, "on": False})
    await bot_post(
        cid, *SCRIBE_BOT,
        f"@{asker['username']} 📝 **recap — last {len(history)} messages**\n{summary[:3000]}",
        ping_uid=asker_id)


# ---------- reminders ----------

class ReminderIn(BaseModel):
    channel_id: int
    seconds: int = Field(ge=10, le=604800)               # 10s … 7d
    text: str = Field(min_length=1, max_length=200)


REMIND_BOT = ("bot:reminders", "Reminders", "⏰")


def _fmt_due(secs: int) -> str:
    for unit, div in (("d", 86400), ("h", 3600), ("m", 60)):
        if secs % div == 0 and secs >= div:
            return f"{secs // div}{unit}"
    return f"{secs}s"


@app.post("/api/reminders")
async def add_reminder(body: ReminderIn, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?",
                          (body.channel_id,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        if conn.execute(
                "SELECT COUNT(*) c FROM reminders WHERE user_id=? AND fired=0",
                (user["id"],)).fetchone()["c"] >= 25:
            raise HTTPException(400, "25 pending reminders max")
        due = now() + body.seconds
        cur = conn.execute(
            "INSERT INTO reminders(user_id, channel_id, text, due_at, created_at) "
            "VALUES (?,?,?,?,?)",
            (user["id"], body.channel_id, body.text.strip()[:200], due, now()))
        rid = cur.lastrowid
    await bot_post(body.channel_id, *REMIND_BOT,
                   f"⏰ got it — **{body.text.strip()[:80]}** in {_fmt_due(body.seconds)}.")
    return {"id": rid, "due_at": due}


@app.get("/api/reminders")
def my_reminders(user=Depends(current_user)):
    with db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT r.*, c.name channel_name FROM reminders r "
            "JOIN channels c ON c.id=r.channel_id "
            "WHERE r.user_id=? AND r.fired=0 ORDER BY r.due_at",
            (user["id"],)).fetchall()]


@app.delete("/api/reminders/{rid}")
def del_reminder(rid: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM reminders WHERE id=?", (rid,)).fetchone()
        if not r or r["user_id"] != user["id"]:
            raise HTTPException(404, "No such reminder")
        conn.execute("DELETE FROM reminders WHERE id=?", (rid,))
        return {"ok": True}


async def reminder_loop():
    """Poll for due reminders and deliver them as bot posts that @ping the user."""
    while True:
        await asyncio.sleep(10)
        try:
            with db() as conn:
                due = conn.execute(
                    "SELECT * FROM reminders WHERE fired=0 AND due_at<=?",
                    (now(),)).fetchall()
                for r in due:
                    conn.execute("UPDATE reminders SET fired=1 WHERE id=?", (r["id"],))
            for r in due:
                with db() as conn:
                    u = conn.execute("SELECT * FROM users WHERE id=?",
                                     (r["user_id"],)).fetchone()
                if u:
                    await bot_post(r["channel_id"], *REMIND_BOT,
                                   f"@{u['username']} ⏰ {r['text']}",
                                   ping_uid=r["user_id"])
        except Exception:
            pass


@app.on_event("startup")
async def _start_reminder_loop():
    asyncio.create_task(reminder_loop())


async def agent_reply(cid, aid, asker_id, msg_id, depth=0):
    """Generate a reply from an agent @mentioned in chat and post it in-channel.
    Bot replies may themselves @mention other agents — those get summoned too,
    bounded by depth (max 3 hops) + per-agent cooldown so convos can't runaway."""
    import asyncio, queue, threading
    from .llm import chat_stream as llm_stream
    try:
        with db() as conn:
            ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
            a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
            msg = conn.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
            asker = conn.execute("SELECT * FROM users WHERE id=?", (asker_id,)).fetchone()
            if not ch or not a or not msg or not asker:
                return
            bot = agent_bot_user(conn, a)
            members = channel_member_ids(conn, ch)
            asker_llm = _agent_llm(a) \
                or (_server_llm(conn, ch["server_id"]) if ch["server_id"] else None) \
                or _user_llm(conn, asker_id)   # agent's own API connection wins, then server, then asker
            root = msg["thread_root"]          # summoned inside a thread → stay there
            if root:
                hist = conn.execute(
                    "SELECT m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? AND (m.thread_root=? OR m.id=?) "
                    "ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id, root, root)).fetchall()
            else:
                hist = conn.execute(
                    "SELECT m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id)).fetchall()
            history = [{"role": "user",
                        "content": f"{r['dn'] or r['un']}: {r['content']}"}
                       for r in reversed(hist)]
        typing = {"type": "typing", "channel_id": cid,
                  "user": {"id": bot["id"], "display_name": a["name"]}}
        await hub.send_many(members, {**typing, "on": True})
        prefix = f"@{asker['username']} "
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO messages(channel_id, author_id, content, reply_to, thread_root, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (cid, bot["id"], prefix + "▌", msg_id, root, now()))
            mid = cur.lastrowid
            m2 = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            seed = {"type": "message", "channel_id": cid,
                    "message": message_json(conn, m2, asker_id)}
        await hub.send_many(members, seed)

        ground_ctx = (await asyncio.to_thread(
            _grounding, a["context_url"],
            a["context_method"] if "context_method" in a.keys() else "GET",
            history[-1]["content"] if history else "",
            a["context_headers"] if "context_headers" in a.keys() else None)) \
            if a["context_url"] else ""
        q = queue.Queue()
        def _pump():
            try:
                for kind, data in llm_stream(
                        _sysprompt(a, ground_ctx),
                        history[:-1],
                        history[-1]["content"],
                        model=_split_model(a["model"])[1],
                        provider=_split_model(a["model"])[0],
                        temperature=a["temperature"],
                        endpoint=asker_llm):
                    if kind == "token":
                        q.put(data)
            except Exception:
                q.put("")
            finally:
                q.put("")
        threading.Thread(target=_pump, daemon=True).start()

        reply, done, errored = "", False, False
        while not done:
            await asyncio.sleep(0.6)
            buf = []
            while True:
                try:
                    item = q.get_nowait()
                except queue.Empty:
                    break
                if item == "":
                    done = True
                elif item == "":
                    errored, done = True, True
                else:
                    buf.append(item)
            if buf and not errored:
                reply += "".join(buf)
                with db() as conn:
                    conn.execute("UPDATE messages SET content=? WHERE id=?",
                                 (prefix + reply[:3600] + "▌", mid))
                    mj = message_json(conn, conn.execute(
                        "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), asker_id)
                await hub.send_many(members, {
                    "type": "message_updated", "channel_id": cid, "message": mj})
        await hub.send_many(members, {**typing, "on": False})
        if errored or not reply:
            reply = "hmm, my brain's offline — no local LLM reachable right now"
        text = prefix + reply[:3600]
        with db() as conn:
            conn.execute("UPDATE messages SET content=? WHERE id=?", (text, mid))
            m2 = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            payload = {"type": "message_updated", "channel_id": cid,
                       "message": message_json(conn, m2, asker_id)}
            emit_buzz(conn, bot["id"], "mentioned", {
                "to": asker_id, "channel_id": cid, "server_id": ch["server_id"],
                "channel": ch["name"], "msg_id": m2["id"], "excerpt": text[:100]})
            # feed event so the agent's owner's friends see it working
            emit_buzz(conn, bot["id"], "answered", {
                "name": a["name"], "asker": asker["display_name"] or asker["username"],
                "channel": ch["name"], "channel_id": cid, "server_id": ch["server_id"],
                "owner_id": a["owner_id"]})
            buzz_ids = set(friend_ids(conn, asker_id)) | {asker_id, a["owner_id"]}
        await hub.send_many(members, payload)
        await hub.send_many(list(buzz_ids), {"type": "buzz"})
        # agent→agent: a bot reply that @names other agents summons them too
        if depth < 3:
            with db() as conn:
                cand = {re.sub(r"[^a-z0-9]+", "", n)
                        for n in re.findall(r"@(\w+)", text)} - {""}
                nxt = [a2["id"] for a2 in
                       conn.execute("SELECT * FROM agents ORDER BY id").fetchall()
                       if a2["id"] != aid and
                       re.sub(r"[^a-z0-9]+", "", a2["name"].lower()) in cand and
                       can_see_agent(conn, a2, asker_id)]
            for naid in nxt[:2]:
                k = (naid, cid)
                if time.time() - _agent_cool.get(k, 0) >= 8:
                    _agent_cool[k] = time.time()
                    asyncio.create_task(
                        agent_reply(cid, naid, asker_id, m2["id"], depth + 1))
    except Exception:
        pass


@app.post("/api/channels/{cid}/huddle")
async def huddle(cid: int, user=Depends(current_user)):
    """Summon every resident agent of a channel — they answer in sequence."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such channel")
        members = channel_member_ids(conn, ch)
        if user["id"] not in members:
            raise HTTPException(403, "Not a member")
        roster = json.loads(ch["roster"] or "[]") if "roster" in ch.keys() else []
        last = conn.execute("SELECT id FROM messages WHERE channel_id=? "
                            "ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
        if not last:
            raise HTTPException(400, "No messages yet — say something first")
        visible = {a["id"] for a in conn.execute("SELECT * FROM agents").fetchall()
                   if can_see_agent(conn, a, user["id"])}
    summoned = []
    for i, aid in enumerate([a for a in roster if a in visible]):
        k = (aid, cid)
        if time.time() - _agent_cool.get(k, 0) < 8:
            continue
        _agent_cool[k] = time.time()
        summoned.append(aid)
        async def delayed(a=aid, d=i * 1.5):
            await asyncio.sleep(d)
            await agent_reply(cid, a, user["id"], last["id"])
        asyncio.create_task(delayed())
    return {"summoned": summoned}


# ---------- agents ----------

@app.get("/api/agents")
def list_agents(q: str = "", tag: str = "", sort: str = "new", mine: int = 0,
                user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY id DESC").fetchall()
        agents = [agent_json(conn, a, user["id"]) for a in rows if can_see_agent(conn, a, user["id"])]
        if mine:
            agents = [a for a in agents if a["owner_id"] == user["id"]]
        if q:
            ql = q.lower()
            agents = [a for a in agents if ql in (a["name"] + a["tagline"] + a["description"]).lower()
                      or any(ql in t.lower() for t in a["tags"])]
        if tag:
            agents = [a for a in agents if tag.lower() in [t.lower() for t in a["tags"]]]
        if sort == "stars":
            agents.sort(key=lambda a: (-a["stars"], -a["id"]))
        elif sort == "installs":
            agents.sort(key=lambda a: (-a["installs"], -a["id"]))
        elif sort == "summons":
            agents.sort(key=lambda a: (-a["summons"], -a["id"]))
        elif sort == "name":
            agents.sort(key=lambda a: a["name"].lower())
        return agents


@app.get("/api/agents/trending")
def trending_agents(user=Depends(current_user)):
    """What the crew actually uses: replies + stars + installs in the last 7d."""
    cutoff = now() - 7 * 86400
    out = []
    with db() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY id DESC").fetchall()
        for a in rows:
            if not can_see_agent(conn, a, user["id"]):
                continue
            slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
            replies = conn.execute(
                "SELECT COUNT(*) c FROM messages m JOIN users u ON u.id=m.author_id "
                "WHERE u.username=? AND m.created_at>?", (f"agent:{slug}", cutoff)).fetchone()["c"]
            stars = conn.execute(
                "SELECT COUNT(*) c FROM agent_stars WHERE agent_id=? AND created_at>?",
                (a["id"], cutoff)).fetchone()["c"]
            installs = conn.execute(
                "SELECT COUNT(*) c FROM agent_installs WHERE agent_id=? AND created_at>?",
                (a["id"], cutoff)).fetchone()["c"]
            score = replies + stars * 3 + installs * 5
            if score:
                d = agent_json(conn, a, user["id"])
                d["week"] = {"replies": replies, "stars": stars, "installs": installs}
                out.append((score, d))
    out.sort(key=lambda x: -x[0])
    return [d for _, d in out[:6]]


@app.get("/api/messages/{mid}/peek")
def peek_message(mid: int, user=Depends(current_user)):
    """Tiny preview for jump-card unfurls — gated by target channel access."""
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such message")
        a = conn.execute("SELECT * FROM users WHERE id=?", (m["author_id"],)).fetchone()
        return {"id": m["id"], "channel_id": m["channel_id"],
                "server_id": ch["server_id"], "channel_name": ch["name"],
                "created_at": m["created_at"],
                "author": public_user(a) if a else None,
                "excerpt": (m["content"] or "")[:120],
                "has_attachments": bool(json.loads(m["attachments"] or "[]"))}


@app.get("/api/agents/{aid}/stats")
def agent_stats(aid: int, user=Depends(current_user)):
    """Per-agent usage card: 14-day summon sparkline, where it's used, who
    summons it. Visibility-gated like the agent itself."""
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
        uname = f"agent:{slug}"
        day0 = int(now() // 86400) - 13
        rows = conn.execute(
            "SELECT CAST(m.created_at / 86400 AS INTEGER) d, COUNT(*) c "
            "FROM messages m JOIN users u ON u.id=m.author_id "
            "WHERE u.username=? AND m.created_at>=? GROUP BY d",
            (uname, day0 * 86400)).fetchall()
        byday = {r["d"]: r["c"] for r in rows}
        days = [byday.get(day0 + i, 0) for i in range(14)]
        chans = conn.execute(
            "SELECT m.channel_id cid, COUNT(*) c FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE u.username=? "
            "GROUP BY m.channel_id ORDER BY c DESC LIMIT 5", (uname,)).fetchall()
        top_channels = []
        for r in chans:
            ch = conn.execute("SELECT * FROM channels WHERE id=?", (r["cid"],)).fetchone()
            if not ch:
                continue
            if ch["kind"] == "dm":
                names = [x["display_name"] for x in conn.execute(
                    "SELECT u.display_name FROM channel_members cm JOIN users u "
                    "ON u.id=cm.user_id WHERE cm.channel_id=? AND u.username NOT LIKE 'agent:%'",
                    (r["cid"],)).fetchall()]
                label = "DM: " + ", ".join(names[:3]) if names else "DM"
            else:
                label = "#" + (ch["name"] or "?")
            top_channels.append({"id": r["cid"], "name": label, "n": r["c"]})
        tops = conn.execute(
            "SELECT m.author_id aid, COUNT(*) c FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE m.content LIKE ? "
            "AND u.username NOT LIKE 'agent:%' AND u.username NOT LIKE 'bot:%' "
            "GROUP BY m.author_id ORDER BY c DESC LIMIT 5", (f"%@{slug}%",)).fetchall()
        top_summoners = [
            {"user": public_user(conn.execute(
                "SELECT * FROM users WHERE id=?", (r["aid"],)).fetchone()),
             "n": r["c"]}
            for r in tops]
        last = conn.execute(
            "SELECT MAX(m.created_at) t, COUNT(*) c FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE u.username=?", (uname,)).fetchone()
        return {"days": days, "day0": day0, "top_channels": top_channels,
                "top_summoners": top_summoners,
                "summons": last["c"], "last_used": last["t"]}


@app.post("/api/agents")
async def create_agent(body: AgentIn, user=Depends(current_user)):
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO agents(owner_id, name, icon, tagline, description, system_prompt, model, "
            "temperature, context_url, context_method, context_headers, api_kind, api_url, api_key, api_headers, "
            "tags, version, visibility, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user["id"], body.name, body.icon, body.tagline, body.description, body.system_prompt,
             body.model, body.temperature, (body.context_url or "").strip()[:512],
             (body.context_method or "GET").upper(), body.context_headers,
             (body.api_kind or "").strip(), (body.api_url or "").strip().rstrip("/")[:512],
             (body.api_key or "").strip()[:256], body.api_headers,
             json.dumps(body.tags), body.version, body.visibility, now(), now()))
        a = conn.execute("SELECT * FROM agents WHERE id=?", (cur.lastrowid,)).fetchone()
        emit_buzz(conn, user["id"], "published", {"agent_id": a["id"], "name": a["name"]})
        result = agent_json(conn, a, user["id"])
        fids = friend_ids(conn, user["id"]) + [user["id"]]
    await hub.send_many(fids, {"type": "buzz"})
    return result


@app.get("/api/agents/{aid}")
def get_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        return agent_json(conn, a, user["id"])


@app.patch("/api/agents/{aid}")
def update_agent(aid: int, body: AgentIn, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or a["owner_id"] != user["id"]:
            raise HTTPException(404, "No such agent")
        # snapshot the previous version into history
        snap = row_to_dict(a)
        snap.pop("id", None)
        conn.execute(
            "INSERT INTO agent_history(agent_id, version, snapshot, edited_by, created_at) "
            "VALUES (?,?,?,?,?)",
            (aid, a["version"], json.dumps(snap), user["id"], now()))
        snap.pop("api_key", None)
        snap.pop("api_headers", None)
        snap.pop("context_headers", None)
        new_key = a["api_key"] if body.api_key is None else body.api_key.strip()[:256]
        new_api_hdrs = a["api_headers"] if body.api_headers is None else (body.api_headers.strip() or None)
        new_ctx_hdrs = a["context_headers"] if body.context_headers is None else (body.context_headers.strip() or None)
        conn.execute(
            "UPDATE agents SET name=?, icon=?, tagline=?, description=?, system_prompt=?, model=?, "
            "temperature=?, context_url=?, context_method=?, context_headers=?, "
            "api_kind=?, api_url=?, api_key=?, api_headers=?, "
            "tags=?, version=?, visibility=?, updated_at=? WHERE id=?",
            (body.name, body.icon, body.tagline, body.description, body.system_prompt, body.model,
             body.temperature, (body.context_url or "").strip()[:512],
             (body.context_method or a["context_method"] or "GET").upper(), new_ctx_hdrs,
             (body.api_kind if body.api_kind is not None else (a["api_kind"] or "")).strip(),
             (body.api_url if body.api_url is not None else (a["api_url"] or "")).strip().rstrip("/")[:512],
             new_key, new_api_hdrs,
             json.dumps(body.tags), body.version, body.visibility, now(), aid))
        return agent_json(conn, conn.execute(
            "SELECT * FROM agents WHERE id=?", (aid,)).fetchone(), user["id"])


@app.delete("/api/agents/{aid}")
def delete_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or a["owner_id"] != user["id"]:
            raise HTTPException(404, "No such agent")
        conn.execute("DELETE FROM agents WHERE id=?", (aid,))
        return {"ok": True}


@app.post("/api/agents/{aid}/star")
async def star_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        if conn.execute("SELECT 1 FROM agent_stars WHERE agent_id=? AND user_id=?",
                        (aid, user["id"])).fetchone():
            conn.execute("DELETE FROM agent_stars WHERE agent_id=? AND user_id=?", (aid, user["id"]))
            starred = False
        else:
            conn.execute("INSERT INTO agent_stars(agent_id, user_id, created_at) VALUES (?,?,?)",
                         (aid, user["id"], now()))
            emit_buzz(conn, user["id"], "starred", {"agent_id": aid, "name": a["name"]})
            starred = True
        return {"starred": starred}


@app.post("/api/agents/{aid}/install")
async def install_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        if conn.execute("SELECT 1 FROM agent_installs WHERE agent_id=? AND user_id=?",
                        (aid, user["id"])).fetchone():
            conn.execute("DELETE FROM agent_installs WHERE agent_id=? AND user_id=?", (aid, user["id"]))
            installed = False
        else:
            conn.execute(
                "INSERT INTO agent_installs(agent_id, user_id, created_at) VALUES (?,?,?)",
                (aid, user["id"], now()))
            conn.execute("UPDATE agents SET downloads=downloads+1 WHERE id=?", (aid,))
            emit_buzz(conn, user["id"], "installed", {"agent_id": aid, "name": a["name"]})
            installed = True
        return {"installed": installed}


@app.get("/api/agents/{aid}/export")
def export_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        d = row_to_dict(a)
        return {"format": "signalteams-agent@1", "name": d["name"], "tagline": d["tagline"],
                "description": d["description"], "system_prompt": d["system_prompt"],
                "model": d["model"], "temperature": d["temperature"], "tags": d["tags"],
                "version": d["version"], "context_url": d["context_url"],
                "author": d["owner_id"] and conn.execute(
                    "SELECT username FROM users WHERE id=?", (d["owner_id"],)).fetchone()["username"]}


@app.post("/api/agents/import")
async def import_agent(body: dict, user=Depends(current_user)):
    name = str(body.get("name", "Imported agent"))[:64]
    agent = AgentIn(
        name=name,
        icon=str(body.get("icon", "🤖"))[:8],
        tagline=str(body.get("tagline", ""))[:200],
        description=str(body.get("description", ""))[:4000],
        system_prompt=str(body.get("system_prompt", ""))[:16000],
        model=str(body.get("model", ""))[:64],
        context_url=str(body.get("context_url", ""))[:512],
        temperature=(float(body["temperature"])
                     if body.get("temperature") is not None
                     and str(body.get("temperature")).replace(".", "", 1).lstrip("-").isdigit()
                     else None),
        tags=[str(t)[:32] for t in (body.get("tags") or [])][:12],
        version=str(body.get("version", "1.0.0"))[:16],
        visibility="friends",
    )
    return await create_agent(agent, user)


@app.get("/api/bench")
def my_bench(user=Depends(current_user)):
    """Agents the user installed to their bench."""
    with db() as conn:
        rows = conn.execute(
            "SELECT a.* FROM agents a JOIN agent_installs i ON i.agent_id=a.id "
            "WHERE i.user_id=? ORDER BY i.created_at DESC", (user["id"],)).fetchall()
        return [agent_json(conn, a, user["id"]) for a in rows]


@app.delete("/api/messages/{mid}")
async def delete_message(mid: int, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m or m["author_id"] != user["id"]:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        members = channel_member_ids(conn, ch)
        conn.execute("DELETE FROM messages WHERE thread_root=?", (mid,))
        conn.execute("DELETE FROM messages WHERE id=?", (mid,))
    await hub.send_many(members, {"type": "message_deleted", "channel_id": m["channel_id"], "id": mid})
    return {"ok": True}


class EditIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


@app.patch("/api/messages/{mid}")
async def edit_message(mid: int, body: EditIn, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m or m["author_id"] != user["id"]:
            raise HTTPException(404, "No such message")
        conn.execute("UPDATE messages SET content=?, edited_at=? WHERE id=?",
                     (body.content.strip(), now(), mid))
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        members = channel_member_ids(conn, ch)
    for uid in members:
        with db() as conn:
            mm = message_json(conn, conn.execute(
                "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), uid)
        await hub.send(uid, {"type": "message_updated", "channel_id": m["channel_id"],
                             "message": mm})
    return {"ok": True}


class ReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


@app.post("/api/messages/{mid}/react")
async def react(mid: int, body: ReactIn, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        members = channel_member_ids(conn, ch)
        if user["id"] not in members:
            raise HTTPException(404, "No such message")
        if conn.execute("SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?",
                        (mid, user["id"], body.emoji)).fetchone():
            conn.execute("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?",
                         (mid, user["id"], body.emoji))
            on = False
        else:
            conn.execute("INSERT INTO message_reactions(message_id, user_id, emoji, created_at) "
                         "VALUES (?,?,?,?)", (mid, user["id"], body.emoji, now()))
            on = True
    # fan out per-member reactions (mine flag differs per viewer)
    for uid in members:
        with db() as conn:
            rx = reactions_json(conn, mid, uid)
        await hub.send(uid, {"type": "reaction", "channel_id": m["channel_id"],
                             "message_id": mid, "reactions": rx})
    if body.emoji == STAR_EMOJI:
        await starboard_check(mid)
    with db() as conn:
        return {"on": on, "reactions": reactions_json(conn, mid, user["id"])}


@app.post("/api/messages/{mid}/pin")
async def pin_message(mid: int, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        members = channel_member_ids(conn, ch)
        if user["id"] not in members:
            raise HTTPException(404, "No such message")
        conn.execute("UPDATE messages SET pinned=1-pinned WHERE id=?", (mid,))
        pinned = conn.execute("SELECT pinned FROM messages WHERE id=?", (mid,)).fetchone()["pinned"]
    for uid in members:
        with db() as conn:
            mm = message_json(conn, conn.execute(
                "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), uid)
        await hub.send(uid, {"type": "message_updated", "channel_id": m["channel_id"],
                             "message": mm})
    return {"pinned": bool(pinned)}


@app.get("/api/channels/{cid}/pins")
def get_pins(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        rows = conn.execute(
            "SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY id DESC",
            (cid,)).fetchall()
        return [message_json(conn, m, user["id"]) for m in rows]


@app.post("/api/messages/{mid}/save")
def save_message(mid: int, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        if user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such message")
        have = conn.execute("SELECT id FROM saved WHERE user_id=? AND message_id=?",
                            (user["id"], mid)).fetchone()
        if have:
            conn.execute("DELETE FROM saved WHERE id=?", (have["id"],))
            return {"saved": False}
        conn.execute("INSERT INTO saved(user_id, message_id, created_at) VALUES (?,?,?)",
                     (user["id"], mid, now()))
        return {"saved": True}


@app.get("/api/saved")
def my_saved(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT s.id sid, s.created_at sat, m.* FROM saved s "
            "JOIN messages m ON m.id=s.message_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 100",
            (user["id"],)).fetchall()
        out = []
        for r in rows:
            ch = conn.execute("SELECT * FROM channels WHERE id=?", (r["channel_id"],)).fetchone()
            if not ch or user["id"] not in channel_member_ids(conn, ch):
                continue
            d = message_json(conn, r, user["id"])
            d["saved_id"] = r["sid"]
            d["channel"] = ch["name"]
            d["server_id"] = ch["server_id"]
            d["dm"] = ch["kind"] == "dm"
            out.append(d)
        return out


_SEARCH_KEYS = ("from", "in", "has", "mentions", "pinned", "is",
                "before", "after", "during")


def _day_ts(s: str):
    """Parse YYYY-MM-DD into an epoch float, or None."""
    try:
        y, m, d = (int(x) for x in s.split("-"))
        import datetime as _dt
        return _dt.datetime(y, m, d).timestamp()
    except Exception:
        return None


def _parse_search(q: str, user):
    """Pull Discord-style filters out of a search query.
    Returns (free_text, where_clauses, params) — clauses AND onto m.*."""
    clauses, params, found = [], [], []
    def repl(mo):
        key, val = mo.group(1).lower(), mo.group(3) or mo.group(2) or ""
        found.append((key, val))
        return " "
    free = re.sub(
        r"(?<!\S)(\w+):(?:\"([^\"]*)\"|(\S+))",
        lambda mo: repl(mo) if mo.group(1).lower() in _SEARCH_KEYS else mo.group(0),
        q).strip()
    for key, val in found:
        v = val.strip()
        if not v:
            continue
        if key == "from":
            if v.lower() == "me":
                clauses.append("m.author_id=?"); params.append(user["id"])
            else:
                clauses.append(
                    "m.author_id IN (SELECT id FROM users WHERE username=? "
                    "OR display_name=? COLLATE NOCASE)")
                params += [v.lstrip("@"), v.lstrip("@")]
        elif key == "in":
            clauses.append(
                "m.channel_id IN (SELECT id FROM channels WHERE name=? COLLATE NOCASE)")
            params.append(v.lstrip("#"))
        elif key == "mentions":
            if v.lower() == "me":
                clauses.append("m.content LIKE ?"); params.append(f"%@{user['username']}%")
            else:
                clauses.append("m.content LIKE ?"); params.append(f"%@{v.lstrip('@')}%")
        elif key == "has":
            kind = v.lower()
            if kind == "link":
                clauses.append("m.content LIKE '%http%'")
            elif kind in ("attachment", "file"):
                clauses.append("m.attachments IS NOT NULL AND m.attachments != '[]'")
            elif kind == "image":
                clauses.append(
                    "(m.attachments LIKE '%.png%' OR m.attachments LIKE '%.jpg%' "
                    "OR m.attachments LIKE '%.jpeg%' OR m.attachments LIKE '%.gif%' "
                    "OR m.attachments LIKE '%.webp%')")
            elif kind == "embed":
                clauses.append("m.embed IS NOT NULL")
            elif kind == "poll":
                clauses.append("m.poll IS NOT NULL")
            elif kind == "reaction":
                clauses.append(
                    "EXISTS (SELECT 1 FROM message_reactions r WHERE r.message_id=m.id)")
        elif key == "is":
            if v.lower() == "pinned":
                clauses.append("m.pinned=1")
        elif key == "pinned":
            if v.lower() in ("true", "yes", "1"):
                clauses.append("m.pinned=1")
            elif v.lower() in ("false", "no", "0"):
                clauses.append("(m.pinned IS NULL OR m.pinned=0)")
        elif key in ("before", "after", "during"):
            ts = _day_ts(v)
            if ts is not None:
                if key == "before":
                    clauses.append("m.created_at<?"); params.append(ts)
                elif key == "after":
                    clauses.append("m.created_at>=?"); params.append(ts + 86400)
                else:
                    clauses.append("m.created_at>=? AND m.created_at<?")
                    params += [ts, ts + 86400]
    if len(free) >= 2:
        clauses.append("m.content LIKE ?"); params.append(f"%{free}%")
    return free, clauses, params, len(found)


@app.get("/api/channels/{cid}/search")
def search_messages(cid: int, q: str = "", user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        _free, clauses, params, nfilters = _parse_search(q, user)
        if not clauses or (not nfilters and len(_free) < 2):
            return []
        rows = conn.execute(
            "SELECT m.* FROM messages m WHERE m.channel_id=? AND m.thread_root IS NULL "
            + ("AND " + " AND ".join(clauses) if clauses else "")
            + " ORDER BY m.id DESC LIMIT 30",
            (cid, *params)).fetchall()
        return [message_json(conn, m, user["id"]) for m in rows]


@app.get("/api/messages/{mid}/thread")
def get_thread(mid: int, user=Depends(current_user)):
    with db() as conn:
        m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        if not m or m["thread_root"]:
            raise HTTPException(404, "No such message")
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such message")
        replies = conn.execute(
            "SELECT * FROM messages WHERE thread_root=? ORDER BY id", (mid,)).fetchall()
        return {"root": message_json(conn, m, user["id"]),
                "replies": [message_json(conn, r, user["id"]) for r in replies]}


@app.get("/api/search")
def global_search(q: str = "", user=Depends(current_user)):
    """Search messages across every channel + DM the user can see."""
    q = q.strip()
    if len(q) < 2:
        return []
    with db() as conn:
        sids = [r["server_id"] for r in conn.execute(
            "SELECT server_id FROM server_members WHERE user_id=?",
            (user["id"],)).fetchall()]
        cids = [r["channel_id"] for r in conn.execute(
            "SELECT channel_id FROM channel_members WHERE user_id=?",
            (user["id"],)).fetchall()]
        if sids:
            cids += [r["id"] for r in conn.execute(
                "SELECT id FROM channels WHERE server_id IN (%s)" % ",".join("?" * len(sids)),
                sids).fetchall()]
        if not cids:
            return []
        _free, clauses, params, nfilters = _parse_search(q, user)
        if not clauses:
            return []
        rows = conn.execute(
            "SELECT m.* FROM messages m WHERE m.channel_id IN (%s) "
            "AND m.thread_root IS NULL AND %s ORDER BY m.id DESC LIMIT 30"
            % (",".join("?" * len(cids)), " AND ".join(clauses)),
            (*cids, *params)).fetchall()
        out = []
        for m in rows:
            ch = conn.execute("SELECT * FROM channels WHERE id=?", (m["channel_id"],)).fetchone()
            if ch["server_id"]:
                where = conn.execute("SELECT name FROM servers WHERE id=?",
                                     (ch["server_id"],)).fetchone()["name"] + " #" + ch["name"]
            else:
                other = conn.execute(
                    "SELECT u.display_name FROM channel_members cm "
                    "JOIN users u ON u.id=cm.user_id "
                    "WHERE cm.channel_id=? AND cm.user_id!=?",
                    (ch["id"], user["id"])).fetchone()
                where = "@" + (other["display_name"] if other else "DM")
            d = message_json(conn, m, user["id"])
            d["server_id"] = ch["server_id"]
            d["where"] = where
            out.append(d)
        return out


# ---------- custom emoji ----------

EMOJI_MAX = 256 * 1024      # 256 KB — emotes stay tiny
EMOJI_PER_SERVER = 50


@app.post("/api/servers/{sid}/emojis")
async def add_emoji(sid: int, file: UploadFile = File(...), name: str = Form(...),
                    user=Depends(current_user)):
    slug = re.sub(r"[^a-z0-9_]+", "", name.strip().lower())[:32]
    if len(slug) < 2:
        raise HTTPException(400, "Emoji names need 2+ letters/digits/underscores")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > EMOJI_MAX:
        raise HTTPException(413, "Emoji too large (256 KB max)")
    mime = file.content_type or ""
    if not (mime.startswith("image/") and mime != "image/svg+xml"):
        raise HTTPException(400, "Images only (png/gif/webp/jpg)")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(403, "Not a member")
        n = conn.execute("SELECT COUNT(*) c FROM emojis WHERE server_id=?", (sid,)).fetchone()["c"]
        if n >= EMOJI_PER_SERVER:
            raise HTTPException(400, f"Server's emoji cap is {EMOJI_PER_SERVER}")
        if conn.execute("SELECT 1 FROM emojis WHERE server_id=? AND name=?",
                        (sid, slug)).fetchone():
            raise HTTPException(409, f":{slug}: already exists")
        fid = secrets.token_urlsafe(10)
        conn.execute(
            "INSERT INTO files(id, uploader, name, mime, data, created_at) VALUES (?,?,?,?,?,?)",
            (fid, user["id"], f":{slug}:.{mime.split('/')[-1]}", mime[:80], data, now()))
        cur = conn.execute(
            "INSERT INTO emojis(server_id, name, file_id, uploader, created_at) VALUES (?,?,?,?,?)",
            (sid, slug, fid, user["id"], now()))
        eid = cur.lastrowid
    with db() as conn:
        await _server_changed(conn, sid)
    return {"id": eid, "name": slug, "file_id": fid}


@app.delete("/api/emojis/{eid}")
async def del_emoji(eid: int, user=Depends(current_user)):
    with db() as conn:
        e = conn.execute("SELECT * FROM emojis WHERE id=?", (eid,)).fetchone()
        if not e:
            raise HTTPException(404, "No such emoji")
        owner = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                             (e["server_id"],)).fetchone()
        if e["uploader"] != user["id"] and (not owner or owner["owner_id"] != user["id"]):
            raise HTTPException(403, "Only the uploader or the server owner can delete it")
        sid = e["server_id"]
        conn.execute("DELETE FROM emojis WHERE id=?", (eid,))
    with db() as conn:
        await _server_changed(conn, sid)
    return {"deleted": eid}


# ---------- file attachments ----------

MAX_UPLOAD = 8 * 1024 * 1024  # 8 MB


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), user=Depends(current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (8 MB max)")
    fid = secrets.token_urlsafe(10)
    with db() as conn:
        conn.execute(
            "INSERT INTO files(id, uploader, name, mime, data, created_at) VALUES (?,?,?,?,?,?)",
            (fid, user["id"], (file.filename or "file")[:120],
             (file.content_type or "application/octet-stream")[:80], data, now()))
    return {"id": fid, "name": file.filename or "file",
            "mime": file.content_type or "application/octet-stream", "size": len(data)}


@app.get("/api/files/{fid}")
def get_file(fid: str, user=Depends(optional_user)):
    with db() as conn:
        f = conn.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        if not f:
            raise HTTPException(404, "No such file")
        return Response(content=f["data"], media_type=f["mime"],
                        headers={"Content-Disposition":
                                 f'inline; filename="{f["name"].replace(chr(34), "")}"',
                                 "Cache-Control": "max-age=86400"})


# ---------- agent fork ----------

@app.post("/api/agents/{aid}/fork")
async def fork_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        owner = conn.execute("SELECT username, display_name FROM users WHERE id=?",
                             (a["owner_id"],)).fetchone()
        attribution = f"{a['name']} by {owner['display_name']}"
        cur = conn.execute(
            "INSERT INTO agents(owner_id, name, icon, tagline, description, system_prompt, model, "
            "temperature, context_url, tags, version, visibility, forked_from, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user["id"], a["name"], a["icon"], a["tagline"], a["description"], a["system_prompt"],
             a["model"], a["temperature"], a["context_url"], a["tags"], a["version"],
             "friends", attribution, now(), now()))
        new = conn.execute("SELECT * FROM agents WHERE id=?", (cur.lastrowid,)).fetchone()
        emit_buzz(conn, user["id"], "forked", {"agent_id": new["id"], "name": a["name"]})
        return agent_json(conn, new, user["id"])


@app.get("/api/agents/{aid}/history")
def agent_history(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        rows = conn.execute(
            "SELECT h.*, u.display_name, u.avatar_emoji FROM agent_history h "
            "JOIN users u ON u.id=h.edited_by WHERE h.agent_id=? ORDER BY h.id DESC",
            (aid,)).fetchall()
        return [{"id": r["id"], "version": r["version"], "created_at": r["created_at"],
                 "editor": r["display_name"], "avatar": r["avatar_emoji"],
                 "snapshot": json.loads(r["snapshot"])} for r in rows]


# ---------- agent reviews ----------

class ReviewIn(BaseModel):
    rating: int = Field(ge=0, le=5, default=0)
    body: str = Field(default="", max_length=2000)


@app.get("/api/agents/{aid}/reviews")
def list_reviews(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        rows = conn.execute(
            "SELECT r.*, u.username, u.display_name, u.avatar_emoji, u.avatar_color "
            "FROM agent_reviews r JOIN users u ON u.id=r.user_id "
            "WHERE r.agent_id=? ORDER BY r.id DESC", (aid,)).fetchall()
        return [{"id": r["id"], "rating": r["rating"], "body": r["body"],
                 "created_at": r["created_at"],
                 "user": {"id": r["user_id"], "username": r["username"],
                          "display_name": r["display_name"], "avatar_emoji": r["avatar_emoji"],
                          "avatar_color": r["avatar_color"]}} for r in rows]


@app.post("/api/agents/{aid}/reviews")
async def post_review(aid: int, body: ReviewIn, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        conn.execute(
            "INSERT INTO agent_reviews(agent_id, user_id, rating, body, created_at) VALUES (?,?,?,?,?) "
            "ON CONFLICT(agent_id, user_id) DO UPDATE SET rating=excluded.rating, "
            "body=excluded.body, created_at=excluded.created_at",
            (aid, user["id"], body.rating, body.body.strip(), now()))
        if body.rating >= 4:
            emit_buzz(conn, user["id"], "reviewed",
                      {"agent_id": aid, "name": a["name"], "rating": body.rating})
    return {"ok": True}


# ---------- agent playground ----------

class TryIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[dict] = []
    model: str | None = None
    provider: str | None = None


def _split_model(spec):
    """'ollama:llama3' → ('ollama', 'llama3'); bare names → (None, name)."""
    if spec and ":" in spec:
        p, m = spec.split(":", 1)
        if p in ("ollama", "lmstudio", "custom") and m:
            return p, m
    return None, (spec or None)


_ENV_LLM = None
if os.environ.get("AGENTHIVE_LLM_URL"):
    _ENV_LLM = {"url": os.environ["AGENTHIVE_LLM_URL"].rstrip("/"),
                "key": os.environ.get("AGENTHIVE_LLM_KEY", ""),
                "model": os.environ.get("AGENTHIVE_LLM_MODEL", ""),
                "kind": os.environ.get("AGENTHIVE_LLM_KIND", "openai")}


def _pub_server(d):
    """Strip secrets from a serialized server — llm_key is write-only."""
    if isinstance(d, dict) and "llm_key" in d:
        d["has_llm_key"] = bool(d.pop("llm_key"))
    return d


def _grounding(url, method="GET", message="", headers=None):
    """Fetch an agent's live-context URL — GET reads data, POST sends the
    prompt and reads the response (any HTTP service becomes an agent tool).
    Supports custom request headers (JSON). Best-effort, 6s timeout, 2KB cap."""
    import urllib.request as _u
    try:
        extra = {}
        if headers:
            extra = {str(k): str(v) for k, v in (json.loads(headers) if isinstance(headers, str) else headers).items()}
        if (method or "GET").upper() == "POST":
            req = _u.Request(url, data=json.dumps(
                {"prompt": message}).encode(),
                headers={"User-Agent": "SignalTeams-agent/1.0",
                         "Content-Type": "application/json", **extra}, method="POST")
        else:
            req = _u.Request(url, headers={"User-Agent": "SignalTeams-agent/1.0", **extra})
        with _u.urlopen(req, timeout=6) as r:
            body = r.read(4000)
            return body.decode("utf-8", "replace")[:2000]
    except Exception:
        return ""


def _agent_llm(a):
    """Agent's own dedicated API connection — overrides server/user default when configured."""
    if not a:
        return None
    keys = a.keys() if hasattr(a, "keys") else a
    url = ((a["api_url"] if "api_url" in keys else "") or "").strip().rstrip("/")
    if not url:
        return None
    kind = ((a["api_kind"] if "api_kind" in keys else "") or "openai").strip() or "openai"
    return {
        "url": url,
        "key": (a["api_key"] if "api_key" in keys else "") or "",
        "model": (a["model"] if "model" in keys else "") or "",
        "kind": kind,
        "headers": (a["api_headers"] if "api_headers" in keys else None),
        "label": f"agent:{kind}",
    }


def _sysprompt(a, ctx=""):
    base = a["system_prompt"] or \
        f"You are {a['name']}, a helpful AI agent. {a['tagline']}"
    if ctx:
        base += f"\n\nLive context (fetched from your grounding URL):\n{ctx}"
    return base


def _server_llm(conn, sid):
    """Server's shared LLM endpoint — owner's pick for the whole crew."""
    if not sid:
        return None
    r = conn.execute(
        "SELECT llm_url, llm_key, llm_model, llm_kind FROM servers WHERE id=?",
        (sid,)).fetchone()
    if not r or not r["llm_url"]:
        return None
    return {"url": r["llm_url"], "key": r["llm_key"],
            "model": r["llm_model"], "kind": r["llm_kind"]}


def _user_llm(conn, uid):
    """User's custom LLM endpoint — theirs first, host's env endpoint as the
    crew-wide fallback (any OpenAI-compatible API or webhook)."""
    r = conn.execute(
        "SELECT llm_url, llm_key, llm_model, llm_kind, llm_headers FROM users WHERE id=?",
        (uid,)).fetchone()
    if not r or not r["llm_url"]:
        return _ENV_LLM
    return {"url": r["llm_url"], "key": r["llm_key"],
            "model": r["llm_model"], "kind": r["llm_kind"],
            "headers": r["llm_headers"]}


class LlmConfigIn(BaseModel):
    base_url: str = ""
    api_key: str | None = None                # None keeps the stored key; "" clears
    model: str = ""
    kind: str = "openai"                      # openai | webhook
    headers: str | None = None                # JSON of extra request headers


@app.get("/api/me/llm")
def get_llm_config(user=Depends(current_user)):
    with db() as conn:
        r = conn.execute(
            "SELECT llm_url, llm_key, llm_model, llm_kind, llm_headers FROM users WHERE id=?",
            (user["id"],)).fetchone()
        return {"base_url": r["llm_url"], "model": r["llm_model"],
                "kind": r["llm_kind"], "has_key": bool(r["llm_key"]),
                "has_headers": bool(r["llm_headers"])}


@app.put("/api/me/llm")
def put_llm_config(body: LlmConfigIn, user=Depends(current_user)):
    url = body.base_url.strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must start with http:// or https://")
    if body.kind not in ("openai", "webhook"):
        raise HTTPException(400, "kind must be openai or webhook")
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


@app.post("/api/me/llm/test")
def test_llm_config(user=Depends(current_user)):
    from .llm import _get, _post, TIMEOUT
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    if not ep:
        raise HTTPException(400, "No endpoint configured")
    try:
        if ep["kind"] == "webhook":
            d = _post(ep["url"], {"system_prompt": "ping", "messages": [
                {"role": "user", "content": "ping"}], "model": "default",
                "temperature": 0}, 15, ep.get("key"))
            return {"ok": True, "sample": str(d)[:200]}
        d = _get(f"{ep['url']}/v1/models", timeout=10, key=ep.get("key"))
        return {"ok": True, "models": [m["id"] for m in d.get("data", [])][:50]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


@app.post("/api/servers/{sid}/llm/test")
def test_server_llm(sid: int, user=Depends(current_user)):
    """Probe the server's shared endpoint — owner only."""
    from .llm import _get, _post
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        ep = _server_llm(conn, sid)
    if not ep:
        raise HTTPException(400, "No endpoint configured")
    try:
        if ep["kind"] == "webhook":
            d = _post(ep["url"], {"system_prompt": "ping", "messages": [
                {"role": "user", "content": "ping"}], "model": "default",
                "temperature": 0}, 15, ep.get("key"))
            return {"ok": True, "sample": str(d)[:200]}
        d = _get(f"{ep['url']}/v1/models", timeout=10, key=ep.get("key"))
        return {"ok": True, "models": [m["id"] for m in d.get("data", [])][:50]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


@app.get("/api/llm/providers")
def llm_providers(user=Depends(current_user)):
    from .llm import providers
    with db() as conn:
        ep = _user_llm(conn, user["id"])
    return providers(ep)


class AgentConnectIn(BaseModel):
    api_kind: str = ""                        # "" | openai | anthropic | ollama | webhook
    api_url: str = ""
    api_key: str | None = None                # None keeps stored key; "" clears
    model: str | None = None
    api_headers: str | None = None            # JSON object string
    context_url: str | None = None
    context_method: str | None = None         # GET | POST
    context_headers: str | None = None        # JSON object string


@app.put("/api/agents/{aid}/connect")
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
        if not a or a["owner_id"] != user["id"]:
            raise HTTPException(404, "Only the agent owner can configure its API connection")
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


@app.post("/api/agents/{aid}/connect/test")
def test_agent_connect(aid: int, body: AgentConnectIn | None = None, user=Depends(current_user)):
    """Probe an agent's individual API connection and/or grounding webhook live."""
    from .llm import _get, _post, _oai_base, _anth_base, custom_models, _ep_headers
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        fallback_ep = _user_llm(conn, user["id"])

    # Merge inline form values if owner is testing unsaved settings
    kind = ((body.api_kind if body and body.api_kind is not None else agent.get("api_kind")) or "").strip().lower()
    url = ((body.api_url if body and body.api_url is not None else agent.get("api_url")) or "").strip().rstrip("/")
    key = (agent.get("api_key") or "") if (not body or body.api_key is None) else body.api_key.strip()
    model = ((body.model if body and body.model is not None else agent.get("model")) or "").strip()
    hdrs = agent.get("api_headers") if (not body or body.api_headers is None) else (body.api_headers.strip() or None)
    ctx_url = ((body.context_url if body and body.context_url is not None else agent.get("context_url")) or "").strip()
    ctx_method = ((body.context_method if body and body.context_method is not None else agent.get("context_method")) or "GET").strip().upper()
    ctx_hdrs = agent.get("context_headers") if (not body or body.context_headers is None) else (body.context_headers.strip() or None)

    ep = {"url": url, "key": key, "model": model, "kind": kind or "openai", "headers": hdrs} if url else fallback_ep
    out = {"ok": False, "kind": ep["kind"] if ep else "local", "url": ep["url"] if ep else "", "models": []}

    t0 = time.time()
    try:
        if ep and ep.get("url"):
            ekind = ep.get("kind") or "openai"
            extra = _ep_headers(ep)
            if ekind == "webhook":
                d = _post(ep["url"], {"system_prompt": "ping", "messages": [
                    {"role": "user", "content": "ping"}], "model": model or "default",
                    "temperature": 0}, 12, ep.get("key"), extra)
                out["ok"] = True
                out["sample"] = str(d)[:220]
            elif ekind == "ollama":
                d = _get(f"{ep['url'].rstrip('/')}/api/tags", timeout=8, key=ep.get("key"), extra=extra)
                out["models"] = [m["name"] for m in d.get("models", [])][:50]
                out["ok"] = True
            elif ekind == "anthropic":
                ah = {"anthropic-version": "2023-06-01", **extra}
                if ep.get("key"):
                    ah["x-api-key"] = ep["key"]
                d = _get(f"{_anth_base(ep['url'])}/models", timeout=8, extra=ah)
                out["models"] = [m["id"] for m in d.get("data", []) if m.get("id")][:50]
                out["ok"] = True
            else:
                d = _get(f"{_oai_base(ep['url'])}/models", timeout=8, key=ep.get("key"), extra=extra)
                out["models"] = [m["id"] for m in d.get("data", []) if m.get("id")][:50]
                out["ok"] = True
        else:
            from .llm import providers as _provs
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


@app.post("/api/agents/{aid}/try")
def try_agent(aid: int, body: TryIn, user=Depends(current_user)):
    from .llm import chat
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        ep = _agent_llm(agent) or _user_llm(conn, user["id"])
    if body.provider == "custom" and not ep:
        raise HTTPException(400, "Configure an API connection on this agent or in Settings → LLM")
    _aprov, _amdl = _split_model(
        agent["model"] if agent["model"] not in ("", "any") else None)
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


@app.post("/api/agents/{aid}/try_stream")
def try_agent_stream(aid: int, body: TryIn, user=Depends(current_user)):
    """NDJSON stream: {t:'meta'|'token'|'done', ...} one JSON object per line."""
    from .llm import chat_stream
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        agent = row_to_dict(a)
        ep = _agent_llm(agent) or _user_llm(conn, user["id"])
    if body.provider == "custom" and not ep:
        raise HTTPException(400, "Configure an API connection on this agent or in Settings → LLM")

    def gen():
        try:
            for kind, data in chat_stream(
                    _sysprompt(agent, _grounding(agent["context_url"], agent.get("context_method", "GET"),
                               body.message, agent.get("context_headers")) if agent["context_url"] else ""),
                    body.history, body.message,
                    model=body.model or _split_model(
                        agent["model"] if agent["model"] not in ("", "any") else None)[1],
                    provider=body.provider or _split_model(
                        agent["model"] if agent["model"] not in ("", "any") else None)[0],
                    temperature=agent.get("temperature"), endpoint=ep):
                if kind == "meta":
                    yield json.dumps({"t": "meta", **data}) + "\n"
                elif kind == "token":
                    yield json.dumps({"t": "token", "c": data}) + "\n"
                else:
                    yield json.dumps({"t": "done"}) + "\n"
        except Exception as e:
            yield json.dumps({"t": "error", "message": str(e)}) + "\n"

    from fastapi.responses import StreamingResponse
    return StreamingResponse(gen(), media_type="application/x-ndjson")


# ---------- agent packs ----------

@app.get("/api/packs")
def list_packs(user=Depends(current_user)):
    with db() as conn:
        fids = set(friend_ids(conn, user["id"])) | {user["id"]}
        rows = conn.execute("SELECT * FROM agent_packs ORDER BY id DESC").fetchall()
        return [pack_json(conn, p, user["id"]) for p in rows if p["owner_id"] in fids]


@app.post("/api/packs")
async def create_pack(body: PackIn, user=Depends(current_user)):
    with db() as conn:
        ids = []
        for aid in body.agent_ids[:20]:
            a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
            if a and can_see_agent(conn, a, user["id"]) and aid not in ids:
                ids.append(aid)
        if not ids:
            raise HTTPException(400, "A pack needs at least one visible agent")
        cur = conn.execute(
            "INSERT INTO agent_packs(owner_id, name, icon, description, created_at) VALUES (?,?,?,?,?)",
            (user["id"], body.name.strip(), body.icon or "📦", body.description.strip(), now()))
        pid = cur.lastrowid
        for i, aid in enumerate(ids):
            conn.execute("INSERT INTO pack_items(pack_id, agent_id, position) VALUES (?,?,?)",
                         (pid, aid, i))
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        emit_buzz(conn, user["id"], "packed", {"name": p["name"], "count": len(ids)})
        result = pack_json(conn, p, user["id"])
        fids = friend_ids(conn, user["id"]) + [user["id"]]
    await hub.send_many(fids, {"type": "buzz"})
    return result


@app.get("/api/packs/{pid}")
def get_pack(pid: int, user=Depends(current_user)):
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or not can_see_pack(conn, p, user["id"]):
            raise HTTPException(404, "No such pack")
        d = pack_json(conn, p, user["id"])
        d["agents"] = [agent_json(conn, a, user["id"]) for a in pack_agent_ids(conn, pid, user["id"])]
        return d


@app.delete("/api/packs/{pid}")
async def delete_pack(pid: int, user=Depends(current_user)):
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or p["owner_id"] != user["id"]:
            raise HTTPException(404, "No such pack")
        conn.execute("DELETE FROM agent_packs WHERE id=?", (pid,))
    return {"ok": True}


@app.post("/api/packs/{pid}/fork")
async def fork_pack(pid: int, user=Depends(current_user)):
    """Remix a friend's pack — clones it with the agents you can see."""
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or not can_see_pack(conn, p, user["id"]):
            raise HTTPException(404, "No such pack")
        agents = pack_agent_ids(conn, pid, user["id"])
        if not agents:
            raise HTTPException(400, "Nothing visible in this pack to fork")
        owner = conn.execute("SELECT display_name FROM users WHERE id=?",
                             (p["owner_id"],)).fetchone()
        cur = conn.execute(
            "INSERT INTO agent_packs(owner_id, name, icon, description, forked_from, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (user["id"], p["name"], p["icon"], p["description"],
             f"{p['name']} by {owner['display_name']}", now()))
        npid = cur.lastrowid
        for i, a in enumerate(agents):
            conn.execute("INSERT INTO pack_items(pack_id, agent_id, position) VALUES (?,?,?)",
                         (npid, a["id"], i))
        new = conn.execute("SELECT * FROM agent_packs WHERE id=?", (npid,)).fetchone()
        emit_buzz(conn, user["id"], "remixed",
                  {"name": p["name"], "count": len(agents), "pack_id": npid,
                   "to": p["owner_id"] if p["owner_id"] != user["id"] else None})
        result = pack_json(conn, new, user["id"])
        fids = friend_ids(conn, user["id"]) + [user["id"]]
    await hub.send_many(fids, {"type": "buzz"})
    return result


@app.post("/api/packs/{pid}/bench")
async def bench_pack(pid: int, user=Depends(current_user)):
    """Bench every agent in the pack (skips ones already benched or invisible)."""
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or not can_see_pack(conn, p, user["id"]):
            raise HTTPException(404, "No such pack")
        added = 0
        for a in pack_agent_ids(conn, pid, user["id"]):
            if not conn.execute("SELECT 1 FROM agent_installs WHERE agent_id=? AND user_id=?",
                                (a["id"], user["id"])).fetchone():
                conn.execute("INSERT INTO agent_installs(agent_id, user_id, created_at) VALUES (?,?,?)",
                             (a["id"], user["id"], now()))
                conn.execute("UPDATE agents SET downloads=downloads+1 WHERE id=?", (a["id"],))
                added += 1
        if added:
            emit_buzz(conn, user["id"], "installed", {"name": f"{p['name']} ({added} agents)"})
            fids = friend_ids(conn, user["id"]) + [user["id"]]
        else:
            fids = []
    for uid in fids:
        await hub.send_many([uid], {"type": "buzz"})
    return {"added": added}


# ---------- buzz feed ----------

@app.get("/api/buzz")
def buzz_feed(limit: int = Query(50, le=100), user=Depends(current_user)):
    with db() as conn:
        fids = set(friend_ids(conn, user["id"])) | {user["id"]}
        rows = conn.execute(
            "SELECT b.*, u.username, u.display_name, u.avatar_emoji, u.avatar_color "
            "FROM buzz b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT ?", (limit * 2,)).fetchall()
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"])
            except Exception:
                payload = {}
            if r["user_id"] not in fids and r["kind"] != "published" \
                    and payload.get("to") != user["id"] \
                    and payload.get("owner_id") not in fids:
                continue
            out.append({"id": r["id"], "kind": r["kind"], "payload": payload,
                        "created_at": r["created_at"],
                        "user": {"id": r["user_id"], "username": r["username"],
                                 "display_name": r["display_name"],
                                 "avatar_emoji": r["avatar_emoji"],
                                 "avatar_color": r["avatar_color"]}})
            if len(out) >= limit:
                break
        return out


@app.get("/api/inbox")
def inbox(user=Depends(current_user)):
    """Every @you — mentions + agent replies directed at me, newest first."""
    with db() as conn:
        rows = conn.execute(
            "SELECT b.*, u.username, u.display_name, u.avatar_emoji, u.avatar_color "
            "FROM buzz b JOIN users u ON u.id=b.user_id WHERE b.kind='mentioned' "
            "ORDER BY b.id DESC LIMIT 200").fetchall()
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload"])
            except Exception:
                continue
            if payload.get("to") != user["id"]:
                continue
            out.append({"id": r["id"], "payload": payload, "created_at": r["created_at"],
                        "user": {"id": r["user_id"], "username": r["username"],
                                 "display_name": r["display_name"],
                                 "avatar_emoji": r["avatar_emoji"],
                                 "avatar_color": r["avatar_color"]}})
            if len(out) >= 50:
                break
        return out


# ---------- websocket ----------

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    with db() as conn:
        u = user_by_token(conn, token)
        if not u:
            await ws.close(code=4401)
            return
        uid = u["id"]
        conn.execute("UPDATE users SET status='online' WHERE id=?", (uid,))
    await hub.connect(uid, ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                evt = json.loads(raw)
            except Exception:
                continue
            t = evt.get("type")
            if t == "typing":
                cid = int(evt.get("channel_id", 0))
                with db() as conn:
                    ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                    if ch and uid in channel_member_ids(conn, ch):
                        members = [m for m in channel_member_ids(conn, ch) if m != uid]
                        await hub.send_many(members, {
                            "type": "typing", "channel_id": cid,
                            "user": {"id": uid, "display_name": u["display_name"]},
                            "on": bool(evt.get("on"))})
            elif t == "status":
                status = str(evt.get("status", "online"))[:16]
                with db() as conn:
                    conn.execute("UPDATE users SET status=? WHERE id=?", (status, uid))
                await hub.broadcast({"type": "status", "user_id": uid, "status": status})
            elif t == "voice_join":
                cid = int(evt.get("channel_id", 0))
                with db() as conn:
                    ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                    members = channel_member_ids(conn, ch) if ch else []
                if uid in members:
                    cap = (ch["voice_cap"] if "voice_cap" in ch.keys() else 0) or 0
                    if cap and uid not in (r["id"] for r in hub.voice_roster(cid)) \
                            and len(hub.voice_roster(cid)) >= cap:
                        await hub.send(uid, {"type": "voice_reject",
                                             "channel_id": cid,
                                             "reason": "Voice channel is full"})
                    else:
                        roster = hub.voice_join(cid, uid, {
                            "id": uid, "display_name": u["display_name"],
                            "avatar_emoji": u["avatar_emoji"], "avatar_color": u["avatar_color"],
                            "muted": False, "sharing": False, "deafened": False,
                            "cam": False}, ws)
                        await hub.send_many(members, {
                            "type": "voice", "channel_id": cid, "members": roster})
            elif t == "voice_leave":
                cid = int(evt.get("channel_id", 0))
                if hub.voice_leave(cid, uid):
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid,
                        "members": hub.voice_roster(cid)})
            elif t == "voice_mute":
                cid = int(evt.get("channel_id", 0))
                roster = hub.voice_mute(cid, uid, bool(evt.get("muted")))
                if roster is not None:
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid, "members": roster})
            elif t in ("voice_screen", "voice_cam", "voice_deafen"):
                cid = int(evt.get("channel_id", 0))
                flag = {"voice_screen": "sharing", "voice_cam": "cam",
                        "voice_deafen": "deafened"}[t]
                fn = {"sharing": hub.voice_share, "cam": hub.voice_cam,
                      "deafened": hub.voice_deafen}[flag]
                roster = fn(cid, uid, bool(evt.get(flag)))
                if roster is not None:
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid, "members": roster})
            elif t == "voice_media":
                # stream-kind hints (cam vs screen) — relay to room so receivers
                # can label remote video tiles by stream.id
                cid = int(evt.get("channel_id", 0))
                room = hub.voice.get(cid, {})
                if uid in room:
                    await hub.send_many(list(room.keys()), {
                        "type": "voice_media", "channel_id": cid,
                        "from": uid, "data": evt.get("data")})
            elif t == "voice_status":
                cid = int(evt.get("channel_id", 0))
                await hub.send(uid, {
                    "type": "voice", "channel_id": cid,
                    "members": hub.voice_roster(cid)})
            elif t == "voice_signal":
                cid = int(evt.get("channel_id", 0))
                to = int(evt.get("to", 0))
                room = hub.voice.get(cid, {})
                if uid in room and to in room:
                    await hub.send(to, {
                        "type": "voice_signal", "channel_id": cid,
                        "from": uid, "data": evt.get("data")})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(uid, ws)
        with db() as conn:
            conn.execute("UPDATE users SET status='offline' WHERE id=?", (uid,))
            for cid, roster in hub.voice_leave_ws(uid, ws):
                ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                if ch:
                    await hub.send_many(channel_member_ids(conn, ch), {
                        "type": "voice", "channel_id": cid, "members": roster})
        await hub.broadcast_presence()


@app.get("/api/health")
def health():
    return {"ok": True, "app": "signalteams", "time": time.time()}


@app.get("/api/stats")
def stats():
    """Tiny public counters for the landing page — counts only, no content."""
    with db() as conn:
        return {
            "humans": conn.execute(
                "SELECT COUNT(*) c FROM users WHERE username NOT LIKE 'agent:%'").fetchone()["c"],
            "agents": conn.execute("SELECT COUNT(*) c FROM agents").fetchone()["c"],
            "packs": conn.execute("SELECT COUNT(*) c FROM agent_packs").fetchone()["c"],
            "messages": conn.execute("SELECT COUNT(*) c FROM messages").fetchone()["c"],
            "online": conn.execute(
                "SELECT COUNT(*) c FROM users WHERE status='online' "
                "AND username NOT LIKE 'agent:%'").fetchone()["c"],
        }


# LAN / single-port mode: serve the built frontend if dist exists
_dist = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_dist, html=True), name="dist")
