import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar, timeAgo, timeUntil } from "../../util";
import { Modal } from "./_shared.jsx";


export function InboxModal({ onClose, onJump }) {
  const [items, setItems] = useState(null);
  const [rems, setRems] = useState([]);
  useEffect(() => {
    api.inbox().then(setItems).catch(() => setItems([]));
    api.reminders().then(setRems).catch(() => {});
  }, []);
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="tray" s={16} /> Inbox</span>}
      sub="Every @you — mentions and agent replies." onClose={onClose} wide>
      {rems.length > 0 && (
        <>
          <label style={{ fontSize: 10.5, textTransform: "uppercase",
            color: "var(--dim)", letterSpacing: ".5px" }}>⏰ your reminders</label>
          {rems.map((r) => (
            <div key={"r" + r.id} className="inbox-row" style={{ opacity: .85 }}>
              <span style={{ fontSize: 16 }}><Ico n="timer" s={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{r.text}</div>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>
                  fires {timeUntil(r.due_at)} — #{r.channel_name || "a channel"}</div>
              </div>
              <span className="ib-jump" title="Cancel reminder"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.delReminder(r.id).catch(() => {});
                  setRems((x) => x.filter((y) => y.id !== r.id));
                }}><Ico n="x" s={13} /></span>
            </div>
          ))}
          <div style={{ height: 6 }} />
        </>
      )}
      {!items && <div className="idehint">Loading…</div>}
      {items?.length === 0 && <div className="idehint">Nobody's pinged you yet — suspicious.</div>}
      {(items || []).map((e) => (
        <div key={e.id} className="inbox-row" onClick={() => onJump(e.payload)}>
          <Avatar user={e.user} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <b>{e.user.display_name}</b>
              <span style={{ color: "var(--dim)" }}> mentioned you in </span>
              <b>#{e.payload.channel}</b>
              <span className="ib-time">{timeAgo(e.created_at)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.payload.excerpt}</div>
          </div>
          <span className="ib-jump"><Ico n="reply" s={14} /></span>
        </div>
      ))}
    </Modal>
  );
}
