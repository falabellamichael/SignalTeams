import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar } from "../../util";
import { Modal } from "./_shared.jsx";


export function ProfileModal({ user, me, onClose, onDm, onOpenAgent, onFriend, blockedIds, onBlock, roles }) {
  const [prof, setProf] = useState(null);
  useEffect(() => { api.profile(user.id).then(setProf).catch(() => setProf({ user })); }, [user.id]);
  const p = prof || { user };
  const mine = user.id === me?.id;

  // clicking an agent's bot avatar jumps straight to the agent card
  useEffect(() => { if (p.is_bot) p.agent ? onOpenAgent(p.agent) : onClose(); }, [p.is_bot]);
  if (p.is_bot) return null;

  return (
    <Modal title={<span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar user={p.user} size="md" showStatus />
        <span>{p.user.display_name}</span></span>}
      sub={`@${p.user.username}${mine ? " — that's you" : ""}`} onClose={onClose}>
      {p.user.status_text && <div className="msub" style={{ marginBottom: 6, color: "var(--honey)" }}>
        {p.user.status_text}</div>}
      {(roles || []).filter((r) => (user.role_ids || []).includes(r.id)).length > 0 && (
        <div className="role-list" style={{ marginBottom: 8 }}>
          {(roles || []).filter((r) => (user.role_ids || []).includes(r.id)).map((r) => (
            <span key={r.id} className="role-pill big"
              style={{ borderColor: r.color, color: r.color }}>{r.name}</span>
          ))}
        </div>
      )}
      {p.user.bio && <div className="msub" style={{ marginBottom: 10 }}>{p.user.bio}</div>}
      {p.agents?.length > 0 && (
        <>
          <label style={{ display: "block", fontSize: 11, textTransform: "uppercase",
            letterSpacing: ".5px", color: "var(--dim)", margin: "4px 0 6px" }}>
            Published agents</label>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {p.agents.map((a) => (
              <div key={a.id} className="pack-agent" onClick={() => onOpenAgent(a)}>
                <span className="pk-ico big">{a.icon || "🤖"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{a.name}</b> <span className="ver">v{a.version}</span>
                  <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{a.tagline}</div>
                </div>
                <span className="stat"><Ico n="star" s={12} />{a.stars} <Ico n="download" s={12} />{a.installs}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {p.agents?.length === 0 && !mine && (
        <div className="idehint">No agents published yet.</div>)}
      {!mine && (
        <div className="mfoot">
          <button className="primary" onClick={() => onDm(p.user)}><Ico n="chat" s={13} /> Message</button>
          {p.friend?.status === "accepted"
            ? <button disabled>🤝 Friends</button>
            : p.friend?.status === "pending"
              ? <button disabled>{p.friend.direction === "out" ? "Request sent" : "Wants to be friends — check Friends tab"}</button>
              : <button onClick={() => onFriend(p.user)}><Ico n="plus" s={13} /> Add friend</button>}
          <button className="blockbtn" title={blockedIds?.has?.(p.user.id) ? "Unblock this user" : "Block this user"}
            onClick={() => onBlock?.(p.user)}>
            {blockedIds?.has?.(p.user.id) ? <><Ico n="unlock" s={13} /> Unblock</> : <><Ico n="ban" s={13} /> Block</>}</button>
        </div>
      )}
    </Modal>
  );
}
