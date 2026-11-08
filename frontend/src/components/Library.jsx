import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AgentCard, PackCard } from "./AgentCard";
import Ico from "./Ico";

const SORTS = [["new", "Newest"], ["stars", "Most starred"], ["installs", "Most benched"], ["summons", "Most summoned"], ["name", "A–Z"]];

export default function Library({ me, onOpenAgent, onStar, onInstall, onShare, onDm, onPublish, refreshKey, benchOnly,
                                  onOpenPack, onNewPack, onBenchPack, onDeletePack }) {
  const [agents, setAgents] = useState([]);
  const [packs, setPacks] = useState([]);
  const [trending, setTrending] = useState([]);
  const [tab, setTab] = useState("agents");
  // library scope — Public = the shared catalog everybody sees; Private =
  // my own agents regardless of their visibility (work locally only)
  const [scope, setScope] = useState(() => localStorage.getItem("st.libscope") || "public");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("new");
  const [err, setErr] = useState("");

  useEffect(() => {
    localStorage.setItem("st.libscope", scope);
  }, [scope]);

  useEffect(() => {
    const call = benchOnly ? api.bench()
      : api.agents({ q, tag, sort, mine: scope === "private" ? 1 : 0 });
    call.then(setAgents).catch((e) => setErr(e.message));
  }, [q, tag, sort, scope, refreshKey, benchOnly]);

  useEffect(() => {
    if (!benchOnly) {
      api.packs().then(setPacks).catch(() => {});
      api.trending().then(setTrending).catch(() => {});
    }
  }, [refreshKey, benchOnly]);

  const allTags = useMemo(() =>
    [...new Set(agents.flatMap((a) => a.tags))].slice(0, 12), [agents]);

  const packsShown = packs.filter((p) =>
    !q || p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.description.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="library">
      <div className="lib-head">
        <h2>{benchOnly ? "My" : "Agent"} <span className="serif">{benchOnly ? "Bench" : "Library"}</span></h2>
      </div>
      <div className="lib-sub">
        {benchOnly
          ? "Agents you've benched — ready to run."
          : scope === "public"
          ? "Every agent the crew has shared publicly. Star the good ones, bench the useful ones."
          : "Your own agents — published or kept local. Flip one to Public when it's ready to share."}
      </div>
      {!benchOnly && (
        <div className="ftabs" style={{ margin: "0 0 14px" }}>
          <button className={`ftab ${tab === "agents" ? "on" : ""}`} onClick={() => setTab("agents")}>Agents</button>
          <button className={`ftab ${tab === "packs" ? "on" : ""}`} onClick={() => setTab("packs")}>
            📦 Packs{packs.length ? ` (${packs.length})` : ""}</button>
          <span style={{ flex: 1 }} />
          {tab === "agents" && (
            <div className="seg" role="tablist" title="Public = shared catalog · Private = just your agents">
              <button role="tab" aria-selected={scope === "public"}
                className={scope === "public" ? "on" : ""}
                onClick={() => setScope("public")}><Ico n="globe" s={12} /> Public</button>
              <button role="tab" aria-selected={scope === "private"}
                className={scope === "private" ? "on" : ""}
                onClick={() => setScope("private")}><Ico n="lock" s={12} /> Private</button>
            </div>
          )}
        </div>
      )}
      <div className="lib-tools">
        <input className="search" placeholder={tab === "packs" ? "Search packs…" : "Search agents, tags, descriptions…"}
          value={q} onChange={(e) => setQ(e.target.value)} />
        {tab === "agents" && SORTS.map(([k, label]) => (
          <button key={k} className={`chip ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {!benchOnly && tab === "agents" && <button className="primary" onClick={onPublish}>+ Publish agent</button>}
        {!benchOnly && tab === "packs" && <button className="primary" onClick={onNewPack}>+ New pack</button>}
      </div>
      {tab === "agents" && allTags.length > 0 && (
        <div className="lib-tools" style={{ marginTop: -8 }}>
          {allTags.map((t) => (
            <button key={t} className={`chip ${tag === t ? "on" : ""}`}
              onClick={() => setTag(tag === t ? "" : t)}>#{t}</button>
          ))}
        </div>
      )}
      {err && <div style={{ color: "var(--bad)" }}>{err}</div>}
      {tab === "agents" && !benchOnly && scope === "public" && !q && !tag && trending.length > 0 && (
        <div className="trend-strip">
          <div className="trend-lab">📈 trending this week</div>
          <div className="trend-row">
            {trending.map((a, i) => (
              <div key={a.id} className="trend-card" onClick={() => onOpenAgent(a)}
                title={`${a.week.replies} replies · ${a.week.stars} stars · ${a.week.installs} benches this week`}>
                <span className="trend-rank">#{i + 1}</span>
                <span className="pk-ico big">{a.icon || "🤖"}</span>
                <div className="trend-info">
                  <b>{a.name}</b>
                  <span>{a.week.replies}✦ {a.week.stars}★ {a.week.installs}⬇ this week</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "packs" ? (
        packsShown.length === 0 ? (
          <div className="empty">
            <div className="big">📦</div>
            <div className="serif">No packs yet.</div>
            <div>Bundle your agents into a toolkit — friends bench it all in one click.</div>
          </div>
        ) : (
          <div className="agent-grid">
            {packsShown.map((p) => (
              <PackCard key={p.id} pack={p} me={me} onOpen={onOpenPack}
                onBench={onBenchPack} onDelete={onDeletePack} />
            ))}
          </div>
        )
      ) : agents.length === 0 ? (
        <div className="empty">
          <div className="big">{scope === "private" ? "🔒" : "🧰"}</div>
          <div className="serif">Nothing here yet.</div>
          <div>{benchOnly ? "Bench an agent from the library to fill this up."
            : scope === "private"
            ? "No agents of your own yet — publish one, or keep it local-only with visibility set to Private."
            : "Publish your first agent — the crew is waiting."}</div>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} me={me} onOpen={onOpenAgent}
              showVis={scope === "private"}
              onStar={onStar} onInstall={onInstall} onShare={onShare} onDm={onDm} />
          ))}
        </div>
      )}
    </div>
  );
}
