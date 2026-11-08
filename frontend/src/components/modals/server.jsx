import React, { useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal } from "./_shared.jsx";

export function ServerModal({ onClose, onDone }) {
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🍯");
  const [code, setCode] = useState("");
  const [tcode, setTcode] = useState("");
  const [tprev, setTprev] = useState(null);
  const [err, setErr] = useState("");

  async function go() {
    setErr("");
    try {
      const s = tab === "create" ? await api.createServer(name.trim(), icon)
        : tab === "join" ? await api.joinServer(code.trim())
        : await api.serverFromTemplate(tcode.trim());
      onDone(s);
    } catch (e) { setErr(e.message); }
  }

  async function preview() {
    setErr(""); setTprev(null);
    const p = await api.templatePreview(tcode.trim()).catch((e) => (setErr(e.message), null));
    if (p) setTprev(p);
  }

  return (
    <Modal title={tab === "create" ? "Start a team" : tab === "join" ? "Join a team" : "From template"}
      sub="Servers = your crew's channels. Invite codes get friends in." onClose={onClose}>
      <div className="ftabs" style={{ marginBottom: 12 }}>
        <button className={`ftab ${tab === "create" ? "on" : ""}`} onClick={() => setTab("create")}>Create</button>
        <button className={`ftab ${tab === "join" ? "on" : ""}`} onClick={() => setTab("join")}>Join with code</button>
        <button className={`ftab ${tab === "tpl" ? "on" : ""}`} onClick={() => setTab("tpl")}>Template</button>
      </div>
      {tab === "create" && (
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
      )}
      {tab === "join" && (
        <>
          <label>Invite code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="signal-demo" />
        </>
      )}
      {tab === "tpl" && (
        <>
          <label>Template code <span style={{ color: "var(--dim)", fontWeight: 400 }}>
            (copies channels, roles &amp; automod — not people or messages)</span></label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={tcode} onChange={(e) => { setTcode(e.target.value); setTprev(null); }}
              placeholder="e.g. a1b2c3d4" style={{ flex: 1 }} />
            <button onClick={preview} disabled={!tcode.trim()}>Preview</button>
          </div>
          {tprev && (
            <div className="pack-agent" style={{ cursor: "default", marginTop: 8 }}>
              <span className="pk-ico big">{tprev.icon}</span>
              <div style={{ flex: 1 }}>
                <b>{tprev.name}</b>
                <div style={{ fontSize: 11, color: "var(--dim)" }}>
                  {tprev.channels.slice(0, 8).map((c) => `#${c}`).join(" ")}
                  {tprev.channels.length > 8 && " …"}
                  {tprev.roles.length > 0 && ` · roles: ${tprev.roles.join(", ")}`}
                  {" · used "}{tprev.views ?? tprev.uses}×
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {err && <div style={{ color: "var(--bad)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={go}
          disabled={tab === "create" ? !name.trim() : tab === "join" ? !code.trim() : !tcode.trim()}>
          {tab === "create" ? "Create" : tab === "join" ? "Join" : "Use template"}
        </button>
      </div>
    </Modal>
  );
}
