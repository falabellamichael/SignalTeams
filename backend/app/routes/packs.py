"""Agent packs: shareable bundles."""
from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, emit_buzz, now
from ..hub import hub

from ..helpers import agent_json, can_see_agent, can_see_pack, friend_ids, pack_agent_ids, pack_json
from ..schemas import PackIn

router = APIRouter()


@router.get("/api/packs")
def list_packs(user=Depends(current_user)):
    with db() as conn:
        fids = set(friend_ids(conn, user["id"])) | {user["id"]}
        rows = conn.execute("SELECT * FROM agent_packs ORDER BY id DESC").fetchall()
        return [pack_json(conn, p, user["id"]) for p in rows if p["owner_id"] in fids]


@router.post("/api/packs")
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


@router.get("/api/packs/{pid}")
def get_pack(pid: int, user=Depends(current_user)):
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or not can_see_pack(conn, p, user["id"]):
            raise HTTPException(404, "No such pack")
        d = pack_json(conn, p, user["id"])
        d["agents"] = [agent_json(conn, a, user["id"]) for a in pack_agent_ids(conn, pid, user["id"])]
        return d


@router.delete("/api/packs/{pid}")
async def delete_pack(pid: int, user=Depends(current_user)):
    with db() as conn:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (pid,)).fetchone()
        if not p or p["owner_id"] != user["id"]:
            raise HTTPException(404, "No such pack")
        conn.execute("DELETE FROM agent_packs WHERE id=?", (pid,))
    return {"ok": True}


@router.post("/api/packs/{pid}/fork")
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


@router.post("/api/packs/{pid}/bench")
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
