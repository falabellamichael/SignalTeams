import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";


export function GroupDmModal({ friends, channel, me, onClose, onCreate, onAdd, onAddAgent }) {
  const [picked, setPicked] = useState(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(0);
  const [agents, setAgents] = useState([]);
  const adding = !!channel;
  useEffect(() => {
    if (adding) api.agents().then(setAgents).catch(() => {});
  }, [adding]);
  const inGroup = new Set([me?.id, ...(channel?.members || []).map((m) => m.id)]);
  const pickable = (friends || []).filter((f) => !adding || !inGroup.has(f.id));
  const agentSlug = (n) => `agent:${(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24)}`;
  const memberNames = new Set((channel?.members || []).map((m) => m.username));
  const pickableAgents = (agents || []).filter((a) => !memberNames.has(agentSlug(a.name)));
  const need = adding ? 1 : 2;
  function toggle(id) {
    setPicked((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="users" s={16} /> {adding ? "Add to group" : "New group DM"}</span>}
      sub={adding ? `Add friends to ${channel.name || "the group"}.` : "Pick 2+ friends — you count as one."}
      onClose={onClose}>
      {!adding && <>
        <label>Name <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional)</span></label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="the sunday crew" maxLength={48} />
      </>}
      <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
        {pickable.length === 0 && <div className="idehint">
          {adding ? "Everyone's already here." : "No friends yet — add some first."}</div>}
        {pickable.map((f) => (
          <div key={f.id} className={`pack-agent ${picked.has(f.id) ? "on" : ""}`}
            onClick={() => toggle(f.id)} style={{ cursor: "pointer" }}>
            <span className="pk-ico big">{f.avatar_emoji}</span>
            <div style={{ flex: 1 }}><b>{f.display_name}</b>
              <div style={{ fontSize: 11, color: "var(--dim)" }}>@{f.username}</div></div>
            <span className="stat">{picked.has(f.id) ? <Ico n="check" s={13} /> : ""}</span>
          </div>
        ))}
        {adding && pickableAgents.length > 0 && <>
          <div className="idehint" style={{ marginTop: 10 }}>✦ or invite an agent — it answers @mentions</div>
          {pickableAgents.map((a) => (
            <div key={a.id} className="pack-agent" style={{ cursor: "pointer" }}
              onClick={async () => {
                if (agentBusy) return;
                setAgentBusy(a.id);
                await onAddAgent?.(a.id);
                setAgentBusy(0);
              }}>
              <span className="pk-ico big">{a.icon || "🤖"}</span>
              <div style={{ flex: 1 }}><b>{a.name}</b>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>{a.tagline || "agent"}</div></div>
              <span className="stat">{agentBusy === a.id ? "…" : <Ico n="plus" s={13} />}</span>
            </div>
          ))}
        </>}
      </div>
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={picked.size < need || busy}
          onClick={async () => {
            setBusy(true);
            if (adding) await onAdd([...picked]);
            else await onCreate([...picked], name.trim());
          }}>
          {busy ? "…" : adding ? `Add ${picked.size || ""}` : `Create (${picked.size + 1})`}
        </button>
      </div>
    </Modal>
  );
}
