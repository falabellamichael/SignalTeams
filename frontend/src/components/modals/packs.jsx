import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal, PACK_ICONS } from "./_shared.jsx";


export function PackModal({ pack, me, onClose, onOpenAgent, onBench, onShare, onDelete, onFork }) {
  const [full, setFull] = useState(pack);
  const [benchMsg, setBenchMsg] = useState("");
  useEffect(() => { api.pack(pack.id).then(setFull).catch(() => {}); }, [pack.id]);
  const mine = full.owner_id === me?.id;

  async function benchAll() {
    const r = await api.benchPack(full.id).catch((e) => ({ error: e.message }));
    setBenchMsg(r.error || (r.added ? `Benched ${r.added} agent${r.added === 1 ? "" : "s"} ✓` : "Already benched them all"));
    onBench?.();
  }

  async function fork() {
    const r = await api.forkPack(full.id).catch((e) => ({ error: e.message }));
    setBenchMsg(r.error || `Remixed to your packs ✓`);
    if (!r.error) onFork?.(r);
  }

  return (
    <Modal title={<>{full.icon || "📦"} {full.name}</>}
      sub={`${full.count} agent${full.count === 1 ? "" : "s"} · by ${full.owner?.display_name}${mine ? " (you)" : ""}${full.forked_from ? ` · ⑂ from ${full.forked_from}` : ""}`}
      onClose={onClose}>
      {full.description && <div className="msub" style={{ marginBottom: 12 }}>{full.description}</div>}
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {(full.agents || []).map((a) => (
          <div key={a.id} className="pack-agent" onClick={() => onOpenAgent(a)}>
            <span className="pk-ico big">{a.icon || "🤖"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{a.name}</b> <span className="ver">v{a.version}</span>
              <div style={{ fontSize: 11.5, color: "var(--dim)" }}>
                {a.tagline || a.description?.slice(0, 80)}</div>
            </div>
            <span className="stat"><Ico n="star" s={12} />{a.stars} <Ico n="download" s={12} />{a.installs}</span>
          </div>
        ))}
        {(!full.agents || full.agents.length === 0) && (
          <div className="idehint">No agents visible to you in this pack.</div>)}
      </div>
      {benchMsg && <div style={{ color: "var(--good)", marginTop: 8, fontSize: 12.5 }}>{benchMsg}</div>}
      <div className="mfoot">
        <button className="primary" onClick={benchAll}><Ico n="plus" s={13} /> Bench all</button>
        {!mine && <button onClick={fork} title="Clone this pack into your library"><Ico n="swap" s={13} /> Fork</button>}
        <button onClick={() => onShare(full)}><Ico n="share" s={13} /> Share</button>
        {mine && <button className="danger" onClick={() => onDelete(full)}><Ico n="trash" s={13} /> Delete</button>}
      </div>
    </Modal>
  );
}

// create a pack: name/icon/desc + pick agents
export function PackCreateModal({ me, onClose, onDone }) {
  const [f, setF] = useState({ name: "", icon: "📦", description: "" });
  const [agents, setAgents] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api.agents({ sort: "name" }).then((all) =>
      setAgents([...all].sort((a, b) => (a.owner_id === me.id ? 0 : 1) - (b.owner_id === me.id ? 0 : 1)))
    ).catch(() => {});
  }, [me.id]);

  function toggle(id) {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    setErr("");
    try {
      const p = await api.createPack({ ...f, agent_ids: [...picked] });
      onDone(p);
    } catch (e) { setErr(e.message); }
  }

  return (
    <Modal title="New agent pack" sub="Bundle agents into one shareable toolkit — friends bench it all at once."
      onClose={onClose} wide>
      <div className="mrow">
        <div><label>Name</label>
          <input value={f.name} onChange={set("name")} placeholder="Coding toolkit" /></div>
        <div style={{ maxWidth: 200 }}><label>Icon</label>
          <div className="emoji-pick" style={{ marginTop: 2 }}>
            {PACK_ICONS.map((e) => (
              <span key={e} className={`e ${f.icon === e ? "on" : ""}`}
                onClick={() => setF({ ...f, icon: e })}>{e}</span>
            ))}
          </div>
        </div>
      </div>
      <label>Description</label>
      <input value={f.description} onChange={set("description")}
        placeholder="Everything you need for code review night" />
      <label>Agents in the pack — {picked.size} picked</label>
      <div className="pack-pick">
        {agents.map((a) => (
          <div key={a.id} className={`pack-agent ${picked.has(a.id) ? "on" : ""}`}
            onClick={() => toggle(a.id)}>
            <span className="pk-ico big">{a.icon || "🤖"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{a.name}</b> <span className="ver">v{a.version}</span>
              <span style={{ color: "var(--dim)", fontSize: 11.5 }}>
                {" "}· by {a.owner?.display_name}{a.owner_id === me.id ? " (you)" : ""}</span>
              <div style={{ fontSize: 11.5, color: "var(--dim)" }}>
                {a.tagline || a.description?.slice(0, 80)}</div>
            </div>
            <span className={`pk-check ${picked.has(a.id) ? "on" : ""}`}>
              {picked.has(a.id) ? <Ico n="check" s={12} /> : <Ico n="plus" s={12} />}</span>
          </div>
        ))}
        {agents.length === 0 && <div className="idehint">No agents you can pack yet.</div>}
      </div>
      {err && <div style={{ color: "var(--bad)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!f.name.trim() || picked.size === 0} onClick={save}>
          Pack {picked.size} agent{picked.size === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}
