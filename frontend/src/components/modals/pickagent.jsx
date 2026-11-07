import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";

// pick an agent or pack to share in chat
export function PickAgentModal({ me, onClose, onPick, onPickPack }) {
  const [agents, setAgents] = useState([]);
  const [packs, setPacks] = useState([]);
  const [q, setQ] = useState("");
  useEffect(() => { api.agents({ q }).then(setAgents).catch(() => {}); }, [q]);
  useEffect(() => { api.packs().then(setPacks).catch(() => {}); }, []);
  const packsShown = packs.filter((p) =>
    !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Share an agent"
      sub="Pick an agent — or a whole pack — to drop in this channel."
      onClose={onClose}>
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
        {packsShown.length > 0 && (
          <div className="side-group" style={{ padding: "2px 4px 4px" }}>Packs</div>
        )}
        {packsShown.map((p) => (
          <div key={`p${p.id}`} className="ideopt" onClick={() => onPickPack(p)}
            style={{ padding: "7px 9px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            <b>{p.icon || "📦"} {p.name}</b>{" "}
            <span style={{ color: "var(--dim)" }}>— {p.count} agents · {p.owner?.display_name}</span>
          </div>
        ))}
        {agents.length > 0 && (
          <div className="side-group" style={{ padding: "6px 4px 4px" }}>Agents</div>
        )}
        {agents.map((a) => (
          <div key={a.id} className="ideopt" onClick={() => onPick(a)}
            style={{ padding: "7px 9px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            <b>{a.name}</b> <span style={{ color: "var(--dim)" }}>— {a.tagline || a.owner?.display_name}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
