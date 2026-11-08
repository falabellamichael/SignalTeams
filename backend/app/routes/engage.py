"""Engagement extras: scribe recaps, knocks, reminders, huddle."""
import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, now
from ..hub import hub

from ..helpers import (_fmt_due, _gated_channel, _server_llm, _user_llm, audit,
                       can_see_agent, channel_member_ids, public_user)
from ..schemas import EventIn, KnockIn, ReminderIn, SummarizeIn
from ..services import (REMIND_BOT, _agent_cool, _reply_cancel, _server_changed,
                        _summarize_task,
                        agent_reply, bot_post)

router = APIRouter()


def _event_json(conn, e, uid):
    d = dict(e)
    d["interested"] = json.loads(d["interested"] or "[]")
    d["me_interested"] = uid in d["interested"]
    d["interested_count"] = len(d["interested"])
    c = conn.execute("SELECT * FROM users WHERE id=?", (e["creator_id"],)).fetchone()
    d["creator"] = public_user(c) if c else None
    if e["channel_id"]:
        ch = conn.execute("SELECT name FROM channels WHERE id=?",
                          (e["channel_id"],)).fetchone()
        d["channel_name"] = ch["name"] if ch else "?"
    else:
        d["channel_name"] = None
    return d


@router.post("/api/channels/{cid}/summarize")
async def summarize(cid: int, body: SummarizeIn, user=Depends(current_user)):
    """Queue a Scribe recap of the channel's recent messages. The reply posts
    via WS like an agent reply — the endpoint just validates and returns."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
    asyncio.create_task(_summarize_task(cid, user["id"], body.count))
    return {"queued": body.count}


@router.post("/api/channels/{cid}/knock")
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


@router.get("/api/channels/{cid}/knocks")
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


@router.post("/api/channels/{cid}/knocks/{uid}")
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
        if ch["server_id"]:
            audit(conn, ch["server_id"], user["id"],
                  "member.approve" if body.approve else "member.deny",
                  f"@{knocker['username']}" if knocker else str(uid), f"#{ch['name']}")
    if body.approve:
        await bot_post(cid, "bot:system", "System", "📡",
                       f"🚪 {user['display_name']} let **{knocker['display_name']}** in")
    await hub.send_many([uid], {"type": "buzz"})
    return {"approved": body.approve}


@router.post("/api/reminders")
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


@router.get("/api/reminders")
def my_reminders(user=Depends(current_user)):
    with db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT r.*, c.name channel_name FROM reminders r "
            "JOIN channels c ON c.id=r.channel_id "
            "WHERE r.user_id=? AND r.fired=0 ORDER BY r.due_at",
            (user["id"],)).fetchall()]


@router.delete("/api/reminders/{rid}")
def del_reminder(rid: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM reminders WHERE id=?", (rid,)).fetchone()
        if not r or r["user_id"] != user["id"]:
            raise HTTPException(404, "No such reminder")
        conn.execute("DELETE FROM reminders WHERE id=?", (rid,))
        return {"ok": True}


@router.get("/api/servers/{sid}/events")
def list_events(sid: int, user=Depends(current_user)):
    """Upcoming + recently-started events for a server (member-gated)."""
    with db() as conn:
        if not conn.execute(
                "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                (sid, user["id"])).fetchone():
            raise HTTPException(404, "No such server")
        rows = conn.execute(
            "SELECT * FROM events WHERE server_id=? AND status!='cancelled' "
            "AND starts_at > ? ORDER BY starts_at LIMIT 100",
            (sid, now() - 4 * 3600)).fetchall()   # keep live events visible 4h past start
        return [_event_json(conn, r, user["id"]) for r in rows]


@router.post("/api/servers/{sid}/events")
async def add_event(sid: int, body: EventIn, user=Depends(current_user)):
    with db() as conn:
        s = conn.execute("SELECT * FROM servers WHERE id=?", (sid,)).fetchone()
        if not s or not conn.execute(
                "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                (sid, user["id"])).fetchone():
            raise HTTPException(404, "No such server")
        if body.starts_at <= now() - 60:
            raise HTTPException(400, "Start time must be in the future")
        if conn.execute("SELECT COUNT(*) c FROM events WHERE server_id=? "
                        "AND status='scheduled'", (sid,)).fetchone()["c"] >= 25:
            raise HTTPException(400, "25 upcoming events max")
        cid = body.channel_id
        if cid is not None:
            ch = conn.execute("SELECT * FROM channels WHERE id=? AND server_id=?",
                              (cid, sid)).fetchone()
            if not ch or ch["kind"] not in ("text", "forum"):
                raise HTTPException(400, "Pick a text channel for announcements")
        else:
            ch = conn.execute(
                "SELECT * FROM channels WHERE server_id=? AND kind IN ('text','forum') "
                "ORDER BY position, id LIMIT 1", (sid,)).fetchone()
            cid = ch["id"] if ch else None
        cur = conn.execute(
            "INSERT INTO events(server_id, channel_id, name, description, starts_at, "
            "creator_id, interested, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (sid, cid, body.name.strip(), body.description.strip()[:400],
             body.starts_at, user["id"], json.dumps([user["id"]]), now()))
        eid = cur.lastrowid
        audit(conn, sid, user["id"], "event.create", body.name.strip(),
              f"starts {time.strftime('%Y-%m-%d %H:%M', time.localtime(body.starts_at))}")
        ev = _event_json(conn, conn.execute(
            "SELECT * FROM events WHERE id=?", (eid,)).fetchone(), user["id"])
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?", (sid,)).fetchall()]
    await hub.send_many(members, {"type": "event", "server_id": sid, "event": ev})
    return ev


@router.patch("/api/events/{eid}")
async def edit_event(eid: int, body: EventIn, user=Depends(current_user)):
    with db() as conn:
        e = conn.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
        if not e or e["status"] == "cancelled":
            raise HTTPException(404, "No such event")
        s = conn.execute("SELECT * FROM servers WHERE id=?", (e["server_id"],)).fetchone()
        if user["id"] not in (e["creator_id"], s["owner_id"]):
            raise HTTPException(403, "Only the creator or server owner can edit")
        if body.starts_at <= now() - 60:
            raise HTTPException(400, "Start time must be in the future")
        cid = body.channel_id
        if cid is not None and not conn.execute(
                "SELECT 1 FROM channels WHERE id=? AND server_id=? AND kind IN ('text','forum')",
                (cid, e["server_id"])).fetchone():
            raise HTTPException(400, "Pick a text channel for announcements")
        conn.execute(
            "UPDATE events SET name=?, description=?, channel_id=?, starts_at=? WHERE id=?",
            (body.name.strip(), body.description.strip()[:400],
             cid if cid is not None else e["channel_id"], body.starts_at, eid))
        ev = _event_json(conn, conn.execute(
            "SELECT * FROM events WHERE id=?", (eid,)).fetchone(), user["id"])
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?",
            (e["server_id"],)).fetchall()]
    await hub.send_many(members, {"type": "event", "server_id": e["server_id"],
                                  "event": ev})
    return ev


@router.post("/api/events/{eid}/interested")
async def toggle_interested(eid: int, user=Depends(current_user)):
    with db() as conn:
        e = conn.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
        if not e or e["status"] == "cancelled" or not conn.execute(
                "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
                (e["server_id"], user["id"])).fetchone():
            raise HTTPException(404, "No such event")
        interested = json.loads(e["interested"] or "[]")
        if user["id"] in interested:
            interested.remove(user["id"])
        else:
            interested.append(user["id"])
        conn.execute("UPDATE events SET interested=? WHERE id=?",
                     (json.dumps(interested), eid))
        ev = _event_json(conn, conn.execute(
            "SELECT * FROM events WHERE id=?", (eid,)).fetchone(), user["id"])
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?",
            (e["server_id"],)).fetchall()]
    await hub.send_many(members, {"type": "event", "server_id": e["server_id"],
                                  "event": ev})
    return ev


@router.delete("/api/events/{eid}")
async def del_event(eid: int, user=Depends(current_user)):
    """Cancel an event — creator or server owner."""
    with db() as conn:
        e = conn.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
        if not e or e["status"] == "cancelled":
            raise HTTPException(404, "No such event")
        s = conn.execute("SELECT * FROM servers WHERE id=?", (e["server_id"],)).fetchone()
        if user["id"] not in (e["creator_id"], s["owner_id"]):
            raise HTTPException(403, "Only the creator or server owner can cancel")
        conn.execute("UPDATE events SET status='cancelled' WHERE id=?", (eid,))
        audit(conn, e["server_id"], user["id"], "event.cancel", e["name"])
        members = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?",
            (e["server_id"],)).fetchall()]
    await hub.send_many(members, {"type": "event", "server_id": e["server_id"],
                                  "event": {"id": eid, "status": "cancelled"}})
    return {"ok": True}


@router.post("/api/channels/{cid}/huddle")
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
        visible = {a["id"]: a["name"] for a in
                   conn.execute("SELECT * FROM agents").fetchall()
                   if can_see_agent(conn, a, user["id"])}
    summoned = []
    for i, aid in enumerate([a for a in roster if a in visible]):
        k = (aid, cid)
        if time.time() - _agent_cool.get(k, 0) < 8:
            await hub.send_many(members, {
                "type": "typing", "channel_id": cid, "on": True,
                "user": {"id": f"agent:{aid}", "display_name": visible.get(aid) or "agent",
                         "bot": True, "phase": "cooling down"}})
            continue
        _agent_cool[k] = time.time()
        summoned.append(aid)
        async def delayed(a=aid, d=i * 1.5):
            await asyncio.sleep(d)
            await agent_reply(cid, a, user["id"], last["id"])
        asyncio.create_task(delayed())
    return {"summoned": summoned}


AI_FLAG_KEYS = ("web", "stt", "tts", "vision", "translate", "summarize")


@router.patch("/api/channels/{cid}/ai")
async def set_channel_ai(cid: int, body: dict, user=Depends(current_user)):
    """Per-channel AI capability toggles — any member may flip them; they affect
    agent replies (web tools, vision), auto-recaps, and client-side features
    (dictation, speak-aloud, translate line) for everyone in the channel."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such channel")
        if user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(403, "Not a member")
        try:
            cur = json.loads(ch["ai_flags"] or "{}")
        except Exception:
            cur = {}
        for k in AI_FLAG_KEYS:
            if k in (body or {}):
                cur[k] = bool(body[k])
        conn.execute("UPDATE channels SET ai_flags=? WHERE id=?",
                     (json.dumps(cur), cid))
        sid = ch["server_id"]
    if sid:  # members on other clients see the new toggles immediately
        with db() as conn:
            await _server_changed(conn, sid)
    return {"ai": cur}


