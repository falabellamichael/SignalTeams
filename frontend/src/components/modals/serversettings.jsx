import React, { useState, useEffect, useRef } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { timeAgo } from "../../util";
import { EMOJI_CHOICES, Modal, ModelField } from "./_shared.jsx";

const AUDIT_LABEL = {
  "server.update": "edited the server", "invite.rotate": "rotated the invite",
  "member.kick": "kicked", "member.leave": "left the team",
  "member.ban": "banned", "member.unban": "unbanned",
  "member.timeout": "timed out",
  "member.nick": "changed nickname on", "member.roles": "updated roles on",
  "member.approve": "let into", "member.deny": "denied a knock in",
  "owner.transfer": "handed ownership to",
  "role.create": "created role", "role.delete": "deleted role",
  "channel.create": "created channel", "channel.update": "edited channel",
  "channel.delete": "deleted channel", "channel.reorder": "reordered channels",
  "category.update": "edited category", "category.delete": "deleted category", "category.roles": "synced category roles",
  "emoji.create": "added emoji", "emoji.delete": "removed emoji",
  "hook.create": "added webhook", "hook.update": "edited webhook",
  "hook.rotate": "rotated webhook", "hook.delete": "deleted webhook",
  "message.delete": "deleted a message in",
};

const OWNER_PAGES = [
  { id: "general", icon: "edit", label: "Overview", blurb: "Name, icon, invite link — and your nickname here." },
  { id: "emoji", icon: "emoji", label: "Emoji", blurb: "Custom emotes — type :name: in chat." },
  { id: "roles", icon: "tag", label: "Roles", blurb: "Colored names and pills for the crew." },
  { id: "members", icon: "group", label: "Members", blurb: "Kick, ban, timeout, transfer — and who holds which role." },
  { id: "safety", icon: "lock", label: "Moderation", blurb: "Automod filters and the ban list." },
  { id: "engine", icon: "bolt", label: "Engine", blurb: "Shared LLM — every @summon here uses it first." },
  { id: "extras", icon: "star", label: "Extras", blurb: "Starboard threshold and the shareable template." },
  { id: "files", icon: "tray", label: "Workspaces", blurb: "Folders on this machine the crew's agents can edit." },
  { id: "audit", icon: "list", label: "Audit log", blurb: "Who did what — the last 500 events." },
];
const MEMBER_PAGES = [
  { id: "general", icon: "edit", label: "Overview", blurb: "The invite link and your nickname here." },
  { id: "emoji", icon: "emoji", label: "Emoji", blurb: "Custom emotes — type :name: in chat." },
];

