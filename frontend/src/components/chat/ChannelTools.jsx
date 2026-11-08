import React, { useEffect, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { timeAgo, hasSearchQuery } from "../../util";
import { AgentShareCard, PackShareCard } from "../AgentCard";

export function ChannelTools({ channel, me, onAgentOpen, onPackOpen, onJump, voice, onJoinCall, onLeaveCall, onWorkspace }) {
  const [open, setOpen] = useState(null);     // "search" | "pins" | null
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [pins, setPins] = useState([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setOpen(null); setQ(""); setHits([]); }, [channel.id]);

  async function search(v) {
    setQ(v);
    if (!hasSearchQuery(v)) { setHits([]); return; }
    setHits(await api.searchChannel(channel.id, v.trim()).catch(() => []));
  }

  async function togglePins() {
    if (open === "pins") { setOpen(null); return; }
    setPins(await api.pins(channel.id).catch(() => []));
    setOpen("pins");
  }

  const Row = ({ m }) => (
    <div className="ideopt" style={{ display: "block", padding: "6px 8px", cursor: "pointer" }}
      onClick={() => { setOpen(null); onJump?.(m.id); }}>
      <b style={{ fontSize: 11.5, color: m.author?.avatar_color }}>{m.author?.display_name}</b>
      <span style={{ fontSize: 10, color: "var(--dim)", marginLeft: 6 }}>{timeAgo(m.created_at)}</span>
      <div style={{ fontSize: 12, marginTop: 2, whiteSpace: "pre-wrap" }}>{m.content}</div>
      {m.agent && <AgentShareCard agent={m.agent} onOpen={onAgentOpen} />}
      {m.pack && <PackShareCard pack={m.pack} onOpen={onPackOpen} />}
    </div>
  );

  return (
    <div className="ch-tools">
      {channel.workspace && (
        <button className="ghost ws-chip" title={`Open workspace ${channel.workspace.name} — agents here can edit its files`}
          onClick={() => onWorkspace?.(channel.workspace)}>
          {channel.workspace.icon} {channel.workspace.name}
        </button>
      )}
      <button className={`ghost ${open === "search" ? "on" : ""}`} title="Search channel"
        onClick={() => setOpen(open === "search" ? null : "search")}><Ico n="search" /></button>
      <button className={`ghost ${open === "pins" ? "on" : ""}`} title="Pinned messages"
        onClick={togglePins}><Ico n="pin" /></button>
      <button className={`ghost ${voice?.joined && voice?.channelId === channel.id ? "on" : ""}`}
        title={voice?.joined && voice?.channelId === channel.id ? "Leave voice" : "Join voice"}
        onClick={() => (voice?.joined && voice?.channelId === channel.id) ? onLeaveCall() : onJoinCall()}><Ico n="phones" /></button>
      <button className={`ghost ${exporting ? "on" : ""}`} title="Export transcript"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            let before = 0, all = [];
            for (let guard = 0; guard < 400; guard++) {
              const page = await api.messages(channel.id, before).catch(() => []);
              if (!page.length) break;
              all = [...page, ...all];
              before = page[0].id;
              if (page.length < 50) break;
            }
            const txt = all.map((m) =>
              `[${new Date(m.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")}] ` +
              `${m.author?.display_name || "?"}: ${m.content || "(attachment)"}`)
              .join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
            a.download = `${channel.name || "dm"}-transcript.txt`;
            a.click(); URL.revokeObjectURL(a.href);
          } finally { setExporting(false); }
        }}><Ico n="fileDl" /></button>
      {open === "search" && (
        <div className="ch-panel">
          <input autoFocus placeholder={`Search ${channel.kind === "dm" ? "@…" : "#" + channel.name}…`}
            value={q} onChange={(e) => search(e.target.value)} />
          <div className="idehint" style={{ marginTop: 6 }}>
            try <code>from:me</code> <code>has:link</code> <code>pinned:true</code>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            {hasSearchQuery(q) && hits.length === 0 &&
              <div className="idehint">No matches.</div>}
            {hits.map((m) => <Row key={m.id} m={m} />)}
          </div>
        </div>
      )}
      {open === "pins" && (
        <div className="ch-panel">
          <label style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--dim)" }}>
            📌 Pinned in this channel</label>
          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            {pins.length === 0 && <div className="idehint">Nothing pinned — hover a message and hit 📌.</div>}
            {pins.map((m) => <Row key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}
