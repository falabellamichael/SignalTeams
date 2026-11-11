"""Nexus mesh: the backend's own lemonade-nexus node (app/nexus.py).

The node is host-level — one mesh identity per backend process, shared by
every user of this hive. Any logged-in user may READ status/peers (no secrets
leave the server), but connect/disconnect/invite/egress/config/kick mutate
that shared node, so they require site admin (auth.require_admin).

Watch pairing is the exception: a watch that physically joined our mesh group
(via an 8-digit invite code) can mint an API session for the inviter by
presenting its node_id + a self-generated secret over the mesh tunnel —
membership in the group IS the authentication, no hive URL or password ever
touches the bezel.
"""
import asyncio
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..auth import create_session, current_user, require_admin
from ..db import db
from .. import nexus

router = APIRouter()


class ConnectReq(BaseModel):
    server: str = ""
    region: str = ""
    device_name: str = ""
    link_token: str = ""


class EgressReq(BaseModel):
    ip: str
    port: int


class InviteReq(BaseModel):
    ttl_sec: int = 86400
    role: str = "user"           # site role the invitee lands as: user | mod | admin


class AcceptInviteReq(BaseModel):
    code: str


class CfgReq(BaseModel):
    enabled: bool | None = None
    domain: str | None = None
    region: str | None = None
    server: str | None = None
    device_name: str | None = None
    vport: int | None = None


@router.get("/api/nexus/status")
def nexus_status(user=Depends(current_user)):
    return nexus.NODE.status()


@router.post("/api/nexus/connect")
async def nexus_connect(req: ConnectReq, user=Depends(require_admin)):
    if not nexus.sdk_available():
        raise HTTPException(503, f"nexus SDK not found at {nexus.sdk_path()}")
    st = nexus.NODE.status()
    if st.get("state") == "running":
        tok = (req.link_token or "").strip()
        # a code pasted anywhere (incl. the server box by mistake) means
        # "join another mesh", not "reconnect" — accept_invite handles both
        # the 8-digit code and the lnk_ token forms.
        if not tok and re.fullmatch(r"(lnk_\S+|[\d\s]+)", req.server or ""):
            tok = re.sub(r"\s+", "", req.server or "")
        if tok:
            try:
                d = await asyncio.to_thread(nexus.NODE.join_foreign, tok)
            except RuntimeError:
                try:
                    d = await asyncio.to_thread(nexus.NODE.accept_invite, tok)
                except RuntimeError as e:
                    raise HTTPException(502, str(e))
            return {"ok": True, "accepted": tok[:8] + "…",
                    **(d if isinstance(d, dict) else {})}
        if not any([req.server.strip(), req.region.strip(),
                    req.device_name.strip(), req.link_token.strip()]):
            return st          # already running — don't tear it down on a no-op
    try:
        return await asyncio.to_thread(
            nexus.NODE.start, req.link_token, req.server, req.region, req.device_name)
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("/api/nexus/disconnect")
def nexus_disconnect(user=Depends(require_admin)):
    nexus.NODE.stop()
    return nexus.NODE.status()


@router.get("/api/nexus/peers")
def nexus_peers(user=Depends(current_user)):
    return {"peers": nexus.NODE.peers()}


@router.get("/api/nexus/devices")
def nexus_devices(user=Depends(require_admin)):
    return {"devices": nexus.NODE.devices()}


@router.delete("/api/nexus/devices/{node_id}")
async def nexus_device_remove(node_id: str, user=Depends(require_admin)):
    try:
        out = await asyncio.to_thread(nexus.NODE.remove_device, node_id)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    # a kicked watch loses its session too — the bound record + minted token go
    bound = nexus._kv_get(f"watch_bound:{node_id}")
    if bound:
        nexus._kv_set(f"watch_bound:{node_id}", {})
        if bound.get("tok"):
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token=?", (bound["tok"],))
    return out


@router.post("/api/nexus/egress")
async def nexus_egress_open(req: EgressReq, user=Depends(require_admin)):
    try:
        port = await asyncio.to_thread(nexus.NODE.egress_open, req.ip, req.port)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"loopback_port": port, "url": f"http://127.0.0.1:{port}"}


@router.delete("/api/nexus/egress")
def nexus_egress_close(req: EgressReq, user=Depends(require_admin)):
    nexus.NODE.egress_close(req.ip, req.port)
    return {"ok": True}


