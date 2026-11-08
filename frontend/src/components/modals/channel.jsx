import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal } from "./_shared.jsx";


function WebhookSection({ channel }) {
  const [hooks, setHooks] = useState(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🪝");
  const [copied, setCopied] = useState(0);
  const [showCurl, setShowCurl] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.webhooks(channel.id).then(setHooks).catch((e) => setErr(e.message));
  }, [channel.id]);

  const urlFor = (h) => `${location.origin}/api/hooks/${h.token}`;

  async function add() {
    const n = name.trim();
    if (!n) return;
    const h = await api.createWebhook(channel.id, n, icon).catch((e) => (setErr(e.message), null));
    if (h) { setHooks((hs) => [...(hs || []), h]); setName(""); setErr(""); }
  }

  async function rotate(h) {
    const r = await api.editWebhook(h.id, { rotate: true }).catch((e) => (setErr(e.message), null));
    if (r) setHooks((hs) => hs.map((x) => (x.id === h.id ? r : x)));
  }

  async function remove(h) {
    if (!confirm(`Delete webhook "${h.name}"? Its URL stops working immediately.`)) return;
    await api.delWebhook(h.id).catch((e) => (setErr(e.message), null));
    setHooks((hs) => hs.filter((x) => x.id !== h.id));
  }

  return (
    <>
      <label><Ico n="link" s={12} /> Incoming webhooks{" "}
        <span style={{ color: "var(--dim)", fontWeight: 400 }}>
          ({(hooks || []).length}/10 — external services POST into #{channel.name})</span></label>
      {(hooks || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {hooks.map((h) => (
            <div key={h.id} style={{
              padding: "7px 10px", borderRadius: 8, background: "var(--panel2)",
              border: "1px solid var(--border)", fontSize: 12
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 15 }}>{h.icon}</span>
                <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</b>
                <span style={{ color: "var(--dim)", fontSize: 11 }}>
                  {h.uses} post{h.uses === 1 ? "" : "s"}</span>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px" }}
                  title="Copy hook URL"
                  onClick={() => {
                    navigator.clipboard?.writeText(urlFor(h));
                    setCopied(h.id); setTimeout(() => setCopied(0), 1500);
                  }}>
                  <Ico n="copy" s={11} /> {copied === h.id ? "copied!" : "URL"}
                </button>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px" }}
                  title="Rotate token — old URL dies" onClick={() => rotate(h)}>
                  <Ico n="refresh" s={11} />
                </button>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px", color: "var(--bad)" }}
                  title="Delete webhook" onClick={() => remove(h)}>
                  <Ico n="trash" s={11} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--dim)", fontSize: 10.5, fontFamily: "ui-monospace, Consolas, monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {urlFor(h)}</span>
                <button type="button" className="ghost" style={{ fontSize: 10.5, padding: "1px 6px" }}
                  onClick={() => setShowCurl(showCurl === h.id ? 0 : h.id)}>
                  {showCurl === h.id ? "hide" : "curl"}
                </button>
              </div>
              {showCurl === h.id && (
                <pre style={{
                  margin: "6px 0 0", padding: "7px 9px", borderRadius: 7, fontSize: 10.5,
                  background: "var(--bg)", border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--dim)"
                }}>{`curl -X POST "${urlFor(h)}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "hello from CI 🚀"}'`}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {hooks && hooks.length === 0 && (
        <div className="idehint" style={{ marginBottom: 8 }}>
          None yet — mint one and your CI / monitors / scripts can post straight into this channel.
          Discord {`{content}`} and Slack {`{text}`} payloads both work.
        </div>
      )}
      {err && <div className="idehint" style={{ color: "var(--bad)" }}>{err}</div>}
      <div className="mrow">
        <div>
          <input value={name} maxLength={48} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="new hook name — e.g. deploy-bot" />
        </div>
        <div style={{ maxWidth: 76 }}>
          <select value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="🪝">🪝</option>
            {EMOJI_CHOICES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 86 }}>
          <button type="button" onClick={add} disabled={!name.trim() || (hooks || []).length >= 10}>
            <Ico n="plus" s={12} /> Add
          </button>
        </div>
      </div>
    </>
  );
}


const DIGEST_IVS = [[900, "every 15 min"], [3600, "hourly"], [21600, "every 6 hours"],
  [86400, "daily"], [604800, "weekly"]];
const ivLabel = (s) => (DIGEST_IVS.find(([v]) => v === s) || [0, `every ${Math.round(s / 60)}m`])[1];

function DigestSection({ channel }) {
  const [dj, setDj] = useState(channel.digest || null);
  const [agents, setAgents] = useState([]);
  const [aid, setAid] = useState(channel.digest?.agent_id || 0);
  const [iv, setIv] = useState(channel.digest?.interval_secs || 86400);
  const [err, setErr] = useState("");
  useEffect(() => { api.agents({ sort: "name" }).then(setAgents).catch(() => {}); }, []);

  async function save() {
    const c = await api.setDigest(channel.id, { agent_id: aid || null, interval_secs: +iv })
      .catch((e) => (setErr(e.message), null));
    if (c) { setDj(c.digest || null); setErr(""); }
  }

  async function remove() {
    await api.delDigest(channel.id).catch((e) => setErr(e.message));
    setDj(null);
  }

  const next = dj ? Math.max(0, Math.round((dj.last_run + dj.interval_secs - Date.now() / 1000) / 60)) : 0;
  return (
    <>
      <label>📅 Agent digest{" "}
        <span style={{ color: "var(--dim)", fontWeight: 400 }}>
          (scheduled recap posted as the agent — quiet intervals are skipped)</span></label>
      {dj && (
        <div className="idehint" style={{ marginBottom: 6 }}>
          On — {dj.agent_icon || "📅"} <b>{dj.agent_name || "Digest bot"}</b> · {ivLabel(dj.interval_secs)}
          · next in ~{next < 60 ? `${next}m` : next < 1440 ? `${Math.round(next / 60)}h` : `${Math.round(next / 1440)}d`}
        </div>
      )}
      {err && <div className="idehint" style={{ color: "var(--bad)" }}>{err}</div>}
      <div className="mrow">
        <div>
          <select value={aid} onChange={(e) => setAid(+e.target.value)}>
            <option value={0}>📅 Digest bot</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon || "🤖"} {a.name}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 130 }}>
          <select value={iv} onChange={(e) => setIv(+e.target.value)}>
            {DIGEST_IVS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 96, display: "flex", gap: 4 }}>
          <button type="button" onClick={save}>{dj ? "Update" : "Enable"}</button>
          {dj && <button type="button" className="danger" onClick={remove}>Off</button>}
        </div>
      </div>
    </>
  );
}

