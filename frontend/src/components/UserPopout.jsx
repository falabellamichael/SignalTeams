import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { Avatar } from "../util";

// Click-a-user popout: the mini profile card anchored at the cursor, with the
// things people actually want — mutual servers, mutual friends, and the quick
// actions. Full profile modal stays one click away via "View Profile".
export function UserPopout({ user, me, x, y, onClose, onDm, onFriend, onBlock, onProfile, onOpenAgent, onJumpServer, blockedIds }) {
  const [prof, setProf] = useState(null);
  const ref = useRef(null);
  useEffect(() => { api.profile(user.id).then(setProf).catch(() => setProf({ user })); }, [user.id]);
  const p = prof || { user };

  // bots route straight to their agent card — same rule as the profile modal
  useEffect(() => { if (p.is_bot) { onClose(); p.agent ? onOpenAgent?.(p.agent) : null; } }, [p.is_bot]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  // keep it on screen — measure once mounted and flip/shift if it overflows
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - r.width - 10);
    const ny = Math.min(y, window.innerHeight - r.height - 10);
    setPos({ left: Math.max(10, nx), top: Math.max(10, ny) });
  }, [x, y, prof]);

  if (p.is_bot) return null;
  const mine = user.id === me?.id;
  const bannerBg = p.user.banner_color || p.user.avatar_color || "var(--accent)";
  const mutualServers = p.mutual_servers || [];
  const mutualFriends = p.mutual_friends || [];
  const fr = p.friend;
  const blocked = blockedIds?.has?.(p.user.id);

  return (
    <>
      <div className="menu-scrim" onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="user-pop" ref={ref} style={pos}>
        <div className="upop-banner" style={{ background: bannerBg }} />
        <div className="upop-avatar"><Avatar user={p.user} size="lg" showStatus /></div>
        <div className="upop-id">
          <div className="upop-name">{p.user.display_name}</div>
          <div className="upop-handle">@{p.user.username}{mine ? " · you" : ""}</div>
          {p.user.status_text && <div className="upop-status"><Ico n="sparkle" s={11} /> {p.user.status_text}</div>}
        </div>

        {!mine && mutualServers.length > 0 && (
          <div className="upop-sec">
            <div className="upop-sec-title">Mutual Servers — {mutualServers.length}</div>
            <div className="upop-list">
              {mutualServers.slice(0, 4).map((s) => (
                <div key={s.id} className="upop-row" onClick={() => { onJumpServer?.(s.id); onClose(); }}>
                  <span className="upop-sicon">{s.icon}</span>
                  <span className="upop-row-name">{s.name}</span>
                  <Ico n="caretR" s={12} />
                </div>
              ))}
              {mutualServers.length > 4 && <div className="upop-more">+{mutualServers.length - 4} more — open profile</div>}
            </div>
          </div>
        )}

        {!mine && mutualFriends.length > 0 && (
          <div className="upop-sec">
            <div className="upop-sec-title">Mutual Friends — {mutualFriends.length}</div>
            <div className="upop-friends">
              {mutualFriends.slice(0, 8).map((f) => (
                <span key={f.id} className="upop-fchip" title={`@${f.username}`}>
                  <Avatar user={f} size="xs" /> <span className="upop-fname">{f.display_name}</span>
                </span>
              ))}
              {mutualFriends.length > 8 && <span className="upop-more">+{mutualFriends.length - 8}</span>}
            </div>
          </div>
        )}

        <div className="upop-actions">
          {!mine && (
            <button className="upop-btn" title="Message" onClick={() => { onDm?.(p.user); onClose(); }}>
              <Ico n="chat" s={15} />
            </button>
          )}
          {!mine && (
            fr?.status === "accepted" ? (
              <button className="upop-btn on" title="Friends" disabled><Ico n="users" s={15} /></button>
            ) : fr?.status === "pending" ? (
              <button className="upop-btn" title={fr.direction === "out" ? "Request sent" : "Pending request"} disabled><Ico n="clock" s={15} /></button>
            ) : (
              <button className="upop-btn" title="Add friend" onClick={() => { onFriend?.(p.user); onClose(); }}>
                <Ico n="plus" s={15} />
              </button>
            )
          )}
          <button className="upop-btn" title="View profile" onClick={() => { onProfile?.(p.user); onClose(); }}>
            <Ico n="user" s={15} />
          </button>
          {!mine && (
            <button className={`upop-btn ${blocked ? "" : "danger"}`} title={blocked ? "Unblock" : "Block"}
              onClick={() => { onBlock?.(p.user); onClose(); }}>
              <Ico n={blocked ? "unlock" : "ban"} s={15} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
