import React, { useEffect, useState } from "react";
import { api } from "../../api";

// Settings → Permissions — two halves:
//   1. device permissions (camera, mic, screen, notifications…) — live status
//      from navigator.permissions plus real request buttons
//   2. agent access — per agent: who may summon it (everyone / friends /
//      specific people / only me) and when (anytime / while I'm online /
//      paused). Enforced server-side at every summon path.

const DESKTOP = !!window.__TAURI__;

const PERMS = [
  { id: "camera", name: "Camera", icon: "📷", query: "camera",
    blurb: "Video tiles and calls",
    test: async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    } },
  { id: "microphone", name: "Microphone", icon: "🎙️", query: "microphone",
    blurb: "Voice rooms and calls",
    test: async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } },
  { id: "screen", name: "Screen share", icon: "🖥️",
    blurb: "getDisplayMedia — always asks when you share",
    test: async () => {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    } },
  { id: "notifications", name: "Notifications", icon: "🔔", query: "notifications",
    blurb: "Desktop pings for mentions and buzz",
    test: async () => { await Notification.requestPermission(); } },
  { id: "clipboard", name: "Clipboard read", icon: "📋", query: "clipboard-read",
    blurb: "Paste helpers and copy actions",
    test: async () => { await navigator.clipboard.readText(); } },
  { id: "popups", name: "Popups & links", icon: "↗️",
    blurb: DESKTOP
      ? "Desktop app — links and sign-ins open in your default browser"
      : "External links and sign-in windows",
    test: async () => {
      if (DESKTOP) {
        // the shell denies in-app windows and forwards the URL to the system
        // browser — fire a real external link; success can't be detected, so
        // report it opened rather than a false "denied"
        window.open("https://example.com", "_blank");
        return "external";
      }
      const w = window.open("about:blank", "_blank", "width=10,height=10");
      if (!w) throw new Error("blocked");
      w.close();
    } },
  { id: "geolocation", name: "Location", icon: "📍", query: "geolocation",
    blurb: "Not used by the app today",
    test: async () => {
      await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej,
        { timeout: 8000 }));
    } },
];

const WHO_OPTS = [
  { v: "", label: "Same as visibility" },
  { v: "public", label: "Everyone" },
  { v: "friends", label: "Friends only" },
  { v: "people", label: "Specific people" },
  { v: "private", label: "Only me" },
];
const WHEN_OPTS = [
  { v: "always", label: "Anytime" },
  { v: "online", label: "Only while I'm online" },
  { v: "off", label: "Paused" },
];

