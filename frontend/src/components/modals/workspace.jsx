import React, { useEffect, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Modal } from "./_shared.jsx";

const ICONS = ["🗂", "📁", "💻", "🧪", "🛠", "📦", "🧠", "🌱", "🔬", "🎨"];

export function WorkspaceModal({ server, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🗂");
  const [root, setRoot] = useState("");
  const [desc, setDesc] = useState("");
  const [roots, setRoots] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.workspaceRoots().then((r) => {
      setRoots(r);
      if (r.roots?.length && !root) setRoot(r.roots[0]);
    }).catch(() => setRoots({ roots: [] }));
  }, []);

  async function create() {
    setBusy(true);
    const w = await api.createWorkspace(server.id, {
      name: name.trim(), icon, root: root.trim(), description: desc.trim(),
    }).catch((e) => (setErr(e.message), null));
    setBusy(false);
    if (w) onCreated(w);
  }

  return (
    <Modal title="New workspace" onClose={onClose}
      sub="A folder on this machine that your crew — and the agents they summon — can read and edit.">
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="e.g. signalhive-core" maxLength={64} />
      <label>Icon</label>
      <div className="emoji-pick">
        {ICONS.map((e) => (
          <span key={e} className={`e ${icon === e ? "on" : ""}`} onClick={() => setIcon(e)}>{e}</span>
        ))}
      </div>
      <label>Folder on this machine <span style={{ color: "var(--dim)", fontWeight: 400 }}>
        (absolute path — the backend must be able to reach it)</span></label>
      <input value={root} onChange={(e) => setRoot(e.target.value)}
        placeholder="D:\\projects\\my-app" spellCheck={false} />
      {roots?.roots?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
          {roots.roots.map((r) => (
            <button key={r} type="button" className={`chip ${root === r ? "on" : ""}`}
              style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setRoot(r)}>{r}</button>
          ))}
        </div>
      )}
      {roots && roots.roots?.length === 0 && (
        <div className="idehint" style={{ marginTop: 4 }}>
          No root allow-list configured — any folder the backend can reach works.
          Set <code>AGENTHIVE_WORKSPACE_ROOTS</code> to lock this down.
        </div>
      )}
      <label>Description <span style={{ color: "var(--dim)", fontWeight: 400 }}>(optional)</span></label>
      <input value={desc} onChange={(e) => setDesc(e.target.value)}
        placeholder="what lives in here?" maxLength={400} />
      {err && <div className="idehint" style={{ color: "var(--bad)" }}>{err}</div>}
      <div className="mfoot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim() || !root.trim() || busy}
          onClick={create}><Ico n="plus" s={12} /> {busy ? "linking…" : "Create workspace"}</button>
      </div>
    </Modal>
  );
}
