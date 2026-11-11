"""Lemonade Nexus mesh node — joins a nexus mesh over the userspace SDK and
publishes this backend's HTTP API to mesh peers as an encrypted service.

The SDK (lemonade_nexus_sdk.dll/.so/.dylib, the `ln_*` C ABI) runs in-process:
userspace WireGuard (BoringTun) + smoltcp netstack — no TUN device, no admin
rights. The node authenticates with an Ed25519 device identity, joins the
network (account + node + tunnel IP in one call), then heartbeats, discovers
peers and hole-punches direct paths with relay fallback.

Data lives under backend/nexus/: bin/<sdk>, data/identity.json. Runtime
config/state sits in kv: "nexus:cfg" (enabled, domain, region, server,
device_name, vport) and "nexus:net" (genesis_pubkey, chain, epoch — the
pinned network trust anchors).

Every FFI call is serialized under one lock and the join path blocks on
network I/O — route handlers run it via asyncio.to_thread.
"""
import ctypes
import json
import os
import sys
import threading
import time
from collections import deque

from . import config
from .db import db

DATA_DIR = os.path.join(config.BASE_DIR, "nexus", "data")
BIN_DIR = os.path.join(config.BASE_DIR, "nexus", "bin")

_LIBNAMES = {
    "win32": "lemonade_nexus_sdk.dll",
    "linux": "liblemonade_nexus_sdk.so",
    "darwin": "liblemonade_nexus_sdk.dylib",
}


def sdk_path():
    if config.NEXUS_SDK:
        return config.NEXUS_SDK
    return os.path.join(BIN_DIR, _LIBNAMES.get(sys.platform, "liblemonade_nexus_sdk.so"))


def sdk_available():
    return config.NEXUS != "0" and os.path.isfile(sdk_path())


# ---------------------------------------------------------------------------
# C ABI bindings
# ---------------------------------------------------------------------------

class _LN:
    """Lazy ctypes binding of the SDK. ln_free releases every out_json."""

    def __init__(self):
        self.lib = ctypes.CDLL(sdk_path())
        VP, CP = ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p)
        b, u16, u32, u64, i = (ctypes.c_char_p, ctypes.c_uint16,
                               ctypes.c_uint32, ctypes.c_uint64, ctypes.c_int)
        L = self.lib
        L.ln_free.argtypes = [VP]; L.ln_free.restype = None
        L.ln_create.argtypes = [b, u16]; L.ln_create.restype = VP
        L.ln_create_tls.argtypes = [b, u16]; L.ln_create_tls.restype = VP
        L.ln_destroy.argtypes = [VP]; L.ln_destroy.restype = None
        L.ln_health.argtypes = [VP, CP]
        L.ln_discover_servers.argtypes = [b, b, u16, CP]
        L.ln_discover_genesis_key.argtypes = [VP, b, CP]
        L.ln_set_genesis_key.argtypes = [VP, b, u64]
        L.ln_set_epoch_floor.argtypes = [VP, b, u64]
        L.ln_tier1_refresh.argtypes = [VP, CP]
        L.ln_tier1_membership.argtypes = [VP, CP]
        L.ln_identity_generate.restype = VP; L.ln_identity_generate.argtypes = []
        L.ln_identity_load.argtypes = [b]; L.ln_identity_load.restype = VP
        L.ln_identity_save.argtypes = [VP, b]
        L.ln_identity_pubkey.argtypes = [VP]; L.ln_identity_pubkey.restype = VP
        L.ln_identity_destroy.argtypes = [VP]; L.ln_identity_destroy.restype = None
        L.ln_set_identity.argtypes = [VP, VP]
        L.ln_set_device_name.argtypes = [VP, b]
        L.ln_set_link_token.argtypes = [VP, b]
        L.ln_join_network.argtypes = [VP, b, b, CP]
        L.ln_leave_network.argtypes = [VP, CP]
        L.ln_link_token_create.argtypes = [VP, u32, CP]
        L.ln_mesh_enable.argtypes = [VP]
        L.ln_mesh_disable.argtypes = [VP]
        L.ln_mesh_is_active.argtypes = [VP]; L.ln_mesh_is_active.restype = i
        L.ln_mesh_status.argtypes = [VP, CP]
        L.ln_mesh_peers.argtypes = [VP, CP]
        L.ln_mesh_expose_service.argtypes = [VP, u16, b]
        L.ln_mesh_open_egress.argtypes = [VP, b, u16, ctypes.POINTER(u16)]
        L.ln_mesh_close_egress.argtypes = [VP, b, u16]
        L.ln_list_network_devices.argtypes = [VP, CP]
        L.ln_delete_node.argtypes = [VP, b, CP]
        L.ln_get_group_devices.argtypes = [VP, b, CP]
        L.ln_get_group_members.argtypes = [VP, b, CP]
        L.ln_remove_group_member.argtypes = [VP, b, b, CP]
        L.ln_invite_accept.argtypes = [VP, b, CP]
        L.ln_get_node_id.argtypes = [VP]; L.ln_get_node_id.restype = VP
        L.ln_resume.argtypes = [VP]
        # void cb(char* event_json, void* user) — the SDK hands ownership of
        # event_json to the callback; we free it.
        self._EVENT = ctypes.CFUNCTYPE(None, VP, VP)
        L.ln_set_mesh_event_callback.argtypes = [VP, self._EVENT, VP]

    def jstr(self, fn, *args):
        """Call fn(*args, char** out); return (rc, parsed-json-or-None, raw)."""
        out = ctypes.c_char_p()
        rc = fn(*args, ctypes.byref(out))
        raw = out.value.decode("utf-8", "replace") if out.value else None
        if out.value:
            self.lib.ln_free(out)
        try:
            return rc, (json.loads(raw) if raw else None), raw
        except json.JSONDecodeError:
            return rc, None, raw


