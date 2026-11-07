import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";


export function ChannelModal({ kind, channel, me, roles, onClose, onDone, onDelete }) {
  const editing = !!channel;
  const [name, setName] = useState(channel?.name || "");
  const [topic, setTopic] = useState(channel?.topic || "");
  const [category, setCategory] = useState(channel?.category || "");
  const [slow, setSlow] = useState(channel?.slowmode_secs || 0);
  const [vcap, setVcap] = useState(channel?.voice_cap || 0);
  const [roleId, setRoleId] = useState(channel?.role_id || 0);
  const [picked, setPicked] = useState(new Set((channel?.roster || []).map((a) => a.id)));
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (kind === "agents") api.agents({ sort: "name" }).then((all) =>
      setAgents([...all].sort((a, b) => (a.owner_id === me?.id ? 0 : 1) - (b.owner_id === me?.id ? 0 : 1)))
    ).catch(() => {});
  }, [kind, me?.id]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal title={editing ? `Edit ${kind === "agents" ? "✦" : "#"}${channel.name}`
        : `New ${kind === "agents" ? "agent" : "text"} channel`} onClose={onClose}
      sub={kind === "agents" ? "Agent channels highlight shared agent cards — pick residents to pin." : "Plain talk."}>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "agents" ? "agent-drops" : "general"} />
      <label>Topic</label>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="optional" />
      <label>Category <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional — groups channels in the sidebar)</span></label>
      <input value={category} onChange={(e) => setCategory(e.target.value)}
        placeholder="e.g. projects, fun" maxLength={48} />
      {kind === "text" && (
        <>
          <label>Slowmode <span style={{ color: "var(--dim)", fontWeight: 400 }}>(seconds between messages — 0 = off)</span></label>
          <input type="number" min={0} max={21600} value={slow}
            onChange={(e) => setSlow(Math.max(0, Math.min(+e.target.value || 0, 21600)))} />
          <label>Voice cap <span style={{ color: "var(--dim)", fontWeight: 400 }}>(max people in 🎧 — 0 = unlimited)</span></label>
          <input type="number" min={0} max={99} value={vcap}
            onChange={(e) => setVcap(Math.max(0, Math.min(+e.target.value || 0, 99)))} />
        </>
      )}
      {(roles || []).length > 0 && (
        <>
          <label><Ico n="lock" s={12} /> Visible to <span style={{ color: "var(--dim)", fontWeight: 400 }}>(role-gated — owner always gets in)</span></label>
          <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
            <option value={0}>everyone</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </>
      )}
      {kind === "agents" && (
        <>
          <label>Resident agents — pinned to the channel header</label>
          <div className="pack-pick" style={{ maxHeight: 160, overflowY: "auto" }}>
            {agents.map((a) => (
              <div key={a.id} className={`pack-agent ${picked.has(a.id) ? "on" : ""}`}
                onClick={() => toggle(a.id)}>
                <span className="pk-ico big">{a.icon || "🤖"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{a.name}</b> <span className="ver">{a.owner?.display_name}</span>
                </div>
                <span className="stat">{picked.has(a.id) ? <Ico n="check" s={13} /> : ""}</span>
              </div>
            ))}
            {agents.length === 0 && <div className="idehint">No agents visible.</div>}
          </div>
        </>
      )}
      <div className="mfoot">
        {editing && <button className="danger" onClick={() => onDelete(channel)}><Ico n="trash" s={13} /> Delete</button>}
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()}
          onClick={() => onDone(name.trim(), kind, topic.trim(), [...picked], category.trim(), slow, vcap, roleId)}>
          {editing ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
