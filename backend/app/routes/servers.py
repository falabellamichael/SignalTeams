"""Servers, members, roles, and channels."""
import json
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, emit_buzz, now
from ..hub import hub

from ..helpers import _clean_automod, _pub_server, _sys_post, audit, channel_json, public_user
from ..schemas import BanIn, ChannelIn, ChannelPatch, DigestIn, JoinIn, MemberRoleIn, NickIn, RoleIn, ServerIn, ServerPatch, TimeoutIn, TransferIn
from ..services import _server_changed

router = APIRouter()


@router.get("/api/servers")
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


@router.post("/api/servers")
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


@router.get("/api/invite/{code}")
def invite_info(code: str):
    """Public invite preview — a join link shows this before signup."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE invite_code=?", (code,)).fetchone()
        if not s:
            raise HTTPException(404, "Bad invite code")
        n = conn.execute("SELECT COUNT(*) c FROM server_members WHERE server_id=?",
                         (s["id"],)).fetchone()["c"]
        return {"name": s["name"], "icon": s["icon"], "members": n}


@router.post("/api/servers/join")
async def join_server(body: JoinIn, user=Depends(current_user)):
    sysinfo = None
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE invite_code=?", (body.invite_code,)).fetchone()
        if not s:
            raise HTTPException(404, "Bad invite code")
        if conn.execute("SELECT 1 FROM server_bans WHERE server_id=? AND user_id=?",
                        (s["id"], user["id"])).fetchone():
            raise HTTPException(403, "You're banned from this server")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (s["id"], user["id"])).fetchone():
            conn.execute(
                "INSERT INTO server_members(server_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (s["id"], user["id"], "member", now()))
            emit_buzz(conn, user["id"], "joined", {"server": s["name"]})
            sysinfo = _sys_post(conn, s["id"], user["id"], "join")
        out = dict(s)
    if sysinfo:
        cid, memb, mj = sysinfo
        await hub.send_many(memb, {"type": "message", "channel_id": cid,
                                   "message": mj})
    return out


@router.patch("/api/servers/{sid}")
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
        if body.automod is not None:
            conn.execute("UPDATE servers SET automod=? WHERE id=?",
                         (json.dumps(_clean_automod(body.automod)), sid))
        changed = [k for k, v in (("name", body.name), ("icon", body.icon),
                                ("icon_file", body.icon_file), ("star_threshold", body.star_threshold),
                                ("llm endpoint", body.llm_url), ("llm key", body.llm_key),
                                ("llm model", body.llm_model), ("llm kind", body.llm_kind),
                                ("automod rules", body.automod))
                   if v is not None]
        if changed:
            audit(conn, sid, user["id"], "server.update", s["name"],
                  "changed " + ", ".join(changed))
        out = _pub_server(dict(conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))
    with db() as conn:
        await _server_changed(conn, sid)
    return out


@router.post("/api/servers/{sid}/invite")
async def regen_invite(sid: int, user=Depends(current_user)):
    """Rotate the invite code — old code stops working."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        conn.execute("UPDATE servers SET invite_code=? WHERE id=?",
                     (secrets.token_urlsafe(6), sid))
        audit(conn, sid, user["id"], "invite.rotate", s["name"], "old code stopped working")
        out = _pub_server(dict(conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))
    with db() as conn:
        await _server_changed(conn, sid)
    return out


@router.delete("/api/servers/{sid}")
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


@router.post("/api/servers/{sid}/leave")
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
        audit(conn, sid, user["id"], "member.leave", f"@{user['username']}", s["name"])
        sysinfo = _sys_post(conn, sid, user["id"], "leave")
    with db() as conn:
        await _server_changed(conn, sid)
    if sysinfo:
        cid, memb, mj = sysinfo
        await hub.send_many(memb, {"type": "message", "channel_id": cid,
                                   "message": mj})
    return {"ok": True}


@router.delete("/api/servers/{sid}/members/{uid}")
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
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        conn.execute("DELETE FROM server_members WHERE server_id=? AND user_id=?",
                     (sid, uid))
        audit(conn, sid, user["id"], "member.kick",
              f"@{tgt['username']}" if tgt else str(uid))
    await hub.send_many([uid], {"type": "server_left", "server_id": sid})
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


