import React, { useState, useEffect, useRef } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar, timeAgo } from "../../util";
import { AGENT_API_PRESETS, Modal, ModelField, diffSnap, providerModels } from "./_shared.jsx";


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

function ConnectTab({ agent, me, onSaved }) {
  const mine = agent.owner_id === me?.id;
  const [kind, setKind] = useState(agent.api_kind || "");
  const [url, setUrl] = useState(agent.api_url || "");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [model, setModel] = useState(agent.model || "");
  const [headers, setHeaders] = useState("");
  const [clearHeaders, setClearHeaders] = useState(false);
  const [ctxUrl, setCtxUrl] = useState(agent.context_url || "");
  const [ctxMethod, setCtxMethod] = useState(agent.context_method || "GET");
  const [ctxHeaders, setCtxHeaders] = useState("");
  const [clearCtxHeaders, setClearCtxHeaders] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!agent.api_url) return;
    api.agentConnectTest(agent.id, {})
      .then((r) => { if (r?.ok && r.models?.length) setProbe((p) => p || r); })
      .catch(() => {});
  }, [agent.id]);

  function applyPreset(p) {
    if (!mine) return;
    setKind(p.kind);
    setUrl(p.url);
    if (p.model && !model) setModel(p.model);
    setProbe(null);
    setMsg("");
    setErr("");
  }

  function buildPayload() {
    const p = {
      api_kind: kind,
      api_url: url.trim(),
      model: model.trim(),
      context_url: ctxUrl.trim(),
      context_method: ctxMethod,
    };
    if (clearKey) p.api_key = "";
    else if (key.trim()) p.api_key = key.trim();
    if (clearHeaders) p.api_headers = "";
    else if (headers.trim()) p.api_headers = headers.trim();
    if (clearCtxHeaders) p.context_headers = "";
    else if (ctxHeaders.trim()) p.context_headers = ctxHeaders.trim();
    return p;
  }

  async function runTest() {
    setTesting(true); setErr(""); setMsg(""); setProbe(null);
    try {
      const res = await api.agentConnectTest(agent.id, buildPayload());
      setProbe(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      const updated = await api.agentConnect(agent.id, buildPayload());
      setKey(""); setClearKey(false);
      setHeaders(""); setClearHeaders(false);
      setCtxHeaders(""); setClearCtxHeaders(false);
      setMsg("Connection saved ✓");
      onSaved?.(updated);
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="msub" style={{ marginBottom: 10 }}>
        Give <b>{agent.name}</b> its own dedicated LLM / API endpoint, bearer key, and live HTTP tool grounding.
        {!mine && " (Read-only — only the agent owner can edit connection credentials.)"}
      </div>

      {mine && (
        <>
          <label style={{ marginTop: 4 }}>Quick provider presets</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {AGENT_API_PRESETS.map((p) => {
              const active = (kind || "") === p.kind && (url || "") === p.url;
              return (
                <button key={p.id} type="button"
                  className={`chip ${active ? "on" : ""}`}
                  style={{ fontSize: 11.5, padding: "3px 9px" }}
                  onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div style={{
        padding: "12px 14px", borderRadius: 10, background: "var(--panel2)",
        border: "1px solid var(--border)", marginBottom: 12
      }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--honey)", marginBottom: 6 }}>
          🔌 Primary LLM / API Endpoint
        </div>
        <div className="mrow">
          <div style={{ maxWidth: 195 }}>
            <label style={{ marginTop: 4 }}>Protocol</label>
            <select value={kind} disabled={!mine} onChange={(e) => {
              const v = e.target.value;
              setKind(v);
              if (v && !url) {
                const match = AGENT_API_PRESETS.find((x) => x.kind === v);
                if (match) setUrl(match.url);
              }
            }}>
              <option value="">Inherit (Server / User default)</option>
              <option value="openai">OpenAI-compatible (/v1)</option>
              <option value="anthropic">Anthropic (/v1/messages)</option>
              <option value="ollama">Ollama (/api/chat)</option>
              <option value="webhook">Custom Webhook (POST JSON)</option>
            </select>
          </div>
          <div>
            <label style={{ marginTop: 4 }}>Endpoint / Base URL</label>
            <input value={url} disabled={!mine}
              onChange={(e) => {
                const v = e.target.value;
                setUrl(v);
                if (v.trim() && !kind) setKind("openai");
              }}
              placeholder={kind === "webhook"
                ? "https://your-service.example.com/agent-webhook"
                : "https://api.openai.com/v1 or http://127.0.0.1:9000/v1"} />
          </div>
        </div>

        <div className="mrow" style={{ marginTop: 4 }}>
          <div>
            <label>
              API Key / Bearer Token{" "}
              {agent.has_api_key && !clearKey && (
                <span style={{ color: "var(--good)", textTransform: "none", fontWeight: 600 }}>
                  · 🔑 key stored
                </span>
              )}
              {clearKey && (
                <span style={{ color: "var(--warn)", textTransform: "none" }}>
                  · key will be cleared on save
                </span>
              )}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="password" value={key} disabled={!mine}
                onChange={(e) => { setKey(e.target.value); setClearKey(false); }}
                placeholder={agent.has_api_key && !clearKey
                  ? "•••••••••••••••• (leave blank to keep stored key)"
                  : "sk-... / Bearer token (optional for local engines)"} />
              {mine && agent.has_api_key && !clearKey && (
                <button type="button" className="ghost" style={{ fontSize: 11, whiteSpace: "nowrap" }}
                  onClick={() => { setKey(""); setClearKey(true); }}>
                  Clear key
                </button>
              )}
            </div>
          </div>
          <div style={{ maxWidth: 220 }}>
            <label>Default Model</label>
            <ModelField value={model} disabled={!mine} options={probe?.models || []}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o, claude-3-7-sonnet — test to list" />
          </div>
        </div>

        {mine && (
          <div>
            <label>
              Custom Request Headers (JSON){" "}
              {agent.has_api_headers && !clearHeaders && (
                <span style={{ color: "var(--good)", textTransform: "none" }}>· stored</span>
              )}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={headers}
                onChange={(e) => { setHeaders(e.target.value); setClearHeaders(false); }}
                placeholder={agent.has_api_headers && !clearHeaders
                  ? '{"X-Custom-Header": "..."} (leave blank to keep stored headers)'
                  : '{"HTTP-Referer": "https://signalteams.local", "X-Title": "SignalTeams"}'} />
              {agent.has_api_headers && !clearHeaders && (
                <button type="button" className="ghost" style={{ fontSize: 11, whiteSpace: "nowrap" }}
                  onClick={() => { setHeaders(""); setClearHeaders(true); }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{
        padding: "12px 14px", borderRadius: 10, background: "var(--panel2)",
        border: "1px solid var(--border)", marginBottom: 12
      }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--accent)", marginBottom: 6 }}>
          🔗 Live Grounding / Tool Context API <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional)</span>
        </div>
        <div className="msub" style={{ marginBottom: 8 }}>
          Called automatically before every reply. <b>GET</b> fetches live JSON/text data; <b>POST</b> sends{" "}
          <code>{`{"prompt": "<user message>"}`}</code> so any HTTP API or microservice acts as an agent tool.
        </div>
        <div className="mrow">
          <div style={{ maxWidth: 110 }}>
            <label style={{ marginTop: 2 }}>Method</label>
            <select value={ctxMethod} disabled={!mine} onChange={(e) => setCtxMethod(e.target.value)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>
          <div>
            <label style={{ marginTop: 2 }}>Context / Tool URL</label>
            <input value={ctxUrl} disabled={!mine} onChange={(e) => setCtxUrl(e.target.value)}
              placeholder="https://api.example.com/status or http://127.0.0.1:8000/search" />
          </div>
        </div>
        {mine && (
          <div>
            <label>
              Context Headers (JSON){" "}
              {agent.has_context_headers && !clearCtxHeaders && (
                <span style={{ color: "var(--good)", textTransform: "none" }}>· stored</span>
              )}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={ctxHeaders}
                onChange={(e) => { setCtxHeaders(e.target.value); setClearCtxHeaders(false); }}
                placeholder={agent.has_context_headers && !clearCtxHeaders
                  ? '{"Authorization": "Bearer ..."} (leave blank to keep)'
                  : '{"Authorization": "Bearer ...", "X-Api-Key": "..."}'} />
              {agent.has_context_headers && !clearCtxHeaders && (
                <button type="button" className="ghost" style={{ fontSize: 11, whiteSpace: "nowrap" }}
                  onClick={() => { setCtxHeaders(""); setClearCtxHeaders(true); }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {probe && (
        <div style={{
          padding: "10px 12px", borderRadius: 9, marginBottom: 10, fontSize: 12,
          background: probe.ok ? "rgba(63, 185, 80, 0.1)" : "rgba(248, 81, 73, 0.1)",
          border: `1px solid ${probe.ok ? "var(--good)" : "var(--bad)"}`
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <b style={{ color: probe.ok ? "var(--good)" : "var(--bad)" }}>
              {probe.ok
                ? `✓ Endpoint reachable (${probe.kind || "local"} · ${probe.latency_ms}ms)`
                : `✗ Connection check failed (${probe.latency_ms}ms)`}
            </b>
            {probe.url && <span style={{ color: "var(--dim)", fontSize: 11 }}>{probe.url}</span>}
          </div>
          {probe.error && <div style={{ color: "var(--bad)", marginTop: 4 }}>{probe.error}</div>}
          {probe.sample && (
            <div style={{ marginTop: 4, color: "var(--dim)", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11 }}>
              Webhook response: {probe.sample}
            </div>
          )}
          {probe.models?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 4 }}>
                Discovered {probe.models.length} model{probe.models.length === 1 ? "" : "s"} — click to assign:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 96, overflowY: "auto" }}>
                {probe.models.map((m) => (
                  <button key={m} type="button"
                    className={`chip ${model === m ? "on" : ""}`}
                    style={{ fontSize: 11, padding: "2px 8px" }}
                    onClick={() => mine && setModel(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
          {probe.context_tested && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
              <b style={{ color: probe.context_ok ? "var(--good)" : "var(--warn)" }}>
                {probe.context_ok
                  ? `✓ Grounding URL responded (${probe.context_ms}ms)`
                  : `⚠ Grounding URL returned empty or unreachable (${probe.context_ms}ms)`}
              </b>
              {probe.context_preview && (
                <div style={{
                  marginTop: 4, padding: "5px 8px", borderRadius: 6, background: "var(--bg)",
                  fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, color: "var(--dim)",
                  whiteSpace: "pre-wrap", maxHeight: 70, overflowY: "auto"
                }}>
                  {probe.context_preview}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {err && <div style={{ color: "var(--bad)", fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={runTest} disabled={testing}>
          <Ico n="bolt" s={13} /> {testing ? "Testing…" : "Test connection"}
        </button>
        {mine && (
          <button type="button" className="primary" onClick={save} disabled={saving}>
            <Ico n="save" s={13} /> {saving ? "Saving…" : "Save connection"}
          </button>
        )}
        {msg && <span style={{ fontSize: 12, color: "var(--good)", fontWeight: 600 }}>{msg}</span>}
      </div>
    </div>
  );
}

function TryTab({ agent, onOpenConnect }) {
  const [providers, setProviders] = useState([]);
  const [model, setModel] = useState("");
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef(null);

  useEffect(() => { api.llmProviders().then(setProviders).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const allModels = providerModels(providers);

  async function send() {
    const msg = draft.trim();
    if (!msg || busy) return;
    setDraft(""); setErr(""); setBusy(true);
    setHistory((h) => [...h, { role: "user", content: msg }, { role: "assistant", content: "", meta: "…" }]);
    try {
      const [prov, mdl] = model.includes(":") ? model.split(/:(.+)/) : [null, model || null];
      const res = await fetch(`/api/agents/${agent.id}/try_stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("signalteams.token")}` },
        body: JSON.stringify({ message: msg, history, model: mdl, provider: prov }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", reply = "";
      const patch = (fn) => setHistory((h) => {
        const c = [...h]; c[c.length - 1] = { ...c[c.length - 1], ...fn(c[c.length - 1]) }; return c;
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt; try { evt = JSON.parse(line); } catch { continue; }
          if (evt.t === "meta") patch(() => ({ meta: `${evt.provider} · ${evt.model}` }));
          else if (evt.t === "token") { reply += evt.c; patch(() => ({ content: reply })); }
          else if (evt.t === "error") throw new Error(evt.message);
        }
      }
      if (!reply) patch(() => ({ content: "(empty reply)", meta: "" }));
    } catch (e) {
      setErr(e.message);
      setHistory((h) => h.slice(0, -2));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="lib-tools" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: agent.api_url ? "var(--honey)" : "var(--dim)", alignSelf: "center" }}>
          {agent.api_url
            ? `🔌 Dedicated API (${agent.api_kind || "openai"}): ${agent.api_url}`
            : providers.length
              ? "Local providers:"
              : "⚠ no local LLM detected — connect an API in 🔌 Connect"}
        </span>
        {onOpenConnect && !agent.api_url && (
          <button className="ghost" style={{ fontSize: 11, padding: "2px 7px" }} onClick={onOpenConnect}>
            🔌 Connect API
          </button>
        )}
        {allModels.length > 0 && (
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ fontSize: 11.5 }}>
            <option value="">auto{agent.model ? ` (${agent.model})` : ""}</option>
            {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {history.length > 0 && (
          <button className="ghost" onClick={() => setHistory([])} style={{ marginLeft: "auto" }}>clear</button>
        )}
      </div>
      <div className="pchat">
        {history.length === 0 && (
          <div style={{ color: "var(--dim)", fontSize: 12, padding: 8 }}>
            Talk to <b>{agent.name}</b> — its system prompt is doing the driving. Runs on your local models.
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`pmsg ${m.role}`}>
            <div className="prole">{m.role === "user" ? "you" : agent.name}</div>
            <div className="ptext">{m.content}</div>
            {m.meta && <div className="pmeta">{m.meta}</div>}
          </div>
        ))}
        {busy && <div className="pmsg assistant"><div className="ptext" style={{ color: "var(--dim)" }}>thinking…</div></div>}
        <div ref={endRef} />
      </div>
      {err && <div style={{ color: "var(--bad)", fontSize: 12, margin: "6px 0" }}>{err}</div>}
      <div className="composer" style={{ margin: "8px 0 0" }}>
        <textarea rows={1} value={draft} placeholder={`Message ${agent.name}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="send-row"><button className="ghost cbtn" onClick={send} disabled={busy}><Ico n="send" s={14} /></button></div>
      </div>
    </div>
  );
}

function ReviewsTab({ agent, me }) {
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState("");

  const load = () => api.reviews(agent.id).then(setReviews).catch(() => {});
  useEffect(() => { load(); }, [agent.id]);

  async function submit() {
    await api.postReview(agent.id, rating, body).catch(() => {});
    setBody(""); setSent("review saved ✓");
    setTimeout(() => setSent(""), 1500);
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--dim)", marginRight: 6 }}>Your rating:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`rate-star ${rating >= n ? "on" : ""}`}
            onClick={() => setRating(n)}>★</span>
        ))}
      </div>
      <textarea style={{ width: "100%", minHeight: 54 }} placeholder="How's it working for you?"
        value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <button className="primary" onClick={submit} disabled={!rating && !body.trim()}>Post review</button>
        {sent && <span style={{ fontSize: 11.5, color: "var(--good)" }}>{sent}</span>}
      </div>
      <div style={{ marginTop: 14, maxHeight: 220, overflowY: "auto" }}>
        {reviews.map((r) => (
          <div key={r.id} className="rev">
            <div className="rev-head">
              <Avatar user={r.user} size="sm" />
              <b style={{ fontSize: 12.5 }}>{r.user.display_name}</b>
              <span className="rate-stars">{r.rating ? "★".repeat(r.rating) : ""}</span>
              <span style={{ fontSize: 10.5, color: "var(--dim)", marginLeft: "auto" }}>
                {new Date(r.created_at * 1000).toLocaleDateString()}</span>
            </div>
            {r.body && <div className="rev-body">{r.body}</div>}
          </div>
        ))}
        {reviews.length === 0 && <div style={{ color: "var(--dim)", fontSize: 12 }}>No reviews yet — be first.</div>}
      </div>
    </div>
  );
}
function StatsTab({ agent }) {
  const [s, setS] = useState(null);
  useEffect(() => { api.agentStats(agent.id).then(setS).catch(() => setS({ days: [] })); }, [agent.id]);
  if (!s) return <div className="msub">Counting…</div>;
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const max = Math.max(1, ...(s.days || []));
  const labels = (s.days || []).map((_, i) => {
    const d = new Date((s.day0 + i) * 86400 * 1000);
    return `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  });
  return (
    <div>
      {s.summons === 0 ? (
        <div className="msub">No summons yet — @ the agent in a channel or DM it to get it going.</div>
      ) : (
        <>
          <div className="pulse-bars">
            {(s.days || []).map((n, i) => (
              <div key={i} className="pb-col" title={`${labels[i]}: ${n} replies`}>
                <div className="pb-bar" style={{ height: `${Math.max(4, (n / max) * 64)}px` }} />
                {i % 2 === 0 && <div className="pb-lab">{labels[i].split(" ")[0]}</div>}
              </div>
            ))}
          </div>
          <div className="pulse-stats">
            <div className="ps"><b>{s.summons}</b><span>all-time summons</span></div>
            <div className="ps"><b>{(s.days || []).reduce((a, b) => a + b, 0)}</b><span>last 14 days</span></div>
            <div className="ps"><b>{s.last_used ? timeAgo(s.last_used) : "—"}</b><span>last used</span></div>
          </div>
          <div className="pulse-rows">
            {(s.top_summoners || []).map((t) => (
              <div key={t.user.id} className="pr">✦ <b>{t.user.display_name}</b>
                <span className="pr-n">{t.n} summons</span></div>
            ))}
            {(s.top_channels || []).map((c) => (
              <div key={c.id} className="pr">📍 <b>{c.name}</b>
                <span className="pr-n">{c.n} replies</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryTab({ agent, me, onRestore }) {
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
