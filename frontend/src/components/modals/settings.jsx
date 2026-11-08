import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { COLORS, EMOJI_CHOICES, Modal, ModelField, NotifCtl, STATUSES } from "./_shared.jsx";


export function SettingsModal({ me, theme, onTheme, onClose, onSaved, onLogout }) {
  const [f, setF] = useState({
    display_name: me.display_name, bio: me.bio,
    avatar_emoji: me.avatar_emoji, avatar_color: me.avatar_color, status: me.status,
    status_text: me.status_text || "",
    keywords: (me.keywords || []).join(", "),
    banner_color: me.banner_color || "",
    pronouns: me.pronouns || "",
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

  async function saveLlm(overrideModel) {
    setLlmBusy(true);
    const nextModel = typeof overrideModel === "string" ? overrideModel : llm.model;
    const r = await api.llmSave({
      base_url: llm.base_url, model: nextModel, kind: llm.kind,
      api_key: llmKey === "" ? null : llmKey,
      headers: llmHdrs === "" ? null : llmHdrs,
    }).catch((e) => (setLlmMsg(e.message), null));
    setLlmBusy(false);
    if (r) { setLlm(r); setLlmKey(""); setLlmMsg(r.base_url ? "Endpoint saved ✓" : "Custom endpoint cleared — local providers only."); }
  }

  const [llmHealth, setLlmHealth] = useState(null);   // null | true | false

  async function testLlm() {
    setLlmBusy(true); setLlmMsg("Testing…");
    const saved = await api.llmSave({
      base_url: llm.base_url, model: llm.model, kind: llm.kind,
      api_key: llmKey === "" ? null : llmKey,
      headers: llmHdrs === "" ? null : llmHdrs,
    }).catch(() => null);
    if (saved) { setLlm(saved); setLlmKey(""); }
    const r = await api.llmTest().catch((e) => ({ ok: false, error: e.message }));
    setLlmBusy(false); setLlmHealth(!!r.ok);
    if (r.models?.length) {
      setLlmModels((m) => ({ ...m, custom: r.models }));
      if (!llm.model && r.models[0]) {
        setLlm((prev) => ({ ...prev, model: r.models[0] }));
      }
    }
    setLlmMsg(r.ok
      ? (r.models?.length ? `✓ Connected (${r.latency_ms || 0}ms) — ${r.models.length} chat model(s) visible.` : `✓ Connected (${r.latency_ms || 0}ms) — ${r.sample?.slice(0, 80) || "endpoint answered"}`)
      : `✗ Can't reach it: ${r.error || "unknown"}`);
  }

  async function save() {
    const payload = { ...f,
      keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean) };
    const u = await api.updateMe(payload);
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
        <div className="lab">Theme<div className="d">Two dark palettes, two light palettes.</div></div>
        <div className="seg" style={{ flexWrap: "wrap" }}>
          <button className={theme === "dark" ? "on" : ""} onClick={() => onTheme("dark")}><Ico n="moon" s={12} /> Tokyo Night</button>
          <button className={theme === "obsidian" ? "on" : ""} onClick={() => onTheme("obsidian")}><Ico n="moon" s={12} /> Obsidian</button>
          <button className={theme === "light" ? "on" : ""} onClick={() => onTheme("light")}><Ico n="sun" s={12} /> Warm Theme</button>
          <button className={theme === "daylight" ? "on" : ""} onClick={() => onTheme("daylight")}><Ico n="sun" s={12} /> Daylight</button>
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
      <label>Pronouns <span style={{ color: "var(--dim)", fontWeight: 400 }}>(e.g. they/them, she/her, he/him)</span></label>
      <input value={f.pronouns} onChange={(e) => setF({ ...f, pronouns: e.target.value })}
        placeholder="they/them" maxLength={32} />
      <label>Banner color <span style={{ color: "var(--dim)", fontWeight: 400 }}>(profile header)</span></label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" value={f.banner_color && /^#[0-9a-f]{6}$/i.test(f.banner_color) ? f.banner_color : "#4da3ff"}
          style={{ width: 44, height: 32, padding: 2, cursor: "pointer", background: "none" }}
          onChange={(e) => setF({ ...f, banner_color: e.target.value })} />
        <input value={f.banner_color}
          placeholder="#4da3ff or #5865f2" maxLength={24}
          onChange={(e) => setF({ ...f, banner_color: e.target.value })} style={{ flex: 1 }} />
      </div>
      <label>Custom status <span style={{ color: "var(--dim)", fontWeight: 400 }}>(what you're up to)</span></label>
      <input value={f.status_text} onChange={(e) => setF({ ...f, status_text: e.target.value })}
        placeholder="🎮 grinding ranked…" maxLength={80} />
      <label>Bio</label>
      <input value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })}
        placeholder="A line about you" />
      <label>Keyword notifications <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (get pinged when these words appear in channels you're in — comma-separated)</span></label>
      <input value={f.keywords}
        onChange={(e) => setF({ ...f, keywords: e.target.value })}
        placeholder="deploy, incident, your name…" maxLength={300} />
      <label>Custom LLM endpoint {llmHealth !== null &&
        <span title={llmHealth ? "last test passed" : "last test failed"}
          style={{ color: llmHealth ? "#3fb950" : "var(--bad)", fontSize: 14 }}>
          {" ● "}</span>}<span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (any OpenAI-compatible API — Nexus, OpenRouter, Groq, vLLM — or a webhook harness;
        your summons &amp; Try tab use it first)</span></label>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={llm.base_url} style={{ flex: 1 }}
          placeholder="https://api.nexus-projects.ai/v1 or https://openrouter.ai/api/v1"
          onChange={(e) => setLlm({ ...llm, base_url: e.target.value })} />
        <select value={llm.kind} style={{ maxWidth: 132 }}
          onChange={(e) => setLlm({ ...llm, kind: e.target.value })}>
          <option value="openai">OpenAI API</option>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama</option>
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
      {llmModels.custom.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
          {llmModels.custom.map((m) => (
            <button key={m} type="button"
              className={`chip ${llm.model === m ? "on" : ""}`}
              style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => { setLlm((prev) => ({ ...prev, model: m })); saveLlm(m); }}>
              {m}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={llmBusy} onClick={() => saveLlm()}>Save endpoint</button>
        <button disabled={llmBusy || !llm.base_url} onClick={testLlm}>Test</button>
        {llm.base_url &&
          <button onClick={() => { setLlm({ ...llm, base_url: "", model: "" }); setLlmKey(""); }}
            title="Clear the fields — then Save to apply"><Ico n="x" s={12} /></button>}
      </div>
      {llmMsg && <div className="msub" style={{ marginTop: 6, color: llmHealth === false ? "var(--bad)" : llmHealth === true ? "var(--good)" : undefined }}>{llmMsg}</div>}
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