@router.post("/api/servers/{sid}/bans/{uid}")
async def ban_member(sid: int, uid: int, body: BanIn, user=Depends(current_user)):
    """Ban = remove + block rejoin. Owner only."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can ban")
        if uid == s["owner_id"]:
            raise HTTPException(400, "Can't ban the owner")
        if conn.execute("SELECT 1 FROM server_bans WHERE server_id=? AND user_id=?",
                        (sid, uid)).fetchone():
            raise HTTPException(400, "Already banned")
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        if not tgt:
            raise HTTPException(404, "No such user")
        was_member = conn.execute(
            "DELETE FROM server_members WHERE server_id=? AND user_id=?",
            (sid, uid)).rowcount
        conn.execute(
            "INSERT INTO server_bans(server_id, user_id, reason, banned_by, created_at) "
            "VALUES (?,?,?,?,?)",
            (sid, uid, body.reason.strip()[:200], user["id"], now()))
        audit(conn, sid, user["id"], "member.ban", f"@{tgt['username']}",
              body.reason.strip()[:200])
    if was_member:
        await hub.send_many([uid], {"type": "server_left", "server_id": sid})
        with db() as conn:
            await _server_changed(conn, sid)
    return {"ok": True}


@router.get("/api/servers/{sid}/bans")
def list_bans(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can see bans")
        return [
            {**public_user(r), "reason": r["reason"], "banned_at": r["created_at"]}
            for r in conn.execute(
                "SELECT u.*, b.reason, b.created_at FROM server_bans b "
                "JOIN users u ON u.id=b.user_id WHERE b.server_id=? "
                "ORDER BY b.created_at DESC", (sid,)).fetchall()]


@router.delete("/api/servers/{sid}/bans/{uid}")
async def unban_member(sid: int, uid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can unban")
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        if not conn.execute("DELETE FROM server_bans WHERE server_id=? AND user_id=?",
                            (sid, uid)).rowcount:
            raise HTTPException(404, "Not banned")
        audit(conn, sid, user["id"], "member.unban",
              f"@{tgt['username']}" if tgt else str(uid))
    return {"ok": True}


@router.post("/api/servers/{sid}/members/{uid}/timeout")
async def timeout_member(sid: int, uid: int, body: TimeoutIn, user=Depends(current_user)):
    """Temporarily block a member's posts. minutes=0 clears."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can time out")
        if uid == s["owner_id"]:
            raise HTTPException(400, "Can't time out the owner")
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, uid)).fetchone():
            raise HTTPException(404, "Not a member")
        until = now() + body.minutes * 60 if body.minutes else None
        conn.execute("UPDATE server_members SET timeout_until=? "
                     "WHERE server_id=? AND user_id=?", (until, sid, uid))
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        audit(conn, sid, user["id"], "member.timeout", f"@{tgt['username']}" if tgt else str(uid),
              f"{body.minutes}min" if body.minutes else "cleared")
    return {"ok": True, "timeout_until": until}


@router.post("/api/servers/{sid}/nick")
async def set_nick(sid: int, body: NickIn, user=Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(404, "Not a member")
        nick = body.nickname.strip()[:48]
        conn.execute("UPDATE server_members SET nickname=? WHERE server_id=? AND user_id=?",
                     (nick, sid, user["id"]))
        audit(conn, sid, user["id"], "member.nick",
              f"@{user['username']}", nick or "nickname cleared")
    with db() as conn:
        await _server_changed(conn, sid)
        return {"nickname": nick}


@router.post("/api/servers/{sid}/transfer")
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
        tgt = conn.execute("SELECT username FROM users WHERE id=?", (body.user_id,)).fetchone()
        audit(conn, sid, user["id"], "owner.transfer",
              f"@{tgt['username']}" if tgt else str(body.user_id), s["name"])
    with db() as conn:
        await _server_changed(conn, sid)
        return {"ok": True, "owner_id": body.user_id}


@router.get("/api/servers/{sid}")
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
             "timeout_until": r["timeout_until"],
             "role_ids": [x["role_id"] for x in conn.execute(
                 "SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?",
                 (sid, r["id"])).fetchall()]}
            for r in conn.execute(
                "SELECT u.*, m.nickname, m.timeout_until FROM users u "
                "JOIN server_members m ON m.user_id=u.id "
                "WHERE m.server_id=? ORDER BY u.username", (sid,)).fetchall()]
        d["emojis"] = [dict(r) for r in conn.execute(
            "SELECT id, name, file_id, uploader FROM emojis WHERE server_id=? ORDER BY name",
            (sid,)).fetchall()]
        d["roles"] = [dict(r) for r in conn.execute(
            "SELECT id, name, color FROM server_roles WHERE server_id=? ORDER BY id",
            (sid,)).fetchall()]
        return d


