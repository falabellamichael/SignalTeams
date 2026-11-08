"""Workspaces — shared folders on a host machine that a server's members and
their agents can browse and edit, gated by per-user read/write/admin grants."""
import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import current_user
from ..config import WORKSPACE_AGENT_TOOLS, WORKSPACE_EXEC, WORKSPACE_MAX_BYTES, WORKSPACE_ROOTS
from ..db import db, now
from ..hub import hub

from ..helpers import _agent_llm, _server_llm, _user_llm, audit as server_audit, can_see_agent
from ..schemas import (WorkspaceAgentIn, WorkspaceExecIn, WorkspaceFileIn, WorkspaceGrantIn,
                       WorkspaceIn, WorkspaceMoveIn, WorkspacePatch, WorkspacePathIn)
from .. import workspace as wsx

router = APIRouter()


def _ws_or_404(conn, wid):
    ws = conn.execute("SELECT * FROM workspaces WHERE id=?", (wid,)).fetchone()
    if not ws:
        raise HTTPException(404, "No such workspace")
    return ws


def _member(conn, sid, uid):
    return bool(conn.execute(
        "SELECT 1 FROM server_members WHERE server_id=? AND user_id=?",
        (sid, uid)).fetchone())


def _owner(conn, sid, uid):
    s = conn.execute("SELECT owner_id FROM servers WHERE id=?", (sid,)).fetchone()
    return bool(s and s["owner_id"] == uid)


def _guard(fn, *a, **kw):
    """Run a workspace helper, turning WorkspaceError into an HTTPException."""
    try:
        return fn(*a, **kw)
    except wsx.WorkspaceError as e:
        raise HTTPException(e.code, str(e))


async def _notify(conn, ws, event):
    """Push a workspace event to every member who can read it."""
    ids = [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM server_members WHERE server_id=?",
        (ws["server_id"],)).fetchall()]
    readers = [u for u in ids if wsx.can(conn, ws, u, "read")]
    await hub.send_many(readers, {"type": "workspace", "workspace_id": ws["id"], **event})


# ---------------------------------------------------------------- CRUD

@router.get("/api/servers/{sid}/workspaces")
def list_workspaces(sid: int, user=Depends(current_user)):
    with db() as conn:
        if not _member(conn, sid, user["id"]):
            raise HTTPException(404, "No such server")
        rows = conn.execute("SELECT * FROM workspaces WHERE server_id=? ORDER BY id",
                            (sid,)).fetchall()
        return [wsx.workspace_json(conn, w, user["id"]) for w in rows
                if wsx.can(conn, w, user["id"], "read")]


@router.post("/api/servers/{sid}/workspaces")
async def create_workspace(sid: int, body: WorkspaceIn, user=Depends(current_user)):
    with db() as conn:
        if not _owner(conn, sid, user["id"]):
            raise HTTPException(403, "Only the server owner can add workspaces")
        root = _guard(wsx.check_root, body.root)
        if conn.execute("SELECT 1 FROM workspaces WHERE server_id=? AND root=?",
                        (sid, root)).fetchone():
            raise HTTPException(409, "That folder is already a workspace here")
        cur = conn.execute(
            "INSERT INTO workspaces(server_id, name, icon, root, description, created_by, "
            "created_at) VALUES (?,?,?,?,?,?,?)",
            (sid, body.name.strip()[:64], body.icon or "🗂", root,
             body.description.strip()[:400], user["id"], now()))
        wid = cur.lastrowid
        conn.execute(
            "INSERT INTO workspace_grants(workspace_id, user_id, level, granted_by, created_at) "
            "VALUES (?,?,?,?,?)", (wid, user["id"], "admin", user["id"], now()))
        server_audit(conn, sid, user["id"], "workspace.create", body.name, root)
        ws = _ws_or_404(conn, wid)
        out = wsx.workspace_json(conn, ws, user["id"])
        await _notify(conn, ws, {"action": "created"})
        return out