function AgentPermCard({ a, friends }) {
  const [who, setWho] = useState(a.use_who || "");
  const [when, setWhen] = useState(a.use_when || "always");
  const [allow, setAllow] = useState(a.allowed_user_ids || []);
  const [state, setState] = useState("");       // '' | 'saving' | 'saved' | 'err'
  const dirty = who !== (a.use_who || "") || when !== (a.use_when || "always") ||
    JSON.stringify([...allow].sort()) !== JSON.stringify([...(a.allowed_user_ids || [])].sort());

  async function save() {
    setState("saving");
    try {
      const r = await api.updateAgent(a.id, {
        ...a, use_who: who, use_when: when, allowed_user_ids: allow });
      a.use_who = r.use_who; a.use_when = r.use_when; a.allowed_user_ids = r.allowed_user_ids;
      setState("saved");
      setTimeout(() => setState(""), 2500);
    } catch (e) {
      setState("err");
    }
  }
  const whoLabel = WHO_OPTS.find((o) => o.v === (who || a.visibility))?.label || who;
  return (
    <div className="con-card">
      <span className="con-mark" style={{ background: "#3a4254" }}>{a.icon || "🤖"}</span>
      <div className="con-body">
        <div className="con-top">
          <b>{a.name}</b>
          <span className="con-tag">{whoLabel}</span>
          {when === "off" && <span className="con-warn">paused</span>}
        </div>
        <div className="con-sub">{a.tagline || "—"}</div>
        <div className="perm-row">
          <label>Who can summon</label>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            {WHO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <label>When</label>
          <select value={when} onChange={(e) => setWhen(e.target.value)}>
            {WHEN_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          {dirty && (
            <button type="button" className="primary" disabled={state === "saving"}
              onClick={save}>
              {state === "saving" ? "Saving…" : "Save"}
            </button>
          )}
          {state === "saved" && <span className="con-ok">✓ saved</span>}
          {state === "err" && <span className="con-warn">✗ save failed</span>}
        </div>
        {who === "people" ? (
          <div className="perm-people">
            {friends.length === 0 && <span className="con-meta">No friends yet.</span>}
            {friends.map((f) => (
              <button key={f.id} type="button"
                className={`chip perm-chip ${allow.includes(f.id) ? "on" : ""}`}
                onClick={() => setAllow((x) => x.includes(f.id)
                  ? x.filter((i) => i !== f.id) : [...x, f.id])}>
                {allow.includes(f.id) ? "✓ " : ""}{f.display_name || f.username}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PermissionsPage({ me }) {
  const [stats, setStats] = useState({});      // perm id -> granted|denied|prompt|unsupported
  const [testing, setTesting] = useState({});  // perm id -> bool
  const [agents, setAgents] = useState(null);
  const [friends, setFriends] = useState([]);

  async function queryPerm(p) {
    if (!p.query || !navigator.permissions?.query) return;
    try {
      const r = await navigator.permissions.query({ name: p.query });
      setStats((s) => ({ ...s, [p.id]: r.state }));
      r.onchange = () => setStats((s) => ({ ...s, [p.id]: r.state }));
    } catch { setStats((s) => ({ ...s, [p.id]: s[p.id] || "unknown" })); }
  }
  useEffect(() => {
    PERMS.forEach(queryPerm);
    api.agents().then((as) =>
      setAgents((as || []).filter((a) => a.owner?.id === me.id || a.owner_id === me.id)))
      .catch(() => setAgents([]));
    api.friends().then((fs) => setFriends(fs?.accepted || fs || [])).catch(() => {});
  }, []);

  async function runTest(p) {
    setTesting((t) => ({ ...t, [p.id]: true }));
    try {
      const r = await p.test();
      setStats((s) => ({ ...s, [p.id]: r === "external" ? "external" : "granted" }));
    } catch (e) {
      const msg = String(e?.message || e?.name || "").toLowerCase();
      setStats((s) => ({ ...s, [p.id]:
        /denied|notallowed|blocked|dismissed/.test(msg) ? "denied" : "prompt" }));
    } finally {
      setTesting((t) => ({ ...t, [p.id]: false }));
    }
  }

  const stateOf = (p) => stats[p.id] === "external" ? "system browser"
    : stats[p.id] || (p.query ? "…" : "—");
  return (
    <div>
      <div className="con-sect">This {DESKTOP ? "desktop app" : "browser"}</div>
      <div className="msub" style={{ margin: "4px 0 12px" }}>
        {DESKTOP
          ? "Voice and video permissions are granted by the app shell; links and sign-ins always open in your default browser."
          : "What SignalHive can ask your browser for — check a row to see its live state."}
      </div>
      {PERMS.map((p) => (
        <div key={p.id} className="con-card perm-card">
          <span className="con-mark" style={{ background: "#3a4254" }}>{p.icon}</span>
          <div className="con-body">
            <div className="con-top">
              <b>{p.name}</b>
              <span className={`perm-state ${stateOf(p)}`}>{stateOf(p)}</span>
            </div>
            <div className="con-sub">{p.blurb}</div>
            <div className="con-actions">
              <button type="button" disabled={!!testing[p.id]}
                onClick={() => runTest(p)}>
                {testing[p.id] ? "Asking…" : stats[p.id] === "granted" ? "Re-check" : "Allow / test"}
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="con-sect">Your agents — who can use them &amp; when</div>
      <div className="msub" style={{ margin: "4px 0 12px" }}>
        Controls summons (@name in chat, agent DMs, the Try tab, workspace desks)
        — not whether the agent shows in the Library. You can always use your
        own agents.
      </div>
      {agents === null ? (
        <div className="msub">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="msub">No agents yet — publish one from the Agent modal.</div>
      ) : (
        agents.map((a) => <AgentPermCard key={a.id} a={a} friends={friends} />)
      )}
    </div>
  );
}