def _snapshot_server(conn, s):
    """Structure-only snapshot — channels/roles/automod, no members or messages.
    Role gating travels as role *names* so it re-links on instantiation."""
    sid = s["id"]
    roles = [dict(r) for r in conn.execute(
        "SELECT id, name, color FROM server_roles WHERE server_id=? ORDER BY id",
        (sid,)).fetchall()]
    rname = {r["id"]: r["name"] for r in roles}
    chans = []
    for c in conn.execute(
            "SELECT * FROM channels WHERE server_id=? ORDER BY position, id",
            (sid,)).fetchall():
        chans.append({"name": c["name"], "kind": c["kind"], "topic": c["topic"] or "",
                      "category": c["category"] or "", "position": c["position"],
                      "slowmode_secs": c["slowmode_secs"] or 0,
                      "voice_cap": c["voice_cap"] or 0,
                      "role_name": rname.get(c["role_id"])})
    try:
        automod = json.loads(s["automod"] or "{}")
    except Exception:
        automod = {}
    return {"name": s["name"], "icon": s["icon"],
            "star_threshold": s["star_threshold"] if "star_threshold" in s.keys() else 3,
            "automod": automod, "roles": [{"name": r["name"], "color": r["color"]}
                                          for r in roles],
            "channels": chans}


@router.post("/api/servers/{sid}/template")
def save_template(sid: int, user=Depends(current_user)):
    """Create (or refresh) this server's shareable template — owner only."""
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can template this server")
        snap = json.dumps(_snapshot_server(conn, s))
        have = conn.execute("SELECT code FROM server_templates WHERE server_id=?",
                            (sid,)).fetchone()
        if have:
            conn.execute("UPDATE server_templates SET snapshot=?, created_by=? WHERE code=?",
                         (snap, user["id"], have["code"]))
            code = have["code"]
        else:
            code = secrets.token_urlsafe(5)
            conn.execute(
                "INSERT INTO server_templates(code, server_id, snapshot, created_by, uses, created_at) "
                "VALUES (?,?,?,?,0,?)", (code, sid, snap, user["id"], now()))
        audit(conn, sid, user["id"], "server.template", s["name"],
              f"code {code}")
        return {"code": code}


@router.delete("/api/servers/{sid}/template")
def del_template(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner can drop the template")
        if not conn.execute("DELETE FROM server_templates WHERE server_id=?",
                            (sid,)).rowcount:
            raise HTTPException(404, "No template for this server")
        return {"ok": True}


@router.get("/api/servers/{sid}/template")
def get_template(sid: int, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(403, "Only the owner")
        t = conn.execute("SELECT code, uses, created_at FROM server_templates "
                         "WHERE server_id=?", (sid,)).fetchone()
        return {"code": t["code"], "uses": t["uses"], "created_at": t["created_at"]} if t else {}


@router.get("/api/templates/{code}")
def template_preview(code: str):
    """Public preview — what a template builds, no secrets."""
    with db() as conn:
        t = conn.execute("SELECT * FROM server_templates WHERE code=?", (code,)).fetchone()
        if not t:
            raise HTTPException(404, "No such template")
        snap = json.loads(t["snapshot"])
        return {"name": snap["name"], "icon": snap["icon"], "uses": t["uses"],
                "channels": [c["name"] for c in snap["channels"]],
                "roles": [r["name"] for r in snap["roles"]]}


@router.post("/api/servers/from-template")
def server_from_template(body: dict, user=Depends(current_user)):
    """Instantiate a template: owner member + roles + channels (role names re-linked)."""
    code = (body.get("code") or "").strip()
    with db() as conn:
        t = conn.execute("SELECT * FROM server_templates WHERE code=?", (code,)).fetchone()
        if not t:
            raise HTTPException(404, "No such template")
        snap = json.loads(t["snapshot"])
        name = (body.get("name") or "").strip()[:64] or snap["name"]
        code2 = secrets.token_urlsafe(6)
        cur = conn.execute(
            "INSERT INTO servers(name, icon, invite_code, owner_id, automod, star_threshold, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (name, snap["icon"], code2, user["id"],
             json.dumps(snap.get("automod") or {}),
             snap.get("star_threshold", 3), now()))
        sid = cur.lastrowid
        conn.execute(
            "INSERT INTO server_members(server_id, user_id, role, joined_at) VALUES (?,?,?,?)",
            (sid, user["id"], "owner", now()))
        role_ids = {}
        for r in snap.get("roles", []):
            rc = conn.execute(
                "INSERT INTO server_roles(server_id, name, color, created_at) VALUES (?,?,?,?)",
                (sid, r["name"][:24], r["color"], now()))
            role_ids[r["name"]] = rc.lastrowid
        chans = snap.get("channels") or [
            {"name": "general", "kind": "text", "topic": "", "category": "",
             "position": 0, "slowmode_secs": 0, "voice_cap": 0, "role_name": None}]
        for c in chans:
            kind = c["kind"] if c["kind"] in ("text", "agents", "forum") else "text"
            conn.execute(
                "INSERT INTO channels(server_id, kind, name, topic, position, category, "
                "slowmode_secs, voice_cap, role_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (sid, kind, c["name"][:48], (c["topic"] or "")[:200],
                 c["position"], (c["category"] or "")[:48],
                 c["slowmode_secs"] or 0, c["voice_cap"] or 0,
                 role_ids.get(c["role_name"]), now()))
        conn.execute("UPDATE server_templates SET uses=uses+1 WHERE code=?", (code,))
        emit_buzz(conn, user["id"], "joined", {"server": name})
        return _pub_server(dict(conn.execute(
            "SELECT * FROM servers WHERE id=?", (sid,)).fetchone()))