@router.get("/api/workspaces/{wid}")
def get_workspace(wid: int, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        if not _member(conn, ws["server_id"], user["id"]):
            raise HTTPException(404, "No such workspace")
        _guard(wsx.require, conn, ws, user["id"], "read")
        d = wsx.workspace_json(conn, ws, user["id"])
        d["exists"] = os.path.isdir(ws["root"])
        d["sessions"] = wsx.sessions(conn, wid)
        d["exec_enabled"] = WORKSPACE_EXEC
        d["agent_tools"] = WORKSPACE_AGENT_TOOLS
        return d


@router.patch("/api/workspaces/{wid}")
async def edit_workspace(wid: int, body: WorkspacePatch, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "admin")
        if body.name is not None:
            conn.execute("UPDATE workspaces SET name=? WHERE id=?",
                         (body.name.strip()[:64] or ws["name"], wid))
        if body.icon is not None:
            conn.execute("UPDATE workspaces SET icon=? WHERE id=?", (body.icon or "🗂", wid))
        if body.description is not None:
            conn.execute("UPDATE workspaces SET description=? WHERE id=?",
                         (body.description.strip()[:400], wid))
        if body.root is not None:
            root = _guard(wsx.check_root, body.root)
            conn.execute("UPDATE workspaces SET root=? WHERE id=?", (root, wid))
            conn.execute("DELETE FROM workspace_files WHERE workspace_id=?", (wid,))
        server_audit(conn, ws["server_id"], user["id"], "workspace.update", ws["name"])
        ws = _ws_or_404(conn, wid)
        out = wsx.workspace_json(conn, ws, user["id"])
        await _notify(conn, ws, {"action": "updated"})
        return out


@router.delete("/api/workspaces/{wid}")
async def delete_workspace(wid: int, user=Depends(current_user)):
    """Unlink the workspace — the folder on disk is never touched."""
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        if not _owner(conn, ws["server_id"], user["id"]):
            raise HTTPException(403, "Only the server owner can remove a workspace")
        server_audit(conn, ws["server_id"], user["id"], "workspace.delete", ws["name"],
                     "folder left on disk")
        conn.execute("DELETE FROM workspaces WHERE id=?", (wid,))
        await _notify(conn, ws, {"action": "deleted"})
        return {"ok": True}


# ---------------------------------------------------------------- tree / files

@router.get("/api/workspaces/{wid}/tree")
def get_tree(wid: int, path: str = Query(""), depth: int = Query(2, le=6),
             user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        if not os.path.isdir(ws["root"]):
            raise HTTPException(410, "The workspace folder is missing on this machine")
        wsx.touch_session(conn, wid, user["id"], path)
        return _guard(wsx.tree, conn, ws, path, depth)


@router.get("/api/workspaces/{wid}/file")
def get_file(wid: int, path: str = Query(...), user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        wsx.touch_session(conn, wid, user["id"], path)
        return _guard(wsx.read_file, conn, ws, path, uid=user["id"])


@router.put("/api/workspaces/{wid}/file")
async def put_file(wid: int, body: WorkspaceFileIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "write")
        r = _guard(wsx.write_file, conn, ws, body.path, body.content,
                   uid=user["id"], source="human", note=body.note,
                   create_only=body.create_only)
        await _notify(conn, ws, {"action": "file", "path": r["path"],
                                 "by": user["display_name"]})
        return r


@router.post("/api/workspaces/{wid}/delete")
async def delete_file(wid: int, body: WorkspacePathIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "write")
        r = _guard(wsx.delete_path, conn, ws, body.path, uid=user["id"])
        await _notify(conn, ws, {"action": "file", "path": body.path,
                                 "by": user["display_name"]})
        return r


@router.post("/api/workspaces/{wid}/move")
async def move_file(wid: int, body: WorkspaceMoveIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "write")
        r = _guard(wsx.move_path, conn, ws, body.path, body.to, uid=user["id"])
        await _notify(conn, ws, {"action": "file", "path": r["to"],
                                 "by": user["display_name"]})
        return r


@router.post("/api/workspaces/{wid}/mkdir")
async def make_dir(wid: int, body: WorkspacePathIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "write")
        r = _guard(wsx.mkdir, conn, ws, body.path, uid=user["id"])
        await _notify(conn, ws, {"action": "file", "path": r["path"],
                                 "by": user["display_name"]})
        return r


@router.get("/api/workspaces/{wid}/search")
def search_ws(wid: int, q: str = Query(""), user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        return _guard(wsx.search, conn, ws, q)


@router.get("/api/workspaces/{wid}/history")
def history(wid: int, path: str = Query(...), user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        return _guard(wsx.revisions, conn, ws, path)


@router.get("/api/workspaces/{wid}/diff")
def get_diff(wid: int, path: str = Query(...), rev: int = Query(0),
             user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        return _guard(wsx.diff, conn, ws, path, rev or None)


@router.post("/api/workspaces/{wid}/restore")
async def restore_rev(wid: int, body: dict, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "write")
        r = _guard(wsx.restore, conn, ws, body.get("path", ""),
                   int(body.get("rev") or 0), uid=user["id"])
        await _notify(conn, ws, {"action": "file", "path": r["path"],
                                 "by": user["display_name"]})
        return r


@router.get("/api/workspaces/{wid}/audit")
def get_audit(wid: int, before: int = Query(0), user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        return wsx.audit_json(conn, wid, before)


@router.post("/api/workspaces/{wid}/exec")
def exec_cmd(wid: int, body: WorkspaceExecIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "admin")
        return _guard(wsx.run_command, conn, ws, body.cmd, uid=user["id"])


# ---------------------------------------------------------------- grants

@router.post("/api/workspaces/{wid}/grants")
async def set_grant(wid: int, body: WorkspaceGrantIn, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "admin")
        if not _member(conn, ws["server_id"], body.user_id):
            raise HTTPException(404, "That person isn't in this server")
        if _owner(conn, ws["server_id"], body.user_id):
            raise HTTPException(400, "The server owner always has admin")
        lvl = (body.level or "").strip().lower()
        if lvl and lvl not in wsx.LEVELS:
            raise HTTPException(400, "level must be read, write, admin or blank")
        tgt = conn.execute("SELECT username FROM users WHERE id=?",
                           (body.user_id,)).fetchone()
        if not lvl:
            conn.execute("DELETE FROM workspace_grants WHERE workspace_id=? AND user_id=?",
                         (wid, body.user_id))
        else:
            conn.execute(
                "INSERT INTO workspace_grants(workspace_id, user_id, level, granted_by, "
                "created_at) VALUES (?,?,?,?,?) ON CONFLICT(workspace_id, user_id) "
                "DO UPDATE SET level=excluded.level, granted_by=excluded.granted_by",
                (wid, body.user_id, lvl, user["id"], now()))
        wsx.audit(conn, wid, "grant", f"@{tgt['username'] if tgt else body.user_id}",
                  lvl or "revoked", actor_id=user["id"])
        out = wsx.workspace_json(conn, ws, user["id"])
        await _notify(conn, ws, {"action": "grants"})
        return out


# ---------------------------------------------------------------- agent bridge

@router.post("/api/workspaces/{wid}/agent")
async def agent_work(wid: int, body: WorkspaceAgentIn, user=Depends(current_user)):
    """Let an agent work inside the workspace with tool calls.

    The agent inherits the caller's permission level, so it can never read or
    write more than the person asking. Every tool call lands in the workspace
    audit log with the agent's id attached.
    """
    from ..llm import chat as llm_chat
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        a = conn.execute("SELECT * FROM agents WHERE id=?", (body.agent_id,)).fetchone()
        if not a or not can_see_agent(conn, a, user["id"]):
            raise HTTPException(404, "No such agent")
        ep = _agent_llm(a) or _server_llm(conn, ws["server_id"]) or _user_llm(conn, user["id"])
        lvl = wsx.level_of(conn, ws, user["id"])
        tools = wsx.agent_tools(conn, ws, user["id"]) if WORKSPACE_AGENT_TOOLS else []
        focus = body.path or ""
        if focus:
            try:
                f = wsx.read_file(conn, ws, focus, uid=user["id"], record=False)
                focus_txt = f"\n\nOpen file `{focus}`:\n```\n{f['content'][:6000]}\n```"
            except wsx.WorkspaceError:
                focus_txt = ""
        else:
            focus_txt = ""
        sysp = (a["system_prompt"] or f"You are {a['name']}, a coding agent.") + (
            f"\n\nYou are working inside the shared workspace \"{ws['name']}\" "
            f"(folder: {ws['root']}). Your access level is {lvl}. "
            "Use the tools to inspect and edit files. Prefer reading before writing, "
            "keep edits minimal, and summarize what you changed at the end.\n"
            "To call a tool, reply with ONLY a JSON object like "
            '{"tool": "read_file", "args": {"path": "README.md"}} — one call per reply. '
            "Available tools: " + ", ".join(t["function"]["name"] for t in tools)
            + focus_txt)
        history = []
        steps = []
        reply = ""
        for _ in range(4):
            try:
                reply, _prov, _model = await asyncio.to_thread(
                    llm_chat, sysp, history, body.message, endpoint=ep)
            except Exception as e:
                raise HTTPException(502, f"Agent brain offline — {e}")
            calls = wsx.parse_tool_calls(reply)
            if not calls:
                break
            for c in calls[:4]:
                res = wsx.run_tool(conn, ws, user["id"], a["id"], c["name"], c["args"])
                steps.append({"tool": c["name"], "args": c["args"], "result": res})
                history.append({"role": "assistant", "content": reply})
                history.append({"role": "user", "content":
                                f"TOOL RESULT {c['name']}: "
                                f"{json.dumps(res)[:6000]}\n\nContinue."})
            reply = ""
        if not reply:
            reply = "Done — see the tool steps above."
        out = wsx.workspace_json(conn, ws, user["id"])
        await _notify(conn, ws, {"action": "agent", "by": a["name"]})
        return {"reply": reply[:4000], "steps": steps, "workspace": out}


@router.get("/api/workspaces/{wid}/sessions")
def get_sessions(wid: int, user=Depends(current_user)):
    with db() as conn:
        ws = _ws_or_404(conn, wid)
        _guard(wsx.require, conn, ws, user["id"], "read")
        return wsx.sessions(conn, wid)


@router.get("/api/workspace-roots")
def allowed_roots(user=Depends(current_user)):
    """What the host allows as a workspace root — powers the folder picker."""
    return {"roots": WORKSPACE_ROOTS, "exec": WORKSPACE_EXEC,
            "max_bytes": WORKSPACE_MAX_BYTES}
