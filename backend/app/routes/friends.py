"""Friends and blocks."""
from fastapi import APIRouter, Depends, HTTPException
from ..auth import current_user
from ..db import db, emit_buzz, now

from ..helpers import is_blocked, public_user
from ..schemas import FriendIn

router = APIRouter()


@router.get("/api/friends")
def friends(user=Depends(current_user)):
    with db() as conn:
        uid = user["id"]
        out = {"accepted": [], "incoming": [], "outgoing": []}
        rows = conn.execute(
            "SELECT * FROM friendships WHERE user_id=? OR friend_id=?", (uid, uid)).fetchall()
        for r in rows:
            other_id = r["friend_id"] if r["user_id"] == uid else r["user_id"]
            other = public_user(conn.execute("SELECT * FROM users WHERE id=?", (other_id,)).fetchone())
            other["friendship_id"] = r["id"]
            if r["status"] == "accepted":
                out["accepted"].append(other)
            elif r["user_id"] == uid:
                out["outgoing"].append(other)
            else:
                out["incoming"].append(other)
        return out


@router.post("/api/friends")
def add_friend(body: FriendIn, user=Depends(current_user)):
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        if not target:
            raise HTTPException(404, "No such user")
        if target["id"] == user["id"]:
            raise HTTPException(400, "That's you")
        if is_blocked(conn, user["id"], target["id"]):
            raise HTTPException(403, "Blocked — unblock them first")
        existing = conn.execute(
            "SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
            (user["id"], target["id"], target["id"], user["id"])).fetchone()
        if existing:
            if existing["status"] == "pending" and existing["friend_id"] == user["id"]:
                conn.execute("UPDATE friendships SET status='accepted' WHERE id=?", (existing["id"],))
                emit_buzz(conn, user["id"], "friended", {"with": target["username"]})
                return {"status": "accepted"}
            raise HTTPException(409, "Already friends or pending")
        conn.execute(
            "INSERT INTO friendships(user_id, friend_id, status, created_at) VALUES (?,?,?,?)",
            (user["id"], target["id"], "pending", now()))
        return {"status": "pending"}


@router.get("/api/blocks")
def my_blocks(user=Depends(current_user)):
    with db() as conn:
        return [r["blocked_id"] for r in conn.execute(
            "SELECT blocked_id FROM blocks WHERE user_id=?", (user["id"],)).fetchall()]


@router.post("/api/blocks/{uid}")
def toggle_block(uid: int, user=Depends(current_user)):
    if uid == user["id"]:
        raise HTTPException(400, "Can't block yourself")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "No such user")
        have = conn.execute("SELECT id FROM blocks WHERE user_id=? AND blocked_id=?",
                            (user["id"], uid)).fetchone()
        if have:
            conn.execute("DELETE FROM blocks WHERE id=?", (have["id"],))
            return {"blocked": False}
        conn.execute("INSERT INTO blocks(user_id, blocked_id, created_at) VALUES (?,?,?)",
                     (user["id"], uid, now()))
        # blocking severs the friendship + any pending requests, Discord-style
        conn.execute(
            "DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
            (user["id"], uid, uid, user["id"]))
        return {"blocked": True}


@router.post("/api/friends/{friendship_id}/accept")
def accept_friend(friendship_id: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM friendships WHERE id=?", (friendship_id,)).fetchone()
        if not r or r["friend_id"] != user["id"]:
            raise HTTPException(404, "No such request")
        conn.execute("UPDATE friendships SET status='accepted' WHERE id=?", (friendship_id,))
        return {"status": "accepted"}


@router.delete("/api/friends/{friendship_id}")
def remove_friend(friendship_id: int, user=Depends(current_user)):
    with db() as conn:
        r = conn.execute("SELECT * FROM friendships WHERE id=?", (friendship_id,)).fetchone()
        if not r or user["id"] not in (r["user_id"], r["friend_id"]):
            raise HTTPException(404, "No such friendship")
        conn.execute("DELETE FROM friendships WHERE id=?", (friendship_id,))
        return {"ok": True}
