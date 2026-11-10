import React, { useEffect, useRef, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";

// Settings → Mesh — the hive's own lemonade-nexus node. The backend joins the
// mesh as a userspace WireGuard client (no TUN, no admin) and publishes its
// API as a mesh service, so linked peers reach this hive over encrypted
// tunnels — no public port, no central bandwidth. Invites mint 8-digit codes
// a friend pastes into their own Mesh settings (or any nexus client).

const STATE_STYLE = {
  running: { c: "#3fb950", t: "Connected" },
  connecting: { c: "var(--honey)", t: "Joining…" },
  error: { c: "var(--bad)", t: "Error" },
  off: { c: "var(--dim)", t: "Disconnected" },
};

function short(s, n = 10) { return s && s.length > n ? s.slice(0, n) + "…" : s; }

function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? `${s | 0}s` : s < 3600 ? `${s / 60 | 0}m` : `${s / 3600 | 0}h`;
}

function up(s) {   // seconds -> "1m" / "2h" / "3d"
  return s < 60 ? `${s | 0}s` : s < 3600 ? `${s / 60 | 0}m` : s < 86400 ? `${s / 3600 | 0}h` : `${s / 86400 | 0}d`;
}

function bytes(n) {
  return n > 1 << 20 ? (n / (1 << 20)).toFixed(1) + "M" : (n / 1024).toFixed(0) + "K";
}

