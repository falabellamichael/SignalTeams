import React, { useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal, ModelField, providerModels, useLlmProviders } from "./_shared.jsx";


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