@router.post("/api/channels/{cid}/translate")
async def translate_text(cid: int, body: dict, user=Depends(current_user)):
    """Translate a message via the requester's configured LLM."""
    from ..llm import chat as llm_chat
    text = str((body or {}).get("text") or "")[:2000]
    if not text.strip():
        raise HTTPException(400, "No text")
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        ep = _server_llm(conn, ch["server_id"]) or _user_llm(conn, user["id"])
    if not ep:
        raise HTTPException(503, "No LLM configured")
    try:
        out, _p, _m = await asyncio.to_thread(
            llm_chat,
            "Translate the user's message to English. Reply with ONLY the "
            "translation — no commentary, no quotes, no explanation.", [],
            text, endpoint=ep)
    except Exception as e:
        raise HTTPException(502, f"translation failed — {e}")
    return {"text": out.strip()}


@router.post("/api/channels/{cid}/agents/stop")
def stop_channel_agents(cid: int, body: dict, user=Depends(current_user)):
    """Cancel in-flight agent replies in a channel — the typing-row ✕.
    Any member can stop a runaway reply; `bot_id` targets one typer."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            raise HTTPException(404, "No such channel")
        if user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(403, "Not a member")
    try:
        bid = int((body or {}).get("bot_id") or 0)
    except (TypeError, ValueError):
        bid = 0
    if bid:
        _reply_cancel.add((cid, bid))
    return {"ok": True}
