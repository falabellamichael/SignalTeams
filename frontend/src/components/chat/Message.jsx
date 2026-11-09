import React, { useRef, useState, useEffect } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar, Md, msgTime, timeAgo } from "../../util";
import { AgentShareCard, PackShareCard } from "../AgentCard";
import { QUICK, POLL_EMOJI } from "./consts";

export function Message({ m, grouped, me, members, agents, emojis, roles, channels, onAgentOpen, onPackOpen, onDelete, onReact, onPin, onImgLoad, onReply, onUserOpen, onFwdJump, onThread, onMenu, onLightbox, blocked, onWave, editTarget, onJump }) {
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

  // ArrowUp in the composer targets this message for editing
  useEffect(() => {
    if (editTarget?.id === m.id) { setEditDraft(m.content); setEditing(true); }
  }, [editTarget]);

  async function saveEdit() {
    const v = editDraft.trim();
    if (!v || v === m.content) { setEditing(false); return; }
    setEditing(false);
    await api.editMessage(m.id, v).catch((e) => alert(e.message));
  }

  if (m.system) {
    const isJoin = m.system === "join";
    const isLeave = m.system === "leave";
    const txt = m.content || (isJoin ? "joined the server." : isLeave ? "left the server." : m.system);
    const ic = isJoin ? "🎉" : isLeave ? "👋" : "ℹ️";
    const isOther = m.author?.id !== me?.id;
    return (
      <div className={`sysmsg ${isJoin ? "sysmsg-join" : ""}`} id={"msg-" + m.id}>
        <span className="sysmsg-body">
          <span className="sysmsg-ic">{ic}</span>{" "}
          <b style={{ color: m.author?.avatar_color, cursor: "pointer" }}
            onClick={(e) => m.author && onUserOpen?.(m.author, e)}>
            {nickOf(m.author) || m.author?.display_name}
          </b>{" "}
          {txt}
          <span className="sysmsg-time">{timeAgo(m.created_at)}</span>
        </span>
        {isJoin && isOther && onWave && (
          <button className="ghost sysmsg-wave-btn" title={`Wave to say hello to ${nickOf(m.author) || m.author?.display_name}`}
            onClick={() => onWave(m.author)}>
            👋 Wave
          </button>
        )}
      </div>
    );
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
        : <span style={{ cursor: "pointer" }} onClick={(e) => m.author && onUserOpen?.(m.author, e)}>
            <Avatar user={m.author} size="sm" /></span>}
      <div className="body">
        {m.reply && (
          <div className={`reply-quote${m.reply.id ? " jumpable" : ""}`}
            title={m.reply.id ? "Jump to the original message" : m.reply.content}
            onClick={() => m.reply.id && onJump?.(m.reply.id)}>
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
            <span className="author" style={{ color: topRole(m.author)?.color || m.author?.avatar_color, cursor: "pointer" }} onClick={(e) => m.author && onUserOpen?.(m.author, e)}
              title={nickOf(m.author) !== m.author?.display_name ? `@${m.author?.username}` : undefined}>
              {nickOf(m.author)}</span>
            {m.author?.status === "bot" && <span className="bot-tag">BOT</span>}
            {m.hook && m.author_name &&
              <span className="via-tag" title={`posted via the "${m.hook}" webhook`}>via {m.hook}</span>}
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
        {m.title && <div className="post-title">{m.title}</div>}
        {editing ? (
          <div className="edit-row">
            <textarea autoFocus value={editDraft}
              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
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
              {m._tl && <div className="m-tl"><Ico n="translate" s={11} /> {m._tl}</div>}
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
        ) : m.embed && (m.embed.type === "rich" || m.embed.fields || m.embed.color || m.embed.author || m.embed.footer) ? (
          <DiscordEmbed embed={m.embed} />
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
        {QUICK.slice(0, 4).map((e) => (
          <button key={e} type="button" onClick={() => onReact(m, e)}>{e}</button>
        ))}
        <button type="button" title="Add reaction" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu?.(r.left, r.bottom + 4, m, setEditing);
        }}><Ico n="emoji" s={13} /></button>
        <button type="button" title="Reply" onClick={() => onReply(m)}><Ico n="reply" s={13} /></button>
        <button type="button" title="More actions" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu?.(r.left, r.bottom + 4, m, setEditing);
        }}><Ico n="dots" s={13} /></button>
      </div>
    </div>
  );
}


function DiscordEmbed({ embed }) {
  if (!embed) return null;
  const col = embed.color || "var(--accent)";
  return (
    <div className="discord-embed" style={{ "--embed-color": col, borderLeftColor: col }}>
      {embed.thumbnail?.url && (
        <img className="de-thumb" src={embed.thumbnail.url} alt="" loading="lazy" />
      )}
      {embed.author?.name && (
        <div className="de-author">
          {embed.author.icon_url && <img className="de-author-icon" src={embed.author.icon_url} alt="" />}
          {embed.author.url ? (
            <a href={embed.author.url} target="_blank" rel="noreferrer">{embed.author.name}</a>
          ) : (
            <span>{embed.author.name}</span>
          )}
        </div>
      )}
      {embed.title && (
        embed.url ? (
          <a className="de-title" href={embed.url} target="_blank" rel="noreferrer">{embed.title}</a>
        ) : (
          <span className="de-title">{embed.title}</span>
        )
      )}
      {embed.description && (
        <div className="de-desc">{embed.description}</div>
      )}
      {embed.fields?.length > 0 && (
        <div className="de-fields">
          {embed.fields.map((f, i) => (
            <div key={i} className={`de-field ${f.inline ? "inline" : "full"}`}>
              <div className="de-field-name">{f.name}</div>
              <div className="de-field-value">{f.value}</div>
            </div>
          ))}
        </div>
      )}
      {embed.image?.url && (
        <img className="de-image" src={embed.image.url} alt="" loading="lazy" />
      )}
      {(embed.footer?.text || embed.timestamp) && (
        <div className="de-footer">
          {embed.footer?.icon_url && <img className="de-footer-icon" src={embed.footer.icon_url} alt="" />}
          <span>{embed.footer?.text}</span>
          {embed.footer?.text && embed.timestamp && <span> • </span>}
          {embed.timestamp && <span>{new Date(embed.timestamp).toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

// 🔍/📌/📥 floating tools — search + pinned + transcript export, per channel


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

