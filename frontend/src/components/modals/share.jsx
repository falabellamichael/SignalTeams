import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";


export function ShareModal({ agent, pack, servers, dms, onClose, onShared }) {
  const item = agent || pack;
  const [targets, setTargets] = useState([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const t = [];
    servers.forEach((s) => api.server(s.id).then((full) => {
      full.channels.forEach((c) => t.push({ sid: s.id, sname: s.name, ...c }));
      setTargets((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...t.filter((x) => !ids.has(x.id))];
      });
    }).catch(() => {}));
    dms.forEach((d) => setTargets((prev) => [...prev,
      { id: d.id, sname: "DM", name: "@" + (d.other?.display_name || "?") }]));
  }, [servers, dms]);

  async function share(t) {
    try {
      await api.send(t.id, msg.trim(), agent?.id || null, [], pack?.id || null);
      onShared(t);
    } catch (e) { alert(e.message); }
  }

  return (
    <Modal title={`Share ${item.name}`}
      sub={pack ? "Drop this agent pack into a channel or DM."
               : "Drop this agent card into a channel or DM."} onClose={onClose}>
      <label>Attach a note (optional)</label>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="check this out…" />
      <div style={{ marginTop: 12, maxHeight: 300, overflowY: "auto" }}>
        {targets.map((t) => (
          <div key={`${t.sname}-${t.id}`} className="ideopt" style={{
            padding: "8px 10px", borderRadius: 7, cursor: "pointer", fontSize: 13,
            display: "flex", justifyContent: "space-between" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            onClick={() => share(t)}>
            <span>{t.kind === "agents" ? "✦" : "#"} {t.name}</span>
            <span style={{ color: "var(--dim)", fontSize: 11.5 }}>{t.sname}</span>
          </div>
        ))}
        {targets.length === 0 && <div style={{ color: "var(--dim)", padding: 8 }}>Loading channels…</div>}
      </div>
    </Modal>
  );
}