_LN_INST = None
_LN_ERR = None


def _ln():
    global _LN_INST, _LN_ERR
    if _LN_INST is None and _LN_ERR is None:
        try:
            _LN_INST = _LN()
        except Exception as e:  # missing dll, wrong arch, missing deps
            _LN_ERR = str(e)
    return _LN_INST


# ---------------------------------------------------------------------------
# kv persistence
# ---------------------------------------------------------------------------

def _kv_get(key, default=None):
    with db() as conn:
        r = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    if not r:
        return default
    try:
        return json.loads(r["value"])
    except (json.JSONDecodeError, TypeError):
        return default


def _kv_set(key, value):
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
                     (key, json.dumps(value)))


DEFAULT_CFG = {
    "enabled": False,          # autostart on boot
    "domain": "lemonade-nexus.io",
    "region": "us-west",
    "server": "",              # explicit host[:port] — skips DNS discovery
    "device_name": "agenthive",
    "vport": 0,                # mesh port the API is published on (0 = PORT)
}


def get_cfg():
    cfg = dict(DEFAULT_CFG)
    cfg.update(_kv_get("nexus:cfg") or {})
    for k, env in (("domain", config.NEXUS_DOMAIN), ("region", config.NEXUS_REGION),
                   ("server", config.NEXUS_SERVER), ("vport", config.NEXUS_VPORT)):
        if env:
            cfg[k] = env
    return cfg


# ---------------------------------------------------------------------------
# The node
# ---------------------------------------------------------------------------

