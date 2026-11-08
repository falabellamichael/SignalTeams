import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import KnotMark from "../KnotMark";
import { api } from "../../api";
import { hasSearchQuery, timeAgo } from "../../util";
import { Modal } from "./_shared.jsx";


export function GlobalSearchModal({ onClose, onPick, dests, onJump }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState([]);
  const [sel, setSel] = useState(0);
  useEffect(() => { api.agents({}).then(setAgents).catch(() => {}); }, []);

  async function run(v) {
    setQ(v); setSel(0);
    if (!hasSearchQuery(v)) { setHits([]); return; }
    setBusy(true);
    setHits(await api.searchAll(v.trim()).catch(() => []));
    setBusy(false);
  }

  function activate(i, jumpCount) {
    if (i < jumpCount) onJump?.(jumps[i].t, jumps[i].x);
    else onPick?.(hits[i - jumpCount]);
  }

  const qq = q.trim().toLowerCase();
  const jumps = [];
  if (qq && dests) {
    const has = (s) => (s || "").toLowerCase().includes(qq);
    for (const c of dests.channels || [])
      if (has(c.name)) jumps.push({ t: "channel", x: c, ic: c.kind === "agents" ? "✦" : "#",
        name: c.name, sub: `${c.sname}${c.category ? " · " + c.category : ""}` });
    for (const d of dests.dms || []) {
      const nm = d.name || (d.members || []).map((u) => u.display_name).join(", ") || d.other?.display_name || "";
      if (has(nm)) jumps.push({ t: "dm", x: d, ic: "💬", name: nm, sub: "direct message" });
    }
    for (const a of agents || [])
      if (has(a.name)) jumps.push({ t: "agent", x: a, ic: a.icon || "🤖", name: a.name, sub: "agent" });
    for (const f of dests.friends || [])
      if (has(f.display_name) || has(f.username))
        jumps.push({ t: "friend", x: f, ic: f.avatar_emoji || "👤", name: f.display_name, sub: `@${f.username}` });
    for (const s of dests.servers || [])
      if (has(s.name)) jumps.push({ t: "server", x: s, ic: s.icon || <KnotMark />, name: s.name, sub: "server" });
  }

  const flat = jumps.slice(0, 6).length + hits.length;

  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="search" s={16} /> Search everywhere</span>}
      sub="Every channel and DM you can see." onClose={onClose} wide>
      <input autoFocus placeholder="search messages, or jump to a channel, dm, agent…" value={q}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, flat - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === "Enter" && flat > 0) { e.preventDefault(); activate(sel, jumps.slice(0, 6).length); }
        }} />
      <div className="idehint" style={{ marginTop: 6, borderRadius: 8 }}>
        filters: <code>from:me</code> <code>in:general</code> <code>has:link</code>{" "}
        <code>has:image</code> <code>pinned:true</code> <code>mentions:me</code>{" "}
        <code>before:2025-01-01</code> <code>after:</code> <code>during:</code>
      </div>
      {jumps.length > 0 && (
        <div className="jump-list">
          {jumps.slice(0, 6).map((j, i) => (
            <div key={i} className={`jump-row ${i === sel ? "on" : ""}`}
              ref={i === sel ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseEnter={() => setSel(i)} onClick={() => onJump?.(j.t, j.x)}>
              <span className="jump-ic">{j.ic}</span>
              <b>{j.name}</b>
              <span className="jump-sub">{j.sub}</span>
              <span className="jump-go">→</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 10 }}>
        {busy && <div className="idehint">Searching…</div>}
        {!busy && hasSearchQuery(q) && hits.length === 0 &&
          <div className="idehint">No matches.</div>}
        {hits.map((m, i) => (
          <div key={m.id}
            className={`pack-agent ${jumps.slice(0, 6).length + i === sel ? "gsel" : ""}`}
            style={{ cursor: "pointer" }}
            ref={jumps.slice(0, 6).length + i === sel
              ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseEnter={() => setSel(jumps.slice(0, 6).length + i)}
            onClick={() => onPick(m)}>
            <span className="pk-ico big">{m.author?.avatar_emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{m.author?.display_name}</b>
              <span className="ver" style={{ marginLeft: 6, color: "var(--honey)" }}>{m.where}</span>
              <div style={{ fontSize: 12, color: "var(--dim)", whiteSpace: "pre-wrap" }}>
                {m.content?.slice(0, 160)}</div>
            </div>
            <span className="stat">{timeAgo(m.created_at)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
