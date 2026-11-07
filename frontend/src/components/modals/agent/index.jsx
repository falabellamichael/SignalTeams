import React, { useEffect, useState } from "react";
import Ico from "../../Ico";
import { api } from "../../../api";
import { Modal } from "../_shared.jsx";
import { ConnectTab } from "./ConnectTab.jsx";
import { TryTab } from "./TryTab.jsx";
import { ReviewsTab } from "./ReviewsTab.jsx";
import { StatsTab } from "./StatsTab.jsx";
import { HistoryTab } from "./HistoryTab.jsx";

export function AgentModal({ agent: initialAgent, me, onClose, onStar, onInstall, onShare, onEdit, onFork, onDelete, onDm, onUpdated }) {
  const [agent, setAgent] = useState(initialAgent);
  const [tab, setTab] = useState("about");
  const [copied, setCopied] = useState("");
  useEffect(() => { setAgent(initialAgent); }, [initialAgent]);
  const mine = agent.owner_id === me?.id;
  const flashCopy = (k) => { setCopied(k); setTimeout(() => setCopied(""), 1500); };

  function handleUpdated(next) {
    setAgent(next);
    onUpdated?.(next);
  }

  return (
    <Modal title={`${agent.icon || "🤖"} ${agent.name}`}
      sub={`v${agent.version} · by ${agent.owner?.display_name} · ${agent.visibility}` +
        (agent.rating ? ` · ★${agent.rating} (${agent.rating_count})` : "") +
        (agent.forked_from ? ` · ⑂ from ${agent.forked_from}` : "")}
      onClose={onClose} wide>
      <div className="ftabs" style={{ marginBottom: 12 }}>
        {[["about", "About"],
          ["connect", `🔌 Connect${agent.api_url || agent.context_url ? " •" : ""}`],
          ["try", "⚡ Try it"],
          ["reviews", `Reviews${agent.rating_count ? ` (${agent.rating_count})` : ""}`],
          ["stats", "📊 Stats"],
          ["history", "History"]].map(([k, l]) => (
          <button key={k} className={`ftab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "about" && <>
        <div style={{ fontSize: 13 }}>{agent.tagline}</div>
        {agent.description && <p style={{ fontSize: 12.5, color: "var(--dim)" }}>{agent.description}</p>}
        <div className="tags" style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
          {agent.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
          {agent.api_url && (
            <span className="model-chip" style={{ borderColor: "var(--honey)", color: "var(--honey)" }}
              title={`Dedicated API (${agent.api_kind || "openai"}): ${agent.api_url}`}>
              🔌 {agent.api_kind || "openai"}{agent.has_api_key ? " · 🔑" : ""}
            </span>
          )}
          {agent.model && <span className="model-chip">{agent.model}</span>}
          {agent.temperature != null && agent.temperature !== 0.7 &&
            <span className="model-chip" title="custom temperature">🌡 {agent.temperature}</span>}
          {agent.context_url &&
            <span className="model-chip" title={`grounded (${agent.context_method || "GET"}) — ${agent.context_url}`}>
              🔗 {agent.context_method === "POST" ? "POST tool" : "grounded"}
            </span>}
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "8px 11px", borderRadius: 9, background: "var(--panel2)", border: "1px solid var(--border)",
          marginBottom: 10, fontSize: 12
        }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <b style={{ color: agent.api_url || agent.context_url ? "var(--honey)" : "var(--dim)" }}>
              {agent.api_url
                ? `🔌 Connected (${agent.api_kind || "openai"}): ${agent.api_url}`
                : "🔌 Engine: Inherits server / user LLM"}
            </b>
            {agent.has_api_key && <span style={{ color: "var(--good)", marginLeft: 8 }}>🔑 API key set</span>}
            {agent.context_url && <span style={{ color: "var(--accent)", marginLeft: 8 }}>🔗 {agent.context_method || "GET"} {agent.context_url}</span>}
          </div>
          <button className="ghost" style={{ fontSize: 11.5, padding: "3px 8px", flexShrink: 0 }}
            onClick={() => setTab("connect")}>
            {mine ? "Configure API →" : "Inspect →"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 4px" }}>
          <label style={{ margin: 0, fontSize: 10.5, textTransform: "uppercase", color: "var(--dim)", letterSpacing: ".5px" }}>
            System prompt</label>
          {agent.system_prompt && (
            <button className="ghost" style={{ fontSize: 11, padding: "2px 7px" }}
              onClick={() => {
                navigator.clipboard?.writeText(agent.system_prompt);
                flashCopy("prompt");
              }}>
              <Ico n={copied === "prompt" ? "check" : "copy"} s={12} /> {copied === "prompt" ? "Copied" : "Copy prompt"}
            </button>
          )}
        </div>
        <div className="prompt-view">{agent.system_prompt || "(no prompt)"}</div>
      </>}

      {tab === "connect" && (
        <ConnectTab agent={agent} me={me} onSaved={handleUpdated} />
      )}
      {tab === "try" && <TryTab agent={agent} onOpenConnect={() => setTab("connect")} />}
      {tab === "reviews" && <ReviewsTab agent={agent} me={me} />}
      {tab === "stats" && <StatsTab agent={agent} />}
      {tab === "history" && <HistoryTab agent={agent} me={me} onRestore={onEdit} />}

      <div className="mfoot">
        <button className={agent.starred ? "primary" : ""} onClick={() => onStar(agent)}>
          <Ico n="star" s={13} w={agent.starred ? "fill" : "regular"} /> {agent.starred ? "Starred" : "Star"} · {agent.stars}
        </button>
        <button onClick={() => onInstall(agent)}>
          {agent.installed ? <><Ico n="check" s={13} /> On your bench</> : <><Ico n="plus" s={13} /> Bench</>} · {agent.installs}
        </button>
        <button onClick={() => {
          navigator.clipboard?.writeText(JSON.stringify({
            format: "signalteams-agent@1", name: agent.name, icon: agent.icon, tagline: agent.tagline,
            description: agent.description, system_prompt: agent.system_prompt,
            model: agent.model, tags: agent.tags, version: agent.version,
            context_url: agent.context_url,
            author: agent.owner?.username }, null, 2));
          flashCopy("json");
        }}>
          <Ico n={copied === "json" ? "check" : "copy"} s={13} /> {copied === "json" ? "Copied JSON" : "Copy JSON"}
        </button>
        <button onClick={() => {
          navigator.clipboard?.writeText(`${location.origin}/#/agent/${agent.id}`);
          flashCopy("link");
        }}>
          <Ico n={copied === "link" ? "check" : "link"} s={13} /> {copied === "link" ? "Copied" : "Link"}
        </button>
        <button onClick={() => onShare(agent)}><Ico n="share" s={13} /> Share</button>
        {onDm && <button onClick={() => onDm(agent)} title="Private 1:1 chat"><Ico n="chat" s={13} /> Chat</button>}
        {!mine && <button onClick={() => onFork(agent)} title="Copy to your library"><Ico n="swap" s={13} /> Fork</button>}
        {mine && <>
          <button onClick={() => onEdit(agent)}><Ico n="edit" s={13} /> Edit</button>
          <button className="danger" onClick={() => onDelete(agent)}><Ico n="trash" s={13} /> Delete</button>
        </>}
      </div>
    </Modal>
  );
}