@router.post("/api/nexus/watch-join")
async def nexus_watch_join(user=Depends(current_user)):
    """Join parameters for the Wear OS watch app (any logged-in user).

    Returns the mesh endpoints the watch needs plus a short-lived invite so
    the watch lands in this hive's device group as a peer. Read-only against
    status; mints one link token — the same thing an admin would hand out
    via /invite, scoped to pairing a watch."""
    st = nexus.NODE.status()
    out = {"ok": False, "state": st.get("state")}
    if st.get("state") == "running" and st.get("tunnel_ip"):
        net = nexus._kv_get("nexus:net") or {}
        out.update({
            "ok": True,
            "tunnel_ip": st.get("tunnel_ip"),
            "vport": st.get("vport") or _cfg_port(),
            "server": st.get("server"),
            "domain": st.get("domain"),
            "region": st.get("region") or nexus.get_cfg().get("region", ""),
            "device_name": nexus.get_cfg().get("device_name", "agenthive"),
            "genesis_pubkey": net.get("genesis_pubkey", ""),
        })
        try:
            inv = await asyncio.to_thread(nexus.NODE.invite, 600)
            out["invite"] = inv
        except RuntimeError as e:
            out["invite_error"] = str(e)
    return out


def _cfg_port() -> int:
    from .. import config
    return int(config.NEXUS_VPORT or config.PORT)


@router.post("/api/nexus/invite")
async def nexus_invite(req: InviteReq, user=Depends(require_admin)):
    role = (req.role or "user").lower()
    if role not in ("user", "mod", "admin"):
        raise HTTPException(400, "role must be user, mod, or admin")
    try:
        inv = await asyncio.to_thread(nexus.NODE.invite, req.ttl_sec)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    # the code doubles as a registration grant — the invitee's first crew
    # signup on this hive redeems it and lands with the chosen role.
    code = str(inv.get("code") or "")
    if code:
        nexus._kv_set(f"invite_role:{code}", {
            "role": role, "exp": time.time() + req.ttl_sec,
            "by": user["id"], "by_name": user["username"],
        })
    inv["role"] = role
    return inv


@router.post("/api/nexus/accept-invite")
async def nexus_accept_invite(req: AcceptInviteReq, user=Depends(require_admin)):
    """Join ANOTHER mesh group — e.g. an invite minted in the Lemonade app.

    Additive: our own group stays; the foreign group's members become
    reachable peers (and reach the service we publish — that's how a watch
    that only knows the Lemonade mesh still finds this hive)."""
    # join_foreign registers a device record in the foreign group (visible in
    # members' device lists); accept_invite is membership-only — try it as the
    # fallback for tokens the join path refuses.
    try:
        d = await asyncio.to_thread(nexus.NODE.join_foreign, req.code)
    except RuntimeError:
        try:
            d = await asyncio.to_thread(nexus.NODE.accept_invite, req.code)
        except RuntimeError as e:
            raise HTTPException(502, str(e))
    return {"ok": True, **(d if isinstance(d, dict) else {"result": d})}


# ---------------------------------------------------------------------------
# Watch pairing — the whole point of the mesh: the watch never sees a hive URL.
# Admin taps "Pair a watch" → we mint a group invite and remember whose session
# the watch should get. The watch types only the 8-digit code, joins the mesh,
# and calls /api/watch/session over the encrypted tunnel to claim its session.
# ---------------------------------------------------------------------------

PAIR_TTL = 600            # invite codes die fast — pairing is a hand-off, not a key
_ws_hits: dict[str, list[float]] = {}   # cheap per-IP throttle for the unauthed route


class WatchSessionReq(BaseModel):
    node_id: str
    code: str = ""
    secret: str = ""


@router.post("/api/nexus/watch-pair")
async def nexus_watch_pair(user=Depends(require_admin)):
    """Mint a one-shot watch pairing code (admin only — it's a group invite).

    The same 8-digit code does double duty: ln_set_link_token on the watch
    joins it to this hive's mesh group, and /api/watch/session later redeems
    it for an API session bound to the inviting admin's account."""
    try:
        inv = await asyncio.to_thread(nexus.NODE.invite, PAIR_TTL)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    st = nexus.NODE.status()
    exp = time.time() + PAIR_TTL
    rec = {"uid": user["id"], "exp": exp,
           "group_id": inv.get("group_node_id") or inv.get("target_node_id") or ""}
    for key in (inv.get("code"), inv.get("link_token")):
        if key:
            nexus._kv_set(f"watch_pair:{key}", rec)
    return {"code": inv.get("code"), "link_token": inv.get("link_token"),
            "expires_at": exp, "user": user["username"],
            "hive_tunnel_ip": (st.get("tunnel_ip") or "").split("/")[0],
            "hive_vport": st.get("vport") or _cfg_port(),
            "hive_device": st.get("device_name") or ""}


def _owner_uid() -> int:
    """The hive owner — first admin — used when a group member claims a watch
    session without a locally minted code (Lemonade-app invites carry no uid)."""
    with db() as conn:
        r = conn.execute("SELECT id FROM users WHERE is_admin=1 ORDER BY id LIMIT 1").fetchone()
        if not r:
            r = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if not r:
        raise HTTPException(503, "no users to bind a watch to")
    return r["id"]


