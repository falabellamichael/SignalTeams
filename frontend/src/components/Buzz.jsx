import React, { useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../util";
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
  ["all", "All"], ["agents", "🧰 Agents"], ["people", "👥 People"], ["activity", "✦ Activity"],
];
const GROUPS = {
  agents: ["published", "starred", "installed", "forked", "packed", "remixed", "reviewed"],
  people: ["joined", "friended"],
  activity: ["answered", "shared"],
};

export default function Buzz({ refreshKey, onOpenAgent, onOpenPack, onOpenChannel, onUser }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    api.buzz().then((all) => setItems(all.filter((i) => i.kind !== "mentioned"))).catch(() => {});
  }, [refreshKey]);
  const shown = filter === "all" ? items : items.filter((i) => GROUPS[filter]?.includes(i.kind));

  function openItem(i) {
    const p = i.payload || {};
    if (p.pack_id && onOpenPack) onOpenPack(p.pack_id);
    else if (p.agent_id && onOpenAgent) onOpenAgent(p.agent_id);
    else if (p.channel_id && onOpenChannel) onOpenChannel(p.channel_id, p.server_id);
  }

  return (
    <div className="buzz">
      <div className="buzz-inner">
      <div className="lib-head"><h2>The <span className="serif">Buzz</span></h2></div>
      <div className="lib-sub">What your friends have been up to — fresh drops, stars, new faces.</div>
      <div className="seg" style={{ margin: "8px 0 14px", width: "fit-content" }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""}
            onClick={() => setFilter(k)}>{l}</button>
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
      {shown.map((i) => {
        const p = i.payload || {};
        const clickable = !!(p.pack_id || p.agent_id || p.channel_id);
        return (
          <div className={`buzz-item ${clickable ? "clickable" : ""}`} key={i.id}
            onClick={() => clickable && openItem(i)}>
            <div className="bicon" style={{ borderColor: `${i.user.avatar_color}66` }}
              onClick={(e) => { if (onUser) { e.stopPropagation(); onUser(i.user, e); } }}>
              {ICONS[i.kind] || "•"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bt">{line(i, onUser)}</div>
              <div className="when">{timeAgo(i.created_at)} · {i.user.avatar_emoji} @{i.user.username}</div>
            </div>
            {clickable && <span className="buzz-go" title="Open"><Ico n="caretR" s={13} /></span>}
          </div>
        );
      })}
      </div>
    </div>
  );
}
