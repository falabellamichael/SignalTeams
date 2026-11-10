import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { EMOJI_CHOICES, Modal } from "./_shared.jsx";

/* ------------------------------------------------------------------
   1. Incoming Webhooks Section (for Integrations tab)
------------------------------------------------------------------ */
function WebhookSection({ channel }) {
  const [hooks, setHooks] = useState(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🪝");
  const [copied, setCopied] = useState(0);
  const [showCurl, setShowCurl] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.webhooks(channel.id).then(setHooks).catch((e) => setErr(e.message));
  }, [channel.id]);

  const urlFor = (h) => `${location.origin}/api/hooks/${h.token}`;

  async function add() {
    const n = name.trim();
    if (!n) return;
    const h = await api.createWebhook(channel.id, n, icon).catch((e) => (setErr(e.message), null));
    if (h) { setHooks((hs) => [...(hs || []), h]); setName(""); setErr(""); }
  }

  async function rotate(h) {
    const r = await api.editWebhook(h.id, { rotate: true }).catch((e) => (setErr(e.message), null));
    if (r) setHooks((hs) => hs.map((x) => (x.id === h.id ? r : x)));
  }

  async function remove(h) {
    if (!confirm(`Delete webhook "${h.name}"? Its URL stops working immediately.`)) return;
    await api.delWebhook(h.id).catch((e) => (setErr(e.message), null));
    setHooks((hs) => hs.filter((x) => x.id !== h.id));
  }

  return (
    <div className="set-section">
      <div className="set-row-title">
        <b>Incoming Webhooks</b>
        <span className="d">External services can POST messages into #{channel.name} ({(hooks || []).length}/10)</span>
      </div>
      {(hooks || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
          {hooks.map((h) => (
            <div key={h.id} style={{
              padding: "8px 12px", borderRadius: 8, background: "var(--panel2)",
              border: "1px solid var(--border)", fontSize: 12
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>{h.icon}</span>
                <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</b>
                <span style={{ color: "var(--dim)", fontSize: 11 }}>
                  {h.uses} post{h.uses === 1 ? "" : "s"}</span>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px" }}
                  title="Copy hook URL"
                  onClick={() => {
                    navigator.clipboard?.writeText(urlFor(h));
                    setCopied(h.id); setTimeout(() => setCopied(0), 1500);
                  }}>
                  <Ico n="copy" s={11} /> {copied === h.id ? "copied!" : "URL"}
                </button>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px" }}
                  title="Rotate token — old URL dies" onClick={() => rotate(h)}>
                  <Ico n="refresh" s={11} />
                </button>
                <button type="button" className="ghost" style={{ fontSize: 11, padding: "2px 7px", color: "var(--bad)" }}
                  title="Delete webhook" onClick={() => remove(h)}>
                  <Ico n="trash" s={11} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center" }}>
                <span style={{ color: "var(--dim)", fontSize: 10.5, fontFamily: "ui-monospace, Consolas, monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {urlFor(h)}</span>
                <button type="button" className="ghost" style={{ fontSize: 10.5, padding: "1px 6px" }}
                  onClick={() => setShowCurl(showCurl === h.id ? 0 : h.id)}>
                  {showCurl === h.id ? "hide curl" : "curl"}
                </button>
              </div>
              {showCurl === h.id && (
                <pre style={{
                  margin: "6px 0 0", padding: "7px 9px", borderRadius: 7, fontSize: 10.5,
                  background: "var(--bg)", border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--dim)"
                }}>{`curl -X POST "${urlFor(h)}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "hello from CI 🚀"}'`}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {hooks && hooks.length === 0 && (
        <div className="idehint" style={{ margin: "10px 0" }}>
          No webhooks yet — mint one and your CI, monitors, or scripts can post straight into this channel.
          Discord {`{content}`} and Slack {`{text}`} payloads both work.
        </div>
      )}
      {err && <div className="idehint" style={{ color: "var(--bad)", margin: "6px 0" }}>{err}</div>}
      <div className="mrow" style={{ marginTop: 10 }}>
        <div>
          <input value={name} maxLength={48} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="new hook name — e.g. deploy-bot" />
        </div>
        <div style={{ maxWidth: 76 }}>
          <select value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="🪝">🪝</option>
            {EMOJI_CHOICES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 86 }}>
          <button type="button" onClick={add} disabled={!name.trim() || (hooks || []).length >= 10}>
            <Ico n="plus" s={12} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   2. Scheduled Digest Section (for Agents tab)
------------------------------------------------------------------ */
const DIGEST_IVS = [
  [900, "every 15 min"], [3600, "hourly"], [21600, "every 6 hours"],
  [86400, "daily"], [604800, "weekly"]
];
const ivLabel = (s) => (DIGEST_IVS.find(([v]) => v === s) || [0, `every ${Math.round(s / 60)}m`])[1];

function DigestSection({ channel }) {
  const [dj, setDj] = useState(channel.digest || null);
  const [agents, setAgents] = useState([]);
  const [aid, setAid] = useState(channel.digest?.agent_id || 0);
  const [iv, setIv] = useState(channel.digest?.interval_secs || 86400);
  const [err, setErr] = useState("");
  useEffect(() => { api.agents({ sort: "name" }).then(setAgents).catch(() => {}); }, []);

  async function save() {
    const c = await api.setDigest(channel.id, { agent_id: aid || null, interval_secs: +iv })
      .catch((e) => (setErr(e.message), null));
    if (c) { setDj(c.digest || null); setErr(""); }
  }

  async function remove() {
    await api.delDigest(channel.id).catch((e) => setErr(e.message));
    setDj(null);
  }

  const next = dj ? Math.max(0, Math.round((dj.last_run + dj.interval_secs - Date.now() / 1000) / 60)) : 0;
  return (
    <div className="set-section" style={{ marginTop: 14 }}>
      <div className="set-row-title">
        <b>Scheduled Agent Digest</b>
        <span className="d">Automated AI recap posted on a schedule — quiet intervals are skipped.</span>
      </div>
      {dj && (
        <div className="idehint" style={{ margin: "8px 0" }}>
          Active — {dj.agent_icon || "📅"} <b>{dj.agent_name || "Digest bot"}</b> · {ivLabel(dj.interval_secs)}
          · next in ~{next < 60 ? `${next}m` : next < 1440 ? `${Math.round(next / 60)}h` : `${Math.round(next / 1440)}d`}
        </div>
      )}
      {err && <div className="idehint" style={{ color: "var(--bad)", margin: "6px 0" }}>{err}</div>}
      <div className="mrow" style={{ marginTop: 8 }}>
        <div>
          <select value={aid} onChange={(e) => setAid(+e.target.value)}>
            <option value={0}>📅 Digest bot</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon || "🤖"} {a.name}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 130 }}>
          <select value={iv} onChange={(e) => setIv(+e.target.value)}>
            {DIGEST_IVS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 96, display: "flex", gap: 4 }}>
          <button type="button" onClick={save}>{dj ? "Update" : "Enable"}</button>
          {dj && <button type="button" className="danger" onClick={remove}>Off</button>}
        </div>
      </div>
    </div>
  );
}

const row = (label, hint, ctl) => (
  <div className="set-row">
    <div className="lab">{label}<div className="d">{hint}</div></div>
    {ctl}
  </div>
);

/* ------------------------------------------------------------------
   3. Channel Create Modal (Compact dialog for new channels)
------------------------------------------------------------------ */
export function ChannelCreateModal({ kind, me, roles = [], categories = [], presetCategory = "", onClose, onDone }) {
  const [selKind, setSelKind] = useState(kind || "text");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [catSel, setCatSel] = useState(() => {
    if (presetCategory) return categories.includes(presetCategory) ? presetCategory : "__new__";
    return categories.length ? "" : "__new__";
  });
  const [catNew, setCatNew] = useState(() => {
    return presetCategory && !categories.includes(presetCategory) ? presetCategory : "";
  });
  const category = catSel === "__new__" ? catNew.trim() : catSel;
  const [roleId, setRoleId] = useState(0);

  const CHAN_TYPES = [
    { id: "text", icon: "hash", label: "Text", blurb: "Chat, threads & files" },
    { id: "voice", icon: "speaker", label: "Voice", blurb: "Talk, video & screen share" },
    { id: "forum", icon: "article", label: "Forum", blurb: "Titled posts, threaded replies" },
  ];

  return (
    <Modal className="chan-modal"
      title={`New ${selKind === "agents" ? "agent" : selKind === "forum" ? "forum" : selKind === "voice" ? "voice" : "text"} channel`}
      onClose={onClose}
      sub={selKind === "agents" ? "Agent channels highlight shared agent cards — pick residents to pin."
        : selKind === "voice" ? "Hang out together with voice, video, screen share, and soundboard."
        : selKind === "forum" ? "Titled posts with threaded replies — like Discord forums."
        : "Plain text chat, media, threads, and agent summons."}>
      <div className="set-body">
        {kind !== "agents" && (
          <div className="chan-types" role="radiogroup" aria-label="Channel type">
            {CHAN_TYPES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={selKind === t.id}
                className={selKind === t.id ? "on" : ""} onClick={() => setSelKind(t.id)}>
                <span className="ct-ico"><Ico n={t.icon} s={17} /></span>
                <b>{t.label}</b>
                <span className="ct-d">{t.blurb}</span>
              </button>
            ))}
          </div>
        )}

        {row("Channel name", "Shown in the sidebar — keep it short.",
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder={selKind === "agents" ? "agent-drops" : selKind === "voice" ? "General Voice" : selKind === "forum" ? "showcase" : "general"} />)}

        {row("Topic", "A one-line description under the channel name.",
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="optional" />)}

        {categories.length > 0
          ? row("Category", "Put it under an existing group, or start a new one.",
              <div className="cat-ctl">
                <select value={catSel} onChange={(e) => setCatSel(e.target.value)}>
                  <option value="">no category</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">＋ new category…</option>
                </select>
                {catSel === "__new__" && (
                  <input value={catNew} onChange={(e) => setCatNew(e.target.value)}
                    placeholder="new category name" maxLength={48} autoFocus />)}
              </div>)
          : row("Category", "Optional — groups channels in the sidebar.",
              <input value={catNew} onChange={(e) => setCatNew(e.target.value)}
                placeholder="e.g. projects, fun" maxLength={48} />)}

        {(roles || []).length > 0 && row(
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Ico n="lock" s={12} /> Visible to</span>,
          "Role-gated — the server owner always has access.",
          <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
            <option value={0}>everyone (@everyone)</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>)}
      </div>

      <div className="set-foot">
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()}
          onClick={() => onDone(name.trim(), selKind, topic.trim(), [], category.trim(), 0, 0, roleId, [], [], 0)}>
          Create channel
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------
   4. Channel Settings Overlay Modal (Full shell: Icon Rail + Pages)
------------------------------------------------------------------ */
const CHAN_PAGES = [
  { id: "overview", icon: "edit", label: "Overview", blurb: "Channel name, topic, and category grouping." },
  { id: "perms", icon: "lock", label: "Permissions", blurb: "Role-based visibility — gate who can see and talk here." },
  { id: "integrations", icon: "link", label: "Integrations", blurb: "Incoming webhooks — let external services post into this channel." },
  { id: "agents", icon: "sparkle", label: "Agents", blurb: "Resident agents, auto-replies, and scheduled recaps." },
];

export function ChannelSettingsModal({ channel, me, roles = [], workspaces = [], categories = [], onClose, onDone, onDelete }) {
  const [page, setPage] = useState("overview");
  const [name, setName] = useState(channel.name || "");
  const [topic, setTopic] = useState(channel.topic || "");
  const [catSel, setCatSel] = useState(() => {
    const init = channel.category || "";
    if (init) return categories.includes(init) ? init : "__new__";
    return categories.length ? "" : "__new__";
  });
  const [catNew, setCatNew] = useState(() => {
    const init = channel.category || "";
    return init && !categories.includes(init) ? init : "";
  });
  const category = catSel === "__new__" ? catNew.trim() : catSel;
  const [slow, setSlow] = useState(channel.slowmode_secs || 0);
  const [vcap, setVcap] = useState(channel.voice_cap || 0);
  const [roleId, setRoleId] = useState(channel.role_id || 0);
  const [picked, setPicked] = useState(new Set((channel.roster || []).map((a) => a.id)));
  const [lurk, setLurk] = useState(new Set(channel.lurkers || []));
  const [ftags, setFtags] = useState((channel.forum_tags || []).join(", "));
  const [wsId, setWsId] = useState(channel.workspace_id || 0);
  const [agents, setAgents] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    api.agents({ sort: "name" }).then((all) =>
      setAgents([...all].sort((a, b) => (a.owner_id === me?.id ? 0 : 1) - (b.owner_id === me?.id ? 0 : 1)))
    ).catch(() => {});
  }, [me?.id]);

  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleLurk = (id) => setLurk((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pages = (workspaces.length > 0 || channel.workspace_id)
    ? [...CHAN_PAGES, { id: "workspace", icon: "tray", label: "Workspace", blurb: "Folder on this host agents summoned here can read & edit." }]
    : CHAN_PAGES;

  const cur = pages.find((p) => p.id === page) || pages[0];

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

  const kindLabel = channel.kind === "agents" ? "Agent channel"
    : channel.kind === "voice" ? "Voice channel"
    : channel.kind === "forum" ? "Forum channel"
    : "Text channel";

  const kindIcon = channel.kind === "agents" ? "✦"
    : channel.kind === "voice" ? "🔊"
    : channel.kind === "forum" ? "📋"
    : "#";

  function handleSave() {
    onDone(
      name.trim(),
      channel.kind,
      topic.trim(),
      [...picked],
      category.trim(),
      slow,
      vcap,
      roleId,
      [...lurk].filter((id) => picked.has(id)),
      ftags.split(",").map((t) => t.trim()).filter(Boolean),
      wsId
    );
  }

  return (
    <Modal className="settings-modal" bare onClose={onClose}>
      <div className="set-shell">
        <nav className="set-rail" aria-label="Channel settings">
          {pages.map(railBtn)}
        </nav>

        <div className="set-main">
          <div className="set-head">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <h3>{cur.label}</h3>
                <span className="badge" style={{ fontSize: 11, padding: "2px 8px", background: "var(--panel2)", borderRadius: 12 }}>
                  {kindIcon} {channel.name} · {kindLabel}
                </span>
              </div>
              <div className="msub">{cur.blurb}</div>
            </div>
            <button className="ghost modal-x" onClick={onClose} title="Close (Esc)">
              <Ico n="x" s={15} />
            </button>
          </div>

          <div className="set-body">
            {page === "overview" && (
              <>
                {row("Channel name", "Displayed in the sidebar channel navigation.",
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />)}

                {row("Channel topic", "Shown in the header bar of the channel view.",
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="optional" />)}

                {categories.length > 0
                  ? row("Category", "Collapsible category group in the sidebar.",
                      <div className="cat-ctl">
                        <select value={catSel} onChange={(e) => setCatSel(e.target.value)}>
                          <option value="">no category</option>
                          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                          <option value="__new__">＋ new category…</option>
                        </select>
                        {catSel === "__new__" && (
                          <input value={catNew} onChange={(e) => setCatNew(e.target.value)}
                            placeholder="new category name" maxLength={48} autoFocus />)}
                      </div>)
                  : row("Category", "Optional — groups channels in the sidebar.",
                      <input value={catNew} onChange={(e) => setCatNew(e.target.value)}
                        placeholder="e.g. projects, fun" maxLength={48} />)}

                {channel.kind !== "agents" && (
                  <>
                    {row("Slowmode", "Seconds members must wait between messages (0 = off).",
                      <input type="number" min={0} max={21600} value={slow}
                        onChange={(e) => setSlow(Math.max(0, Math.min(+e.target.value || 0, 21600)))} />)}
                  </>
                )}

                {channel.kind === "voice" && (
                  row("Voice cap", "Maximum concurrent users allowed in the room (0 = unlimited).",
                    <input type="number" min={0} max={99} value={vcap}
                      onChange={(e) => setVcap(Math.max(0, Math.min(+e.target.value || 0, 99)))} />)
                )}

                {channel.kind === "forum" && (
                  row("Post tags", "Comma-separated tag choices for forum posters.",
                    <input value={ftags} onChange={(e) => setFtags(e.target.value)}
                      placeholder="bug, feature, question" maxLength={200} />)
                )}
              </>
            )}

            {page === "perms" && (
              <>
                {row(
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Ico n="lock" s={13} /> Role gate
                  </span>,
                  "Restrict channel visibility to a specific role. Server owner always gets in.",
                  <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
                    <option value={0}>@everyone (Public to all members)</option>
                    {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}

                <div className="idehint" style={{ marginTop: 12 }}>
                  {roleId === 0 ? (
                    <span>🌍 <b>Public Channel:</b> All team members can see this channel and post messages.</span>
                  ) : (
                    <span>🔒 <b>Private Role-Gated:</b> Only members holding the <b>{roles.find((r) => r.id === roleId)?.name || "specified"}</b> role (and the server owner) can view and chat here.</span>
                  )}
                </div>

                {category && (
                  <div className="idehint" style={{ marginTop: 8 }}>
                    📁 This channel belongs to the <b>{category}</b> category. You can also sync role gates across all channels from the category settings overlay.
                  </div>
                )}
              </>
            )}

            {page === "integrations" && (
              <WebhookSection channel={channel} />
            )}

            {page === "agents" && (
              <>
                <div className="set-row-title">
                  <b>Resident Agents</b>
                  <span className="d">Pin agents to this channel's header so members can quickly summon them.</span>
                </div>
                <div className="pack-pick" style={{ maxHeight: 180, overflowY: "auto", margin: "10px 0" }}>
                  {agents.map((a) => (
                    <div key={a.id} className={`pack-agent ${picked.has(a.id) ? "on" : ""}`}
                      onClick={() => toggle(a.id)}>
                      <span className="pk-ico big">{a.icon || "🤖"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{a.name}</b> <span className="ver">{a.owner?.display_name}</span>
                      </div>
                      {picked.has(a.id) && (
                        <span className={`lurk-chip ${lurk.has(a.id) ? "on" : ""}`}
                          title={lurk.has(a.id) ? "Lurking — auto-replies to new messages" : "Click to let it lurk"}
                          onClick={(e) => { e.stopPropagation(); toggleLurk(a.id); }}>⚡ lurks</span>
                      )}
                      <span className="stat">{picked.has(a.id) ? <Ico n="check" s={13} /> : ""}</span>
                    </div>
                  ))}
                  {agents.length === 0 && <div className="idehint">No agents visible.</div>}
                </div>
                {[...picked].some((id) => lurk.has(id)) && (
                  <div className="idehint" style={{ marginTop: 4 }}>
                    ⚡ Lurkers auto-reply to messages — one per message, ~60s cooldown each.
                  </div>
                )}

                <DigestSection channel={channel} />
              </>
            )}

            {page === "workspace" && (
              <>
                {row("🗂 Linked Workspace",
                  "Summoned agents can read and write files inside this linked host directory.",
                  <select value={wsId} onChange={(e) => setWsId(+e.target.value)}>
                    <option value={0}>none — chat only</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>{w.icon} {w.name} — {w.root}</option>
                    ))}
                  </select>
                )}
                <div className="idehint" style={{ marginTop: 12 }}>
                  Agents inherit the summoner's workspace access level (read, write, or admin). File writes create rollback revisions in the workspace history.
                </div>
              </>
            )}
          </div>

          <div className="set-foot">
            {!confirmDel ? (
              <button className="danger" onClick={() => setConfirmDel(true)}>
                <Ico n="trash" s={13} /> Delete channel
              </button>
            ) : (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: "var(--bad)" }}>Delete permanently?</span>
                <button className="danger" onClick={() => onDelete(channel)}>Yes, delete</button>
                <button className="ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!name.trim()} onClick={handleSave}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------
   5. Category Settings Overlay Modal (Full shell: Icon Rail + Pages)
------------------------------------------------------------------ */
const CAT_PAGES = [
  { id: "overview", icon: "edit", label: "Overview", blurb: "Category name and channel arrangement." },
  { id: "perms", icon: "lock", label: "Permissions", blurb: "Role-based visibility — sync access across member channels." },
];

export function CategorySettingsModal({ server, category = "", isNew = false, roles = [], onClose, onSave, onDelete, onAddChannel, onMoveChannel, onEditChannel }) {
  const [page, setPage] = useState("overview");
  const [name, setName] = useState(category || "");
  const [roleId, setRoleId] = useState(0);
  const [syncRoles, setSyncRoles] = useState(false);
  const [delChoice, setDelChoice] = useState(null); // null | "prompt"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [uncatPicked, setUncatPicked] = useState(new Set());
  const [starterChan, setStarterChan] = useState("general");

  // Channels under this category
  const allChannels = server?.channels || [];
  const channelsInCat = allChannels.filter(
    (c) => c.category === category && (c.kind === "text" || c.kind === "voice" || c.kind === "forum")
  ).sort((a, b) => (a.position || 0) - (b.position || 0));

  const uncategorized = allChannels.filter(
    (c) => !c.category && (c.kind === "text" || c.kind === "voice" || c.kind === "forum")
  );

  // Derive common role if any
  useEffect(() => {
    if (channelsInCat.length > 0) {
      const firstRole = channelsInCat[0].role_id || 0;
      const allMatch = channelsInCat.every((c) => (c.role_id || 0) === firstRole);
      if (allMatch) setRoleId(firstRole);
    }
  }, [category]);

  const allSynced = channelsInCat.length > 0 && channelsInCat.every((c) => (c.role_id || 0) === roleId);

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

  const cur = CAT_PAGES.find((p) => p.id === page) || CAT_PAGES[0];

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true); setMsg("");
    const channelIds = isNew ? [...uncatPicked] : undefined;
    const starter = isNew && (!channelIds || channelIds.length === 0) ? (starterChan.trim() || "general") : null;
    await onSave(category, trimmed, roleId, syncRoles, channelIds, starter);
    setBusy(false);
    onClose();
  }

  async function handleDelete(deleteChannels) {
    if (!category) return;
    setBusy(true);
    await onDelete(category, deleteChannels);
    setBusy(false);
    onClose();
  }

  const toggleUncat = (id) => setUncatPicked((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <Modal className="settings-modal" bare onClose={onClose}>
      <div className="set-shell">
        <nav className="set-rail" aria-label="Category settings">
          {CAT_PAGES.map(railBtn)}
        </nav>

        <div className="set-main">
          <div className="set-head">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <h3>{cur.label}</h3>
                <span className="badge" style={{ fontSize: 11, padding: "2px 8px", background: "var(--panel2)", borderRadius: 12 }}>
                  📁 {name.trim() || (isNew ? "New Category" : "Category")}
                </span>
              </div>
              <div className="msub">{cur.blurb}</div>
            </div>
            <button className="ghost modal-x" onClick={onClose} title="Close (Esc)">
              <Ico n="x" s={15} />
            </button>
          </div>

          <div className="set-body">
            {page === "overview" && (
              <>
                {row("Category name", "Shown in uppercase header above channels in the sidebar.",
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. PROJECTS, FUN, WORK" maxLength={48} autoFocus />)}

                {!isNew && (
                  <div className="set-section" style={{ marginTop: 16 }}>
                    <div className="set-row-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <b>Channels in this Category ({channelsInCat.length})</b>
                        <div className="d">Reorder or inspect channels grouped under {category}.</div>
                      </div>
                      <button type="button" className="ghost" style={{ fontSize: 11 }}
                        onClick={() => { onClose(); onAddChannel?.("text", category); }}>
                        <Ico n="plus" s={11} /> New channel
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
                      {channelsInCat.map((c, i) => (
                        <div key={c.id} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                          borderRadius: 7, background: "var(--panel2)", border: "1px solid var(--border)",
                          fontSize: 12.5
                        }}>
                          <span style={{ color: "var(--dim)" }}>
                            {c.kind === "voice" ? "🔊" : c.kind === "forum" ? "📋" : c.kind === "agents" ? "✦" : "#"}
                          </span>
                          <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</b>
                          {c.role_id > 0 && (
                            <span style={{ fontSize: 10.5, color: "var(--dim)", background: "var(--bg)", padding: "1px 6px", borderRadius: 4 }}>
                              <Ico n="lock" s={10} /> {roles.find((r) => r.id === c.role_id)?.name || "role"}
                            </span>
                          )}
                          <button type="button" className="ghost" title="Move up" style={{ padding: "2px 5px" }}
                            disabled={i === 0} onClick={() => onMoveChannel?.(c, -1)}>
                            <Ico n="up" s={11} />
                          </button>
                          <button type="button" className="ghost" title="Move down" style={{ padding: "2px 5px" }}
                            disabled={i === channelsInCat.length - 1} onClick={() => onMoveChannel?.(c, 1)}>
                            <Ico n="down" s={11} />
                          </button>
                          <button type="button" className="ghost" title="Channel settings" style={{ padding: "2px 5px" }}
                            onClick={() => { onClose(); onEditChannel?.(c); }}>
                            <Ico n="gear" s={11} />
                          </button>
                        </div>
                      ))}
                      {channelsInCat.length === 0 && (
                        <div className="idehint">No channels currently grouped under this category.</div>
                      )}
                    </div>
                  </div>
                )}

                {isNew && (
                  row("Starter channel", "A channel to start this category with (or select existing ones below).",
                    <input value={starterChan} onChange={(e) => setStarterChan(e.target.value)}
                      placeholder="e.g. general" maxLength={48} disabled={uncatPicked.size > 0} />)
                )}

                {isNew && uncategorized.length > 0 && (
                  <div className="set-section" style={{ marginTop: 16 }}>
                    <div className="set-row-title">
                      <b>Add Existing Channels to this Category</b>
                      <div className="d">Check any channels to move them out of root and into this category.</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                      {uncategorized.map((c) => (
                        <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5 }}>
                          <input type="checkbox" checked={uncatPicked.has(c.id)} onChange={() => toggleUncat(c.id)}
                            style={{ width: "auto" }} />
                          <span>{c.kind === "voice" ? "🔊" : c.kind === "forum" ? "📋" : "#"} {c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {page === "perms" && (
              <>
                {row(
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Ico n="lock" s={13} /> Category role gate
                  </span>,
                  "Default role required to see channels in this category.",
                  <select value={roleId} onChange={(e) => setRoleId(+e.target.value)}>
                    <option value={0}>@everyone (Public to all)</option>
                    {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}

                {!isNew && channelsInCat.length > 0 && (
                  <div className="set-section" style={{ marginTop: 14 }}>
                    <div className="set-row">
                      <div className="lab">
                        Sync permissions to member channels
                        <div className="d">
                          Apply this role gate to all {channelsInCat.length} channel{channelsInCat.length === 1 ? "" : "s"} in this category.
                        </div>
                      </div>
                      <button type="button" className={syncRoles ? "primary" : ""}
                        onClick={() => setSyncRoles((v) => !v)}>
                        <Ico n={syncRoles ? "check" : "refresh"} s={12} /> {syncRoles ? "Will sync on save" : "Sync to all"}
                      </button>
                    </div>

                    <div className="idehint" style={{ marginTop: 10 }}>
                      {allSynced ? (
                        <span>✓ All <b>{channelsInCat.length}</b> channels in this category currently match this role gate.</span>
                      ) : (
                        <span>⚠️ Permissions currently differ across member channels. Enable "Sync to all" to align every channel to this role gate.</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {msg && <div style={{ color: "var(--bad)", margin: "0 20px", fontSize: 12 }}>{msg}</div>}

          <div className="set-foot">
            {!isNew && category && (
              !delChoice ? (
                <button className="danger" onClick={() => setDelChoice("prompt")}>
                  <Ico n="trash" s={13} /> Delete category
                </button>
              ) : (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: "var(--bad)" }}>Delete category:</span>
                  <button className="danger" onClick={() => handleDelete(false)} title="Move channels to uncategorized">
                    Keep channels
                  </button>
                  <button className="danger" onClick={() => handleDelete(true)} title="Delete all channels in this category">
                    Delete channels too
                  </button>
                  <button className="ghost" onClick={() => setDelChoice(null)}>Cancel</button>
                </div>
              )
            )}
            <span style={{ flex: 1 }} />
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary" disabled={!name.trim() || busy} onClick={handleSave}>
              {isNew ? "Create category" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------
   6. Smart Export: ChannelModal dispatches to overlay when editing
------------------------------------------------------------------ */
export function ChannelModal(props) {
  if (props.channel) {
    return <ChannelSettingsModal {...props} />;
  }
  return <ChannelCreateModal {...props} />;
}

export const CategoryModal = CategorySettingsModal;
