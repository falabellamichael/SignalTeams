import Ico from "./Ico";
import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Avatar, timeAgo } from "../util";

export default function Saved({ onJump }) {
  const [items, setItems] = useState(null);
  const load = () => api.saved().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function unsave(m) {
    await api.saveMsg(m.id).catch(() => {});
    setItems((xs) => xs.filter((x) => x.id !== m.id));
  }

  return (
    <div className="buzz">
      <div className="lib-head"><h2><span className="serif">Saved</span></h2></div>
      <div className="lib-sub">Messages you bookmarked — agent cards, recipes, lore.</div>
      {!items && <div className="idehint">Loading…</div>}
      {items?.length === 0 && (
        <div className="empty"><div className="big">🔖</div>
          <div className="serif">Nothing saved.</div>
          <div>Right-click any message → Save. It'll wait here.</div>
        </div>
      )}
      {(items || []).map((m) => (
        <div key={m.saved_id} className="inbox-row" onClick={() => onJump(m)}>
          <Avatar user={m.author} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <b>{m.author?.display_name}</b>
              <span style={{ color: "var(--dim)" }}> in </span>
              <b>{m.dm ? "@" : "#"}{m.channel}</b>
              <span className="ib-time">{timeAgo(m.created_at)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.content || (m.attachments?.length ? "📎 attachment" : "—")}
            </div>
          </div>
          <span className="ib-jump"><Ico n="share" s={13} /></span>
          <span className="stat kick" title="Remove from saved"
            onClick={(e) => { e.stopPropagation(); unsave(m); }}><Ico n="x" s={12} /></span>
        </div>
      ))}
    </div>
  );
}
