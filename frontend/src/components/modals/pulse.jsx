import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";


export function PulseModal({ server, onClose, onJump }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.pulse(server.id).then(setP).catch((e) => setErr(e.message));
  }, [server.id]);
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const labels = p ? p.days.map((_, i) => {
    const d = new Date((p.today0 + (i - 6) * 86400) * 1000);
    return DOW[d.getDay()];
  }) : [];
  const max = p ? Math.max(1, ...p.days) : 1;
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="pulse" s={16} /> {server.name} — pulse</span>}
      sub="Last 7 days of activity" onClose={onClose}>
      {err && <div className="msub">{err}</div>}
      {!p && !err && <div className="msub">Counting…</div>}
      {p && (
        <>
          <div className="pulse-bars">
            {p.days.map((n, i) => (
              <div key={i} className="pb-col" title={`${labels[i]}: ${n} messages`}>
                <div className="pb-bar" style={{ height: `${Math.max(4, (n / max) * 64)}px` }} />
                <div className="pb-lab">{labels[i]}</div>
              </div>
            ))}
          </div>
          <div className="pulse-stats">
            <div className="ps"><b>{p.total}</b><span>messages</span></div>
            <div className="ps"><b>{p.active_members}</b><span>active members</span></div>
            <div className="ps"><b>{p.new_members}</b><span>new members</span></div>
          </div>
          <div className="pulse-rows">
            {p.top_poster && (
              <div className="pr">🏆 top poster — <b>{p.top_poster.name}</b>
                <span className="pr-n">{p.top_poster.count} msgs</span></div>)}
            {(p.top_agents || []).map((a, i) => (
              <div key={a.name} className="pr">
                {i === 0 ? "🤖" : `${i + 1}.`} {i === 0 ? "busiest agent — " : ""}
                <b>{a.name}</b>
                <span className="pr-n">{a.count} replies</span></div>))}
            {p.top_message && (
              <div className="pr link" onClick={() => onJump?.(p.top_message)}>
                ✨ most reacted — <b className="pr-x">{p.top_message.excerpt || "(attachment)"}</b>
                <span className="pr-n">{p.top_message.reactions} reacts · jump →</span></div>)}
            {!p.top_poster && !p.top_agent && !p.top_message && (
              <div className="msub">Quiet week — go make some noise. 📣</div>)}
          </div>
        </>
      )}
    </Modal>
  );
}
