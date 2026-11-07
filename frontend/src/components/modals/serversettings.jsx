import React, { useState, useEffect, useRef } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal, ModelField } from "./_shared.jsx";

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
            placeholder="https://api.nexus-projects.ai/v1 or webhook URL (blank = personal/local)" />
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
          {srvModels.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
              {srvModels.map((m) => (
                <button key={m} type="button"
                  className={`chip ${srvLlm.model === m ? "on" : ""}`}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => setSrvLlm((prev) => ({ ...prev, model: m }))}>
                  {m}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={async () => {
              const s = await api.editServer(server.id, {
                llm_url: srvLlm.url.trim(), llm_model: srvLlm.model.trim(),
                llm_kind: srvLlm.kind,
                llm_key: srvLlmKey === "" ? null : srvLlmKey,
              }).catch((e) => (setSrvLlmMsg(e.message), null));
              if (s) { onSaved(s); setSrvLlmKey(""); setSrvLlmMsg("Saved — the crew runs on this engine."); }
            }}>Save engine</button>
            <button disabled={!srvLlm.url.trim()} onClick={async () => {
              setSrvLlmMsg("Testing…");
              const s = await api.editServer(server.id, {
                llm_url: srvLlm.url.trim(), llm_model: srvLlm.model.trim(),
                llm_kind: srvLlm.kind,
                llm_key: srvLlmKey === "" ? null : srvLlmKey,
              }).catch(() => null);
              if (s) { onSaved(s); setSrvLlmKey(""); }
              const r = await api.serverLlmTest(server.id).catch((e) => ({ ok: false, error: e.message }));
              setSrvLlmHealth(!!r.ok);
              if (r?.models?.length) setSrvModels(r.models);
              setSrvLlmMsg(r.ok
                ? (r.models?.length ? `✓ Connected (${r.latency_ms || 0}ms) — ${r.models.length} chat model(s) visible.` : `✓ Connected (${r.latency_ms || 0}ms) — ${String(r.sample || "").slice(0, 80)}`)
                : `✗ Can't reach it: ${r.error || "unknown"}`);
            }}>Test</button>
          </div>
          {srvLlmMsg && <div className="idehint" style={{ color: srvLlmHealth === false ? "var(--bad)" : srvLlmHealth === true ? "var(--good)" : undefined }}>{srvLlmMsg}</div>}
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
