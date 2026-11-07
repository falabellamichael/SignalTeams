import React, { useEffect, useState } from "react";
import { api } from "../../../api";
import { diffSnap } from "../_shared.jsx";

export function HistoryTab({ agent, me, onRestore }) {
  const [items, setItems] = useState([]);
  const [peek, setPeek] = useState(null);
  const [diff, setDiff] = useState(null);
  const mine = agent.owner_id === me?.id;
  useEffect(() => { api.history(agent.id).then(setItems).catch(() => {}); }, [agent.id]);

  return (
    <div>
      <div className="msub" style={{ marginBottom: 8 }}>
        Every save snapshots the previous version. Current: <b>v{agent.version}</b>
      </div>
      {items.length === 0 && (
        <div style={{ color: "var(--dim)", fontSize: 12 }}>
          No previous versions — edit this agent and its old self lands here.</div>
      )}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {items.map((h, i) => {
          const newer = i === 0 ? agent : items[i - 1].snapshot;
          const rows = diffSnap(h.snapshot, newer);
          const open = diff === h.id;
          return (
            <div key={h.id} className="hist-row" style={{ display: "block" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="v">v{h.version}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.snapshot.name}</div>
                  <div className="snap">{h.snapshot.system_prompt || h.snapshot.tagline}</div>
                  <div className="who">{h.avatar} {h.editor} · {new Date(h.created_at * 1000).toLocaleString()}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="restore ghost" onClick={() => setPeek(peek === h.id ? null : h.id)}>
                    {peek === h.id ? "hide" : "peek"}</button>
                  <button className="restore ghost" onClick={() => setDiff(open ? null : h.id)}>
                    {open ? "close" : `diff${rows.length ? ` (${rows.length})` : ""}`}</button>
                  {mine && <button className="restore"
                    onClick={() => onRestore({ ...h.snapshot, id: agent.id })}>restore</button>}
                </div>
              </div>
              {open && (
                <div className="diff-box">
                  {rows.length === 0 && <div className="idehint">No field changes vs the next version.</div>}
                  {rows.map((r) => (
                    <div key={r.label} className="diff-row">
                      <div className="df">{r.label}</div>
                      <div className="dd">
                        <div className="old">{String(r.a) || <i>empty</i>}</div>
                        <div className="new">{String(r.b) || <i>empty</i>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {peek && items.find((h) => h.id === peek) && (
        <div className="prompt-view" style={{ marginTop: 8 }}>
          {items.find((h) => h.id === peek).snapshot.system_prompt}
        </div>
      )}
    </div>
  );
}
