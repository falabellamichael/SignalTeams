"""Channel messages: CRUD, reactions, pins, saved, search."""
import asyncio
import json
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import current_user
from ..db import db, emit_buzz, now
from ..hub import hub

from ..helpers import STAR_EMOJI, URL_RE, _parse_search, can_see_agent, can_see_pack, channel_member_ids, is_blocked, message_json, public_user, reactions_json, unfurl
from ..schemas import EditIn, MessageIn, ReactIn
from ..services import _agent_cool, agent_reply, starboard_check

router = APIRouter()


@router.get("/api/channels/{cid}/messages")
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


@router.post("/api/channels/{cid}/read")
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


@router.post("/api/me/read-all")
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


@router.post("/api/channels/{cid}/mark-unread")
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


@router.post("/api/channels/{cid}/messages")
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


@router.get("/api/messages/{mid}/peek")
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


@router.delete("/api/messages/{mid}")
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


@router.patch("/api/messages/{mid}")
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


@router.post("/api/messages/{mid}/react")
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


@router.post("/api/messages/{mid}/pin")
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


@router.get("/api/channels/{cid}/pins")
def get_pins(cid: int, user=Depends(current_user)):
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch or user["id"] not in channel_member_ids(conn, ch):
            raise HTTPException(404, "No such channel")
        rows = conn.execute(
            "SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY id DESC",
            (cid,)).fetchall()
        return [message_json(conn, m, user["id"]) for m in rows]


@router.post("/api/messages/{mid}/save")
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


@router.get("/api/saved")
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


@router.get("/api/channels/{cid}/search")
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


@router.get("/api/messages/{mid}/thread")
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


@router.get("/api/search")
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