export function ServerSettingsModal({ server, me, onClose, onSaved, onDeleted, onLeft, onKick, onBan, onTimeout, onTransfer, onOpenWorkspace, onNewWorkspace }) {
  const owner = server.owner_id === me?.id;
  const pages = owner ? OWNER_PAGES : MEMBER_PAGES;
  const [page, setPage] = useState("general");
  const cur = pages.find((p) => p.id === page) || pages[0];

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
  const [audit, setAudit] = useState(null);
  const [auditMore, setAuditMore] = useState(false);
  const [bans, setBans] = useState(null);
  const [tpl, setTpl] = useState(undefined);   // undefined=unfetched, null=none, {code,uses}
  const [tplCopied, setTplCopied] = useState(false);
  const [am, setAm] = useState({
    words: (server.automod?.words || []).join(", "),
    block_links: !!server.automod?.block_links,
    link_allow: (server.automod?.link_allow || []).join(", "),
    caps: !!server.automod?.caps_min_len,
    max_mentions: server.automod?.max_mentions || 0,
  });
  const [amMsg, setAmMsg] = useState("");
  const [wsList, setWsList] = useState(null);

  // page-scoped fetches — each owner page pulls its data when first opened
  useEffect(() => {
    if (owner && page === "files" && wsList === null)
      api.workspaces(server.id).then(setWsList).catch(() => setWsList([]));
  }, [owner, page, wsList, server.id]);
  useEffect(() => {
    if (owner && page === "audit" && audit === null) {
      api.serverAudit(server.id)
        .then((rows) => { setAudit(rows); setAuditMore(rows.length === 50); })
        .catch(() => setAudit([]));
    }
  }, [owner, page, audit, server.id]);
  useEffect(() => {
    if (owner && page === "safety" && bans === null)
      api.serverBans(server.id).then(setBans).catch(() => setBans([]));
  }, [owner, page, bans, server.id]);
  useEffect(() => {
    if (owner && page === "extras" && tpl === undefined) {
      api.getTemplate(server.id)
        .then((t) => setTpl(t.code ? t : null))
        .catch(() => setTpl(null));
    }
  }, [owner, page, tpl, server.id]);
  useEffect(() => {
    if (!owner || !server.llm_url) return;
    api.serverLlmTest(server.id)
      .then((r) => { if (r?.models?.length) setSrvModels(r.models); })
      .catch(() => {});
  }, [owner, server.id, server.llm_url]);

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
    if (s) { onSaved(s); setMsg("Saved."); }
  }
  async function regen() {
    const s = await api.regenInvite(server.id).catch((e) => (setMsg(e.message), null));
    if (s) { setCode(s.invite_code); setMsg("Invite rotated — the old code is dead."); }
  }

  function railBtn(p) {
    return (
      <button key={p.id} type="button" title={p.label} aria-label={p.label}
        aria-current={page === p.id ? "page" : undefined}
        className={page === p.id ? "on" : ""}
        onClick={() => setPage(p.id)}>
        <Ico n={p.icon} s={18} w={page === p.id ? "fill" : "regular"} />
      </button>
    );
  }

  return (
    <Modal className="settings-modal" bare onClose={onClose}>
      <div className="set-shell">
        <nav className="set-rail" aria-label="Server settings">
          {pages.slice(0, -1).map(railBtn)}
          <span className="set-rail-gap" />
          {railBtn(pages[pages.length - 1])}
        </nav>
        <div className="set-main">
          <div className="set-head">
            <div>
              <h3>{server.icon} {server.name} — {cur.label}</h3>
              <div className="msub">{cur.blurb}</div>
            </div>
            <button className="ghost modal-x" onClick={onClose} title="Close (Esc)">
              <Ico n="x" s={15} />
            </button>
          </div>
          <div className="set-body">

            {page === "general" && (
              <>
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
                {owner && (
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
                  </>
                )}
              </>
            )}

            {page === "emoji" && (
              <>
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
              </>
            )}

            {page === "roles" && owner && (
              <>
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
                <div className="idehint">Assign roles on the Members page — each member gets tappable role chips.</div>
              </>
            )}

            {page === "members" && owner && (
              <>
                <label>Members</label>
                <div style={{ maxHeight: "none", overflowY: "visible" }}>
                  {(server.members || []).map((m) => (
                    <div key={m.id} className="pack-agent" style={{ cursor: "default", flexWrap: "wrap" }}>
                      <span className="pk-ico big">{m.avatar_emoji}</span>
                      <div style={{ flex: 1 }}>
                        <b>{m.display_name}</b>
                        <div style={{ fontSize: 11, color: "var(--dim)" }}>
                          @{m.username}{m.id === server.owner_id ? " · owner" : ""}
                          {m.timeout_until > Date.now() / 1000 &&
                            <span className="to-badge" title="Timed out — can't post">
                              ⏱ {Math.ceil((m.timeout_until - Date.now() / 1000) / 60)}min</span>}
                        </div>
                      </div>
                      {m.id !== server.owner_id && <>
                        <span className="stat xfer" title={`Make ${m.display_name} the owner`}
                          onClick={() => onTransfer(m)}><Ico n="swap" s={13} /></span>
                        <span className="stat kick" title={`Kick ${m.display_name}`}
                          onClick={() => onKick(m)}><Ico n="x" s={11} /> kick</span>
                        <span className="stat kick" title={m.timeout_until > Date.now() / 1000
                              ? "Clear timeout" : `Time out ${m.display_name}`}
                          onClick={() => onTimeout(m)}>⏱</span>
                        <span className="stat kick" title={`Ban ${m.display_name} — blocks rejoin`}
                          onClick={() => onBan(m)}>🚫</span>
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
            )}

            {page === "safety" && owner && (
              <>
                <label><Ico n="lock" s={13} /> Automod{" "}
                  <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                    (blocks messages before they land — owner & bots exempt, blocks hit the audit log)</span></label>
                <textarea rows={2} value={am.words}
                  placeholder="blocked words — comma separated"
                  onChange={(e) => setAm({ ...am, words: e.target.value })} />
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center",
                  fontSize: 12.5, margin: "6px 0" }}>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", margin: 0 }}>
                    <input type="checkbox" checked={am.block_links}
                      onChange={(e) => setAm({ ...am, block_links: e.target.checked })} />
                    block links</label>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", margin: 0 }}>
                    <input type="checkbox" checked={am.caps}
                      onChange={(e) => setAm({ ...am, caps: e.target.checked })} />
                    block mostly-caps (10+ chars)</label>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", margin: 0 }}>
                    max mentions
                    <input type="number" min={0} max={25} value={am.max_mentions}
                      style={{ width: 54 }}
                      onChange={(e) => setAm({ ...am, max_mentions: Math.max(0, Math.min(25, +e.target.value || 0)) })} />
                    <span style={{ color: "var(--dim)", fontSize: 11 }}>(0 = off)</span></label>
                </div>
                {am.block_links && (
                  <input value={am.link_allow}
                    placeholder="allowed domains — e.g. github.com, discord.gg (blank = block all)"
                    onChange={(e) => setAm({ ...am, link_allow: e.target.value })} />
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={async () => {
                    const cfg = {
                      words: am.words.split(",").map((w) => w.trim()).filter(Boolean),
                      ...(am.block_links ? {
                        block_links: true,
                        link_allow: am.link_allow.split(",").map((d) => d.trim()).filter(Boolean),
                      } : {}),
                      ...(am.caps ? { caps_min_len: 10, caps_pct: 70 } : {}),
                      ...(am.max_mentions > 0 ? { max_mentions: am.max_mentions } : {}),
                    };
                    const s = await api.editServer(server.id, { automod: cfg })
                      .catch((e) => (setAmMsg(e.message), null));
                    if (s) { onSaved(s); setAmMsg("Saved — rules are live."); }
                  }}>Save rules</button>
                  {amMsg && <span className="idehint" style={{ alignSelf: "center" }}>{amMsg}</span>}
                </div>

                <label style={{ marginTop: 16 }}>Bans{" "}
                  <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                    (banned users can't rejoin)</span></label>
                <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 8 }}>
                  {bans === null && <div className="idehint">Loading…</div>}
                  {(bans || []).length === 0 && bans !== null && (
                    <div className="idehint">Nobody's banned — keep it that way.</div>)}
                  {(bans || []).map((b) => (
                    <div key={b.id} className="pack-agent" style={{ cursor: "default" }}>
                      <span className="pk-ico big">{b.avatar_emoji}</span>
                      <div style={{ flex: 1 }}>
                        <b>{b.display_name}</b>
                        <div style={{ fontSize: 11, color: "var(--dim)" }}>
                          @{b.username}{b.reason ? ` · ${b.reason}` : ""}</div>
                      </div>
                      <span className="stat xfer" title={`Unban ${b.display_name}`}
                        onClick={async () => {
                          await api.unbanMember(server.id, b.id).catch((e) => (setMsg(e.message), null));
                          setBans((x) => (x || []).filter((z) => z.id !== b.id));
                        }}><Ico n="plus" s={11} /> unban</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {page === "engine" && owner && (
              <>
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
              </>
            )}

            {page === "extras" && owner && (
              <>
                <label><Ico n="star" s={13} /> Starboard <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                  (stars needed to repost into #starboard — 0 = off)</span></label>
                <input type="number" min={0} max={20} value={thresh}
                  onChange={(e) => setThresh(Math.max(0, Math.min(20, +e.target.value || 0)))}
                  style={{ width: 80 }} />
                <div className="idehint" style={{ marginBottom: 8 }}>Saved with the Save button below.</div>
                <label>Server template <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                  (shareable snapshot — channels, roles, categories, automod rules)</span></label>
                {tpl === null && (
                  <button onClick={async () => {
                    const t = await api.saveTemplate(server.id)
                      .catch((e) => (setMsg(e.message), null));
                    if (t) { setTpl(t); setTplCopied(false); }
                  }}>Create template code</button>
                )}
                {tpl === undefined && <div className="idehint">Loading…</div>}
                {tpl && (
                    <div className="pack-agent" style={{ cursor: "default" }}>
                      <span className="pk-ico big">📋</span>
                      <div style={{ flex: 1 }}>
                        <b><code>{tpl.code}</code></b>
                        <div style={{ fontSize: 11, color: "var(--dim)" }}>
                          used {tpl.uses}× — anyone with this code clones the structure</div>
                      </div>
                      <span className="stat xfer" title="Copy template code" onClick={() => {
                        navigator.clipboard?.writeText(tpl.code);
                        setTplCopied(true); setTimeout(() => setTplCopied(false), 1200);
                      }}>{tplCopied ? "✓ copied" : "copy"}</span>
                      <span className="stat xfer" title="Re-snapshot current structure" onClick={async () => {
                        const t = await api.saveTemplate(server.id).catch((e) => (setMsg(e.message), null));
                        if (t) setTpl(t);
                      }}>sync</span>
                      <span className="stat kick" title="Delete template" onClick={async () => {
                        if (!confirm("Delete this template? Existing clones are unaffected.")) return;
                        await api.delTemplate(server.id).catch((e) => (setMsg(e.message), null));
                        setTpl(null);
                      }}><Ico n="x" s={11} /></span>
                    </div>
                )}
              </>
            )}

            {page === "files" && owner && (
              <>
                <label>🗂 Workspaces <span style={{ color: "var(--dim)", fontWeight: 400 }}>
                  (folders on this machine your crew and its agents can edit)</span></label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {wsList === null && <div className="idehint">Loading…</div>}
                  {(wsList || []).map((w) => (
                    <div key={w.id} className="pack-agent" style={{ cursor: "default" }}>
                      <span className="pk-ico big">{w.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{w.name}</b>
                        <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "ui-monospace, Consolas, monospace",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.root}</div>
                        <div style={{ fontSize: 11, color: "var(--dim)" }}>
                          {w.files} tracked file{w.files === 1 ? "" : "s"} · {w.grants.length} grant{w.grants.length === 1 ? "" : "s"}
                          {w.last && <> · last: {w.last.agent || w.last.actor || "?"} {w.last.action} {w.last.path}</>}
                        </div>
                      </div>
                      <span className="stat xfer" title="Open workspace"
                        onClick={() => onOpenWorkspace?.(w)}>open</span>
                      <span className="stat kick" title="Unlink (folder stays on disk)" onClick={async () => {
                        if (!confirm(`Unlink workspace "${w.name}"? The folder on disk is not touched.`)) return;
                        await api.delWorkspace(w.id).catch((e) => (setMsg(e.message), null));
                        setWsList((x) => (x || []).filter((z) => z.id !== w.id));
                      }}><Ico n="x" s={11} /></span>
                    </div>
                  ))}
                  {wsList && wsList.length === 0 && (
                    <div className="idehint">
                      No workspaces yet — link a folder and agents summoned in a wired channel can read and edit it.
                    </div>
                  )}
                  <button onClick={() => onNewWorkspace?.()}><Ico n="plus" s={12} /> link a folder</button>
                </div>
              </>
            )}

            {page === "audit" && owner && (
              <div style={{ maxHeight: "none", overflowY: "visible" }}>
                {audit === null && <div className="idehint">Loading…</div>}
                {(audit || []).length === 0 && audit !== null && (
                  <div className="idehint">Nothing yet — kicks, edits, hooks and channel changes land here.</div>)}
                {(audit || []).map((r) => (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "baseline", gap: 7, padding: "3px 2px",
                    fontSize: 12, borderBottom: "1px solid var(--border)"
                  }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{r.actor?.avatar_emoji}</span>
                    <b style={{ flexShrink: 0 }}>{r.actor?.display_name}</b>
                    <span style={{ color: "var(--dim)", flexShrink: 0 }}>
                      {AUDIT_LABEL[r.action] || r.action}</span>
                    {r.target && <b style={{ flexShrink: 0, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.target}</b>}
                    {r.detail && <span style={{ color: "var(--dim)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.detail}>{r.detail}</span>}
                    <span style={{ color: "var(--dim)", fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }}>
                      {timeAgo(r.created_at)}</span>
                  </div>
                ))}
                {auditMore && (
                  <button className="ghost" style={{ fontSize: 11, marginTop: 6 }} onClick={async () => {
                    const older = await api.serverAudit(server.id, audit[audit.length - 1].id).catch(() => []);
                    setAudit((a) => [...(a || []), ...older]);
                    setAuditMore(older.length === 50);
                  }}>load older</button>
                )}
              </div>
            )}

            {!owner && page === "general" && (
              <div className="msub" style={{ marginTop: 14 }}>
                You can rejoin anytime with the invite code — leaving is one click in the footer.
              </div>
            )}
          </div>

          {msg && <div style={{ color: "var(--dim)", margin: "0 20px", fontSize: 12.5 }}>{msg}</div>}
          <div className="set-foot">
            {owner
              ? <button className="danger" onClick={() => onDeleted(server)}><Ico n="trash" s={13} /> Delete team</button>
              : <button className="danger" onClick={() => onLeft(server)}><Ico n="leave" s={13} /> Leave team</button>}
            <span style={{ flex: 1 }} />
            <button onClick={onClose}>Close</button>
            {owner && <button className="primary" onClick={save} disabled={!name.trim()}>Save</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
