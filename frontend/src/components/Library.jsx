import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AgentCard, PackCard } from "./AgentCard";

const SORTS = [["new", "Newest"], ["stars", "Most starred"], ["installs", "Most benched"], ["summons", "Most summoned"], ["name", "A–Z"]];

export default function Library({ me, onOpenAgent, onStar, onInstall, onShare, onDm, onPublish, refreshKey, benchOnly,
                                  onOpenPack, onNewPack, onBenchPack, onDeletePack }) {
  const [agents, setAgents] = useState([]);
  const [packs, setPacks] = useState([]);
  const [trending, setTrending] = useState([]);
  const [tab, setTab] = useState("agents");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("new");
  const [err, setErr] = useState("");

  useEffect(() => {
    const call = benchOnly ? api.bench() : api.agents({ q, tag, sort });
    call.then(setAgents).catch((e) => setErr(e.message));
  }, [q, tag, sort, refreshKey, benchOnly]);

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
          : "Every agent your crew has published. Star the good ones, bench the useful ones."}
      </div>
      {!benchOnly && (
        <div className="ftabs" style={{ margin: "0 0 14px" }}>
          <button className={`ftab ${tab === "agents" ? "on" : ""}`} onClick={() => setTab("agents")}>Agents</button>
          <button className={`ftab ${tab === "packs" ? "on" : ""}`} onClick={() => setTab("packs")}>
            📦 Packs{packs.length ? ` (${packs.length})` : ""}</button>
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
      {tab === "agents" && !benchOnly && !q && !tag && trending.length > 0 && (
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
          <div className="big">🧰</div>
          <div className="serif">Nothing here yet.</div>
          <div>{benchOnly ? "Bench an agent from the library to fill this up."
            : "Publish your first agent — your friends are waiting."}</div>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} me={me} onOpen={onOpenAgent}
              onStar={onStar} onInstall={onInstall} onShare={onShare} onDm={onDm} />
          ))}
        </div>
      )}
    </div>
  );
}