@router.get("/api/servers/{sid}/pulse")
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


ROLE_COLORS = ["#e8b339", "#f2644c", "#4cc2f2", "#7ce87c", "#c084fc",
               "#f278b6", "#8f9aa8", "#5eead4"]


@router.post("/api/servers/{sid}/roles")
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
        audit(conn, sid, user["id"], "role.create", body.name.strip(), color.lower())
    with db() as conn:
        await _server_changed(conn, sid)
    return {"id": rid, "name": body.name.strip(), "color": color.lower()}


@router.delete("/api/roles/{rid}")
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
        audit(conn, sid, user["id"], "role.delete", r["name"], r["color"])


@router.post("/api/servers/{sid}/members/{uid}/roles")
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
        un = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        rn = conn.execute("SELECT name FROM server_roles WHERE id=?", (body.role_id,)).fetchone()
        audit(conn, sid, user["id"], "member.roles",
              f"@{un['username']}" if un else str(uid),
              ("+" if on else "-") + (rn["name"] if rn else "role"))
    with db() as conn:
        await _server_changed(conn, sid)
    return {"role_id": body.role_id, "on": on}


@router.post("/api/servers/{sid}/channels")
def add_channel(sid: int, body: ChannelIn, user=Depends(current_user)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                            (sid, user["id"])).fetchone():
            raise HTTPException(403, "Not a member")
        pos = conn.execute("SELECT COALESCE(MAX(position),0)+1 p FROM channels WHERE server_id=?",
                           (sid,)).fetchone()["p"]
        roster = [aid for aid in body.roster[:10] if conn.execute(
            "SELECT 1 FROM agents WHERE id=?", (aid,)).fetchone()]
        lurkers = [aid for aid in body.lurkers[:10] if conn.execute(
            "SELECT 1 FROM agents WHERE id=?", (aid,)).fetchone()]
        if body.role_id and not conn.execute(
                "SELECT 1 FROM server_roles WHERE id=? AND server_id=?",
                (body.role_id, sid)).fetchone():
            raise HTTPException(404, "No such role")
        kind = body.kind if body.kind in ("text", "agents", "forum") else "text"
        ftags = [t.strip()[:24] for t in body.forum_tags[:10] if str(t).strip()]
        cur = conn.execute(
            "INSERT INTO channels(server_id, kind, name, topic, position, roster, lurkers, category, role_id, voice_cap, forum_tags, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, kind, body.name.lstrip("#"), body.topic, pos,
             json.dumps(roster), json.dumps(lurkers), body.category[:48], body.role_id or None,
             max(0, min(int(body.voice_cap or 0), 99)),
             json.dumps(ftags), now()))
        audit(conn, sid, user["id"], "channel.create",
              f"#{body.name.lstrip('#')}", body.kind)
        return channel_json(conn, conn.execute(
            "SELECT * FROM channels WHERE id=?", (cur.lastrowid,)).fetchone(), user["id"])