export function MeshPage({ me }) {
  const isAdmin = !!me?.is_admin;
  const [st, setSt] = useState(null);
  const [denied, setDenied] = useState(false);
  const [peers, setPeers] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [adv, setAdv] = useState(false);
  const [form, setForm] = useState({ server: "", region: "", device_name: "", link_token: "" });
  const [invite, setInvite] = useState(null);
  const [watchPair, setWatchPair] = useState(null);
  const [links, setLinks] = useState({});      // peer tunnel_ip -> opened loopback url
  const [dialPort, setDialPort] = useState({}); // peer ip -> vport to dial (default 8075)
  const poll = useRef(null);

  async function refresh() {
    try {
      const s = await api.nexusStatus();
      setSt(s);
      if (s.state === "running") {
        const p = await api.nexusPeers().catch(() => ({ peers: [] }));
        setPeers(p.peers || []);
      } else setPeers([]);
    } catch (e) {
      if (e.status === 403) { setDenied(true); clearInterval(poll.current); }
      /* else: backend older than this feature */
    }
  }
  useEffect(() => {
    refresh();
    poll.current = setInterval(refresh, 5000);
    return () => clearInterval(poll.current);
  }, []);

  async function connect() {
    setBusy("connect"); setErr("");
    try {
      const s = await api.nexusConnect({
        server: form.server.trim(), region: form.region.trim(),
        device_name: form.device_name.trim(), link_token: form.link_token.trim(),
      });
      setSt(s);
    } catch (e) { setErr(e.message); }
    setBusy(""); refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    try { setSt(await api.nexusDisconnect()); } catch (e) { setErr(e.message); }
    setBusy("");
  }

  async function mintInvite() {
    setBusy("invite"); setErr("");
    try { setInvite(await api.nexusInvite(86400)); }
    catch (e) { setErr(e.message); }
    setBusy("");
  }

  async function mintWatchPair() {
    setBusy("watchpair"); setErr("");
    try { setWatchPair(await api.nexusWatchPair()); }
    catch (e) { setErr(e.message); }
    setBusy("");
  }

  async function openPeer(ip) {
    const port = parseInt(dialPort[ip] || "8075", 10) || 8075;
    setBusy("eg" + ip); setErr("");
    try {
      const r = await api.nexusEgress(ip, port);
      setLinks((m) => ({ ...m, [ip]: r.url }));
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  const state = st?.state || "off";
  const running = state === "running";
  const ss = STATE_STYLE[state] || STATE_STYLE.off;

  if (denied) return (
    <div className="set-row">
      <div className="lab">Site admins only
        <div className="d">The mesh node is shared infrastructure — ask a site
          admin to manage it.</div>
      </div>
    </div>
  );
  if (!st) return <div className="msub">Loading mesh…</div>;
  if (st.available === false) return (
    <div className="set-row">
      <div className="lab">Nexus SDK missing
        <div className="d">The mesh library isn't installed at <code>{st.sdk || "backend/nexus/bin"}</code> —
          run <code>backend/.venv/Scripts/python.exe backend/nexus/fetch.py</code> to download it.</div>
      </div>
    </div>
  );

  return (
    <>
      {/* ---------- hero status card ---------- */}
      <div className="nx-hero">
        <div className={`nx-badge${running ? " on" : ""}`}><Ico n="dish" s={19} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4>
            <span className="nx-dot" style={{ background: ss.c }} />
            {ss.t}{state === "running" ? " to lemonade‑nexus" : ""}
          </h4>
          <div className="sub">BoringTun · end-to-end encrypted · no open ports</div>
        </div>
        {isAdmin && (running
          ? <button disabled={!!busy} onClick={disconnect}>{busy === "disconnect" ? "…" : "Disconnect"}</button>
          : <button className="primary" disabled={!!busy}
              onClick={connect}>{busy === "connect" ? "Joining…" : "Connect"}</button>)}
        {!isAdmin && <span className="chip">view only</span>}
      </div>

      {err && <div className="msub" style={{ color: "var(--bad)" }}>{err}</div>}
      {st.error && !err && <div className="msub" style={{ color: "var(--bad)" }}>{st.error}</div>}

      {running && (
        <>
          {/* ---------- this node ---------- */}
          <div className="nx-card">
            <div className="nx-title"><Ico n="globe" s={13} /> This node</div>
            <div className="nx-addr">
              <span style={{ color: "var(--honey)", fontWeight: 600 }}>
                {(st.tunnel_ip || "").split("/")[0]}:{st.vport}</span>
              <span className="to">→</span>
              <span className="to">127.0.0.1:{st.local_port}</span>
              <button className="ghost" style={{ marginLeft: "auto", padding: "1px 6px" }}
                title="Copy mesh address"
                onClick={() => copy(`${(st.tunnel_ip || "").split("/")[0]}:${st.vport}`)}>
                <Ico n="copy" s={12} /></button>
            </div>
            <div className="pulse-stats" style={{ margin: "10px 0 2px" }}>
              <div className="ps"><b>{st.peer_count ?? peers.length}</b><span>peers</span></div>
              <div className="ps"><b>↑{bytes(st.tx_bytes || 0)}</b><span>sent</span></div>
              <div className="ps"><b>↓{bytes(st.rx_bytes || 0)}</b><span>received</span></div>
              <div className="ps"><b>{up(st.uptime || 0)}</b><span>uptime</span></div>
            </div>
            <div className="nx-meta">node {short(st.node_id, 12)} · via {st.server}</div>
          </div>

          {/* ---------- invite (admin) ---------- */}
          {isAdmin && (
            <div className="nx-card">
              <div className="nx-title"><Ico n="userPlus" s={13} /> Invite a device</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 12, color: "var(--dim)" }}>
                  Single-use code — a friend pastes it into their own Mesh settings
                  (or any nexus client) and joins this hive's group as a peer.
                </div>
                <button disabled={!!busy} onClick={mintInvite} style={{ flex: "none" }}>
                  <Ico n="key" s={13} /> {busy === "invite" ? "…" : "Mint code"}
                </button>
              </div>
              {invite && (
                <div className="nx-ticket">
                  <div style={{ flex: "none" }}>
                    <div className="nx-code">{invite.code}</div>
                    <div style={{ fontSize: 10.5, color: "var(--dim)" }}>code · good for 10 min</div>
                  </div>
                  <div className="nx-token">{invite.link_token}
                    <div style={{ fontSize: 10.5, marginTop: 2 }}>or full token · good for 24 h</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: "none" }}>
                    <button className="ghost" onClick={() => copy(invite.code)}>
                      <Ico n="copy" s={12} /> code</button>
                    <button className="ghost" onClick={() => copy(invite.link_token)}>
                      <Ico n="copy" s={12} /> token</button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "var(--dim)" }}>
                  <b style={{ color: "var(--fg)" }}>Wear OS watch:</b> type one code on the
                  bezel — it joins the mesh <i>and</i> signs in as you. No hive URL, no password.
                </div>
                <button disabled={!!busy} onClick={mintWatchPair} style={{ flex: "none" }}>
                  <Ico n="watch" s={13} /> {busy === "watchpair" ? "…" : "Pair a watch"}
                </button>
              </div>
              {watchPair && (
                <div className="nx-ticket" style={{ borderColor: "var(--honey)" }}>
                  <div style={{ flex: "none" }}>
                    <div className="nx-code" style={{ color: "var(--honey)" }}>{watchPair.code}</div>
                    <div style={{ fontSize: 10.5, color: "var(--dim)" }}>watch code · 10 min</div>
                  </div>
                  <div className="nx-token" style={{ fontSize: 11 }}>
                    Enter on the watch — it becomes <b>{watchPair.user}</b>'s session
                    at <b>{watchPair.hive_device || "this hive"}</b> over the mesh.
                  </div>
                  <button className="ghost" style={{ flex: "none" }} onClick={() => copy(watchPair.code)}>
                    <Ico n="copy" s={12} /> code</button>
                </div>
              )}
            </div>
          )}

          {/* ---------- peers ---------- */}
          <div className="nx-card">
            <div className="nx-title"><Ico n="users" s={13} /> Peers
              <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                {peers.length ? `${peers.length} device(s) · ${st.online_count || 0} online` : ""}
              </span>
            </div>
            {peers.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--dim)" }}>
                No linked devices yet — mint an invite and a peer appears here.
              </div>
            )}
            {peers.map((p) => (
              <div key={p.node_id || p.tunnel_ip} className="nx-peer">
                <span className="nx-dot" style={{ background: p.is_online ? "#3fb950" : "var(--dim)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {p.hostname || short(p.node_id, 12) || "peer"}
                    {p.path && <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>{p.path}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "ui-monospace,Consolas,monospace" }}>
                    {(p.tunnel_ip || "").split("/")[0]}
                    {p.latency_ms ? ` · ${Math.round(p.latency_ms)}ms` : ""}
                    {!p.is_online && p.last_seen ? ` · seen ${ago(p.last_seen)} ago` : ""}
                  </div>
                </div>
                {isAdmin && (<>
                  {links[p.tunnel_ip]
                    ? <a href={links[p.tunnel_ip]} target="_blank" rel="noreferrer"
                         style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                        {links[p.tunnel_ip].replace("http://", "")} <Ico n="ext" s={12} /></a>
                    : <>
                        <input value={dialPort[p.tunnel_ip] || ""} placeholder="8075"
                          onChange={(e) => setDialPort((m) => ({ ...m, [p.tunnel_ip]: e.target.value }))}
                          style={{ width: 52, fontSize: 11, padding: "2px 6px" }} />
                        <button className="ghost" disabled={!!busy || !p.is_online}
                          title="Bridge the peer's hive to a loopback port"
                          onClick={() => openPeer(p.tunnel_ip)}>
                          <Ico n="ext" s={13} /> {busy === "eg" + p.tunnel_ip ? "…" : "Open"}
                        </button>
                      </>}
                  <button className="ghost" title="Remove this device from the group"
                    disabled={!!busy}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${p.hostname || p.tunnel_ip} from the group?`)) return;
                      setBusy("rm" + p.node_id); setErr("");
                      try { await api.nexusDeviceRemove(p.node_id); refresh(); }
                      catch (e) { setErr(e.message); }
                      setBusy("");
                    }}>
                    <Ico n={busy === "rm" + p.node_id ? "dots" : "trash"} s={13} />
                  </button>
                </>)}
              </div>
            ))}
            {!isAdmin && (
              <div className="nx-meta" style={{ marginTop: 8 }}>
                Want your device in this mesh? Ask an admin for an invite code —
                you redeem it on your own nexus client, not here.
              </div>
            )}
          </div>

          {st.needs_rejoin && (
            <div className="msub" style={{ color: "var(--honey)" }}>
              The session server left the verified membership — reconnect to move the session.
            </div>
          )}
        </>
      )}

      {!running && !isAdmin && (
        <div className="msub">The mesh node is off — a site admin can switch it on.</div>
      )}

      {!running && isAdmin && (
        <div className="nx-card">
          <div className="nx-title"><Ico n="sliders" s={13} /> Connect options</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--dim)" }}>
              Quick connect joins the public mesh (lemonade-nexus.io) as this
              hive's node and publishes the app to group peers only.
            </div>
            <button className="ghost" onClick={() => setAdv(!adv)} style={{ flex: "none" }}>
              {adv ? "Less" : "Advanced"}
            </button>
          </div>
          {adv && (
            <div style={{ marginTop: 10 }}>
              <label>Mesh server <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                (blank = DNS discovery on {st.cfg?.domain || "lemonade-nexus.io"})</span></label>
              <input value={form.server} placeholder="sn01.us-west.seip.lemonade-nexus.io:9100"
                onChange={(e) => setForm({ ...form, server: e.target.value })} />
              <label>Region</label>
              <input value={form.region} placeholder={st.cfg?.region || "us-west"}
                onChange={(e) => setForm({ ...form, region: e.target.value })} />
              <label>Device name</label>
              <input value={form.device_name} placeholder={st.cfg?.device_name || "agenthive"}
                onChange={(e) => setForm({ ...form, device_name: e.target.value })} />
              <label>Join a friend's group <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                (paste their 8-digit code or lnk_… token — first join only)</span></label>
              <input value={form.link_token} placeholder="12345678 or lnk_…"
                onChange={(e) => setForm({ ...form, link_token: e.target.value })} />
            </div>
          )}
          <div className="nx-meta" style={{ marginTop: 8 }}>
            Once connected, this hive auto-joins on every boot until you disconnect.
            First join walks the network's trust chain — give it ~30s.
          </div>
        </div>
      )}
    </>
  );
}
