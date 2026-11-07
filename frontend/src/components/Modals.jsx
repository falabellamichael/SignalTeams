import React, { useEffect, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { Avatar, timeAgo, timeUntil, hasSearchQuery } from "../util";

function Modal({ title, sub, onClose, children, wide }) {
  return (
    <div className="shade" onClick={onClose}>
      <div className="modal" style={wide ? { width: 640 } : undefined}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost modal-x" onClick={onClose} title="Close (Esc)">
            <Ico n="x" s={15} />
          </button>
        </div>
        {sub && <div className="msub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

let _dlId = 0;
function ModelField({ value, onChange, options, placeholder, style, disabled }) {
  // input + datalist: dropdown of discovered models, free text still allowed
  const [id] = useState(() => `mdl-list-${++_dlId}`);
  return (
    <>
      <input list={id} value={value} onChange={onChange}
        placeholder={placeholder} style={style} disabled={disabled} />
      <datalist id={id}>
        {(options || []).map((m) => <option key={m} value={m} />)}
      </datalist>
    </>
  );
}

function useLlmProviders() {
  const [providers, setProviders] = useState([]);
  useEffect(() => { api.llmProviders().then(setProviders).catch(() => {}); }, []);
  return providers;
}
// "ollama:x"/"lmstudio:x"/"custom:x" select a provider; anything else is a bare model name
const providerModels = (ps) => ps.flatMap((p) => p.models.map((m) =>
  ["ollama", "lmstudio", "custom"].includes(p.name) ? `${p.name}:${m}` : m));

const AGENT_API_PRESETS = [
  { id: "inherit", label: "Inherit Default", kind: "", url: "", model: "" },
  { id: "openai", label: "OpenAI", kind: "openai", url: "https://api.openai.com/v1", model: "gpt-4o" },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", url: "https://api.anthropic.com", model: "claude-3-7-sonnet-latest" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", url: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.7-sonnet" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "groq", label: "Groq", kind: "openai", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "dashscope", label: "DashScope", kind: "openai", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
  { id: "lemonade", label: "Lemonade :9000", kind: "openai", url: "http://127.0.0.1:9000/v1", model: "" },
  { id: "lmstudio", label: "LM Studio :1234", kind: "openai", url: "http://127.0.0.1:1234/v1", model: "" },
  { id: "ollama", label: "Ollama :11434", kind: "ollama", url: "http://127.0.0.1:11434", model: "" },
  { id: "webhook", label: "Custom Webhook", kind: "webhook", url: "https://", model: "webhook" },
];

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

const DIFF_FIELDS = [["name", "Name"], ["icon", "Icon"], ["version", "Version"],
  ["model", "Model"], ["temperature", "Creativity"], ["tagline", "Tagline"], ["description", "Description"],
  ["system_prompt", "System prompt"], ["visibility", "Visibility"], ["context_url", "Context URL"]];

function diffSnap(older, newer) {
  const rows = [];
  for (const [k, label] of DIFF_FIELDS) {
    const a = older?.[k] ?? "", b = newer?.[k] ?? "";
    if (a !== b) rows.push({ label, a, b });
  }
  const ta = JSON.stringify(older?.tags || []), tb = JSON.stringify(newer?.tags || []);
  if (ta !== tb) rows.push({ label: "Tags", a: (older?.tags || []).join(", "),
    b: (newer?.tags || []).join(", ") });
  return rows;
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

const EMOJI_CHOICES = ["🤖", "🐝", "🦉", "🦊", "🐙", "⚡", "🌙", "🍯", "🔍", "📚", "🛠", "🎲"];

export function PublishModal({ initial, onClose, onDone }) {
  const [f, setF] = useState({ icon: "🤖", ...(initial || {
    name: "", tagline: "", description: "", system_prompt: "",
    model: "", tags: [], version: "1.0.0", visibility: "friends",
  })});
  const [tagText, setTagText] = useState((initial?.tags || []).join(", "));
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const providers = useLlmProviders();
  const modelOpts = [...new Set(providerModels(providers))];

  async function save() {
    setErr("");
    try {
      const body = { ...f, tags: tagText.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12) };
      const res = f.id ? await api.updateAgent(f.id, body) : await api.createAgent(body);
      onDone(res);
    } catch (e) { setErr(e.message); }
  }

  async function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const res = await api.importAgent(json);
      onDone(res);
    } catch (ex) { setErr("Couldn't import that file: " + ex.message); }
  }

  return (
    <Modal title={f.id ? `Edit ${f.name}` : "Publish an agent"}
      sub="Share a prompt, a persona, a whole worker — your friends can bench it." onClose={onClose} wide>
      {!f.id && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "inline", margin: 0 }}>…or import a .json agent file:&nbsp;</label>
          <input type="file" accept=".json,application/json" style={{ width: "auto", fontSize: 12 }}
            onChange={importJson} />
        </div>
      )}
      <div className="mrow">
        <div><label>Name</label><input value={f.name} onChange={set("name")} placeholder="BugHunter" /></div>
        <div style={{ maxWidth: 110 }}><label>Version</label><input value={f.version} onChange={set("version")} /></div>
        <div style={{ maxWidth: 170 }}><label>Model</label>
          <ModelField value={f.model} onChange={set("model")} options={modelOpts}
            placeholder="pick ▾ or type — ollama:llama3" /></div>
      </div>
      <label>Icon</label>
      <div className="emoji-pick">
        {EMOJI_CHOICES.map((e) => (
          <span key={e} className={`e ${f.icon === e ? "on" : ""}`}
            onClick={() => setF({ ...f, icon: e })}>{e}</span>
        ))}
      </div>
      <label>Tagline</label>
      <input value={f.tagline} onChange={set("tagline")} placeholder="One line that sells it" />
      <label>Description</label>
      <textarea value={f.description} onChange={set("description")}
        placeholder="What it does, when to use it, tricks" />
      <label>System prompt</label>
      <textarea style={{ minHeight: 110, fontFamily: "ui-monospace, Consolas, monospace" }}
        value={f.system_prompt} onChange={set("system_prompt")}
        placeholder="You are…" />
      <label><Ico n="bolt" s={13} /> Dedicated API Connection <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (optional — give this agent its own OpenAI / Anthropic / Ollama / Webhook endpoint & key)</span></label>
      <div className="mrow">
        <div style={{ maxWidth: 165 }}>
          <select value={f.api_kind || ""} onChange={(e) => setF({ ...f, api_kind: e.target.value })}>
            <option value="">Inherit default</option>
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
            <option value="webhook">Webhook POST</option>
          </select>
        </div>
        <div>
          <input value={f.api_url || ""} onChange={(e) => setF({
            ...f, api_url: e.target.value,
            api_kind: f.api_kind || (e.target.value.trim() ? "openai" : "")
          })} placeholder="https://api.openai.com/v1 or http://127.0.0.1:9000/v1" />
        </div>
        <div style={{ maxWidth: 185 }}>
          <input type="password" value={f.api_key || ""} onChange={set("api_key")}
            placeholder={f.has_api_key ? "•••• (saved)" : "API key (optional)"} />
        </div>
      </div>
      <label><Ico n="link" s={13} /> Context / Tool URL <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (optional — fetched live before every reply, injected as grounding)</span></label>
      <div className="mrow">
        <div style={{ maxWidth: 95 }}>
          <select value={f.context_method || "GET"} onChange={set("context_method")}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div>
          <input value={f.context_url || ""} onChange={set("context_url")}
            placeholder="https://your-api/scoreboard — live data the agent sees" />
        </div>
      </div>
      <label>Creativity <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        — temperature {(f.temperature ?? 0.7).toFixed(2)} · 0 precise → 2 wild</span></label>
      <input type="range" min="0" max="2" step="0.05" value={f.temperature ?? 0.7}
        onChange={(e) => setF({ ...f, temperature: +e.target.value })} />
      <div className="mrow">
        <div><label>Tags (comma-separated)</label>
          <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="code, review" /></div>
        <div style={{ maxWidth: 150 }}><label>Visibility</label>
          <select value={f.visibility} onChange={set("visibility")}>
            <option value="friends">Friends</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select></div>
      </div>
      {err && <div style={{ color: "var(--bad)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!f.name.trim()} onClick={save}>
          {f.id ? "Save changes" : "Publish to the library"}
        </button>
      </div>
    </Modal>
  );
}

export function ShareModal({ agent, pack, servers, dms, onClose, onShared }) {
  const item = agent || pack;
  const [targets, setTargets] = useState([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const t = [];
    servers.forEach((s) => api.server(s.id).then((full) => {
      full.channels.forEach((c) => t.push({ sid: s.id, sname: s.name, ...c }));
      setTargets((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        return [...prev, ...t.filter((x) => !ids.has(x.id))];
      });
    }).catch(() => {}));
    dms.forEach((d) => setTargets((prev) => [...prev,
      { id: d.id, sname: "DM", name: "@" + (d.other?.display_name || "?") }]));
  }, [servers, dms]);

  async function share(t) {
    try {
      await api.send(t.id, msg.trim(), agent?.id || null, [], pack?.id || null);
      onShared(t);
    } catch (e) { alert(e.message); }
  }

  return (
    <Modal title={`Share ${item.name}`}
      sub={pack ? "Drop this agent pack into a channel or DM."
               : "Drop this agent card into a channel or DM."} onClose={onClose}>
      <label>Attach a note (optional)</label>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="check this out…" />
      <div style={{ marginTop: 12, maxHeight: 300, overflowY: "auto" }}>
        {targets.map((t) => (
          <div key={`${t.sname}-${t.id}`} className="ideopt" style={{
            padding: "8px 10px", borderRadius: 7, cursor: "pointer", fontSize: 13,
            display: "flex", justifyContent: "space-between" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            onClick={() => share(t)}>
            <span>{t.kind === "agents" ? "✦" : "#"} {t.name}</span>
            <span style={{ color: "var(--dim)", fontSize: 11.5 }}>{t.sname}</span>
          </div>
        ))}
        {targets.length === 0 && <div style={{ color: "var(--dim)", padding: 8 }}>Loading channels…</div>}
      </div>
    </Modal>
  );
}

const PACK_ICONS = ["📦", "🧰", "🐝", "🍯", "⚡", "🛠", "🎒", "🔬", "🎲", "📚", "🧪", "🚀"];

// detail view of a pack — list of agents, bench-all, share, delete
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

export function ServerModal({ onClose, onDone }) {
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🍯");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  async function go() {
    setErr("");
    try {
      const s = tab === "create"
        ? await api.createServer(name.trim(), icon)
        : await api.joinServer(code.trim());
      onDone(s);
    } catch (e) { setErr(e.message); }
  }

  return (
    <Modal title={tab === "create" ? "Start a team" : "Join a team"}
      sub="Servers = your crew's channels. Invite codes get friends in." onClose={onClose}>
      <div className="ftabs" style={{ marginBottom: 12 }}>
        <button className={`ftab ${tab === "create" ? "on" : ""}`} onClick={() => setTab("create")}>Create</button>
        <button className={`ftab ${tab === "join" ? "on" : ""}`} onClick={() => setTab("join")}>Join with code</button>
      </div>
      {tab === "create" ? (
        <>
          <label>Icon</label>
          <div className="emoji-pick">
            {EMOJI_CHOICES.map((e) => (
              <span key={e} className={`e ${icon === e ? "on" : ""}`} onClick={() => setIcon(e)}>{e}</span>
            ))}
          </div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Crew" />
        </>
      ) : (
        <>
          <label>Invite code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="signal-demo" />
        </>
      )}
      {err && <div style={{ color: "var(--bad)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={go}
          disabled={tab === "create" ? !name.trim() : !code.trim()}>
          {tab === "create" ? "Create" : "Join"}
        </button>
      </div>
    </Modal>
  );
}

export function GlobalSearchModal({ onClose, onPick, dests, onJump }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState([]);
  const [sel, setSel] = useState(0);
  useEffect(() => { api.agents({}).then(setAgents).catch(() => {}); }, []);

  async function run(v) {
    setQ(v); setSel(0);
    if (!hasSearchQuery(v)) { setHits([]); return; }
    setBusy(true);
    setHits(await api.searchAll(v.trim()).catch(() => []));
    setBusy(false);
  }

  function activate(i, jumpCount) {
    if (i < jumpCount) onJump?.(jumps[i].t, jumps[i].x);
    else onPick?.(hits[i - jumpCount]);
  }

  const qq = q.trim().toLowerCase();
  const jumps = [];
  if (qq && dests) {
    const has = (s) => (s || "").toLowerCase().includes(qq);
    for (const c of dests.channels || [])
      if (has(c.name)) jumps.push({ t: "channel", x: c, ic: c.kind === "agents" ? "✦" : "#",
        name: c.name, sub: `${c.sname}${c.category ? " · " + c.category : ""}` });
    for (const d of dests.dms || []) {
      const nm = d.name || (d.members || []).map((u) => u.display_name).join(", ") || d.other?.display_name || "";
      if (has(nm)) jumps.push({ t: "dm", x: d, ic: "💬", name: nm, sub: "direct message" });
    }
    for (const a of agents || [])
      if (has(a.name)) jumps.push({ t: "agent", x: a, ic: a.icon || "🤖", name: a.name, sub: "agent" });
    for (const f of dests.friends || [])
      if (has(f.display_name) || has(f.username))
        jumps.push({ t: "friend", x: f, ic: f.avatar_emoji || "👤", name: f.display_name, sub: `@${f.username}` });
    for (const s of dests.servers || [])
      if (has(s.name)) jumps.push({ t: "server", x: s, ic: s.icon || "📡", name: s.name, sub: "server" });
  }

  const flat = jumps.slice(0, 6).length + hits.length;

  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="search" s={16} /> Search everywhere</span>}
      sub="Every channel and DM you can see." onClose={onClose} wide>
      <input autoFocus placeholder="search messages, or jump to a channel, dm, agent…" value={q}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, flat - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === "Enter" && flat > 0) { e.preventDefault(); activate(sel, jumps.slice(0, 6).length); }
        }} />
      <div className="idehint" style={{ marginTop: 6, borderRadius: 8 }}>
        filters: <code>from:me</code> <code>in:general</code> <code>has:link</code>{" "}
        <code>has:image</code> <code>pinned:true</code> <code>mentions:me</code>{" "}
        <code>before:2025-01-01</code> <code>after:</code> <code>during:</code>
      </div>
      {jumps.length > 0 && (
        <div className="jump-list">
          {jumps.slice(0, 6).map((j, i) => (
            <div key={i} className={`jump-row ${i === sel ? "on" : ""}`}
              ref={i === sel ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseEnter={() => setSel(i)} onClick={() => onJump?.(j.t, j.x)}>
              <span className="jump-ic">{j.ic}</span>
              <b>{j.name}</b>
              <span className="jump-sub">{j.sub}</span>
              <span className="jump-go">→</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 10 }}>
        {busy && <div className="idehint">Searching…</div>}
        {!busy && hasSearchQuery(q) && hits.length === 0 &&
          <div className="idehint">No matches.</div>}
        {hits.map((m, i) => (
          <div key={m.id}
            className={`pack-agent ${jumps.slice(0, 6).length + i === sel ? "gsel" : ""}`}
            style={{ cursor: "pointer" }}
            ref={jumps.slice(0, 6).length + i === sel
              ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseEnter={() => setSel(jumps.slice(0, 6).length + i)}
            onClick={() => onPick(m)}>
            <span className="pk-ico big">{m.author?.avatar_emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{m.author?.display_name}</b>
              <span className="ver" style={{ marginLeft: 6, color: "var(--honey)" }}>{m.where}</span>
              <div style={{ fontSize: 12, color: "var(--dim)", whiteSpace: "pre-wrap" }}>
                {m.content?.slice(0, 160)}</div>
            </div>
            <span className="stat">{timeAgo(m.created_at)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function GroupDmModal({ friends, channel, me, onClose, onCreate, onAdd, onAddAgent }) {
  const [picked, setPicked] = useState(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(0);
  const [agents, setAgents] = useState([]);
  const adding = !!channel;
  useEffect(() => {
    if (adding) api.agents().then(setAgents).catch(() => {});
  }, [adding]);
  const inGroup = new Set([me?.id, ...(channel?.members || []).map((m) => m.id)]);
  const pickable = (friends || []).filter((f) => !adding || !inGroup.has(f.id));
  const agentSlug = (n) => `agent:${(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24)}`;
  const memberNames = new Set((channel?.members || []).map((m) => m.username));
  const pickableAgents = (agents || []).filter((a) => !memberNames.has(agentSlug(a.name)));
  const need = adding ? 1 : 2;
  function toggle(id) {
    setPicked((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="users" s={16} /> {adding ? "Add to group" : "New group DM"}</span>}
      sub={adding ? `Add friends to ${channel.name || "the group"}.` : "Pick 2+ friends — you count as one."}
      onClose={onClose}>
      {!adding && <>
        <label>Name <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional)</span></label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="the sunday crew" maxLength={48} />
      </>}
      <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
        {pickable.length === 0 && <div className="idehint">
          {adding ? "Everyone's already here." : "No friends yet — add some first."}</div>}
        {pickable.map((f) => (
          <div key={f.id} className={`pack-agent ${picked.has(f.id) ? "on" : ""}`}
            onClick={() => toggle(f.id)} style={{ cursor: "pointer" }}>
            <span className="pk-ico big">{f.avatar_emoji}</span>
            <div style={{ flex: 1 }}><b>{f.display_name}</b>
              <div style={{ fontSize: 11, color: "var(--dim)" }}>@{f.username}</div></div>
            <span className="stat">{picked.has(f.id) ? <Ico n="check" s={13} /> : ""}</span>
          </div>
        ))}
        {adding && pickableAgents.length > 0 && <>
          <div className="idehint" style={{ marginTop: 10 }}>✦ or invite an agent — it answers @mentions</div>
          {pickableAgents.map((a) => (
            <div key={a.id} className="pack-agent" style={{ cursor: "pointer" }}
              onClick={async () => {
                if (agentBusy) return;
                setAgentBusy(a.id);
                await onAddAgent?.(a.id);
                setAgentBusy(0);
              }}>
              <span className="pk-ico big">{a.icon || "🤖"}</span>
              <div style={{ flex: 1 }}><b>{a.name}</b>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>{a.tagline || "agent"}</div></div>
              <span className="stat">{agentBusy === a.id ? "…" : <Ico n="plus" s={13} />}</span>
            </div>
          ))}
        </>}
      </div>
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={picked.size < need || busy}
          onClick={async () => {
            setBusy(true);
            if (adding) await onAdd([...picked]);
            else await onCreate([...picked], name.trim());
          }}>
          {busy ? "…" : adding ? `Add ${picked.size || ""}` : `Create (${picked.size + 1})`}
        </button>
      </div>
    </Modal>
  );
}

export function InboxModal({ onClose, onJump }) {
  const [items, setItems] = useState(null);
  const [rems, setRems] = useState([]);
  useEffect(() => {
    api.inbox().then(setItems).catch(() => setItems([]));
    api.reminders().then(setRems).catch(() => {});
  }, []);
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="tray" s={16} /> Inbox</span>}
      sub="Every @you — mentions and agent replies." onClose={onClose} wide>
      {rems.length > 0 && (
        <>
          <label style={{ fontSize: 10.5, textTransform: "uppercase",
            color: "var(--dim)", letterSpacing: ".5px" }}>⏰ your reminders</label>
          {rems.map((r) => (
            <div key={"r" + r.id} className="inbox-row" style={{ opacity: .85 }}>
              <span style={{ fontSize: 16 }}><Ico n="timer" s={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{r.text}</div>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>
                  fires {timeUntil(r.due_at)} — #{r.channel_name || "a channel"}</div>
              </div>
              <span className="ib-jump" title="Cancel reminder"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.delReminder(r.id).catch(() => {});
                  setRems((x) => x.filter((y) => y.id !== r.id));
                }}><Ico n="x" s={13} /></span>
            </div>
          ))}
          <div style={{ height: 6 }} />
        </>
      )}
      {!items && <div className="idehint">Loading…</div>}
      {items?.length === 0 && <div className="idehint">Nobody's pinged you yet — suspicious.</div>}
      {(items || []).map((e) => (
        <div key={e.id} className="inbox-row" onClick={() => onJump(e.payload)}>
          <Avatar user={e.user} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <b>{e.user.display_name}</b>
              <span style={{ color: "var(--dim)" }}> mentioned you in </span>
              <b>#{e.payload.channel}</b>
              <span className="ib-time">{timeAgo(e.created_at)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.payload.excerpt}</div>
          </div>
          <span className="ib-jump"><Ico n="reply" s={14} /></span>
        </div>
      ))}
    </Modal>
  );
}

export function ForwardModal({ msg, servers, dms, onClose, onPick }) {
  const [targets, setTargets] = useState(null);
  useEffect(() => {
    Promise.all((servers || []).map((s) => api.server(s.id).catch(() => null)))
      .then((fulls) => {
        const t = [];
        fulls.forEach((f) => f?.channels.forEach((c) =>
          t.push({ cid: c.id, sid: f.id, label: `${f.icon} ${f.name} · ${c.kind === "agents" ? "✦" : "#"}${c.name}` })));
        (dms || []).forEach((d) =>
          t.push({ cid: d.id, sid: null, label: `@ ${d.other?.display_name || "DM"}` }));
        setTargets(t.filter((x) => x.cid !== msg.channel_id));
      });
  }, []);
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="forward" s={16} /> Forward message</span>}
      sub={msg.content?.slice(0, 90)} onClose={onClose}>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {!targets && <div className="idehint">Loading destinations…</div>}
        {targets?.length === 0 && <div className="idehint">Nowhere else to send it.</div>}
        {targets?.map((t) => (
          <div key={t.cid} className="ideopt" onClick={() => onPick(t)}>{t.label}</div>
        ))}
      </div>
    </Modal>
  );
}

export function ProfileModal({ user, me, onClose, onDm, onOpenAgent, onFriend, blockedIds, onBlock, roles }) {
  const [prof, setProf] = useState(null);
  useEffect(() => { api.profile(user.id).then(setProf).catch(() => setProf({ user })); }, [user.id]);
  const p = prof || { user };
  const mine = user.id === me?.id;

  // clicking an agent's bot avatar jumps straight to the agent card
  useEffect(() => { if (p.is_bot) p.agent ? onOpenAgent(p.agent) : onClose(); }, [p.is_bot]);
  if (p.is_bot) return null;

  return (
    <Modal title={<span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar user={p.user} size="md" showStatus />
        <span>{p.user.display_name}</span></span>}
      sub={`@${p.user.username}${mine ? " — that's you" : ""}`} onClose={onClose}>
      {p.user.status_text && <div className="msub" style={{ marginBottom: 6, color: "var(--honey)" }}>
        {p.user.status_text}</div>}
      {(roles || []).filter((r) => (user.role_ids || []).includes(r.id)).length > 0 && (
        <div className="role-list" style={{ marginBottom: 8 }}>
          {(roles || []).filter((r) => (user.role_ids || []).includes(r.id)).map((r) => (
            <span key={r.id} className="role-pill big"
              style={{ borderColor: r.color, color: r.color }}>{r.name}</span>
          ))}
        </div>
      )}
      {p.user.bio && <div className="msub" style={{ marginBottom: 10 }}>{p.user.bio}</div>}
      {p.agents?.length > 0 && (
        <>
          <label style={{ display: "block", fontSize: 11, textTransform: "uppercase",
            letterSpacing: ".5px", color: "var(--dim)", margin: "4px 0 6px" }}>
            Published agents</label>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {p.agents.map((a) => (
              <div key={a.id} className="pack-agent" onClick={() => onOpenAgent(a)}>
                <span className="pk-ico big">{a.icon || "🤖"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{a.name}</b> <span className="ver">v{a.version}</span>
                  <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{a.tagline}</div>
                </div>
                <span className="stat"><Ico n="star" s={12} />{a.stars} <Ico n="download" s={12} />{a.installs}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {p.agents?.length === 0 && !mine && (
        <div className="idehint">No agents published yet.</div>)}
      {!mine && (
        <div className="mfoot">
          <button className="primary" onClick={() => onDm(p.user)}><Ico n="chat" s={13} /> Message</button>
          {p.friend?.status === "accepted"
            ? <button disabled>🤝 Friends</button>
            : p.friend?.status === "pending"
              ? <button disabled>{p.friend.direction === "out" ? "Request sent" : "Wants to be friends — check Friends tab"}</button>
              : <button onClick={() => onFriend(p.user)}><Ico n="plus" s={13} /> Add friend</button>}
          <button className="blockbtn" title={blockedIds?.has?.(p.user.id) ? "Unblock this user" : "Block this user"}
            onClick={() => onBlock?.(p.user)}>
            {blockedIds?.has?.(p.user.id) ? <><Ico n="unlock" s={13} /> Unblock</> : <><Ico n="ban" s={13} /> Block</>}</button>
        </div>
      )}
    </Modal>
  );
}

export function ServerSettingsModal({ server, me, onClose, onSaved, onDeleted, onLeft, onKick, onTransfer }) {
  const owner = server.owner_id === me?.id;
  const [name, setName] = useState(server.name);
  const [icon, setIcon] = useState(server.icon);
  const [code, setCode] = useState(server.invite_code);
  const [iconErr, setIconErr] = useState(false);
  const myNick = (server.members || []).find((m) => m.id === me?.id)?.nickname || "";
  const [nick, setNick] = useState(myNick);
  const [msg, setMsg] = useState("");
  const [ems, setEms] = useState(server.emojis || []);
  const [emName, setEmName] = useState("");
  const emFileRef = useRef(null);
  const iconFileRef = useRef(null);
  const ROLE_COLORS = ["#e8b339", "#f2644c", "#4cc2f2", "#7ce87c",
    "#c084fc", "#f278b6", "#8f9aa8", "#5eead4"];
  const [roles, setRoles] = useState(server.roles || []);
  const [rName, setRName] = useState("");
  const [rColor, setRColor] = useState(ROLE_COLORS[0]);
  const [thresh, setThresh] = useState(server.star_threshold ?? 3);
  const [mroles, setMroles] = useState(() => {
    const m = {};
    (server.members || []).forEach((u) => { m[u.id] = u.role_ids || []; });
    return m;
  });
  const [srvLlm, setSrvLlm] = useState({
    url: server.llm_url || "", model: server.llm_model || "",
    kind: server.llm_kind || "openai"});
  const [srvLlmKey, setSrvLlmKey] = useState("");
  const [srvLlmMsg, setSrvLlmMsg] = useState("");
  const [srvLlmHealth, setSrvLlmHealth] = useState(null);
  const [srvModels, setSrvModels] = useState([]);
  useEffect(() => {
    if (!server.llm_url) return;
    api.serverLlmTest(server.id)
      .then((r) => { if (r?.models?.length) setSrvModels(r.models); })
      .catch(() => {});
  }, [server.id]);

  async function uploadEmoji() {
    const f = emFileRef.current?.files?.[0];
    if (!f) return setMsg("Pick an image file first.");
    const r = await api.addEmoji(server.id, emName || f.name.replace(/\.[^.]+$/, ""), f)
      .catch((e) => (setMsg(e.message), null));
    if (r) {
      setEms((x) => [...x, { id: r.id || Date.now(), name: r.name, file_id: r.file_id, uploader: me?.id }]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setEmName(""); emFileRef.current.value = "";
      setMsg(`:${r.name}: is live — use it in any channel here.`);
    }
  }

  async function save() {
    const s = await api.editServer(server.id,
      { name: name.trim(), icon, star_threshold: thresh }).catch((e) => (setMsg(e.message), null));
    if (s) onSaved(s);
  }
  async function regen() {
    const s = await api.regenInvite(server.id).catch((e) => (setMsg(e.message), null));
    if (s) { setCode(s.invite_code); setMsg("Invite rotated — the old code is dead."); }
  }

  return (
    <Modal title={`${server.icon} ${server.name} — settings`} onClose={onClose}
      sub={owner ? "You own this team." : "You're a member here."}>
      <label>My nickname here <span style={{ color: "var(--dim)", fontWeight: 400 }}>(blank = display name)</span></label>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={nick} onChange={(e) => setNick(e.target.value)}
          placeholder={me?.display_name} maxLength={48} style={{ flex: 1 }} />
        <button disabled={nick.trim() === myNick} onClick={async () => {
          const r = await api.setNick(server.id, nick.trim()).catch((e) => (setMsg(e.message), null));
          if (r) setMsg(nick.trim() ? `You're now "${nick.trim()}" here.` : "Nickname cleared.");
        }}>Set</button>
      </div>
      <label>Invite link</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code className="invite-link">{location.origin}/#join/{code}</code>
        <button onClick={() => {
          navigator.clipboard?.writeText(`${location.origin}/#join/${code}`)
            .then(() => setMsg("Link copied — send it to a friend."))
            .catch(() => setMsg(`${location.origin}/#join/${code}`));
        }}><Ico n="copy" s={13} /> copy</button>
      </div>
      <label>Custom emoji <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        ({ems.length}/50 — type :name: in chat)</span></label>
      {ems.length > 0 && (
        <div className="emoji-list">
          {ems.map((e) => (
            <div key={e.id} className="em-row">
              <img className="md-emoji big" src={api.fileUrl(e.file_id)} alt={":" + e.name + ":"} />
              <span style={{ flex: 1 }}>:{e.name}:</span>
              {(e.uploader === me?.id || owner) &&
                <span className="stat kick" title="Delete emoji" onClick={async () => {
                  const r = await api.delEmoji(e.id).catch((x) => (setMsg(x.message), null));
                  if (r) setEms((x) => x.filter((y) => y.id !== e.id));
                }}><Ico n="x" s={12} /></span>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={emName} onChange={(e) => setEmName(e.target.value)}
          placeholder="emote_name" maxLength={32} style={{ width: 130 }} />
        <input ref={emFileRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg"
          style={{ flex: 1, fontSize: 11.5 }} />
        <button onClick={uploadEmoji}><Ico n="plus" s={12} /> add</button>
      </div>
      {owner ? (
        <>
          <label>Icon</label>
          <div className="emoji-pick">
            {EMOJI_CHOICES.map((e) => (
              <span key={e} className={`e ${icon === e ? "on" : ""}`} onClick={() => setIcon(e)}>{e}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            {server.icon_file && !iconErr
              ? <img src={api.fileUrl(server.icon_file)} alt="" onError={() => setIconErr(true)}
                  style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover" }} />
              : null}
            <button onClick={() => iconFileRef.current?.click()}>🖼 {server.icon_file ? "replace image" : "upload image"}</button>
            {server.icon_file ? (
              <button onClick={async () => {
                const s = await api.editServer(server.id, { icon_file: "" }).catch((e) => (setMsg(e.message), null));
                if (s) { onSaved(s); setMsg("Back to the emoji icon."); }
              }}><Ico n="x" s={12} /> clear</button>
            ) : null}
            <input ref={iconFileRef} type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              const up = await api.upload(f).catch((er) => (setMsg(er.message), null));
              if (!up) return;
              const s = await api.editServer(server.id, { icon_file: up.id }).catch((er) => (setMsg(er.message), null));
              if (s) { setIconErr(false); onSaved(s); setMsg("Server icon updated 🖼"); }
            }} />
          </div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>Invite code</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, padding: "7px 10px", background: "var(--panel2)", borderRadius: 7 }}>{code}</code>
            <button onClick={regen} title="Rotate the invite code"><Ico n="refresh" s={13} /> rotate</button>
          </div>
          <label><Ico n="star" s={13} /> Starboard <span style={{ color: "var(--dim)", fontWeight: 400 }}>
            (stars needed to repost into #starboard — 0 = off)</span></label>
          <input type="number" min={0} max={20} value={thresh}
            onChange={(e) => setThresh(Math.max(0, Math.min(20, +e.target.value || 0)))}
            style={{ width: 80 }} />
          <label><Ico n="bolt" s={13} /> Server LLM endpoint {srvLlmHealth !== null &&
            <span title={srvLlmHealth ? "last test passed" : "last test failed"}
              style={{ color: srvLlmHealth ? "#3fb950" : "var(--bad)", fontSize: 14 }}> ● </span>}
            <span style={{ color: "var(--dim)", fontWeight: 400 }}>
              (shared engine — every @summon in this server uses it first)</span></label>
          <input value={srvLlm.url} onChange={(e) => setSrvLlm({ ...srvLlm, url: e.target.value })}
            placeholder="https://…/v1 or webhook URL (blank = personal/local)" />
          <div style={{ display: "flex", gap: 8 }}>
            <ModelField value={srvLlm.model} onChange={(e) => setSrvLlm({ ...srvLlm, model: e.target.value })}
              options={srvModels} placeholder="model (optional)" style={{ flex: 1 }} />
            <select value={srvLlm.kind}
              onChange={(e) => setSrvLlm({ ...srvLlm, kind: e.target.value })}>
              <option value="openai">OpenAI-compatible</option>
              <option value="webhook">Webhook harness</option>
            </select>
          </div>
          <input type="password" value={srvLlmKey}
            onChange={(e) => setSrvLlmKey(e.target.value)}
            placeholder={server.has_llm_key ? "api key — set (type to replace)" : "api key (optional)"} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={async () => {
              const s = await api.editServer(server.id, {
                llm_url: srvLlm.url.trim(), llm_model: srvLlm.model.trim(),
                llm_kind: srvLlm.kind,
                llm_key: srvLlmKey === "" ? null : srvLlmKey,
              }).catch((e) => (setSrvLlmMsg(e.message), null));
              if (s) { onSaved(s); setSrvLlmKey(""); setSrvLlmMsg("Saved — the crew runs on this engine."); }
            }}>Save engine</button>
            <button onClick={async () => {
              setSrvLlmMsg("Testing…");
              const r = await api.serverLlmTest(server.id).catch((e) => ({ ok: false, error: e.message }));
              setSrvLlmHealth(!!r.ok);
              if (r?.models?.length) setSrvModels(r.models);
              setSrvLlmMsg(r.ok
                ? (r.models ? `Connected — ${r.models.length} model(s) visible.` : `Connected — ${String(r.sample || "").slice(0, 80)}`)
                : `Can't reach it: ${r.error || "unknown"}`);
            }}>Test</button>
          </div>
          {srvLlmMsg && <div className="idehint">{srvLlmMsg}</div>}
          <label>Roles <span style={{ color: "var(--dim)", fontWeight: 400 }}>
            ({roles.length}/20 — colored names + pills)</span></label>
          {roles.length > 0 && (
            <div className="role-list">
              {roles.map((r) => (
                <span key={r.id} className="role-pill big" style={{ borderColor: r.color, color: r.color }}>
                  {r.name}
                  <i className="rp-x" title="Delete role" onClick={async () => {
                    const x = await api.delRole(r.id).catch((e) => (setMsg(e.message), null));
                    if (x) {
                      setRoles((y) => y.filter((z) => z.id !== r.id));
                      setMroles((m) => Object.fromEntries(
                        Object.entries(m).map(([k, v]) => [k, v.filter((z) => z !== r.id)])));
                    }
                  }}>✕</i>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <input value={rName} onChange={(e) => setRName(e.target.value)}
              placeholder="role name" maxLength={24} style={{ width: 120 }} />
            <span className="role-sws">
              {ROLE_COLORS.map((c) => (
                <span key={c} className={`role-sw ${rColor === c ? "on" : ""}`}
                  style={{ background: c }} onClick={() => setRColor(c)} />
              ))}
            </span>
            <button disabled={!rName.trim()} onClick={async () => {
              const r = await api.addRole(server.id, rName.trim(), rColor)
                .catch((e) => (setMsg(e.message), null));
              if (r) { setRoles((x) => [...x, r]); setRName(""); setMsg(`Role "${r.name}" created.`); }
            }}><Ico n="plus" s={12} /></button>
          </div>
          <label>Members</label>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {(server.members || []).map((m) => (
              <div key={m.id} className="pack-agent" style={{ cursor: "default", flexWrap: "wrap" }}>
                <span className="pk-ico big">{m.avatar_emoji}</span>
                <div style={{ flex: 1 }}>
                  <b>{m.display_name}</b>
                  <div style={{ fontSize: 11, color: "var(--dim)" }}>
                    @{m.username}{m.id === server.owner_id ? " · owner" : ""}</div>
                </div>
                {m.id !== server.owner_id && <>
                  <span className="stat xfer" title={`Make ${m.display_name} the owner`}
                    onClick={() => onTransfer(m)}><Ico n="swap" s={13} /></span>
                  <span className="stat kick" title={`Kick ${m.display_name}`}
                    onClick={() => onKick(m)}><Ico n="x" s={11} /> kick</span>
                </>}
                {roles.length > 0 && (
                  <div className="role-chips">
                    {roles.map((r) => {
                      const on = (mroles[m.id] || []).includes(r.id);
                      return (
                        <span key={r.id} className={`role-pill tgl ${on ? "on" : ""}`}
                          style={on ? { borderColor: r.color, color: r.color, background: r.color + "22" } : undefined}
                          title={on ? "Remove role" : "Assign role"}
                          onClick={async () => {
                            const x = await api.toggleMemberRole(server.id, m.id, r.id)
                              .catch((e) => (setMsg(e.message), null));
                            if (x) setMroles((mr) => ({
                              ...mr,
                              [m.id]: x.on
                                ? [...(mr[m.id] || []), r.id]
                                : (mr[m.id] || []).filter((z) => z !== r.id),
                            }));
                          }}>{r.name}</span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="msub" style={{ marginBottom: 8 }}>
          Leave <b>{server.name}</b>? You can rejoin anytime with the invite code.
        </div>
      )}
      {msg && <div style={{ color: "var(--dim)", marginTop: 10, fontSize: 12.5 }}>{msg}</div>}
      <div className="mfoot">
        {owner
          ? <button className="danger" onClick={() => onDeleted(server)}><Ico n="trash" s={13} /> Delete team</button>
          : <button className="danger" onClick={() => onLeft(server)}><Ico n="leave" s={13} /> Leave team</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>Close</button>
        {owner && <button className="primary" onClick={save} disabled={!name.trim()}>Save</button>}
      </div>
    </Modal>
  );
}

function NotifCtl() {
  const [perm, setPerm] = useState("Notification" in window ? Notification.permission : "denied");
  const [on, setOn] = useState(localStorage.getItem("signalteams.notifs") !== "0");
  if (!("Notification" in window)) return <span className="idehint">unsupported</span>;
  if (perm === "denied") return <span className="idehint">blocked by browser</span>;
  if (perm !== "granted") return (
    <button onClick={async () => {
      const p = await Notification.requestPermission(); setPerm(p);
    }}>Enable</button>);
  return (
    <button className={on ? "primary" : ""} onClick={() => {
      const v = !on; setOn(v);
      localStorage.setItem("signalteams.notifs", v ? "1" : "0");
    }}>{on ? "On" : "Off"}</button>);
}

const COLORS = ["#4da3ff", "#3fb950", "#d29922", "#f85149", "#a371f7", "#14b8a6", "#e85d75", "#d4af37"];
const STATUSES = [["online", "Online"], ["idle", "Idle"], ["dnd", "Do not disturb"], ["offline", "Invisible"]];

export function PulseModal({ server, onClose, onJump }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.pulse(server.id).then(setP).catch((e) => setErr(e.message));
  }, [server.id]);
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const labels = p ? p.days.map((_, i) => {
    const d = new Date((p.today0 + (i - 6) * 86400) * 1000);
    return DOW[d.getDay()];
  }) : [];
  const max = p ? Math.max(1, ...p.days) : 1;
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="pulse" s={16} /> {server.name} — pulse</span>}
      sub="Last 7 days of activity" onClose={onClose}>
      {err && <div className="msub">{err}</div>}
      {!p && !err && <div className="msub">Counting…</div>}
      {p && (
        <>
          <div className="pulse-bars">
            {p.days.map((n, i) => (
              <div key={i} className="pb-col" title={`${labels[i]}: ${n} messages`}>
                <div className="pb-bar" style={{ height: `${Math.max(4, (n / max) * 64)}px` }} />
                <div className="pb-lab">{labels[i]}</div>
              </div>
            ))}
          </div>
          <div className="pulse-stats">
            <div className="ps"><b>{p.total}</b><span>messages</span></div>
            <div className="ps"><b>{p.active_members}</b><span>active members</span></div>
            <div className="ps"><b>{p.new_members}</b><span>new members</span></div>
          </div>
          <div className="pulse-rows">
            {p.top_poster && (
              <div className="pr">🏆 top poster — <b>{p.top_poster.name}</b>
                <span className="pr-n">{p.top_poster.count} msgs</span></div>)}
            {(p.top_agents || []).map((a, i) => (
              <div key={a.name} className="pr">
                {i === 0 ? "🤖" : `${i + 1}.`} {i === 0 ? "busiest agent — " : ""}
                <b>{a.name}</b>
                <span className="pr-n">{a.count} replies</span></div>))}
            {p.top_message && (
              <div className="pr link" onClick={() => onJump?.(p.top_message)}>
                ✨ most reacted — <b className="pr-x">{p.top_message.excerpt || "(attachment)"}</b>
                <span className="pr-n">{p.top_message.reactions} reacts · jump →</span></div>)}
            {!p.top_poster && !p.top_agent && !p.top_message && (
              <div className="msub">Quiet week — go make some noise. 📣</div>)}
          </div>
        </>
      )}
    </Modal>
  );
}

export function SettingsModal({ me, theme, onTheme, onClose, onSaved, onLogout }) {
  const [f, setF] = useState({
    display_name: me.display_name, bio: me.bio,
    avatar_emoji: me.avatar_emoji, avatar_color: me.avatar_color, status: me.status,
    status_text: me.status_text || "",
  });
  const [acct, setAcct] = useState(me);        // fresh flags from /api/me
  const [density, setDensity] = useState(localStorage.getItem("st.density") || "cozy");
  const [sound, setSound] = useState(localStorage.getItem("st.sound") || "1");
  const [pwCur, setPwCur] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [acctMsg, setAcctMsg] = useState("");
  const [llm, setLlm] = useState({ base_url: "", model: "", kind: "openai", has_key: false });
  const [llmKey, setLlmKey] = useState("");
  const [llmHdrs, setLlmHdrs] = useState("");
  const [llmMsg, setLlmMsg] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmModels, setLlmModels] = useState({ custom: [], local: [] });
  useEffect(() => {
    api.me().then(setAcct).catch(() => {});
    api.llmMe().then(setLlm).catch(() => {});
    api.llmProviders().then((ps) => {
      setLlmModels({
        custom: ps.find((p) => p.name === "custom")?.models || [],
        local: ps.filter((p) => p.name !== "custom").flatMap((p) => p.models),
      });
    }).catch(() => {});
  }, []);
  const llmModelOpts = (llm.base_url || "").trim() ? llmModels.custom : llmModels.local;

  async function saveLlm() {
    setLlmBusy(true);
    const r = await api.llmSave({
      base_url: llm.base_url, model: llm.model, kind: llm.kind,
      api_key: llmKey === "" ? null : llmKey,
      headers: llmHdrs === "" ? null : llmHdrs,
    }).catch((e) => (setLlmMsg(e.message), null));
    setLlmBusy(false);
    if (r) { setLlm(r); setLlmKey(""); setLlmMsg(r.base_url ? "Endpoint saved." : "Custom endpoint cleared — local providers only."); }
  }

  const [llmHealth, setLlmHealth] = useState(null);   // null | true | false

  async function testLlm() {
    setLlmBusy(true); setLlmMsg("Testing…");
    const saved = await api.llmSave({
      base_url: llm.base_url, model: llm.model, kind: llm.kind,
      api_key: llmKey === "" ? null : llmKey,
      headers: llmHdrs === "" ? null : llmHdrs,
    }).catch(() => null);
    if (saved) setLlm(saved);
    const r = await api.llmTest().catch((e) => ({ ok: false, error: e.message }));
    setLlmBusy(false); setLlmHealth(!!r.ok);
    if (r.models?.length) setLlmModels((m) => ({ ...m, custom: r.models }));
    setLlmMsg(r.ok
      ? (r.models ? `Connected — ${r.models.length} model(s) visible.` : `Connected — ${r.sample?.slice(0, 80) || "endpoint answered"}`)
      : `Can't reach it: ${r.error || "unknown"}`);
  }

  async function save() {
    const u = await api.updateMe(f);
    onSaved(u);
  }

  async function savePw() {
    const r = await api.setPassword(pwCur, pwNext)
      .catch((e) => (setAcctMsg(e.message), null));
    if (r) {
      setAcctMsg(acct.has_password === false
        ? "Crew password set — the 🐝 tab works for you now."
        : "Password changed — other devices were signed out.");
      setPwCur(""); setPwNext("");
      setAcct((a) => ({ ...a, has_password: true }));
    }
  }

  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="gear" s={16} /> Settings</span>}
      sub={`@${me.username} · build ${__APP_BUILD__?.slice(0, 10) || "dev"}`} onClose={onClose}>
      <div className="set-row">
        <div className="lab">Theme<div className="d">Dark = night ops. Light = warm paper.</div></div>
        <div className="seg">
          <button className={theme === "dark" ? "on" : ""} onClick={() => onTheme("dark")}><Ico n="moon" s={12} /> Dark</button>
          <button className={theme === "light" ? "on" : ""} onClick={() => onTheme("light")}><Ico n="sun" s={12} /> Light</button>
        </div>
      </div>
      <div className="set-row">
        <div className="lab">Message density<div className="d">
          Cozy = avatars + room to breathe. Compact = dense, ops-terminal.</div></div>
        <div className="seg">
          {["cozy", "compact"].map((d) => (
            <button key={d} className={density === d ? "on" : ""}
              onClick={() => {
                setDensity(d); localStorage.setItem("st.density", d);
                document.documentElement.dataset.density = d;
              }}>{d[0].toUpperCase() + d.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div className="lab">Notifications
          <div className="d">Desktop ping on mentions &amp; DMs when you're away.</div></div>
        <NotifCtl />
      </div>
      <div className="set-row">
        <div className="lab">Ping sound
          <div className="d">A soft 880 Hz blip when a mention or DM lands.</div></div>
        <div className="seg">
          {[["1", "On"], ["0", "Off"]].map(([v, l]) => (
            <button key={v} className={sound === v ? "on" : ""}
              onClick={() => { setSound(v); localStorage.setItem("st.sound", v); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div className="lab">Status<div className="d">Shown to friends and server members.</div></div>
        <div className="seg">
          {STATUSES.map(([k, l]) => (
            <button key={k} className={f.status === k ? "on" : ""}
              onClick={() => setF({ ...f, status: k })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <div className="lab">Avatar<div className="d">Emoji + color.</div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div className="emoji-pick">
            {EMOJI_CHOICES.slice(0, 8).map((e) => (
              <span key={e} className={`e ${f.avatar_emoji === e ? "on" : ""}`}
                onClick={() => setF({ ...f, avatar_emoji: e })}>{e}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {COLORS.map((c) => (
              <div key={c} className={`swatch ${f.avatar_color === c ? "on" : ""}`}
                style={{ background: c }} onClick={() => setF({ ...f, avatar_color: c })} />
            ))}
          </div>
        </div>
      </div>
      <label>Display name</label>
      <input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
      <label>Custom status <span style={{ color: "var(--dim)", fontWeight: 400 }}>(what you're up to)</span></label>
      <input value={f.status_text} onChange={(e) => setF({ ...f, status_text: e.target.value })}
        placeholder="🎮 grinding ranked…" maxLength={80} />
      <label>Bio</label>
      <input value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })}
        placeholder="A line about you" />
      <label>Custom LLM endpoint {llmHealth !== null &&
        <span title={llmHealth ? "last test passed" : "last test failed"}
          style={{ color: llmHealth ? "#3fb950" : "var(--bad)", fontSize: 14 }}>
          {" ● "}</span>}<span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (any OpenAI-compatible API — OpenRouter, Groq, vLLM — or a webhook harness;
        your summons &amp; Try tab use it first)</span></label>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={llm.base_url} style={{ flex: 1 }}
          placeholder="https://openrouter.ai/api or http://host:8000"
          onChange={(e) => setLlm({ ...llm, base_url: e.target.value })} />
        <select value={llm.kind} style={{ maxWidth: 116 }}
          onChange={(e) => setLlm({ ...llm, kind: e.target.value })}>
          <option value="openai">OpenAI API</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <ModelField value={llm.model} style={{ flex: 1 }} options={llmModelOpts}
          placeholder="model (blank = endpoint default)"
          onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
        <input type="password" value={llmKey} style={{ flex: 1 }}
          placeholder={llm.has_key ? "api key • set" : "api key (optional)"}
          onChange={(e) => setLlmKey(e.target.value)} />
      </div>
      <input value={llmHdrs} onChange={(e) => setLlmHdrs(e.target.value)}
        placeholder={llm.has_headers ? 'extra headers • set — JSON to replace, "{}" clears'
          : 'extra headers JSON — e.g. {"X-Api-Key":"…"}'} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={llmBusy} onClick={saveLlm}>Save endpoint</button>
        <button disabled={llmBusy || !llm.base_url} onClick={testLlm}>Test</button>
        {llm.base_url &&
          <button onClick={() => { setLlm({ ...llm, base_url: "", model: "" }); setLlmKey(""); }}
            title="Clear the fields — then Save to apply"><Ico n="x" s={12} /></button>}
      </div>
      {llmMsg && <div className="msub" style={{ marginTop: 6 }}>{llmMsg}</div>}
      <label>Account <span style={{ color: "var(--dim)", fontWeight: 400 }}>(security)</span></label>
      {acct.supabase_linked &&
        <div className="msub" style={{ marginBottom: 6 }}>
          ⚡ linked to Supabase{acct.email ? ` — ${acct.email}` : ""}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {acct.has_password !== false && (
          <input type="password" placeholder="current password" value={pwCur}
            onChange={(e) => setPwCur(e.target.value)} style={{ flex: 1 }} />)}
        <input type="password" value={pwNext}
          placeholder={acct.has_password === false ? "set a crew password" : "new password"}
          onChange={(e) => setPwNext(e.target.value)} style={{ flex: 1 }} />
        <button disabled={pwNext.length < 4} onClick={savePw}>
          {acct.has_password === false ? "Set" : "Change"}</button>
      </div>
      <button className="ghost" style={{ marginTop: 8 }} onClick={async () => {
        const r = await api.signoutOthers().catch((e) => (setAcctMsg(e.message), null));
        if (r) setAcctMsg("Every other session was signed out.");
      }}>Sign out other devices</button>
      <button className="ghost" style={{ marginTop: 8 }} onClick={async () => {
        const r = await api.exportData().then(() => true).catch((e) => (setAcctMsg(e.message), null));
        if (r) setAcctMsg("Export downloaded — check your files. 📦");
      }}><Ico n="download" s={13} /> Download my data</button>
      {acctMsg && <div style={{ color: "var(--dim)", marginTop: 8, fontSize: 12.5 }}>{acctMsg}</div>}
      <div className="mfoot">
        <button className="danger" onClick={onLogout}><Ico n="leave" s={13} /> Sign out</button>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>Close</button>
        <button className="primary" onClick={save}>Save profile</button>
      </div>
    </Modal>
  );
}

export function ChannelModal({ kind, channel, me, roles, onClose, onDone, onDelete }) {
  const editing = !!channel;
  const [name, setName] = useState(channel?.name || "");
  const [topic, setTopic] = useState(channel?.topic || "");
  const [category, setCategory] = useState(channel?.category || "");
  const [slow, setSlow] = useState(channel?.slowmode_secs || 0);
  const [vcap, setVcap] = useState(channel?.voice_cap || 0);
  const [roleId, setRoleId] = useState(channel?.role_id || 0);
  const [picked, setPicked] = useState(new Set((channel?.roster || []).map((a) => a.id)));
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (kind === "agents") api.agents({ sort: "name" }).then((all) =>
      setAgents([...all].sort((a, b) => (a.owner_id === me?.id ? 0 : 1) - (b.owner_id === me?.id ? 0 : 1)))
    ).catch(() => {});
  }, [kind, me?.id]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal title={editing ? `Edit ${kind === "agents" ? "✦" : "#"}${channel.name}`
        : `New ${kind === "agents" ? "agent" : "text"} channel`} onClose={onClose}
      sub={kind === "agents" ? "Agent channels highlight shared agent cards — pick residents to pin." : "Plain talk."}>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "agents" ? "agent-drops" : "general"} />
      <label>Topic</label>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="optional" />
      <label>Category <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional — groups channels in the sidebar)</span></label>
      <input value={category} onChange={(e) => setCategory(e.target.value)}
        placeholder="e.g. projects, fun" maxLength={48} />
      {kind === "text" && (
        <>
          <label>Slowmode <span style={{ color: "var(--dim)", fontWeight: 400 }}>(seconds between messages — 0 = off)</span></label>
          <input type="number" min={0} max={21600} value={slow}
            onChange={(e) => setSlow(Math.max(0, Math.min(+e.target.value || 0, 21600)))} />
          <label>Voice cap <span style={{ color: "var(--dim)", fontWeight: 400 }}>(max people in 🎧 — 0 = unlimited)</span></label>
          <input type="number" min={0} max={99} value={vcap}
            onChange={(e) => setVcap(Math.max(0, Math.min(+e.target.value || 0, 99)))} />
        </>
      )}
      {(roles || []).length > 0 && (
        <>
          <label><Ico n="lock" s={12} /> Visible to <span style={{ color: "var(--dim)", fontWeight: 400 }}>(role-gated — owner always gets in)</span></label>
          <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
            <option value={0}>everyone</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </>
      )}
      {kind === "agents" && (
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
          onClick={() => onDone(name.trim(), kind, topic.trim(), [...picked], category.trim(), slow, vcap, roleId)}>
          {editing ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

const KEY_SHORTCUTS = [
  ["Ctrl + K", "Quick switcher & search everywhere"],
  ["Ctrl + /  or  ?", "Keyboard shortcuts & slash commands"],
  ["Alt + ↑ / ↓", "Cycle previous / next channel or DM"],
  ["Alt + Shift + ↑ / ↓", "Jump to previous / next unread channel"],
  ["Shift + Esc", "Mark all channels in current server as read"],
  ["↑ (empty composer)", "Edit your last sent message"],
  ["Shift + Enter", "Insert a newline in the composer"],
  ["Esc", "Close active modal, cancel reply, or clear unread"],
];

const SLASH_CMDS = [
  ["/poll Q | A | B", "Start a live interactive reaction poll (2–9 options)"],
  ["/remind 10m text", "Schedule a channel timer reminder (s, m, h, d)"],
  ["/huddle topic", "Run a 2–4 agent roundtable in an agent channel"],
  ["/topic text", "Update the current channel's topic banner"],
  ["/nick name", "Set or clear your nickname in the current server"],
  ["/me action", "Send an italicized action status message"],
  ["/roll 2d6", "Roll dice (e.g. 2d6, d20) in the channel"],
  ["/8ball question", "Ask the Magic 8-Ball"],
  ["/shrug · /tableflip", "Append classic ASCII emotes"],
  ["/clear", "Clear the composer draft"],
];

export function ShortcutsModal({ onClose }) {
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="kb" s={17} /> Shortcuts &amp; Slash Commands</span>}
      sub="Navigate at keyboard speed or drive the composer with slash commands." onClose={onClose} wide>
      <div className="sc-grid">
        <div>
          <label style={{ marginTop: 0 }}><Ico n="kb" s={12} /> Keyboard shortcuts</label>
          <div className="sc-list">
            {KEY_SHORTCUTS.map(([k, d]) => (
              <div key={k} className="sc-row">
                <kbd className="sc-kbd">{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label style={{ marginTop: 0 }}><Ico n="term" s={12} /> Composer slash commands</label>
          <div className="sc-list">
            {SLASH_CMDS.map(([c, d]) => (
              <div key={c} className="sc-row">
                <code className="sc-cmd">{c}</code>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mfoot">
        <button className="primary" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}