class NexusNode:
    def __init__(self):
        self.lock = threading.RLock()
        self.cli = None       # ln_client_t*
        self.ident = None     # ln_identity_t*
        self.state = "off"    # off | connecting | running | error
        self.error = ""
        self.info = {}        # node_id, tunnel_ip, mesh_pubkey, pubkey, server
        self.started_at = 0.0
        self.events = deque(maxlen=40)
        self.ev_version = 0
        self._cb_ref = None   # keep the CFUNCTYPE alive

    # -- lifecycle -----------------------------------------------------------

    def start(self, link_token="", server="", region="", device_name=""):
        """Blocking connect: discover -> pin -> identity -> join -> mesh up.
        Safe to call again while running (returns current status)."""
        ln = _ln()
        if not ln:
            raise RuntimeError(f"nexus SDK unavailable: {_LN_ERR or 'library not loaded'}")
        with self.lock:
            if self.state == "running":
                return self.status()
            if self.state == "connecting":
                raise RuntimeError("mesh is already joining — wait for it")
            self._teardown()
            self.state, self.error = "connecting", ""
        try:
            info = self._connect(ln, link_token=link_token, server=server,
                                 region=region, device_name=device_name)
        except Exception as e:
            with self.lock:
                self.state, self.error = "error", str(e)
                self._teardown()
            raise
        with self.lock:
            self.info = info
            self.state = "running"
            self.started_at = time.time()
            cfg = get_cfg(); cfg["enabled"] = True
            if server:
                cfg["server"] = server
            if region:
                cfg["region"] = region
            if device_name:
                cfg["device_name"] = device_name
            _kv_set("nexus:cfg", cfg)
        return self.status()

    def _connect(self, ln, link_token="", server="", region="", device_name=""):
        cfg = get_cfg()
        domain = config.NEXUS_DOMAIN or cfg["domain"]
        region = region or config.NEXUS_REGION or cfg["region"]
        server = server or config.NEXUS_SERVER or cfg["server"]
        device_name = device_name or cfg["device_name"]

        # 1. pick a live seed: explicit override, else walk SEIP DNS discovery —
        #    individual nodes are flaky, the first reachable one wins and
        #    auto_discover grows the pool from /api/servers after that.
        host, port, servers = "", 9100, []
        if server:
            host, _, p = server.partition(":")
            port = int(p or 9100)
            servers = [{"host": host, "port": port}]
        else:
            rc, d, _ = ln.jstr(ln.lib.ln_discover_servers,
                               domain.encode(), region.encode(), 9100)
            if rc != 0 or not (d or {}).get("servers"):
                raise RuntimeError((d or {}).get("error") or f"no nexus servers in {region}")
            servers = d["servers"]

        cli = None
        last_err = "no reachable nexus server"
        for cand in servers[:6]:
            c = ln.lib.ln_create_tls(cand["host"].encode(), int(cand.get("port", 9100)))
            if not c:
                continue
            rc, d, _ = ln.jstr(ln.lib.ln_health, c)
            if rc == 0 and (d or {}).get("ok"):
                cli, host, port = c, cand["host"], int(cand.get("port", 9100))
                break
            last_err = f"{cand['host']} unreachable"
            ln.lib.ln_destroy(c)
        if not cli:
            raise RuntimeError(last_err)
        self.cli = cli

        # 2. pin the network key: stored trust anchor, else TOFU discovery
        net = _kv_get("nexus:net") or {}
        if net.get("genesis_pubkey"):
            if ln.lib.ln_set_genesis_key(cli, net["genesis_pubkey"].encode(), 0) != 0:
                raise RuntimeError("stored genesis key refused")
            if net.get("chain") and net.get("epoch"):
                ln.lib.ln_set_epoch_floor(cli, net["chain"].encode(), int(net["epoch"]))
        else:
            hosts_json = json.dumps(
                [{"host": s["host"], "port": s.get("port", 9100)} for s in servers]
                or [{"host": host, "port": port}]).encode()
            rc, d, _ = ln.jstr(ln.lib.ln_discover_genesis_key, cli, hosts_json)
            if rc != 0 or not (d or {}).get("genesis_pubkey"):
                raise RuntimeError((d or {}).get("error") or "genesis key discovery failed")
            net = {"genesis_pubkey": d["genesis_pubkey"],
                   "network_id": d.get("network_id", ""),
                   "domain": d.get("dns_base_domain", domain)}
            _kv_set("nexus:net", net)

        # 3. device identity (persisted — same node across restarts)
        os.makedirs(DATA_DIR, exist_ok=True)
        ipath = os.path.join(DATA_DIR, "identity.json")
        ident = ln.lib.ln_identity_load(ipath.encode()) if os.path.isfile(ipath) else None
        if not ident:
            ident = ln.lib.ln_identity_generate()
            if not ident or ln.lib.ln_identity_save(ident, ipath.encode()) != 0:
                raise RuntimeError("could not create mesh identity")
        self.ident = ident
        pub_p = ln.lib.ln_identity_pubkey(ident)
        pubkey = ctypes.cast(pub_p, ctypes.c_char_p).value.decode() if pub_p else ""
        if pub_p:
            ln.lib.ln_free(pub_p)
        ln.lib.ln_set_identity(cli, ident)
        if device_name:
            ln.lib.ln_set_device_name(cli, device_name.encode())
        if link_token:
            if ln.lib.ln_set_link_token(cli, link_token.encode()) != 0:
                raise RuntimeError("invalid link token (8-digit code or lnk_…)")

        # 4. join — retry across the verified server pool on no-response
        joined, last_err = None, "join failed"
        for _ in range(3):
            rc, d, _ = ln.jstr(ln.lib.ln_join_network, cli, b"agenthive", b"")
            if rc == 0 and (d or {}).get("success"):
                joined = d
                break
            last_err = (d or {}).get("error") or f"join rc={rc}"
            time.sleep(2)
        if not joined:
            raise RuntimeError(last_err)

        # 5. mesh dataplane + publish the API service
        ln.lib.ln_mesh_enable(cli)
        vport = int(config.NEXUS_VPORT or cfg.get("vport") or config.PORT)
        target = f"tcp:127.0.0.1:{config.PORT}".encode()
        ln.lib.ln_mesh_expose_service(cli, vport, target)
        self._hook_events(ln)

        # 6. record the verified epoch floor for next boot's rollback check
        rc, d, _ = ln.jstr(ln.lib.ln_tier1_refresh, cli)
        if rc == 0 and (d or {}).get("chain"):
            net["chain"], net["epoch"] = d["chain"], d.get("epoch", 0)
            _kv_set("nexus:net", net)

        return {"node_id": joined.get("node_id", ""),
                "tunnel_ip": joined.get("tunnel_ip", ""),
                "mesh_pubkey": joined.get("mesh_pubkey", ""),
                "pubkey": pubkey, "server": f"{host}:{port}",
                "domain": domain, "vport": vport, "local_port": config.PORT,
                "membership": joined.get("membership")}

    def stop(self):
        with self.lock:
            self._teardown()
            self.state, self.error = "off", ""
            cfg = get_cfg(); cfg["enabled"] = False
            _kv_set("nexus:cfg", cfg)

    def _teardown(self):
        if self.cli:
            try:
                _ln().lib.ln_destroy(self.cli)
            except Exception:
                pass
        if self.ident:
            try:
                _ln().lib.ln_identity_destroy(self.ident)
            except Exception:
                pass
        self.cli = self.ident = None
        self.info = {}
        self.started_at = 0.0

    def _hook_events(self, ln):
        def _on_event(event_json, user):
            try:
                raw = ctypes.cast(event_json, ctypes.c_char_p).value
                ev = json.loads(raw.decode()) if raw else {}
                self.events.appendleft({"t": time.time(), **ev})
                self.ev_version += 1
            finally:
                if event_json:
                    ln.lib.ln_free(event_json)
        self._cb_ref = ln._EVENT(_on_event)
        ln.lib.ln_set_mesh_event_callback(self.cli, self._cb_ref, None)

    # -- introspection (cheap, called under lock) -----------------------------

    def status(self):
        """Public status dict — never leaks keys/tokens."""
        out = {"available": sdk_available(), "sdk": sdk_path() if sdk_available() else "",
               "state": self.state, "error": self.error,
               "events_version": self.ev_version}
        with self.lock:
            if self.state == "running" and self.cli:
                ln = _ln()
                rc, d, _ = ln.jstr(ln.lib.ln_mesh_status, self.cli)
                if rc == 0 and d:
                    out.update({"peer_count": d.get("peer_count", 0),
                                "online_count": d.get("online_count", 0),
                                "tunnel_up": d.get("tunnel_up", False),
                                "needs_rejoin": d.get("needs_rejoin", False),
                                "rx_bytes": d.get("total_rx_bytes", 0),
                                "tx_bytes": d.get("total_tx_bytes", 0)})
                else:
                    self.state, self.error = "error", "mesh status failed"
                    out["state"], out["error"] = self.state, self.error
                out.update(self.info)
                out["uptime"] = round(time.time() - self.started_at)
            out["cfg"] = {k: v for k, v in get_cfg().items()}
            out["events"] = list(self.events)[:10]
        return out

    def peers(self):
        with self.lock:
            if not self.cli:
                return []
            rc, d, _ = _ln().jstr(_ln().lib.ln_mesh_peers, self.cli)
            return d if isinstance(d, list) else []

    def devices(self):
        with self.lock:
            if not self.cli:
                return []
            rc, d, _ = _ln().jstr(_ln().lib.ln_list_network_devices, self.cli)
            return d if isinstance(d, list) else []

    # -- actions ---------------------------------------------------------------

    def egress_open(self, ip, port):
        """Bridge a peer's mesh service to a loopback port."""
        with self.lock:
            if not self.cli or not _ln().lib.ln_mesh_is_active(self.cli):
                raise RuntimeError("mesh is not connected")
            ip = str(ip).split("/")[0]
            out_port = ctypes.c_uint16(0)
            rc = _ln().lib.ln_mesh_open_egress(self.cli, ip.encode(),
                                             int(port), ctypes.byref(out_port))
            if rc != 0 or not out_port.value:
                raise RuntimeError(f"egress to {ip}:{port} failed (rc={rc})")
            return out_port.value

    def egress_close(self, ip, port):
        with self.lock:
            if self.cli:
                _ln().lib.ln_mesh_close_egress(
                    self.cli, str(ip).split("/")[0].encode(), int(port))

    def invite(self, ttl_sec=86400):
        """Mint a device link token — a friend joins our group with it."""
        with self.lock:
            if not self.cli:
                raise RuntimeError("mesh is not connected")
            rc, d, _ = _ln().jstr(_ln().lib.ln_link_token_create,
                                  self.cli, int(ttl_sec))
            if rc != 0 or not d:
                raise RuntimeError("invite failed — is the mesh session up?")
            if d.get("error"):
                raise RuntimeError(d["error"])
            return d

    def accept_invite(self, token):
        """Join ANOTHER mesh group by redeeming a code/lnk_ token minted
        elsewhere (e.g. the Lemonade app). Additive — our own group stays and
        the foreign group's members become reachable peers (and can reach the
        service we publish)."""
        with self.lock:
            if not self.cli:
                raise RuntimeError("mesh is not connected")
            rc, d, _ = _ln().jstr(_ln().lib.ln_invite_accept,
                                  self.cli, str(token).strip().encode())
            if rc != 0 or not d:
                raise RuntimeError(f"invite accept failed (rc={rc})")
            if d.get("error") or d.get("success") is False:
                raise RuntimeError(d.get("error") or "invite rejected")
            return d

    def remove_device(self, node_id):
        """Group-admin kick: strip a member's entry from our group.

        We can't delete the peer's own node (it belongs to their identity —
        the tree refuses delete_node without that permission), so this removes
        their membership: they lose group permissions and stop being a peer.
        Accepts a peer node_id or a raw ed25519 management pubkey."""
        with self.lock:
            if not self.cli:
                raise RuntimeError("mesh is not connected")
            ln = _ln()

            # our home group id comes from our own device entry
            mine = [d for d in self.devices() if d.get("is_self")]
            group_id = (mine[0].get("group_id") if mine else "") or ""
            if not group_id:
                raise RuntimeError("no group membership to manage")

            pubkey = node_id
            if not pubkey.startswith("ed25519:"):
                # map node_id -> mgmt_pubkey: live peers first, then all
                # device nodes under our group (covers offline members)
                pubkey = ""
                for p in self.peers():
                    if p.get("node_id") == node_id:
                        pubkey = p.get("mgmt_pubkey") or ""
                if not pubkey:
                    _, gdevs, _ = ln.jstr(ln.lib.ln_get_group_devices,
                                        self.cli, group_id.encode())
                    for d in (gdevs if isinstance(gdevs, list) else []):
                        if d.get("node_id") == node_id:
                            pubkey = d.get("mgmt_pubkey") or ""
            if not pubkey:
                raise RuntimeError("no such peer")

            rc, d, _ = ln.jstr(ln.lib.ln_remove_group_member,
                               self.cli, group_id.encode(), pubkey.encode())
            if rc != 0 or (d or {}).get("error") or (d and d.get("success") is False):
                raise RuntimeError((d or {}).get("error") or f"remove failed (rc={rc})")
            return d or {"ok": True, "removed": pubkey, "group_id": group_id}

    def resume(self):
        with self.lock:
            if self.cli:
                _ln().lib.ln_resume(self.cli)


NODE = NexusNode()


def autostart_enabled():
    return config.NEXUS == "1" or (config.NEXUS != "0" and get_cfg().get("enabled"))