export function ChannelModal({ kind, channel, me, roles, onClose, onDone, onDelete }) {
  const editing = !!channel;
  const [selKind, setSelKind] = useState(channel?.kind || kind);
  const [name, setName] = useState(channel?.name || "");
  const [topic, setTopic] = useState(channel?.topic || "");
  const [category, setCategory] = useState(channel?.category || "");
  const [slow, setSlow] = useState(channel?.slowmode_secs || 0);
  const [vcap, setVcap] = useState(channel?.voice_cap || 0);
  const [roleId, setRoleId] = useState(channel?.role_id || 0);
  const [picked, setPicked] = useState(new Set((channel?.roster || []).map((a) => a.id)));
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (selKind === "agents") api.agents({ sort: "name" }).then((all) =>
      setAgents([...all].sort((a, b) => (a.owner_id === me?.id ? 0 : 1) - (b.owner_id === me?.id ? 0 : 1)))
    ).catch(() => {});
  }, [selKind, me?.id]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal title={editing ? `Edit ${selKind === "agents" ? "✦" : selKind === "forum" ? "📋" : "#"}${channel.name}`
        : `New ${selKind === "agents" ? "agent" : selKind === "forum" ? "forum" : "text"} channel`} onClose={onClose}
      sub={selKind === "agents" ? "Agent channels highlight shared agent cards — pick residents to pin."
        : selKind === "forum" ? "Titled posts with threaded replies — like Discord forums." : "Plain talk."}>
      {!editing && kind !== "agents" && (
        <>
          <label>Channel type</label>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={selKind === "text" ? "on" : ""} onClick={() => setSelKind("text")}># Text</button>
            <button className={selKind === "forum" ? "on" : ""} onClick={() => setSelKind("forum")}>📋 Forum</button>
          </div>
        </>
      )}
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder={selKind === "agents" ? "agent-drops" : selKind === "forum" ? "showcase" : "general"} />
      <label>Topic</label>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="optional" />
      <label>Category <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional — groups channels in the sidebar)</span></label>
      <input value={category} onChange={(e) => setCategory(e.target.value)}
        placeholder="e.g. projects, fun" maxLength={48} />
      {selKind !== "agents" && (
        <>
          <label>Slowmode <span style={{ color: "var(--dim)", fontWeight: 400 }}>(seconds between messages — 0 = off)</span></label>
          <input type="number" min={0} max={21600} value={slow}
            onChange={(e) => setSlow(Math.max(0, Math.min(+e.target.value || 0, 21600)))} />
          <label>Voice cap <span style={{ color: "var(--dim)", fontWeight: 400 }}>(max people in 🎧 — 0 = unlimited)</span></label>
          <input type="number" min={0} max={99} value={vcap}
            onChange={(e) => setVcap(Math.max(0, Math.min(+e.target.value || 0, 99)))} />
        </>
      )}
      {editing && <WebhookSection channel={channel} />}
      {editing && <DigestSection channel={channel} />}
      {(roles || []).length > 0 && (
        <>
          <label><Ico n="lock" s={12} /> Visible to <span style={{ color: "var(--dim)", fontWeight: 400 }}>(role-gated — owner always gets in)</span></label>
          <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
            <option value={0}>everyone</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </>
      )}
      {selKind === "agents" && (
        <>
          <label>Resident agents — pinned to the channel header</label>
          <div className="pack-pick" style={{ maxHeight: 160, overflowY: "auto" }}>
            {agents.map((a) => (
              <div key={a.id} className={`pack-agent ${picked.has(a.id) ? "on" : ""}`}
                onClick={() => toggle(a.id)}>
                <span className="pk-ico big">{a.icon || "🤖"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{a.name}</b> <span className="ver">{a.owner?.display_name}</span>
                </div>
                <span className="stat">{picked.has(a.id) ? <Ico n="check" s={13} /> : ""}</span>
              </div>
            ))}
            {agents.length === 0 && <div className="idehint">No agents visible.</div>}
          </div>
        </>
      )}
      <div className="mfoot">
        {editing && <button className="danger" onClick={() => onDelete(channel)}><Ico n="trash" s={13} /> Delete</button>}
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()}
          onClick={() => onDone(name.trim(), selKind, topic.trim(), [...picked], category.trim(), slow, vcap, roleId)}>
          {editing ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
