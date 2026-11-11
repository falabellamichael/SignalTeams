"""Realtime hub: tracks websocket connections, presence, and broadcasts."""
import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self):
        # user_id -> set[WebSocket]
        self.sockets: dict[int, set[WebSocket]] = defaultdict(set)
        # channel_id -> set[user_id] currently viewing (for typing scope)
        self.viewing: dict[int, set[int]] = defaultdict(set)
        # channel_id -> {user_id: member_info} — live voice rooms (ephemeral)
        self.voice: dict[int, dict[int, dict]] = defaultdict(dict)

    # ---- voice rooms ----
    def voice_roster(self, cid: int):
        return sorted(
            ({k: v for k, v in m.items() if not k.startswith("_")}
             for m in self.voice.get(cid, {}).values()),
            key=lambda m: m["id"])

    def voice_join(self, cid: int, uid: int, info: dict, ws=None):
        info = {**info, "_ws": ws}
        self.voice[cid][uid] = info
        return self.voice_roster(cid)

    def voice_leave(self, cid: int, uid: int):
        room = self.voice.get(cid)
        if room and uid in room:
            del room[uid]
            if not room:
                del self.voice[cid]
            return True
        return False

    def voice_leave_ws(self, uid: int, ws):
        """Drop uid only from rooms bound to this socket; returns [(cid, roster)]."""
        out = []
        for cid in list(self.voice.keys()):
            m = self.voice[cid].get(uid)
            if m and m.get("_ws") is ws and self.voice_leave(cid, uid):
                out.append((cid, self.voice_roster(cid)))
        return out

    def voice_mute(self, cid: int, uid: int, muted: bool):
        if uid in self.voice.get(cid, {}):
            self.voice[cid][uid]["muted"] = muted
            return self.voice_roster(cid)
        return None

    def voice_share(self, cid: int, uid: int, sharing: bool):
        if uid in self.voice.get(cid, {}):
            self.voice[cid][uid]["sharing"] = sharing
            return self.voice_roster(cid)
        return None

    def voice_cam(self, cid: int, uid: int, cam: bool):
        if uid in self.voice.get(cid, {}):
            self.voice[cid][uid]["cam"] = cam
            return self.voice_roster(cid)
        return None

    def voice_deafen(self, cid: int, uid: int, deafened: bool):
        if uid in self.voice.get(cid, {}):
            self.voice[cid][uid]["deafened"] = deafened
            if deafened:
                self.voice[cid][uid]["muted"] = True
            return self.voice_roster(cid)
        return None

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self.sockets[user_id].add(ws)
        await self.broadcast_presence()

    def disconnect(self, user_id: int, ws: WebSocket):
        self.sockets[user_id].discard(ws)
        if not self.sockets[user_id]:
            self.sockets.pop(user_id, None)
        for viewers in self.viewing.values():
            viewers.discard(user_id)

    def online_ids(self):
        return sorted(self.sockets.keys())

    async def send(self, user_id: int, event: dict):
        await self._send_raw(user_id, json.dumps(event))

    async def _send_raw(self, user_id: int, payload: str):
        dead = []
        for ws in list(self.sockets.get(user_id, ())):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets[user_id].discard(ws)

    async def send_many(self, user_ids, event: dict):
        # one serialization for every recipient, and gather so a stalled
        # socket can't head-of-line-block everyone behind it
        payload = json.dumps(event)
        await asyncio.gather(
            *(self._send_raw(uid, payload) for uid in set(user_ids)),
            return_exceptions=True)

    async def broadcast(self, event: dict):
        await self.send_many(list(self.sockets.keys()), event)

    async def broadcast_presence(self):
        await self.broadcast({"type": "presence", "online": self.online_ids()})


hub = Hub()
