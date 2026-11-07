import React, { useEffect, useState } from "react";
import Ico from "../../Ico";
import { api } from "../../../api";
import { AGENT_API_PRESETS, ModelField } from "../_shared.jsx";

export function ConnectTab({ agent, me, onSaved }) {
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