def _watch_user(uid: int) -> dict:
    with db() as conn:
        r = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not r:
        raise HTTPException(403, "pairing user no longer exists")
    return dict(r)


def _node_in_group(node_id: str) -> bool:
    """Is this node a member/peer on any group our hive administers or joined?

    Member nodes of a foreign group may not enumerate as 'devices' for a
    plain member like us — but a live mesh peer that can open a tunnel to us
    shares a group by definition."""
    for d in nexus.NODE.devices():
        if d.get("node_id") == node_id and not d.get("is_self"):
            return True
    for p in nexus.NODE.peers():
        if p.get("node_id") == node_id:
            return True
    return False


@router.post("/api/watch/session")
async def watch_session(req: WatchSessionReq, request: Request):
    """Unauthed — mesh membership is the credential.

    First pair: {node_id, code, secret} redeems a minted watch-pair code; the
    node must already be a group member (the join had to happen). Reconnect:
    {node_id, secret} alone works forever for a bound watch while it stays in
    the group — kick it in Mesh settings and this stops answering.
    Any code minted elsewhere (Lemonade app, another hive) still pairs a
    group member — membership is the credential; codes only pick the user."""
    now = time.time()
    ip = request.client.host if request.client else "?"
    hits = [t for t in _ws_hits.get(ip, []) if now - t < 60]
    if len(hits) >= 12:
        raise HTTPException(429, "slow down")
    hits.append(now)
    _ws_hits[ip] = hits

    st = nexus.NODE.status()
    if st.get("state") != "running":
        raise HTTPException(503, "hive mesh is offline")

    node_id = req.node_id.strip()
    if not node_id:
        raise HTTPException(400, "node_id required")

    bound = nexus._kv_get(f"watch_bound:{node_id}") or {}
    # codes render grouped ("7665 0116") — whatever the user typed, the kv
    # key is digits: drop every whitespace run before lookup
    code = re.sub(r"\s+", "", req.code or "")
    pair_key = f"watch_pair:{code}" if code else ""
    pair = nexus._kv_get(pair_key) if pair_key else None
    if not pair and code:
        # the general "Connect another device" invite mints invite_role:{code}
        # instead of watch_pair:{code} — same SDK link token, so the mesh
        # join already worked; bind the watch to the inviting admin's account
        inv = nexus._kv_get(f"invite_role:{code}")
        if inv and inv.get("exp", 0) >= now and inv.get("by"):
            pair_key = f"invite_role:{code}"
            pair = {"uid": inv["by"], "exp": inv["exp"]}

    in_group = await asyncio.to_thread(_node_in_group, node_id)

    if bound.get("uid") and req.secret and req.secret == bound.get("secret"):
        uid = bound["uid"]                     # reconnection path — no code needed
        pair = None                            # bound path doesn't consume a code
    elif pair and pair.get("exp", 0) >= now:
        if not req.secret:
            raise HTTPException(400, "secret required")
        if not in_group:
            raise HTTPException(403, "node is not in this hive's mesh group")
        uid = pair["uid"]
    elif in_group and code:
        # The code isn't one of ours — but the SDK already let this node into
        # the group (a Lemonade-app invite, an expired pair mint, or a wiped
        # watch whose stored secret is gone). The mesh join was the real vetting:
        # bound nodes keep their user, new nodes bind to the hive owner.
        if not req.secret:
            raise HTTPException(400, "secret required")
        uid = bound.get("uid") or _owner_uid()
        pair = None                            # unrecognized mints aren't ours to burn
    else:
        raise HTTPException(403, "invalid or expired pairing code"
                          if code else "node is not in this hive's mesh group")

    if not in_group:
        raise HTTPException(403, "node is not in this hive's mesh group")

    user = _watch_user(uid)
    with db() as conn:
        token = create_session(conn, user["id"])
    nexus._kv_set(f"watch_bound:{node_id}",
                  {"uid": uid, "secret": req.secret or bound.get("secret", ""),
                   "tok": token})
    if pair_key and pair:
        nexus._kv_set(pair_key, {**pair, "exp": 0})   # burn it — single use
    return {"token": token,
            "user": {"username": user["username"],
                     "display_name": user.get("display_name") or user["username"]},
            "hive": {"tunnel_ip": (st.get("tunnel_ip") or "").split("/")[0],
                     "vport": st.get("vport") or _cfg_port(),
                     "device_name": st.get("device_name") or ""}}


@router.put("/api/nexus/config")
def nexus_config(req: CfgReq, user=Depends(require_admin)):
    cfg = nexus.get_cfg()
    for k in ("enabled", "domain", "region", "server", "device_name", "vport"):
        v = getattr(req, k)
        if v is not None:
            cfg[k] = v
    nexus._kv_set("nexus:cfg", cfg)
    return {"cfg": cfg}
