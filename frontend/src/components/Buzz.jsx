import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Avatar, timeAgo } from "../util";
import Ico from "./Ico";

const ICONS = {
  published: "🚀", starred: "★", installed: "⬇", joined: "🏠",
  shared: "↗", friended: "🤝", reviewed: "✍", forked: "⑂", packed: "📦", remixed: "⑂",
  answered: "✦",
};

function line(item, onUser) {
  const p = item.payload || {};
  const who = (
    <b style={onUser ? { cursor: "pointer" } : undefined}
      onClick={(e) => { if (onUser) { e.stopPropagation(); onUser(item.user, e); } }}>
      {item.user.display_name}
    </b>
  );
  switch (item.kind) {
    case "published": return <>{who} published <span className="hl">{p.name}</span> to the library</>;
    case "starred": return <>{who} starred <span className="hl">{p.name}</span></>;
    case "installed": return <>{who} benched <span className="hl">{p.name}</span></>;
    case "joined": return <>{who} joined <span className="hl">{p.server}</span></>;
    case "friended": return <>{who} became friends with <span className="hl">@{p.with}</span></>;
    case "shared": return <>{who} shared <span className="hl">{p.name}</span></>;
    case "reviewed": return <>{who} rated <span className="hl">{p.name}</span> {"★".repeat(p.rating || 0)}</>;
    case "forked": return <>{who} forked <span className="hl">{p.name}</span> — remix culture</>;
    case "packed": return <>{who} packed <span className="hl">{p.name}</span> — {p.count} agent{p.count === 1 ? "" : "s"} in one bundle</>;
    case "remixed": return <>{who} remixed the <span className="hl">{p.name}</span> pack — {p.count} agent{p.count === 1 ? "" : "s"} cloned</>;
    case "answered": return <>{who} answered <span className="hl">{p.asker}</span>'s summons in <span className="hl">#{p.channel}</span></>;
    default: return <>{who} did something ({item.kind})</>;
  }
}

const FILTERS = [
  ["all", "All"], ["agents", "Agents"], ["people", "People"], ["activity", "Activity"],
];
const GROUPS = {
  agents: ["published", "starred", "installed", "forked", "packed", "remixed", "reviewed"],
  people: ["joined", "friended"],
  activity: ["answered", "shared"],
};
const inGroup = (g, i) => g === "all" || GROUPS[g]?.includes(i.kind);

function dayLabel(ts) {
  const today = new Date().setHours(0, 0, 0, 0);
  const days = Math.round((today - new Date(ts * 1000).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return days < 7 ? "This week" : "Earlier";
}

export default function Buzz({ refreshKey, onOpenAgent, onOpenPack, onOpenChannel, onUser }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    api.buzz().then((all) => setItems(all.filter((i) => i.kind !== "mentioned"))).catch(() => {});
  }, [refreshKey]);
  const shown = items.filter((i) => inGroup(filter, i));
  const sections = useMemo(() => {
    const out = [];
    for (const i of shown) {
      const label = dayLabel(i.created_at);
      if (out[out.length - 1]?.label !== label) out.push({ label, rows: [] });
      out[out.length - 1].rows.push(i);
    }
    return out;
  }, [items, filter]);

  function openItem(i) {
    const p = i.payload || {};
    if (p.pack_id && onOpenPack) onOpenPack(p.pack_id);
    else if (p.agent_id && onOpenAgent) onOpenAgent(p.agent_id);
    else if (p.channel_id && onOpenChannel) onOpenChannel(p.channel_id, p.server_id);
  }

  return (
    <div className="buzz buzz-feed">
      <div className="buzz-inner">
        <div className="buzz-head">
          <div>
            <h2>The <span className="serif">Buzz</span></h2>
            <div className="buzz-sub">What your friends have been up to — fresh drops, stars, new faces.</div>
          </div>
          {items.length > 0 && (
            <div className="buzz-count"><b>{items.length}</b> update{items.length === 1 ? "" : "s"}</div>)}
        </div>
        <div className="buzz-tabs">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {l}<span className="n">{items.filter((i) => inGroup(k, i)).length}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 && items.length > 0 && (
          <div className="idehint" style={{ padding: "12px 4px" }}>Nothing in this lane yet.</div>)}
        {items.length === 0 && (
          <div className="empty"><div className="big">🐝</div>
            <div className="serif">All quiet.</div>
            <div>When your friends publish or bench agents, it'll show up here.</div>
          </div>
        )}
        {sections.map((sec) => (
          <section className="buzz-sec" key={sec.label}>
            <div className="buzz-day"><span>{sec.label}</span><i>{sec.rows.length}</i></div>
            <div className="buzz-list">
              {sec.rows.map((i) => {
                const p = i.payload || {};
                const clickable = !!(p.pack_id || p.agent_id || p.channel_id);
                return (
                  <div className={`buzz-item ${clickable ? "clickable" : ""}`} key={i.id}
                    data-kind={i.kind} onClick={() => clickable && openItem(i)}>
                    <div className="buzz-av"
                      onClick={(e) => { if (onUser) { e.stopPropagation(); onUser(i.user, e); } }}>
                      <Avatar user={i.user} />
                      <span className="buzz-kind">{ICONS[i.kind] || "•"}</span>
                    </div>
                    <div className="buzz-body">
                      <div className="bt">{line(i, onUser)}</div>
                      <div className="when">@{i.user.username}</div>
                    </div>
                    <div className="buzz-time">{timeAgo(i.created_at)}</div>
                    <span className="buzz-go" title="Open">
                      {clickable && <Ico n="caretR" s={13} />}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
