import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";


export function ForwardModal({ msg, servers, dms, onClose, onPick }) {
  const [targets, setTargets] = useState(null);
  useEffect(() => {
    Promise.all((servers || []).map((s) => api.server(s.id).catch(() => null)))
      .then((fulls) => {
        const t = [];
        fulls.forEach((f) => f?.channels.forEach((c) =>
          t.push({ cid: c.id, sid: f.id, label: `${f.icon} ${f.name} · ${c.kind === "agents" ? "✦" : "#"}${c.name}` })));
        (dms || []).forEach((d) =>
          t.push({ cid: d.id, sid: null, label: `@ ${d.other?.display_name || "DM"}` }));
        setTargets(t.filter((x) => x.cid !== msg.channel_id));
      });
  }, []);
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="forward" s={16} /> Forward message</span>}
      sub={msg.content?.slice(0, 90)} onClose={onClose}>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {!targets && <div className="idehint">Loading destinations…</div>}
        {targets?.length === 0 && <div className="idehint">Nowhere else to send it.</div>}
        {targets?.map((t) => (
          <div key={t.cid} className="ideopt" onClick={() => onPick(t)}>{t.label}</div>
        ))}
      </div>
    </Modal>
  );
}
