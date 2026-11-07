"""Misc: emoji, uploads, buzz feed, inbox, health."""
import json
import re
import secrets
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from ..auth import current_user, optional_user
from ..db import db, now

from ..helpers import friend_ids
from ..services import _server_changed

router = APIRouter()


EMOJI_MAX = 256 * 1024      # 256 KB — emotes stay tiny


EMOJI_PER_SERVER = 50


@router.post("/api/servers/{sid}/emojis")
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


@router.delete("/api/emojis/{eid}")
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


MAX_UPLOAD = 8 * 1024 * 1024  # 8 MB


@router.post("/api/upload")
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


@router.get("/api/files/{fid}")
def get_file(fid: str, user=Depends(optional_user)):
    with db() as conn:
        f = conn.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        if not f:
            raise HTTPException(404, "No such file")
        return Response(content=f["data"], media_type=f["mime"],
                        headers={"Content-Disposition":
                                 f'inline; filename="{f["name"].replace(chr(34), "")}"',
                                 "Cache-Control": "max-age=86400"})


@router.get("/api/buzz")
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


@router.get("/api/inbox")
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


@router.get("/api/health")
def health():
    return {"ok": True, "app": "signalteams", "time": time.time()}


@router.get("/api/stats")
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
