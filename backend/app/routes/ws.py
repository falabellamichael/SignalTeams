"""Realtime websocket endpoint."""
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..auth import user_by_token
from ..db import db
from ..hub import hub

from ..helpers import channel_member_ids

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    with db() as conn:
        u = user_by_token(conn, token)
        if not u:
            await ws.close(code=4401)
            return
        uid = u["id"]
        conn.execute("UPDATE users SET status='online' WHERE id=? AND status='offline'", (uid,))
    await hub.connect(uid, ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                evt = json.loads(raw)
            except Exception:
                continue
            t = evt.get("type")
            if t == "typing":
                cid = int(evt.get("channel_id", 0))
                with db() as conn:
                    ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                    members = channel_member_ids(conn, ch) if ch else []
                # was channel_member_ids ×2 per keystroke — one pass now
                if uid in members:
                    await hub.send_many([m for m in members if m != uid], {
                        "type": "typing", "channel_id": cid,
                        "user": {"id": uid, "display_name": u["display_name"]},
                        "on": bool(evt.get("on"))})
            elif t == "status":
                status = str(evt.get("status", "online"))[:16]
                with db() as conn:
                    conn.execute("UPDATE users SET status=? WHERE id=?", (status, uid))
                await hub.broadcast({"type": "status", "user_id": uid, "status": status})
            elif t == "voice_join":
                cid = int(evt.get("channel_id", 0))
                with db() as conn:
                    ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                    members = channel_member_ids(conn, ch) if ch else []
                if uid in members:
                    cap = (ch["voice_cap"] if "voice_cap" in ch.keys() else 0) or 0
                    if cap and uid not in (r["id"] for r in hub.voice_roster(cid)) \
                            and len(hub.voice_roster(cid)) >= cap:
                        await hub.send(uid, {"type": "voice_reject",
                                             "channel_id": cid,
                                             "reason": "Voice channel is full"})
                    else:
                        roster = hub.voice_join(cid, uid, {
                            "id": uid, "display_name": u["display_name"],
                            "avatar_emoji": u["avatar_emoji"], "avatar_color": u["avatar_color"],
                            "muted": False, "sharing": False, "deafened": False,
                            "cam": False}, ws)
                        await hub.send_many(members, {
                            "type": "voice", "channel_id": cid, "members": roster})
            elif t == "voice_leave":
                cid = int(evt.get("channel_id", 0))
                if hub.voice_leave(cid, uid):
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid,
                        "members": hub.voice_roster(cid)})
            elif t == "voice_mute":
                cid = int(evt.get("channel_id", 0))
                roster = hub.voice_mute(cid, uid, bool(evt.get("muted")))
                if roster is not None:
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid, "members": roster})
            elif t in ("voice_screen", "voice_cam", "voice_deafen"):
                cid = int(evt.get("channel_id", 0))
                flag = {"voice_screen": "sharing", "voice_cam": "cam",
                        "voice_deafen": "deafened"}[t]
                fn = {"sharing": hub.voice_share, "cam": hub.voice_cam,
                      "deafened": hub.voice_deafen}[flag]
                roster = fn(cid, uid, bool(evt.get(flag)))
                if roster is not None:
                    with db() as conn:
                        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                        members = channel_member_ids(conn, ch) if ch else []
                    await hub.send_many(members, {
                        "type": "voice", "channel_id": cid, "members": roster})
            elif t == "voice_media":
                # stream-kind hints (cam vs screen) — relay to room so receivers
                # can label remote video tiles by stream.id
                cid = int(evt.get("channel_id", 0))
                room = hub.voice.get(cid, {})
                if uid in room:
                    await hub.send_many(list(room.keys()), {
                        "type": "voice_media", "channel_id": cid,
                        "from": uid, "data": evt.get("data")})
            elif t == "voice_status":
                cid = int(evt.get("channel_id", 0))
                await hub.send(uid, {
                    "type": "voice", "channel_id": cid,
                    "members": hub.voice_roster(cid)})
            elif t == "voice_signal":
                cid = int(evt.get("channel_id", 0))
                to = int(evt.get("to", 0))
                room = hub.voice.get(cid, {})
                if uid in room and to in room:
                    await hub.send(to, {
                        "type": "voice_signal", "channel_id": cid,
                        "from": uid, "data": evt.get("data")})
            elif t == "soundboard":
                cid = int(evt.get("channel_id", 0))
                sound = str(evt.get("sound", ""))[:32]
                room = hub.voice.get(cid, {})
                if uid in room and sound:
                    await hub.send_many(list(room.keys()), {
                        "type": "soundboard", "channel_id": cid,
                        "sound": sound, "from": uid,
                        "from_name": u["display_name"]})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(uid, ws)
        with db() as conn:
            # only flip to offline once the user's LAST socket is gone — other
            # tabs/devices keep them online
            if uid not in hub.sockets:
                conn.execute("UPDATE users SET status='offline' WHERE id=?", (uid,))
            for cid, roster in hub.voice_leave_ws(uid, ws):
                ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
                if ch:
                    await hub.send_many(channel_member_ids(conn, ch), {
                        "type": "voice", "channel_id": cid, "members": roster})
        await hub.broadcast_presence()