@router.patch("/api/channels/{cid}")
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
        if body.lurkers is not None:
            lurkers = [aid for aid in body.lurkers[:10] if conn.execute(
                "SELECT 1 FROM agents WHERE id=?", (aid,)).fetchone()]
            conn.execute("UPDATE channels SET lurkers=? WHERE id=?",
                         (json.dumps(lurkers), cid))
        if body.forum_tags is not None:
            conn.execute("UPDATE channels SET forum_tags=? WHERE id=?",
                         (json.dumps([t.strip()[:24] for t in body.forum_tags[:10]
                                      if str(t).strip()]), cid))
        changed = [k for k, v in (("name", body.name), ("topic", body.topic),
                                ("category", body.category), ("slowmode", body.slowmode_secs),
                                ("voice cap", body.voice_cap), ("roster", body.roster),
                                ("lurkers", body.lurkers), ("role gate", body.role_id))
                   if v is not None]
        audit(conn, ch["server_id"], user["id"], "channel.update",
              f"#{ch['name']}", "changed " + ", ".join(changed) if changed else "")
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
        return channel_json(conn, conn.execute(
            "SELECT * FROM channels WHERE id=?", (cid,)).fetchone(), user["id"])


@router.put("/api/channels/{cid}/digest")
async def set_digest(cid: int, body: DigestIn, user=Depends(current_user)):
    """Schedule (or reschedule) an agent recap for a channel — owner only."""
    with db() as conn:
        ch = conn.execute(
            "SELECT c.*, s.owner_id so FROM channels c JOIN servers s ON s.id=c.server_id "
            "WHERE c.id=?", (cid,)).fetchone()
        if not ch or ch["so"] != user["id"]:
            raise HTTPException(404, "No such channel")
        if ch["kind"] == "dm":
            raise HTTPException(400, "Digests are for server channels")
        if body.agent_id and not conn.execute(
                "SELECT 1 FROM agents WHERE id=?", (body.agent_id,)).fetchone():
            raise HTTPException(404, "No such agent")
        conn.execute(
            "INSERT INTO digest_jobs(channel_id, agent_id, interval_secs, last_run, created_by, created_at) "
            "VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(channel_id) DO UPDATE SET agent_id=excluded.agent_id, "
            "interval_secs=excluded.interval_secs, last_run=excluded.last_run, "
            "created_by=excluded.created_by",
            (cid, body.agent_id, int(body.interval_secs), now(), user["id"], now()))
        audit(conn, ch["server_id"], user["id"], "channel.digest",
              f"#{ch['name']}", f"every {int(body.interval_secs)}s")
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
        return channel_json(conn, conn.execute(
            "SELECT * FROM channels WHERE id=?", (cid,)).fetchone(), user["id"])


@router.delete("/api/channels/{cid}/digest")
async def del_digest(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute(
            "SELECT c.*, s.owner_id so FROM channels c JOIN servers s ON s.id=c.server_id "
            "WHERE c.id=?", (cid,)).fetchone()
        if not ch or ch["so"] != user["id"]:
            raise HTTPException(404, "No such channel")
        had = conn.execute("DELETE FROM digest_jobs WHERE channel_id=?", (cid,)).rowcount
        if had:
            audit(conn, ch["server_id"], user["id"], "channel.digest",
                  f"#{ch['name']}", "removed")
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
        return {"ok": True}


@router.post("/api/servers/{sid}/channels/order")
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
        audit(conn, sid, user["id"], "channel.reorder", "", f"{len(ids)} channels")
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


@router.delete("/api/channels/{cid}")
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
        audit(conn, ch["server_id"], user["id"], "channel.delete", f"#{ch['name']}")
        sid = ch["server_id"]
    with db() as conn:
        await _server_changed(conn, sid)
    return {"ok": True}


@router.get("/api/servers/{sid}/audit")
def get_audit(sid: int, before: int = 0, user=Depends(current_user)):
    """Server audit log — owner only, newest first, 50 per page."""
    with db() as conn:
        s = conn.execute("SELECT owner_id FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or s["owner_id"] != user["id"]:
            raise HTTPException(404, "No such server")
        q = ("SELECT a.*, u.username, u.display_name, u.avatar_emoji, u.avatar_color "
             "FROM audit_log a JOIN users u ON u.id=a.actor_id WHERE a.server_id=?")
        args = [sid]
        if before:
            q += " AND a.id<?"
            args.append(before)
        rows = conn.execute(q + " ORDER BY a.id DESC LIMIT 50", args).fetchall()
        return [{"id": r["id"], "action": r["action"], "target": r["target"],
                 "detail": r["detail"], "created_at": r["created_at"],
                 "actor": {"id": r["actor_id"], "username": r["username"],
                          "display_name": r["display_name"],
                          "avatar_emoji": r["avatar_emoji"],
                          "avatar_color": r["avatar_color"]}} for r in rows]
