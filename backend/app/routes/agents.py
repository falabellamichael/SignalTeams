"""Agent library: CRUD, stars, installs, forks, reviews."""
import json
import re

from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, emit_buzz, now, row_to_dict
from ..hub import hub

from ..helpers import agent_json, can_see_agent, friend_ids, public_user
from ..schemas import AgentIn, AgentPatch, ReviewIn
from .engage import AI_FLAG_KEYS

router = APIRouter()


@router.get("/api/agents")
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


@router.get("/api/agents/trending")
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


@router.get("/api/agents/{aid}/stats")
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


@router.post("/api/agents")
async def create_agent(body: AgentIn, user=Depends(current_user)):
    with db() as conn:
        ai_flags = json.dumps({k: bool(v) for k, v in (body.ai_flags or {}).items()
                             if k in AI_FLAG_KEYS})
        cur = conn.execute(
            "INSERT INTO agents(owner_id, name, icon, tagline, description, system_prompt, model, "
            "temperature, context_url, context_method, context_headers, api_kind, api_url, api_key, api_headers, "
            "tags, version, visibility, ai_flags, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user["id"], body.name, body.icon, body.tagline, body.description, body.system_prompt,
             body.model, body.temperature, (body.context_url or "").strip()[:512],
             (body.context_method or "GET").upper(), body.context_headers,
             (body.api_kind or "").strip(), (body.api_url or "").strip().rstrip("/")[:512],
             (body.api_key or "").strip()[:256], body.api_headers,
             json.dumps(body.tags), body.version, body.visibility, ai_flags, now(), now()))
        a = conn.execute("SELECT * FROM agents WHERE id=?", (cur.lastrowid,)).fetchone()
        emit_buzz(conn, user["id"], "published", {"agent_id": a["id"], "name": a["name"]})
        result = agent_json(conn, a, user["id"])
        fids = friend_ids(conn, user["id"]) + [user["id"]]
    await hub.send_many(fids, {"type": "buzz"})
    return result


@router.get("/api/agents/{aid}")
def get_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        return agent_json(conn, a, user["id"])


@router.patch("/api/agents/{aid}")
def update_agent(aid: int, body: AgentPatch, user=Depends(current_user)):
    """Merge-PATCH — only fields the client actually sent are written, so a
    partial body (e.g. {use_who, use_when} from mobile permissions, or
    {ai_flags} alone) never resets everything else to schema defaults."""
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
        sent = body.model_fields_set
        keep = lambda k: getattr(body, k) if k in sent else a[k]
        # secrets: None keeps stored, "" clears (unchanged semantics)
        new_key = a["api_key"] if body.api_key is None else body.api_key.strip()[:256]
        new_api_hdrs = a["api_headers"] if body.api_headers is None else (body.api_headers.strip() or None)
        new_ctx_hdrs = a["context_headers"] if body.context_headers is None else (body.context_headers.strip() or None)
        if body.use_who is None:
            use_who = a["use_who"]
        elif body.use_who in ("", "public", "friends", "people", "private"):
            use_who = body.use_who
        else:
            raise HTTPException(400, "use_who must be public|friends|people|private")
        if body.use_when is None:
            use_when = a["use_when"]
        elif body.use_when in ("always", "online", "off"):
            use_when = body.use_when
        else:
            raise HTTPException(400, "use_when must be always|online|off")
        ai_flags = a["ai_flags"] if body.ai_flags is None else json.dumps(
            {k: bool(v) for k, v in (body.ai_flags or {}).items() if k in AI_FLAG_KEYS})
        conn.execute(
            "UPDATE agents SET name=?, icon=?, tagline=?, description=?, system_prompt=?, model=?, "
            "temperature=?, context_url=?, context_method=?, context_headers=?, "
            "api_kind=?, api_url=?, api_key=?, api_headers=?, "
            "tags=?, version=?, visibility=?, use_who=?, use_when=?, ai_flags=?, updated_at=? WHERE id=?",
            (keep("name"), keep("icon"), keep("tagline"), keep("description"),
             keep("system_prompt"), keep("model"), keep("temperature"),
             (keep("context_url") or "").strip()[:512],
             (keep("context_method") or "GET").upper(), new_ctx_hdrs,
             (keep("api_kind") or "").strip(),
             (keep("api_url") or "").strip().rstrip("/")[:512],
             new_key, new_api_hdrs,
             json.dumps(keep("tags") if "tags" in sent
                        else json.loads(a["tags"] or "[]")),
             keep("version"), keep("visibility"),
             use_who, use_when, ai_flags, now(), aid))
        if body.allowed_user_ids is not None:
            conn.execute("DELETE FROM agent_allowed_users WHERE agent_id=?", (aid,))
            conn.executemany(
                "INSERT OR IGNORE INTO agent_allowed_users(agent_id, user_id) VALUES (?,?)",
                [(aid, int(u)) for u in (body.allowed_user_ids or [])[:64]])
        return agent_json(conn, conn.execute(
            "SELECT * FROM agents WHERE id=?", (aid,)).fetchone(), user["id"])


@router.delete("/api/agents/{aid}")
def delete_agent(aid: int, user=Depends(current_user)):
    with db() as conn:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if not a or a["owner_id"] != user["id"]:
            raise HTTPException(404, "No such agent")
        conn.execute("DELETE FROM agents WHERE id=?", (aid,))
        return {"ok": True}


@router.post("/api/agents/{aid}/star")
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


@router.post("/api/agents/{aid}/install")
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


@router.get("/api/agents/{aid}/export")
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


@router.post("/api/agents/import")
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


@router.get("/api/bench")
def my_bench(user=Depends(current_user)):
    """Agents the user installed to their bench."""
    with db() as conn:
        rows = conn.execute(
            "SELECT a.* FROM agents a JOIN agent_installs i ON i.agent_id=a.id "
            "WHERE i.user_id=? ORDER BY i.created_at DESC", (user["id"],)).fetchall()
        return [agent_json(conn, a, user["id"]) for a in rows]


@router.post("/api/agents/{aid}/fork")
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
            "temperature, context_url, tags, version, visibility, forked_from, ai_flags, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user["id"], a["name"], a["icon"], a["tagline"], a["description"], a["system_prompt"],
             a["model"], a["temperature"], a["context_url"], a["tags"], a["version"],
             "friends", attribution, a["ai_flags"], now(), now()))
        new = conn.execute("SELECT * FROM agents WHERE id=?", (cur.lastrowid,)).fetchone()
        emit_buzz(conn, user["id"], "forked", {"agent_id": new["id"], "name": a["name"]})
        return agent_json(conn, new, user["id"])


@router.get("/api/agents/{aid}/history")
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


@router.get("/api/agents/{aid}/reviews")
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


@router.post("/api/agents/{aid}/reviews")
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
