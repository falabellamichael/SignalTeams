"""Direct messages and group DMs."""
from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, now
from ..hub import hub

from ..helpers import agent_bot_user, can_see_agent, is_blocked, public_user
from ..schemas import AgentDmAddIn, DmRenameIn, GroupDmIn
from ..services import bot_post

router = APIRouter()


@router.get("/api/dms")
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


@router.post("/api/dms/group")
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


@router.post("/api/dms/{cid}/add")
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


@router.post("/api/dms/{cid}/add-agent")
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


@router.patch("/api/dms/{cid}")
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


@router.post("/api/dms/{cid}/leave")
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


@router.post("/api/dms/{other_id}")
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


@router.post("/api/agents/{aid}/dm")
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
