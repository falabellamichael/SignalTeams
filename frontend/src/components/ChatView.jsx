import React, { useEffect, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { sendWS } from "../ws";
import { Avatar, Md, agentSlug, msgDay, msgTime, timeAgo, hasSearchQuery } from "../util";
import { AgentShareCard, PackShareCard } from "./AgentCard";
import { onVoice, joinVoice, leaveVoice, toggleVoiceMute, toggleDeafen, toggleShare, toggleCam, askVoiceRoster } from "../voice";

const QUICK = ["👍", "❤️", "😂", "🔥", "🐝", "⭐", "😮"];
const EMOJI_PICK = [
  "😀", "😄", "😂", "🤣", "😊", "😉", "😍", "😘", "🤔", "🤨", "😮", "😴",
  "😎", "🥳", "😭", "😤", "🤯", "🥺", "😬", "🙃", "🫡", "🤝",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "✍️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✨", "🔥", "💥",
  "🎉", "🎊", "🏆", "🥇", "🎯", "🚀", "🐝", "📡", "🤖", "🧠", "🍯", "☕", "🍕", "🎮", "📌", "🧵",
];

const POLL_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

function Message({ m, grouped, me, members, agents, emojis, roles, channels, onAgentOpen, onPackOpen, onDelete, onReact, onPin, onImgLoad, onReply, onUserOpen, onFwdJump, onThread, onMenu, onLightbox, blocked }) {
  const emap = new Map((emojis || []).map((x) => [x.name, x.file_id]));
  const mine = m.author?.id === me?.id;
  const nickOf = (u) => (members || []).find((x) => x?.id === u?.id)?.nickname || u?.display_name;
  const topRole = (u) => {
    const ids = (members || []).find((x) => x?.id === u?.id)?.role_ids || [];
    return (roles || []).find((r) => ids.includes(r.id));
  };
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(m.content);
  const [revealed, setRevealed] = useState(false);
  const pressT = useRef(null);

  async function saveEdit() {
    const v = editDraft.trim();
    if (!v || v === m.content) { setEditing(false); return; }
    setEditing(false);
    await api.editMessage(m.id, v).catch((e) => alert(e.message));
  }

  if (blocked?.has?.(m.author?.id) && !revealed) {
    return (
      <div className="msg blocked-msg" id={"msg-" + m.id} title="Click to show"
        onClick={() => setRevealed(true)}>
        <div className="body">
          <span className="blocked-line">🚫 <b>{nickOf(m.author) || "Blocked user"}</b> — blocked message</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`msg ${grouped ? "grouped" : ""}`} id={"msg-" + m.id}
      onContextMenu={(e) => { if (onMenu) { e.preventDefault(); onMenu(e.clientX, e.clientY, m, setEditing); } }}
      onTouchStart={(e) => {
        if (!onMenu) return;
        const t = e.touches[0];
        pressT.current = setTimeout(() => onMenu(t.clientX, t.clientY, m, setEditing), 480);
      }}
      onTouchEnd={() => clearTimeout(pressT.current)}
      onTouchMove={() => clearTimeout(pressT.current)}>
      {grouped
        ? <div className="gtime">{msgTime(m.created_at)}</div>
        : <span style={{ cursor: "pointer" }} onClick={() => m.author && onUserOpen?.(m.author)}>
            <Avatar user={m.author} size="sm" /></span>}
      <div className="body">
        {m.reply && (
          <div className="reply-quote" title={m.reply.content}>
            ↩ <b>{nickOf(m.reply.author) || "deleted message"}</b>
            {m.reply.content ? ` ${m.reply.content}` : ""}
          </div>
        )}
        {m.fwd && (
          <div className="fwd-tag" title="Jump to original"
            onClick={() => m.fwd.channel_id && onFwdJump?.(m.fwd.channel_id, m.fwd.server_id, m.fwd.msg_id)}>
            ↪ forwarded from <b>{nickOf(m.fwd.author) || "?"}</b>
            {m.fwd.channel && m.fwd.channel !== "deleted"
              ? <> in <span className="fwd-where">{m.fwd.dm ? "@" : "#"}{m.fwd.channel}</span></> : ""}
          </div>
        )}
        {!grouped && (
          <div className="meta">
            <span className="author" style={{ color: topRole(m.author)?.color || m.author?.avatar_color }}
              title={nickOf(m.author) !== m.author?.display_name ? `@${m.author?.username}` : undefined}>
              {nickOf(m.author)}</span>
            <span className="time">{timeAgo(m.created_at)}</span>
            {m.edited_at && <span className="edited" title={new Date(m.edited_at * 1000).toLocaleString()}>(edited)</span>}
            {m.pinned ? <span className="pin-flag" title="Pinned">📌</span> : null}
            <button className="del-msg" title={m.pinned ? "Unpin" : "Pin"}
              onClick={() => onPin(m)}><Ico n="pin" s={12} /></button>
            {mine && m.content &&
              <button className="del-msg" title="Edit" onClick={() => { setEditDraft(m.content); setEditing(true); }}><Ico n="edit" s={12} /></button>}
            {mine && <button className="del-msg" title="Delete" onClick={() => onDelete(m)}><Ico n="x" s={12} /></button>}
          </div>
        )}
        {editing ? (
          <div className="edit-row">
            <textarea autoFocus value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") setEditing(false);
              }} />
            <div style={{ fontSize: 10.5, color: "var(--dim)", marginTop: 2 }}>
              enter to save · esc to cancel</div>
          </div>
        ) : (
          m.content && (
            <div className="text"><Md text={m.content} members={members} me={me} agents={agents}
              emojis={emojis} roles={roles} channels={channels}
              onChannel={onFwdJump && ((c) => onFwdJump(c.id, c.server_id))}
              onUser={onUserOpen} onAgent={onAgentOpen} />
              {grouped && m.edited_at &&
                <span className="edited" title={new Date(m.edited_at * 1000).toLocaleString()}> (edited)</span>}
            </div>
          )
        )}
        {m.attachments?.map((a) => (
          a.mime?.startsWith("image/") ? (
            <img key={a.id} className="att-img" src={api.fileUrl(a.id)} alt={a.name} loading="lazy"
              onLoad={onImgLoad} title={`${a.name} — click to expand`}
              onClick={() => onLightbox?.(a)} style={{ cursor: "zoom-in" }} />
          ) : (
            <a key={a.id} className="att-file" href={api.fileUrl(a.id)} download={a.name}>
              <Ico n="clip" s={13} /> {a.name} <span className="att-size">{Math.ceil(a.size / 1024)} KB</span>
            </a>
          )
        ))}
        {m.embed?.type === "jump" ? (
          <JumpCard embed={m.embed} onJump={onFwdJump} />
        ) : m.embed ? (
          <a className="embed" href={m.embed.url} target="_blank" rel="noreferrer">
            {m.embed.image && <img className="embed-img" src={m.embed.image} alt="" loading="lazy" />}
            <span className="embed-body">
              {m.embed.site && <span className="embed-site">{m.embed.site}</span>}
              <span className="embed-title">{m.embed.title}</span>
              {m.embed.desc && <span className="embed-desc">{m.embed.desc}</span>}
            </span>
          </a>
        ) : (() => {
          const j = (m.content || "").match(/#\/s\/(\d+)\/c\/(\d+)\/m\/(\d+)/);
          return j && <JumpCard embed={{ sid: +j[1], cid: +j[2], mid: +j[3] }} onJump={onFwdJump} />;
        })()}
        {m.agent && <AgentShareCard agent={m.agent} onOpen={onAgentOpen} />}
        {m.pack && <PackShareCard pack={m.pack} onOpen={onPackOpen} />}
        {m.poll && (() => {
          const total = m.poll.options.reduce((n, _, j) =>
            n + ((m.reactions || []).find((x) => x.emoji === POLL_EMOJI[j])?.count || 0), 0);
          return (
            <div className="poll">
              {m.poll.options.map((o, i) => {
                const e = POLL_EMOJI[i];
                const r = (m.reactions || []).find((x) => x.emoji === e);
                const pct = total ? Math.round((r?.count || 0) / total * 100) : 0;
                return (
                  <button key={i} className={`poll-opt ${r?.mine ? "mine" : ""}`}
                    title={r?.users?.join(", ") || "no votes yet"}
                    onClick={() => onReact(m, e)}>
                    <span className="poll-bar" style={{ width: pct + "%" }} />
                    <span className="poll-key">{e}</span>
                    <span className="poll-txt">{o}</span>
                    {total > 0 && <span className="poll-pct">{pct}%</span>}
                    <span className="poll-n">{r?.count || 0}</span>
                  </button>
                );
              })}
              <div className="poll-foot">
                {total} {total === 1 ? "vote" : "votes"} · click an option to vote
              </div>
            </div>
          );
        })()}
        {m.thread_count > 0 && (
          <button className="thread-chip" onClick={() => onThread?.(m)}>
            <Ico n="dots3" s={13} /> {m.thread_count} {m.thread_count === 1 ? "reply" : "replies"}
          </button>
        )}
        {m.reactions?.filter((r) => !m.poll || !POLL_EMOJI.slice(0, m.poll.options.length).includes(r.emoji)).length > 0 && (
          <div className="reacts">
            {m.reactions.filter((r) => !m.poll || !POLL_EMOJI.slice(0, m.poll.options.length).includes(r.emoji)).map((r) => {
              const efid = /^:(\w+):$/.exec(r.emoji) && emap.get(r.emoji.slice(1, -1));
              return (
                <button key={r.emoji} className={`rchip ${r.mine ? "mine" : ""}`}
                  title={r.users.join(", ")} onClick={() => onReact(m, r.emoji)}>
                  {efid ? <img className="md-emoji" src={api.fileUrl(efid)} alt={r.emoji} /> : r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="react-bar">
        {QUICK.map((e) => (
          <span key={e} onClick={() => onReact(m, e)}>{e}</span>
        ))}
        <span title="Reply" onClick={() => onReply(m)}><Ico n="reply" s={13} /></span>
        <span title="Thread" onClick={() => onThread?.(m)}><Ico n="dots3" s={13} /></span>
        {mine && m.content &&
          <span title="Edit" onClick={() => { setEditDraft(m.content); setEditing(true); }}><Ico n="edit" s={13} /></span>}
      </div>
    </div>
  );
}

// 🔍/📌/📥 floating tools — search + pinned + transcript export, per channel
function ChannelTools({ channel, me, onAgentOpen, onPackOpen, onJump, voice, onJoinCall, onLeaveCall }) {
  const [open, setOpen] = useState(null);     // "search" | "pins" | null
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [pins, setPins] = useState([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setOpen(null); setQ(""); setHits([]); }, [channel.id]);

  async function search(v) {
    setQ(v);
    if (!hasSearchQuery(v)) { setHits([]); return; }
    setHits(await api.searchChannel(channel.id, v.trim()).catch(() => []));
  }

  async function togglePins() {
    if (open === "pins") { setOpen(null); return; }
    setPins(await api.pins(channel.id).catch(() => []));
    setOpen("pins");
  }

  const Row = ({ m }) => (
    <div className="ideopt" style={{ display: "block", padding: "6px 8px", cursor: "pointer" }}
      onClick={() => { setOpen(null); onJump?.(m.id); }}>
      <b style={{ fontSize: 11.5, color: m.author?.avatar_color }}>{m.author?.display_name}</b>
      <span style={{ fontSize: 10, color: "var(--dim)", marginLeft: 6 }}>{timeAgo(m.created_at)}</span>
      <div style={{ fontSize: 12, marginTop: 2, whiteSpace: "pre-wrap" }}>{m.content}</div>
      {m.agent && <AgentShareCard agent={m.agent} onOpen={onAgentOpen} />}
      {m.pack && <PackShareCard pack={m.pack} onOpen={onPackOpen} />}
    </div>
  );

  return (
    <div className="ch-tools">
      <button className={`ghost ${open === "search" ? "on" : ""}`} title="Search channel"
        onClick={() => setOpen(open === "search" ? null : "search")}><Ico n="search" /></button>
      <button className={`ghost ${open === "pins" ? "on" : ""}`} title="Pinned messages"
        onClick={togglePins}><Ico n="pin" /></button>
      <button className={`ghost ${voice?.joined && voice?.channelId === channel.id ? "on" : ""}`}
        title={voice?.joined && voice?.channelId === channel.id ? "Leave voice" : "Join voice"}
        onClick={() => (voice?.joined && voice?.channelId === channel.id) ? onLeaveCall() : onJoinCall()}><Ico n="phones" /></button>
      <button className={`ghost ${exporting ? "on" : ""}`} title="Export transcript"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            let before = 0, all = [];
            for (let guard = 0; guard < 400; guard++) {
              const page = await api.messages(channel.id, before).catch(() => []);
              if (!page.length) break;
              all = [...page, ...all];
              before = page[0].id;
              if (page.length < 50) break;
            }
            const txt = all.map((m) =>
              `[${new Date(m.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")}] ` +
              `${m.author?.display_name || "?"}: ${m.content || "(attachment)"}`)
              .join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
            a.download = `${channel.name || "dm"}-transcript.txt`;
            a.click(); URL.revokeObjectURL(a.href);
          } finally { setExporting(false); }
        }}><Ico n="fileDl" /></button>
      {open === "search" && (
        <div className="ch-panel">
          <input autoFocus placeholder={`Search ${channel.kind === "dm" ? "@…" : "#" + channel.name}…`}
            value={q} onChange={(e) => search(e.target.value)} />
          <div className="idehint" style={{ marginTop: 6 }}>
            try <code>from:me</code> <code>has:link</code> <code>pinned:true</code>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            {hasSearchQuery(q) && hits.length === 0 &&
              <div className="idehint">No matches.</div>}
            {hits.map((m) => <Row key={m.id} m={m} />)}
          </div>
        </div>
      )}
      {open === "pins" && (
        <div className="ch-panel">
          <label style={{ fontSize: 10.5, textTransform: "uppercase", color: "var(--dim)" }}>
            📌 Pinned in this channel</label>
          <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
            {pins.length === 0 && <div className="idehint">Nothing pinned — hover a message and hit 📌.</div>}
            {pins.map((m) => <Row key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// 🧵 side thread — root message + flat replies, lives beside the member list
const peekCache = new Map();   // mid -> peek | null (jump-card previews)

function JumpCard({ embed, onJump }) {
  const [peek, setPeek] = useState(() => peekCache.get(embed.mid));
  useEffect(() => {
    if (peek !== undefined) return;
    api.peekMessage(embed.mid)
      .then((p) => { peekCache.set(embed.mid, p); setPeek(p); })
      .catch(() => { peekCache.set(embed.mid, null); setPeek(null); });
  }, [embed.mid]);
  if (peek === undefined) return <div className="jump-card"><span className="jc-x">…</span></div>;
  if (!peek) return (
    <div className="jump-card no-access">
      <span className="jc-x">🔒 linked message — no access</span>
    </div>);
  return (
    <div className="jump-card" onClick={() => onJump?.(peek.channel_id, peek.server_id, peek.id)}
      title="Jump to message">
      <div className="jc-head">
        {peek.author && <Avatar user={peek.author} size="sm" />}
        <b>{peek.author?.display_name || "?"}</b>
        <span className="jc-where">#{peek.channel_name || "dm"}</span>
        <span className="jc-jump">jump →</span>
      </div>
      <div className="jc-x">{peek.excerpt || "(attachment)"}</div>
    </div>
  );
}

const SLASH_COMMANDS = [
  { cmd: "huddle", icon: "✦", usage: "", desc: "summon every resident agent in this channel" },
  { cmd: "summarize", icon: "📝", usage: "[N]", desc: "Scribe recaps the last N messages (5–100)" },
  { cmd: "remind", icon: "⏰", usage: "<10m> <text>", desc: "Reminders bot pings you later (s/m/h/d)" },
  { cmd: "poll", icon: "📊", usage: "<q> | <a> | <b>", desc: "poll with 2–9 options" },
  { cmd: "roll", icon: "🎲", usage: "[NdS]", desc: "roll dice — /roll, /roll 3d6" },
  { cmd: "me", icon: "💬", usage: "<action>", desc: "italic action line — /me waves" },
  { cmd: "shrug", icon: "🤷", usage: "", desc: "¯\\_(ツ)_/¯" },
  { cmd: "tableflip", icon: "😤", usage: "", desc: "(╯°□°)╯︵ ┻━┻" },
  { cmd: "unflip", icon: "🙂", usage: "", desc: "┬─┬ ノ( ゜-゜ノ)" },
];

function ThreadPanel({ channel, thread, me, members, agents, emojis, roles, channels, onFwdJump, onClose, onDelete,
  onReact, onPin, onAgentOpen, onPackOpen, onUserOpen, onMenu, onLightbox, blocked }) {
  const [tdraft, setTDraft] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); },
    [thread.replies.length]);

  async function send() {
    const v = tdraft.trim();
    if (!v) return;
    setTDraft("");
    await api.send(channel.id, v, null, [], null, null, thread.root.id)
      .catch((e) => { setTDraft(v); alert(e.message); });
  }

  return (
    <div className="thread-panel">
      <div className="tp-head">
        <span className="tp-title"><Ico n="dots3" s={14} /> Thread</span>
        <span className="tp-sub">in #{channel.name} · started by {thread.root.author?.display_name}</span>
        <button className="ghost" onClick={onClose} title="Close thread"><Ico n="x" s={14} /></button>
      </div>
      <div className="tp-root">
        <b style={{ color: thread.root.author?.avatar_color }}>
          {thread.root.author?.display_name}</b>
        <div className="tp-root-text">
          <Md text={thread.root.content} members={members} me={me} agents={agents}
            emojis={emojis} roles={roles} channels={channels}
            onChannel={onFwdJump && ((c) => onFwdJump(c.id, c.server_id))}
            onUser={onUserOpen} onAgent={onAgentOpen} />
        </div>
      </div>
      <div className="tp-msgs">
        {thread.replies.length === 0 &&
          <div className="idehint" style={{ padding: 8 }}>No replies yet — start it.</div>}
        {thread.replies.map((m) => (
          <Message key={m.id} m={m} grouped={false} me={me} members={members} agents={agents}
            emojis={emojis} roles={roles} channels={channels} blocked={blocked}
            onAgentOpen={onAgentOpen} onPackOpen={onPackOpen} onDelete={onDelete}
            onReact={onReact} onPin={onPin} onReply={() => {}} onThread={() => {}}
            onFwdJump={onFwdJump}
            onUserOpen={onUserOpen} onMenu={onMenu} onLightbox={onLightbox} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="tp-composer">
        <textarea rows={1} value={tdraft} placeholder="Reply in thread…"
          onChange={(e) => setTDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }} />
        <button className="ghost" title="Send" onClick={send}><Ico n="send" s={14} /></button>
      </div>
    </div>
  );
}

export default function ChatView({ channel, members, me, emojis, roles, channels = [], onAgentOpen, onPackOpen, onShareAgent, onUserOpen, onForward, onFwdJump, focusMsg, newSince = 0, onGroupAdd, onGroupRename, blocked, onMarkUnread }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [atts, setAtts] = useState([]);
  const [typers, setTypers] = useState({});
  const [reads, setReads] = useState({});   // user_id -> last_read ts (DM receipts)
  const [huddling, setHuddling] = useState(false);
  const [preview, setPreview] = useState(false);
  const [lightbox, setLightbox] = useState(null);   // attachment object
  const [mention, setMention] = useState(null);   // {start, query, sel}
  const [replyTo, setReplyTo] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [agents, setAgents] = useState([]);
  const [thread, setThread] = useState(null);   // {root, replies} | null
  const [menu, setMenu] = useState(null);       // {x, y, m, setEditing} — right-click / long-press
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [lastSent, setLastSent] = useState(0);
  const [sendErr, setSendErr] = useState("");
  const loadingOlder = useRef(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingSent = useRef(0);
  const pendingJump = useRef(null);   // msg id to scroll+flash once rendered
  const justPaged = useRef(false);    // suppress bottom-scroll after prepending a page
  const newSeen = useRef(false);      // landed on the unread divider once per channel open
  const atBottom = useRef(true);      // scrolled to the live edge
  const prevLen = useRef(0);
  const [pendingNew, setPendingNew] = useState(0);

  const mentionables = (members || [channel.other, me])
    .filter((u) => u && u.id !== me?.id);

  const [, tick] = useState(0);
  const slowLeft = Math.max(0, Math.ceil(
    (channel.slowmode_secs || 0) - (Date.now() - lastSent) / 1000));
  useEffect(() => {
    if (slowLeft <= 0) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [slowLeft > 0]);

  useEffect(() => {
    setMsgs([]); setThread(null); setHasMore(false); loadingOlder.current = false;
    newSeen.current = false;
    setDraft(localStorage.getItem("st.draft." + channel.id) || "");
    setSendErr(""); setLastSent(0);
    setReads(channel.reads || {});
    setKnocked(channel.knocked || false);
    askVoiceRoster(channel.id);
    if (channel.kind === "dm") api.markRead(channel.id).catch(() => {});
    atBottom.current = true; prevLen.current = 0; setPendingNew(0);
    if (!channel.locked) {
      api.messages(channel.id).then((m) => { setMsgs(m); setHasMore(m.length >= 50); }).catch(() => {});
      api.saved().then((s) => setSavedIds(new Set(s.map((x) => x.id)))).catch(() => {});
      if (channel.role_id) api.knocks(channel.id).then(setKnocks).catch(() => setKnocks([]));
      else setKnocks([]);
    }
  }, [channel.id, channel.locked]);

  const [knocks, setKnocks] = useState([]);
  const [knocked, setKnocked] = useState(false);
  const [voice, setVoice] = useState({ channelId: 0, joined: false, muted: false, roster: [], rosters: {} });
  useEffect(() => onVoice(setVoice), []);
  useEffect(() => { if (voice.err) setSendErr(voice.err); }, [voice.err]);
  async function joinCall() {
    try { await joinVoice(channel.id, me); }
    catch { setSendErr("No mic access — allow microphone to join voice"); }
  }

  // scroll near the top → pull the next older page (server paginates by id)
  async function loadOlder() {
    if (loadingOlder.current || !hasMore || !msgs.length) return;
    loadingOlder.current = true;
    const el = listRef.current, prevH = el?.scrollHeight || 0;
    const older = await api.messages(channel.id, msgs[0].id).catch(() => []);
    loadingOlder.current = false;
    if (!older.length) { setHasMore(false); return; }
    justPaged.current = true;
    setMsgs((prev) => [...older, ...prev]);
    setHasMore(older.length >= 50);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevH;
    });
  }

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom.current) setPendingNew(0);
    if (el.scrollTop < 80) loadOlder();
  }

  async function openThread(m) {
    const t = await api.thread(m.id).catch(() => null);
    if (t) setThread(t);
  }

  // per-channel composer drafts — switch away and your half-written message waits
  useEffect(() => {
    const key = "st.draft." + channel.id;
    if (draft) localStorage.setItem(key, draft);
    else localStorage.removeItem(key);
  }, [draft, channel.id]);

  useEffect(() => { api.agents({}).then(setAgents).catch(() => {}); }, []);

  useEffect(() => {
    if (!lightbox) return;
    const h = (e) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox]);

  useEffect(() => {
    if (pendingJump.current) {
      const el = document.getElementById("msg-" + pendingJump.current);
      if (!el) return;                      // older msg may not be loaded yet
      const id = pendingJump.current;
      pendingJump.current = null;
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1800);
      return;
    }
    if (justPaged.current) { justPaged.current = false; prevLen.current = msgs.length; return; }
    if (newSince > 0 && !newSeen.current) {
      const nd = document.querySelector(".new-div");
      if (nd) { newSeen.current = true; nd.scrollIntoView({ block: "start" }); prevLen.current = msgs.length; return; }
    }
    if (atBottom.current) endRef.current?.scrollIntoView({ behavior: "auto" });
    prevLen.current = msgs.length;
  }, [msgs.length]);

  function scrollToEnd() {
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }

  function jumpTo(id) {
    pendingJump.current = id;
    const el = document.getElementById("msg-" + id);
    if (el) {
      pendingJump.current = null;
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1800);
    }
  }

  // App-level jump (global search / mention click): focusMsg = {id, ch, n}
  useEffect(() => {
    if (focusMsg && focusMsg.ch === channel.id) jumpTo(focusMsg.id);
  }, [focusMsg, channel.id]);

  // live message events are pushed in by App via this prop registration
  useEffect(() => {
    channel._onMsg = (m) => {
      if (m.thread_root) {
        // thread reply — bump the root's chip, feed the open panel
        setMsgs((prev) => prev.map((p) =>
          p.id === m.thread_root ? { ...p, thread_count: (p.thread_count || 0) + 1 } : p));
        setThread((t) => t && t.root.id === m.thread_root
          ? { ...t, replies: t.replies.some((r) => r.id === m.id) ? t.replies : [...t.replies, m] }
          : t);
        return;
      }
      setMsgs((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
      const el = listRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 160
          && m.author?.id !== me?.id)
        setPendingNew((n) => n + 1);
      if (channel.kind === "dm") api.markRead(channel.id).catch(() => {});
    };
    channel._onRead = (uid, ts) => setReads((r) => ({ ...r, [uid]: Math.max(r[uid] || 0, ts) }));
    channel._onTyping = (u, on) => setTypers((t) => ({ ...t, [u.id]: on ? u : undefined }));
    channel._onDel = (id) => {
      setMsgs((prev) => prev.filter((p) => p.id !== id));
      setThread((t) => {
        if (!t) return t;
        if (t.root.id === id) return null;                    // root deleted → close panel
        return { ...t, replies: t.replies.filter((r) => r.id !== id) };
      });
    };
    channel._onReact = (mid, reactions) => {
      setMsgs((prev) => prev.map((p) => p.id === mid ? { ...p, reactions } : p));
      setThread((t) => t ? {
        root: t.root.id === mid ? { ...t.root, reactions } : t.root,
        replies: t.replies.map((r) => r.id === mid ? { ...r, reactions } : r),
      } : t);
    };
    channel._onUpdate = (m) => {
      setMsgs((prev) =>
        prev.map((p) => p.id === m.id ? { ...p, ...m, reactions: m.reactions ?? p.reactions } : p));
      setThread((t) => t ? {
        root: t.root.id === m.id ? { ...t.root, ...m } : t.root,
        replies: t.replies.map((r) => r.id === m.id ? { ...r, ...m } : r),
      } : t);
    };
    return () => { channel._onMsg = null; channel._onTyping = null;
      channel._onDel = null; channel._onReact = null; channel._onUpdate = null;
      channel._onRead = null; };
  }, [channel]);

  async function onPin(m) {
    await api.pinMessage(m.id).catch(() => {});
  }

  async function onReact(m, emoji) {
    await api.react(m.id, emoji).catch(() => {});
  }

  async function onDelete(m) {
    await api.delMessage(m.id).catch(() => {});
    setMsgs((prev) => prev.filter((p) => p.id !== m.id));
  }

  function onType(e) {
    const v = e.target.value;
    setDraft(v);
    const caret = e.target.selectionStart;
    if (v[0] === "/" && /^\w*$/.test(v.slice(1, caret))) {
      setMention({ start: 0, query: v.slice(1, caret), sym: "/", sel: 0 });
    } else {
      const at = Math.max(v.lastIndexOf("@", caret - 1), v.lastIndexOf(":", caret - 1));
      const sym = at >= 0 ? v[at] : null;
      if (at >= 0 && (at === 0 || /\s/.test(v[at - 1]))) {
        const query = v.slice(at + 1, caret);
        if (/^\w*$/.test(query) && (sym === "@" || query.length >= 1)) {
          setMention({ start: at, query, sym, sel: 0 });
        } else setMention(null);
      } else setMention(null);
    }
    if (Date.now() - typingSent.current > 2500) {
      typingSent.current = Date.now();
      sendWS({ type: "typing", channel_id: channel.id, on: true });
      setTimeout(() => sendWS({ type: "typing", channel_id: channel.id, on: false }), 4000);
    }
  }

  function pickMention(o) {
    if (!mention) return;
    const v = inputRef.current.value;
    const caret = inputRef.current.selectionStart;
    const ins = mention.sym === ":" ? ":" + o.insert + ":"
      : mention.sym === "/" ? "/" + o.insert : "@" + o.insert;
    const next = v.slice(0, mention.start) + ins + " " + v.slice(caret);
    setDraft(next); setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + ins.length + 1;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  // /shrug /tableflip /unflip /me /roll [N]dM — Discord flavor, expanded client-side
  function slashExpand(v) {
    if (v === "/shrug") return "¯\\_(ツ)_/¯";
    if (v === "/tableflip") return "(╯°□°)╯︵ ┻━┻";
    if (v === "/unflip") return "┬─┬ ノ( ゜-゜ノ)";
    if (v.startsWith("/me ")) return "*" + v.slice(4).trim() + "*";
    const r = v.match(/^\/roll(?:\s+(\d*)d(\d+))?$/i);
    if (r) {
      const n = Math.min(parseInt(r[1] || "1", 10) || 1, 10);
      const sides = Math.min(Math.max(parseInt(r[2] || "20", 10), 2), 1000);
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return `🎲 rolled **${total}** (${n}d${sides}${n > 1 ? ": " + rolls.join(" ") : ""})`;
    }
    return v;
  }

  function insertEmoji(e) {
    const ta = inputRef.current;
    const s = ta?.selectionStart ?? draft.length, t = ta?.selectionEnd ?? draft.length;
    const next = draft.slice(0, s) + e + draft.slice(t);
    setDraft(next);
    localStorage.setItem("st.draft." + channel.id, next);
    requestAnimationFrame(() => {
      if (ta) { ta.selectionStart = ta.selectionEnd = s + e.length; ta.focus(); }
    });
  }

  async function send() {
    const v = draft.trim();
    if (v === "/huddle") {
      setDraft("");
      try { await api.huddle(channel.id); } catch (e) { alert(e.message); }
      return;
    }
    const sum = v.match(/^\/summarize(?:\s+(\d+))?$/i);
    if (sum) {
      setDraft("");
      try { await api.summarize(channel.id, sum[1] ? +sum[1] : 25); }
      catch (e) { setDraft(v); setSendErr(e.message); }
      return;
    }
    if (v.startsWith("/remind")) {
      const rem = v.match(/^\/remind\s+(\d+)([smhd])\s+([\s\S]+)/i);
      if (!rem) {
        setSendErr("Remind format: /remind 10m <text> (s/m/h/d, 10s–7d)");
        return;
      }
      const mult = { s: 1, m: 60, h: 3600, d: 86400 }[rem[2].toLowerCase()];
      setDraft("");
      try {
        await api.remind(channel.id, +rem[1] * mult, rem[3].trim());
        setSendErr("");
      } catch (e) { setDraft(v); setSendErr(e.message); }
      return;
    }
    const poll = v.match(/^\/poll\s+([\s\S]+)/);
    if (poll) {
      const parts = poll[1].split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) {
        setSendErr("Poll format: /poll question? | option | option (2–9)");
        return;
      }
      const [q, ...options] = parts;
      setDraft("");
      try {
        const m = await api.send(channel.id, `📊 ${q}`, null, [], null,
          replyTo?.id || null, null, null, { q, options: options.slice(0, 9) });
        setMsgs((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
        setReplyTo(null); setSendErr("");
      } catch (e) { setDraft(v); setSendErr(e.message); }
      return;
    }
    const content = slashExpand(v);
    if (!content && !atts.length) return;
    const payload = atts;
    const r = replyTo;
    setDraft(""); setAtts([]); setReplyTo(null);
    sendWS({ type: "typing", channel_id: channel.id, on: false });
    try {
      const m = await api.send(channel.id, content, null, payload, null, r?.id || null);
      setMsgs((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
      setLastSent(Date.now()); setSendErr("");
    } catch (e) {
      setDraft(content); setAtts(payload); setReplyTo(r);
      setSendErr(e.message || "send failed");
    }
  }

  function onReply(m) {
    setReplyTo(m);
    inputRef.current?.focus();
  }

  function openMenu(x, y, m, setEditing) {
    setMenu({
      x: Math.min(x, window.innerWidth - 200),
      y: Math.min(y, window.innerHeight - 260),
      m, setEditing,
    });
  }

  async function uploadFiles(files) {
    for (const f of files || []) {
      try { const up = await api.upload(f); setAtts((a) => [...a, up]); } catch (ex) { alert(ex.message); }
    }
  }

  async function pickFiles(e) {
    await uploadFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  }

  const matches = mention
    ? mention.sym === ":"
      ? (emojis || []).filter((e) =>
          e.name.toLowerCase().startsWith(mention.query.toLowerCase()))
          .slice(0, 6).map((e) => ({ kind: "emoji", id: "e" + e.id, insert: e.name, e }))
    : mention.sym === "/"
      ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(mention.query.toLowerCase()))
          .map((c) => ({ kind: "cmd", id: "c" + c.cmd, insert: c.cmd, c }))
    : [
      ...mentionables.filter((u) =>
        u.username.toLowerCase().startsWith(mention.query.toLowerCase()) ||
        u.display_name.toLowerCase().startsWith(mention.query.toLowerCase()))
        .map((u) => ({ kind: "user", id: "u" + u.id, insert: u.username, u })),
      ...[...agents.filter((a) => {
        const s = agentSlug(a.name), q = mention.query.toLowerCase();
        return s.startsWith(q) || a.name.toLowerCase().startsWith(q);
      }).reduce((m, a) => {
        const s = agentSlug(a.name);
        if (!m.has(s) || a.owner?.id === me?.id) m.set(s, a);
        return m;
      }, new Map()).values()]
        .map((a) => ({ kind: "agent", id: "a" + a.id, insert: agentSlug(a.name), a })),
      ...(roles || []).filter((r) => {
        const s = agentSlug(r.name), q = mention.query.toLowerCase();
        return s.startsWith(q) || r.name.toLowerCase().startsWith(q);
      }).map((r) => ({ kind: "role", id: "r" + r.id, insert: agentSlug(r.name), r })),
    ].slice(0, 6)
    : [];

  function key(e) {
    if (mention && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel + 1) % matches.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel + matches.length - 1) % matches.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(matches[mention.sel] || matches[0]); return; }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const typerList = Object.values(typers).filter(Boolean);
  let lastDay = "", lastAuthor = null, lastTs = 0;

  // DM read receipt — who's caught up past my last message
  const lastOwn = [...msgs].reverse().find((m) => !m.thread_root && m.author?.id === me?.id);
  const dmMembers = members || [channel.other, me].filter(Boolean);
  const seenBy = channel.kind === "dm" && lastOwn
    ? dmMembers.filter((u) => u && u.id !== me?.id && (reads[u.id] || 0) >= lastOwn.created_at)
    : [];

  return (
    <div className="chat">
      <div className="chat-core"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={onDrop}>
        {dragging && (
          <div className="drop-veil">
            <div className="drop-box"><Ico n="clip" s={16} /> Drop files to attach</div>
          </div>
        )}
        <ChannelTools channel={channel} me={me} onAgentOpen={onAgentOpen}
          onPackOpen={onPackOpen} onJump={jumpTo}
          voice={voice} onJoinCall={joinCall} onLeaveCall={leaveVoice} />
        {voice.joined && voice.channelId === channel.id ? (
          <div className="voice-bar in">
            <span className="vb-ico"><Ico n="phones" s={17} /></span>
            <span className="vb-lab">voice connected</span>
            <div className="vb-members">
              {voice.roster.map((m) => (
                <span key={m.id} className={`vb-chip ${m.muted ? "muted" : ""} ${!m.muted && (voice.speaking || []).includes(m.id) ? "speaking" : ""}`}
                  title={m.muted ? `${m.display_name} (muted)` : m.display_name}>
                  <span className="vb-av" style={{ background: m.avatar_color }}>{m.avatar_emoji}</span>
                  {m.display_name}{m.muted ? " 🔇" : ""}{m.deafened ? " 🚫" : ""}{m.sharing ? " 🖥" : ""}{m.cam ? " 📹" : ""}
                </span>
              ))}
            </div>
            <button className={`ghost vb-btn ${voice.camOn ? "on" : ""}`}
              title={voice.camOn ? "Turn camera off" : "Turn camera on"}
              onClick={() => toggleCam().then((r) => r?.error && setSendErr(r.error))}>
              📹</button>
            <button className={`ghost vb-btn ${voice.sharing ? "on" : ""}`}
              title={voice.sharing ? "Stop sharing" : "Share screen"}
              onClick={() => toggleShare().catch(() => setSendErr("Screen share unavailable"))}>
              🖥</button>
            <button className="ghost vb-btn" title={voice.muted ? "Unmute" : "Mute"}
              onClick={toggleVoiceMute}>{voice.muted ? "🔇" : "🎙"}</button>
            <button className={`ghost vb-btn ${voice.deafened ? "on" : ""}`}
              title={voice.deafened ? "Undeafen" : "Deafen (mute + silence)"}
              onClick={toggleDeafen}><Ico n="phones" /></button>
            <button className="ghost vb-btn vb-leave" title="Leave voice"
              onClick={leaveVoice}>📞✕</button>
          </div>
        ) : (voice.rosters[channel.id] || []).length > 0 ? (
          <div className="voice-bar">
            <span className="vb-ico"><Ico n="phones" s={17} /></span>
            <span className="vb-lab">
              {(voice.rosters[channel.id] || []).map((m) =>
                m.display_name + (m.sharing ? " 🖥" : "") + (m.cam ? " 📹" : "")).join(", ")} in voice
            </span>
            <button className="ghost vb-btn" onClick={joinCall}>join</button>
          </div>
        ) : null}
        {(Object.keys(voice.videos || {}).length > 0 || voice.camStream) && (
          <div className="voice-stage">
            {voice.camStream && (
              <div className="vs-tile">
                <video autoPlay playsInline muted
                  ref={(el) => { if (el && el.srcObject !== voice.camStream) el.srcObject = voice.camStream; }} />
                <span className="vs-name">your camera</span>
              </div>
            )}
            {Object.entries(voice.videos).map(([key, v]) => {
              const m = voice.roster.find((x) => x.id === v.uid);
              return (
                <div key={key} className="vs-tile">
                  <video autoPlay playsInline muted
                    ref={(el) => { if (el && el.srcObject !== v.stream) el.srcObject = v.stream; }} />
                  <span className="vs-name">{m?.display_name || "…"}'s {v.kind === "cam" ? "camera" : "screen"}</span>
                </div>
              );
            })}
          </div>
        )}
        {knocks.length > 0 && (
          <div className="knock-bar">
            {knocks.map((k) => (
              <span key={k.user.id} className="knock-row">
                🚪 <b>{k.user.display_name}</b> is knocking
                <button className="ghost kb-y" title="Let them in"
                  onClick={async () => {
                    await api.resolveKnock(channel.id, k.user.id, true).catch((e) => setSendErr(e.message));
                    api.knocks(channel.id).then(setKnocks).catch(() => {});
                  }}>let in</button>
                <button className="ghost kb-n" title="Deny"
                  onClick={async () => {
                    await api.resolveKnock(channel.id, k.user.id, false).catch((e) => setSendErr(e.message));
                    api.knocks(channel.id).then(setKnocks).catch(() => {});
                  }}><Ico n="x" s={12} /></button>
              </span>
            ))}
          </div>
        )}
        {channel.roster?.length > 0 && (
          <div className="roster">
            <span className="r-lab">✦ residents — @ them to summon</span>
            {channel.roster.map((a) => (
              <button key={a.id} className="r-chip" title={`Summon @${agentSlug(a.name)}`}
                onClick={() => onAgentOpen(agents.find((x) => x.id === a.id) || a)}>
                {a.icon} {a.name}
              </button>
            ))}
            <button className="r-chip r-huddle" title="Summon every resident"
              disabled={huddling}
              onClick={async () => {
                setHuddling(true);
                try { await api.huddle(channel.id); }
                finally { setTimeout(() => setHuddling(false), 3000); }
              }}>✦ huddle</button>
          </div>
        )}
        <div className="msgs" ref={listRef} onScroll={onListScroll}
          onClick={(e) => {
            const a = e.target.closest?.("a");
            const m = a?.getAttribute("href")?.match(/#\/s\/(\d+)\/c\/(\d+)\/m\/(\d+)/);
            if (m) { e.preventDefault(); onFwdJump?.(+m[2], +m[1] || null, +m[3]); }
          }}>
          {channel.locked ? (
            <div className="empty">
              <div className="big">🔒</div>
              <div className="serif">This channel is role-gated.</div>
              <div>You need the <b>{(roles || []).find((r) => r.id === channel.role_id)?.name || "required"}</b> role to read or post here.</div>
              {(channel.knocked || knocked)
                ? <div className="idehint" style={{ marginTop: 10 }}>🚪 knock sent — the insiders will let you in</div>
                : <button className="primary" style={{ marginTop: 12 }}
                    onClick={async () => {
                      await api.knock(channel.id).then(() => setKnocked(true))
                        .catch((e) => setSendErr(e.message));
                    }}>🚪 knock to join</button>}
            </div>
          ) : (<>
          {hasMore && <div className="idehint" style={{ textAlign: "center", padding: "4px 0" }}>
            scroll up for earlier messages…</div>}
          {msgs.length === 0 && (
            <div className="empty">
              <div className="big">{channel.kind === "agents" ? "✦" : "💬"}</div>
              <div className="serif">Quiet in here.</div>
              <div>Say something — or drop an agent with the ✦ button.</div>
            </div>
          )}
          {msgs.map((m, i) => {
            const day = msgDay(m.created_at);
            const grouped = day === lastDay && m.author?.id === lastAuthor
              && m.created_at - lastTs < 300 && !m.agent && !m.pack;
            const showDay = day !== lastDay;
            lastDay = day; lastAuthor = m.author?.id; lastTs = m.created_at;
            const isNewBoundary = newSince > 0 && i === Math.max(0, msgs.length - newSince);
            return (
              <React.Fragment key={m.id}>
                {isNewBoundary && <div className="new-div"><span>New</span></div>}
                {showDay && <div className="day-div">{day}</div>}
                <Message m={m} grouped={grouped} me={me} members={members} agents={agents}
                  emojis={emojis} roles={roles} channels={channels}
                  blocked={blocked}
                  onAgentOpen={onAgentOpen} onPackOpen={onPackOpen}
                  onDelete={onDelete} onReact={onReact} onPin={onPin}
                  onImgLoad={scrollToEnd} onReply={onReply} onUserOpen={onUserOpen}
                  onFwdJump={onFwdJump}
                  onThread={openThread} onMenu={openMenu} onLightbox={setLightbox} />
                {channel.kind === "dm" && m.id === lastOwn?.id && (
                  <div className="seen-tag"
                    title={seenBy.length ? `Seen by ${seenBy.map((u) => u.display_name).join(", ")}` : "Not seen yet"}>
                    {seenBy.length ? `✓✓ seen` : "✓ sent"}
                  </div>
                )}
              </React.Fragment>
            );
          })}
          <div ref={endRef} />
          </>)}
        </div>
        {pendingNew > 0 && (
          <div className="scrollpill" onClick={() => {
            setPendingNew(0); atBottom.current = true;
            endRef.current?.scrollIntoView({ behavior: "smooth" });
          }}>↓ {pendingNew} new message{pendingNew > 1 ? "s" : ""}</div>
        )}
        <div className="typing">
          {typerList.length > 0 && (
            <span><b>{typerList.map((t) => t.display_name).join(", ")}</b>
              {typerList.length === 1 ? " is" : " are"} typing…</span>
          )}
        </div>
        {replyTo && (
          <div className="reply-banner">
            <span>↩ Replying to <b>{replyTo.author?.display_name}</b>
              <span className="rb-excerpt"> {replyTo.content?.slice(0, 80) || "an attachment"}</span></span>
            <button className="ghost" onClick={() => setReplyTo(null)}><Ico n="x" s={12} /></button>
          </div>
        )}
        {atts.length > 0 && (
          <div className="att-pending">
            {atts.map((a) => (
              <span key={a.id} className="att-chip">
                <Ico n="clip" s={12} /> {a.name}
                <button className="ghost" onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}><Ico n="x" s={11} /></button>
              </span>
            ))}
          </div>
        )}
        {!channel.locked && (
        <div className="composer">
          {matches.length > 0 && (
            <div className="mention-pop">
              {matches.map((o, i) => (
                <div key={o.id} className={`mopt ${i === mention.sel ? "sel" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); pickMention(o); }}>
                  {o.kind === "cmd" ? (
                    <><span className="aicon">{o.c.icon}</span>
                      <b>/{o.c.cmd} <i>{o.c.usage}</i></b><span>{o.c.desc}</span></>
                  ) : o.kind === "emoji" ? (
                    <><img className="md-emoji" src={api.fileUrl(o.e.file_id)} alt="" />
                      <b>:{o.insert}:</b><span>custom emoji</span></>
                  ) : o.kind === "user" ? (
                    <><Avatar user={o.u} size="sm" />
                      <b>@{o.u.username}</b><span>{o.u.display_name}</span></>
                  ) : o.kind === "role" ? (
                    <><span className="aicon" style={{ color: o.r.color }}>🏷</span>
                      <b style={{ color: o.r.color }}>@{o.insert}</b>
                      <span>{o.r.name} · role — pings holders</span></>
                  ) : (
                    <><span className="aicon">{o.a.icon}</span>
                      <b>@{o.insert}</b><span>{o.a.name} · ✦ agent — it replies</span></>
                  )}
                </div>
              ))}
            </div>
          )}
          {emojiOpen && (
            <div className="emoji-pop">
              {(emojis || []).length > 0 && (
                <>
                  <div className="ep-head">Server emoji</div>
                  {(emojis || []).map((e) => (
                    <span key={"c" + e.id} title={":" + e.name + ":"}
                      onClick={() => insertEmoji(":" + e.name + ":")}>
                      <img className="md-emoji" src={api.fileUrl(e.file_id)} alt={":" + e.name + ":"} />
                    </span>
                  ))}
                  <div className="ep-head">Emoji</div>
                </>
              )}
              {EMOJI_PICK.map((e) => (
                <span key={e} onClick={() => insertEmoji(e)}>{e}</span>
              ))}
            </div>
          )}
          {preview && (
            <div className="md-preview">
              <Md text={draft || "nothing to preview"} members={members} me={me} agents={agents}
                emojis={emojis} roles={roles} channels={channels}
                onChannel={onFwdJump && ((c) => onFwdJump(c.id, c.server_id))}
                onUser={onUserOpen} onAgent={onAgentOpen} />
            </div>
          )}
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={pickFiles} />
          <button className="ghost cbtn" title="Attach file"
            onClick={() => fileRef.current?.click()}><Ico n="clip" /></button>
          <button className={`ghost cbtn ${emojiOpen ? "on" : ""}`} title="Emoji"
            onClick={() => setEmojiOpen((o) => !o)}><Ico n="emoji" /></button>
          <button className={`ghost cbtn ${preview ? "on" : ""}`} title="Preview markdown"
            onClick={() => setPreview((p) => !p)}><Ico n="eye" /></button>
          <textarea ref={inputRef} rows={1} value={draft}
            placeholder={`Message ${channel.kind === "dm" ? "@" + (channel.other?.display_name || channel.name || "") : "#" + channel.name}`}
            onChange={onType} onKeyDown={key}
            onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }} />
          <div className="send-row">
            {(sendErr || slowLeft > 0) && (
              <span className={`slow-chip ${sendErr ? "err" : ""}`}>
                {sendErr || `🐌 ${slowLeft}s`}</span>
            )}
            <button className="ghost cbtn" title="Share an agent" onClick={onShareAgent}><Ico n="sparkle" /></button>
            <button className="ghost cbtn" title="Send" onClick={send}><Ico n="send" /></button>
          </div>
        </div>
        )}
      </div>
      {thread && (
        <ThreadPanel channel={channel} thread={thread} me={me} members={members}
          agents={agents} emojis={emojis} roles={roles} channels={channels}
          onFwdJump={onFwdJump}
          onClose={() => setThread(null)}
          onDelete={onDelete} onReact={onReact} onPin={onPin}
          onAgentOpen={onAgentOpen} onPackOpen={onPackOpen} onUserOpen={onUserOpen}
          onMenu={openMenu} onLightbox={setLightbox} blocked={blocked} />
      )}
      {lightbox && (
        <div className="lb" onClick={() => setLightbox(null)}>
          <div className="lb-top">
            <span className="lb-name">{lightbox.name}</span>
            <a className="lb-act" href={api.fileUrl(lightbox.id)} target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()} title="Open original"><Ico n="ext" s={15} /></a>
            <button className="lb-act" title="Close (Esc)" onClick={() => setLightbox(null)}><Ico n="x" s={15} /></button>
          </div>
          <img className="lb-img" src={api.fileUrl(lightbox.id)} alt={lightbox.name}
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      {members && members.length > 0 && (
        <div className="members">
          {channel.kind === "dm" && (channel.members || []).length > 1 && (
            <div className="mgroup gdm-tools">
              <span>Group DM</span>
              <span className="gt-btn" title="Add friends to group" onClick={() => onGroupAdd?.()}>＋</span>
              <span className="gt-btn" title="Rename group" onClick={() => onGroupRename?.()}>✏</span>
            </div>
          )}
          <div className="mgroup">Online — {members.filter((m) => m.online).length}</div>
          {members.filter((m) => m.online).map((m) => {
            const mRoles = (roles || []).filter((r) => (m.role_ids || []).includes(r.id));
            return (
              <div className="mrow" key={m.id} style={{ cursor: "pointer" }} onClick={() => onUserOpen?.(m)}>
                <Avatar user={m} size="sm" showStatus />
                <span className="n" style={mRoles[0] ? { color: mRoles[0].color } : undefined}
                  title={m.nickname ? `@${m.username}` : undefined}>
                  {m.nickname || m.display_name}</span>
                {mRoles.slice(0, 2).map((r) => (
                  <span key={r.id} className="role-pill" style={{ borderColor: r.color, color: r.color }}>
                    {r.name}</span>
                ))}
                {m.status_text && <span className="mstatus">{m.status_text}</span>}
                {typers[m.id] && <span className="mtype">typing…</span>}
              </div>
            );
          })}
          <div className="mgroup">Offline — {members.filter((m) => !m.online).length}</div>
          {members.filter((m) => !m.online).map((m) => {
            const mRoles = (roles || []).filter((r) => (m.role_ids || []).includes(r.id));
            return (
              <div className="mrow off" key={m.id} style={{ cursor: "pointer" }} onClick={() => onUserOpen?.(m)}>
                <Avatar user={{ ...m, status: "offline" }} size="sm" showStatus />
                <span className="n" style={mRoles[0] ? { color: mRoles[0].color } : undefined}>
                  {m.nickname || m.display_name}</span>
                {mRoles.slice(0, 2).map((r) => (
                  <span key={r.id} className="role-pill" style={{ borderColor: r.color, color: r.color }}>
                    {r.name}</span>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="msg-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="mm-reacts">
              {QUICK.map((e) => (
                <span key={e} onClick={() => { onReact(menu.m, e); setMenu(null); }}>{e}</span>
              ))}
              {(emojis || []).slice(0, 6).map((e) => (
                <span key={"c" + e.id} title={":" + e.name + ":"}
                  onClick={() => { onReact(menu.m, ":" + e.name + ":"); setMenu(null); }}>
                  <img className="md-emoji" src={api.fileUrl(e.file_id)} alt={":" + e.name + ":"} />
                </span>
              ))}
            </div>
            {menu.m.content &&
              <div className="mm-item" onClick={() => {
                navigator.clipboard?.writeText(menu.m.content); setMenu(null);
              }}><Ico n="copy" s={13} /> Copy text</div>}
            <div className="mm-item" onClick={() => {
              navigator.clipboard?.writeText(
                `${location.origin}/#/s/${channel.server_id || 0}/c/${channel.id}/m/${menu.m.id}`);
              setMenu(null);
            }}><Ico n="link" s={13} /> Copy link</div>
            <div className="mm-item" onClick={() => {
              const n = msgs.length - msgs.findIndex((x) => x.id === menu.m.id);
              onMarkUnread?.(menu.m, n); setMenu(null);
            }}><Ico n="bell" s={13} /> Mark unread</div>
            <div className="mm-item" onClick={() => { onReply(menu.m); setMenu(null); }}><Ico n="reply" s={13} /> Reply</div>
            <div className="mm-item" onClick={() => { onForward?.(menu.m); setMenu(null); }}><Ico n="forward" s={13} /> Forward</div>
            <div className="mm-item" onClick={() => { openThread(menu.m); setMenu(null); }}><Ico n="dots3" s={13} /> Thread</div>
            <div className="mm-item" onClick={() => { onPin(menu.m); setMenu(null); }}>
              <Ico n="pin" s={13} /> {menu.m.pinned ? "Unpin" : "Pin"}</div>
            <div className="mm-item" onClick={async () => {
              const r = await api.saveMsg(menu.m.id).catch(() => null);
              if (r) setSavedIds((s) => {
                const n = new Set(s); r.saved ? n.add(menu.m.id) : n.delete(menu.m.id); return n; });
              setMenu(null);
            }}><Ico n="bookmark" s={13} /> {savedIds.has(menu.m.id) ? "Unsave" : "Save"}</div>
            {menu.m.author?.id === me?.id && menu.m.content &&
              <div className="mm-item" onClick={() => {
                menu.setEditing?.(true); setMenu(null);
              }}><Ico n="edit" s={13} /> Edit</div>}
            {menu.m.author?.id === me?.id &&
              <div className="mm-item danger" onClick={() => { onDelete(menu.m); setMenu(null); }}>
                <Ico n="trash" s={13} /> Delete</div>}
          </div>
        </>
      )}
    </div>
  );
}
