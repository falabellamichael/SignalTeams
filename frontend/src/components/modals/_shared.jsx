import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";


export function Modal({ title, sub, onClose, children, wide }) {
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
export function ModelField({ value, onChange, options, placeholder, style, disabled }) {
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

export function useLlmProviders() {
  const [providers, setProviders] = useState([]);
  useEffect(() => { api.llmProviders().then(setProviders).catch(() => {}); }, []);
  return providers;
}
// "ollama:x"/"lmstudio:x"/"custom:x" select a provider; anything else is a bare model name
export const providerModels = (ps) => ps.flatMap((p) => p.models.map((m) =>
  ["ollama", "lmstudio", "custom"].includes(p.name) ? `${p.name}:${m}` : m));

export const AGENT_API_PRESETS = [
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
const DIFF_FIELDS = [["name", "Name"], ["icon", "Icon"], ["version", "Version"],
  ["model", "Model"], ["temperature", "Creativity"], ["tagline", "Tagline"], ["description", "Description"],
  ["system_prompt", "System prompt"], ["visibility", "Visibility"], ["context_url", "Context URL"]];

export function diffSnap(older, newer) {
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
export const EMOJI_CHOICES = ["🤖", "🐝", "🦉", "🦊", "🐙", "⚡", "🌙", "🍯", "🔍", "📚", "🛠", "🎲"];
export const PACK_ICONS = ["📦", "🧰", "🐝", "🍯", "⚡", "🛠", "🎒", "🔬", "🎲", "📚", "🧪", "🚀"];

// detail view of a pack — list of agents, bench-all, share, delete
export function NotifCtl() {
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

export const COLORS = ["#4da3ff", "#3fb950", "#d29922", "#f85149", "#a371f7", "#14b8a6", "#e85d75", "#d4af37"];
export const STATUSES = [["online", "Online"], ["idle", "Idle"], ["dnd", "Do not disturb"], ["offline", "Invisible"]];
