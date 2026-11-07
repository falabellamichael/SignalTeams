import React, { useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal } from "./_shared.jsx";

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
