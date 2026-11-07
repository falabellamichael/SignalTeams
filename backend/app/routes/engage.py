"""Engagement extras: scribe recaps, knocks, reminders, huddle."""
import asyncio
import json
import time

from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, now
from ..hub import hub

from ..helpers import _fmt_due, _gated_channel, can_see_agent, channel_member_ids, public_user
from ..schemas import KnockIn, ReminderIn, SummarizeIn
from ..services import REMIND_BOT, _agent_cool, _summarize_task, agent_reply, bot_post

router = APIRouter()


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
