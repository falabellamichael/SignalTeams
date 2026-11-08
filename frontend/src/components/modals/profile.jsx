import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar } from "../../util";

export function ProfileModal({ user, me, onClose, onDm, onOpenAgent, onFriend, blockedIds, onBlock, roles }) {
  const [prof, setProf] = useState(null);
  useEffect(() => { api.profile(user.id).then(setProf).catch(() => setProf({ user })); }, [user.id]);
  const p = prof || { user };
  const mine = user.id === me?.id;

  // clicking an agent's bot avatar jumps straight to the agent card
  useEffect(() => { if (p.is_bot) p.agent ? onOpenAgent(p.agent) : onClose(); }, [p.is_bot]);
  if (p.is_bot) return null;

  const bannerBg = p.user.banner_color || p.user.avatar_color || "var(--accent)";
  const memberRoles = (roles || []).filter((r) => (user.role_ids || []).includes(r.id));
  const memberSince = p.user.created_at
    ? new Date(p.user.created_at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="shade" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-banner" style={{ background: bannerBg }}>
          <button className="ghost modal-x" onClick={onClose} title="Close (Esc)"
            style={{ position: "absolute", top: 8, right: 8, color: "#fff", background: "rgba(0,0,0,0.3)" }}>
            <Ico n="x" s={14} />
          </button>
        </div>
        <div className="profile-body">
          <div className="profile-avatar-row">
            <Avatar user={p.user} size="lg" showStatus />
            <div className="profile-badges">
              {p.user.status === "bot" && <span className="profile-badge">BOT</span>}
              {mine && <span className="profile-badge">YOU</span>}
            </div>
          </div>

          <div className="profile-identity">
            <div className="profile-display">{p.user.display_name}</div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
              <span className="profile-username">@{p.user.username}</span>
              {p.user.pronouns && <span className="profile-pronouns">{p.user.pronouns}</span>}
            </div>
          </div>

          {p.user.status_text && (
            <div className="profile-status-bar">
              <Ico n="sparkle" s={12} /> {p.user.status_text}
            </div>
          )}

          <div className="profile-divider" />

          {p.user.bio ? (
            <div style={{ marginBottom: 10 }}>
              <div className="profile-sec-title">About Me</div>
              <div className="profile-bio-box">{p.user.bio}</div>
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <div className="profile-sec-title">About Me</div>
              <div className="idehint">No bio written yet.</div>
            </div>
          )}

          {memberSince && (
            <div style={{ marginBottom: 10 }}>
              <div className="profile-sec-title">Member Since</div>
              <div className="profile-meta-text">📅 {memberSince}</div>
            </div>
          )}

          {memberRoles.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="profile-sec-title">Roles</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {memberRoles.map((r) => (
                  <span key={r.id} className="profile-role-chip" style={{ borderColor: r.color }}>
                    <span className="profile-role-circle" style={{ background: r.color }} />
                    <span style={{ color: r.color }}>{r.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {p.agents?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="profile-sec-title">Published Agents ({p.agents.length})</div>
              <div style={{ maxHeight: 140, overflowY: "auto" }}>
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
            </div>
          )}

          {!mine && (
            <div className="mfoot" style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <button className="primary" onClick={() => onDm(p.user)}><Ico n="chat" s={13} /> Message</button>
              {p.friend?.status === "accepted" ? (
                <button disabled>🤝 Friends</button>
              ) : p.friend?.status === "pending" ? (
                <button disabled>{p.friend.direction === "out" ? "Request sent" : "Pending request"}</button>
              ) : (
                <button onClick={() => onFriend(p.user)}><Ico n="plus" s={13} /> Add friend</button>
              )}
              <button className="blockbtn" title={blockedIds?.has?.(p.user.id) ? "Unblock this user" : "Block this user"}
                onClick={() => onBlock?.(p.user)}>
                {blockedIds?.has?.(p.user.id) ? <><Ico n="unlock" s={13} /> Unblock</> : <><Ico n="ban" s={13} /> Block</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
