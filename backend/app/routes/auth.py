"""Auth + account endpoints."""
import json
import re
import secrets
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from .. import config as _cfg
from ..auth import create_session, current_user, get_token, hash_password, verify_password
from ..db import db, now, row_to_dict

from ..helpers import AVATAR_COLORS, AVATAR_EMOJIS, agent_json, can_see_agent, public_user
from ..routes.friends import friends
from ..schemas import LoginIn, PasswordIn, ProfileIn, RegisterIn, SupabaseIn

router = APIRouter()


@router.post("/api/register")
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


@router.post("/api/login")
def login(body: LoginIn):
    with db() as conn:
        u = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not u or not verify_password(body.password, u["password_hash"]):
            raise HTTPException(401, "Bad username or password")
        token = create_session(conn, u["id"])
        conn.execute("UPDATE users SET status='online' WHERE id=?", (u["id"],))
        return {"token": token, "user": public_user(u)}


SUPABASE_URL = _cfg.SUPABASE_URL
SUPABASE_ANON = _cfg.SUPABASE_ANON_KEY


@router.get("/api/auth/config")
def auth_config():
    """Public auth-providers config so the login page knows what to offer.
    The anon key is a public client key — safe to expose to the browser."""
    return {"supabase": bool(SUPABASE_URL and SUPABASE_ANON),
            "supabase_url": SUPABASE_URL or None,
            "supabase_anon": SUPABASE_ANON or None}


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


@router.post("/api/auth/supabase")
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


@router.post("/api/logout")
def logout(user=Depends(current_user), request=None):
    from fastapi import Request
    with db() as conn:
        conn.execute("UPDATE users SET status='offline' WHERE id=?", (user["id"],))
    return {"ok": True}


@router.get("/api/me")
def me(user=Depends(current_user)):
    d = public_user(user)
    d["has_password"] = (user.get("password_hash") or "").startswith("pbkdf2")
    d["supabase_linked"] = bool(user.get("supabase_uid"))
    if user.get("email"):
        d["email"] = user["email"]
    return d


@router.post("/api/me/password")
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


@router.post("/api/me/signout-others")
def signout_others(request: Request, user=Depends(current_user)):
    """Revoke every session except the caller's — the 'signed in somewhere
    else' escape hatch."""
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token<>?",
                     (user["id"], get_token(request)))
        return {"ok": True}


@router.get("/api/me/export")
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


@router.patch("/api/me")
def update_me(body: ProfileIn, user=Depends(current_user)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "muted" in fields:
        fields["muted"] = json.dumps(fields["muted"][:50])
    if "notify_mentions" in fields:
        fields["notify_mentions"] = json.dumps(fields["notify_mentions"][:50])
    if "server_muted" in fields:
        fields["server_muted"] = json.dumps(fields["server_muted"][:50])
    if "keywords" in fields:
        fields["keywords"] = json.dumps(
            [k.strip().lower()[:40] for k in fields["keywords"]
             if str(k).strip()][:25])
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


@router.get("/api/people")
def people(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM users WHERE id != ? ORDER BY username", (user["id"],)).fetchall()
        return [public_user(r) for r in rows]


@router.get("/api/users/{uid}/profile")
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
        # mutuals — servers both users sit in, friends both share
        d["mutual_servers"] = [dict(r) for r in conn.execute(
            "SELECT s.id, s.name, s.icon FROM servers s"
            " JOIN server_members a ON a.server_id=s.id AND a.user_id=?"
            " JOIN server_members b ON b.server_id=s.id AND b.user_id=?"
            " ORDER BY s.name", (user["id"], uid)).fetchall()] if uid != user["id"] else []
        mutual_ids = [r["fid"] for r in conn.execute(
            "SELECT DISTINCT u.id AS fid FROM users u"
            " JOIN friendships f1 ON f1.status='accepted'"
            "   AND u.id = CASE WHEN f1.user_id=? THEN f1.friend_id ELSE f1.user_id END"
            "   AND (f1.user_id=? OR f1.friend_id=?)"
            " JOIN friendships f2 ON f2.status='accepted'"
            "   AND u.id = CASE WHEN f2.user_id=? THEN f2.friend_id ELSE f2.user_id END"
            "   AND (f2.user_id=? OR f2.friend_id=?)",
            (user["id"], user["id"], user["id"], uid, uid, uid)).fetchall()]
        d["mutual_friends"] = [public_user(conn.execute(
            "SELECT * FROM users WHERE id=?", (fid,)).fetchone()) for fid in mutual_ids[:24]]
        return d
