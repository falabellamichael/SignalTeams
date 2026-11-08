import React, { useEffect, useRef, useState } from "react";
import Ico from "../../Ico";
import { api } from "../../../api";
import { providerModels } from "../_shared.jsx";

export function TryTab({ agent, onOpenConnect }) {
  const [providers, setProviders] = useState([]);
  const [userLlm, setUserLlm] = useState(null);
  const [model, setModel] = useState("");
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    api.llmProviders().then(setProviders).catch(() => {});
    api.llmMe().then(setUserLlm).catch(() => {});
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const allModels = providerModels(providers);
  const autoLabel = agent.api_url
    ? (agent.model || "endpoint default")
    : (userLlm?.base_url && userLlm?.model)
      ? userLlm.model
      : (agent.model || "auto");

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
      let buf = "", reply = "", provMeta = "";
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
          if (evt.t === "meta") { provMeta = `${evt.provider} · ${evt.model}`; patch(() => ({ meta: provMeta })); }
          else if (evt.t === "thinking") patch(() => ({ meta: `💭 thinking… (${evt.n})` }));
          else if (evt.t === "token") { reply += evt.c; patch(() => ({ content: reply, meta: provMeta })); }
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
        <span style={{ fontSize: 11, color: (agent.api_url || userLlm?.base_url) ? "var(--honey)" : "var(--dim)", alignSelf: "center" }}>
          {agent.api_url
            ? `🔌 Dedicated API (${agent.api_kind || "openai"}): ${agent.api_url}`
            : userLlm?.base_url
              ? `🔌 Personal Endpoint: ${userLlm.base_url}`
              : providers.length
                ? "Local providers:"
                : "⚠ no LLM detected — connect an API in 🔌 Connect"}
        </span>
        {onOpenConnect && !agent.api_url && (
          <button className="ghost" style={{ fontSize: 11, padding: "2px 7px" }} onClick={onOpenConnect}>
            🔌 Connect API
          </button>
        )}
        {allModels.length > 0 && (
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ fontSize: 11.5 }}>
            <option value="">auto ({autoLabel})</option>
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
            Talk to <b>{agent.name}</b> — its system prompt is doing the driving.
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
