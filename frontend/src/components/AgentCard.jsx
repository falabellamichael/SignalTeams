import React from "react";
import Ico from "./Ico";

// Grid card for the library
export function AgentCard({ agent, me, onOpen, onStar, onInstall, onShare, onDm, showVis }) {
  const mine = agent.owner_id === me?.id;
  const VIS = { public: ["globe", "public", "var(--good)"], friends: ["users", "friends", "var(--honey)"],
                private: ["lock", "private", "var(--bad)"] };
  return (
    <div className="acard" onClick={() => onOpen(agent)}>
      <div className="top">
        <div className="aicon">{agent.icon || "🤖"}</div>
        <div style={{ minWidth: 0 }}>
          <div className="an">{agent.name} <span className="ver">v{agent.version}</span></div>
          <div className="by">by {agent.owner?.display_name}{mine ? " (you)" : ""}
            {agent.forked_from && <span title={`Forked from ${agent.forked_from}`}> · ⑂</span>}
            {(showVis || mine) && agent.visibility && agent.visibility !== "public" && (
              <span className="vis-chip" style={{ color: VIS[agent.visibility]?.[2] }}
                title={`Visibility: ${agent.visibility}`}> · <Ico n={VIS[agent.visibility]?.[0]} s={11} /> {VIS[agent.visibility]?.[1]}</span>)}
          </div>
        </div>
      </div>
      <div className="tagline">{agent.tagline || agent.description?.slice(0, 100)}</div>
      <div className="tags">
        {agent.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
        {agent.api_url && (
          <span className="model-chip" style={{ borderColor: "var(--honey)", color: "var(--honey)" }}
            title={`Dedicated API connection (${agent.api_kind || "openai"}): ${agent.api_url}`}>
            🔌 {agent.api_kind || "api"}{agent.has_api_key ? " · 🔑" : ""}
          </span>
        )}
        {agent.model && <span className="model-chip">{agent.model}</span>}
        {agent.temperature != null && agent.temperature !== 0.7 &&
          <span className="model-chip" title="custom temperature">🌡 {agent.temperature}</span>}
        {agent.context_url &&
          <span className="model-chip" title={`grounded (${agent.context_method || "GET"}) — ${agent.context_url}`}>🔗 {agent.context_method === "POST" ? "tool" : "grounded"}</span>}
      </div>
      <div className="foot" onClick={(e) => e.stopPropagation()}>
        <button className="ghost" style={{ color: agent.starred ? "var(--honey)" : undefined, display: "inline-flex", alignItems: "center", gap: 4 }}
          onClick={() => onStar(agent)} title="Star">
          <Ico n="star" s={13} w={agent.starred ? "fill" : "regular"} /> <span className={`stat ${agent.stars ? "honey" : ""}`}>{agent.stars}</span>
        </button>
        <span className="stat"><Ico n="dl" s={12} /> {agent.installs}</span>
        {agent.summons > 0 && <span className="stat" title="Summoned this many times"><Ico n="sparkle" s={12} /> {agent.summons}</span>}
        <span className="grow" />
        <button className="ghost" title="Share to channel" onClick={() => onShare(agent)}><Ico n="share" s={14} /></button>
        {onDm && <button className="ghost" title="DM this agent — private 1:1 chat"
          onClick={() => onDm(agent)}><Ico n="chat" s={14} /></button>}
        {agent.installed
          ? <button className="ghost" style={{ color: "var(--good)" }} onClick={() => onInstall(agent)}>✓ benched</button>
          : <button onClick={() => onInstall(agent)}>+ bench</button>}
      </div>
    </div>
  );
}

// Compact card embedded in a chat message
export function AgentShareCard({ agent, onOpen }) {
  return (
    <div className="share-card">
      <div className="top">
        <div className="aicon">{agent.icon || "🤖"}</div>
        <div>
          <div className="an">{agent.name}</div>
          <div className="at">{agent.tagline || `by ${agent.owner?.display_name}`}</div>
        </div>
      </div>
      {agent.description && <div className="desc">{agent.description}</div>}
      <div className="foot">
        <button onClick={() => onOpen(agent)}>View agent</button>
        <span className="ver">v{agent.version} · ★{agent.stars}</span>
      </div>
    </div>
  );
}

// Grid card for the packs tab
export function PackCard({ pack, me, onOpen, onBench, onDelete }) {
  const mine = pack.owner_id === me?.id;
  return (
    <div className="acard" onClick={() => onOpen(pack)}>
      <div className="top">
        <div className="aicon">{pack.icon || "📦"}</div>
        <div style={{ minWidth: 0 }}>
          <div className="an">{pack.name}</div>
          <div className="by">by {pack.owner?.display_name}{mine ? " (you)" : ""}
            {pack.forked_from && <span title={`Forked from ${pack.forked_from}`}> · ⑂</span>}</div>
        </div>
      </div>
      <div className="tagline">{pack.description || "A bundled toolkit."}</div>
      <div className="pack-strip">
        {(pack.icons || []).map((ic, i) => <span key={i} className="pk-ico">{ic}</span>)}
        <span className="pk-count">{pack.count} agent{pack.count === 1 ? "" : "s"}</span>
      </div>
      <div className="foot" onClick={(e) => e.stopPropagation()}>
        <span className="grow" />
        {mine && <button className="ghost" title="Delete pack" onClick={() => onDelete(pack)}><Ico n="x" s={13} /></button>}
        <button onClick={() => onBench(pack)}>+ bench all</button>
      </div>
    </div>
  );
}

// Pack card embedded in a chat message
export function PackShareCard({ pack, onOpen }) {
  return (
    <div className="share-card pack" onClick={() => onOpen(pack)} style={{ cursor: "pointer" }}>
      <div className="top">
        <div className="aicon">{pack.icon || "📦"}</div>
        <div>
          <div className="an">{pack.name}</div>
          <div className="at">agent pack · by {pack.owner?.display_name}</div>
        </div>
      </div>
      {pack.description && <div className="desc">{pack.description}</div>}
      <div className="foot">
        <div className="pack-strip">
          {(pack.icons || []).map((ic, i) => <span key={i} className="pk-ico">{ic}</span>)}
        </div>
        <span className="ver">{pack.count} agents →</span>
      </div>
    </div>
  );
}
