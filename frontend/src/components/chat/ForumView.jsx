import React, { useRef, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Avatar, timeAgo } from "../../util";

// Forum channel — titled posts as cards, replies live in the thread panel.
export function ForumFeed({ channel, me, msgs, onOpen, onPosted }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [atts, setAtts] = useState([]);
  const [tags, setTags] = useState([]);
  const [filter, setFilter] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const chanTags = channel.forum_tags || [];

  // bump order — a thread reply lifts its post to the top
  const posts = [...msgs]
    .filter((m) => !filter || (m.tags || []).includes(filter))
    .sort((a, b) =>
    Math.max(b.created_at, b.last_reply?.created_at || 0) -
    Math.max(a.created_at, a.last_reply?.created_at || 0));

  async function pickFiles(e) {
    for (const f of e.target.files || []) {
      try { const up = await api.upload(f); setAtts((a) => [...a, up]); }
      catch (ex) { alert(ex.message); }
    }
    e.target.value = "";
  }

  async function post() {
    const t = title.trim(), v = body.trim();
    if (!t) { setErr("Give the post a title"); return; }
    if (!v && !atts.length) { setErr("Say something — or attach a file"); return; }
    try {
      const m = await api.send(channel.id, v, null, atts, null, null, null, null, null, t, tags);
      onPosted?.(m);
      setTitle(""); setBody(""); setAtts([]); setTags([]); setOpen(false); setErr("");
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="forum-feed">
      {chanTags.length > 0 && (
        <div className="ftagbar">
          <span className={`ftag ${filter === null ? "on" : ""}`}
            onClick={() => setFilter(null)}>All</span>
          {chanTags.map((t) => (
            <span key={t} className={`ftag ${filter === t ? "on" : ""}`}
              onClick={() => setFilter((f) => (f === t ? null : t))}>{t}</span>
          ))}
        </div>
      )}
      <div className="forum-tools">
        <span className="idehint">{posts.length} post{posts.length === 1 ? "" : "s"}</span>
        {!channel.locked &&
          <button className={open ? "" : "primary"} onClick={() => setOpen((o) => !o)}>
            {open ? "Cancel" : <><Ico n="plus" s={12} /> New post</>}
          </button>}
      </div>
      {open && (
        <div className="newpost">
          <input className="np-title" value={title} maxLength={120}
            placeholder="Post title — e.g. Q3 launch retro"
            onChange={(e) => setTitle(e.target.value)} autoFocus />
          {chanTags.length > 0 && (
            <div className="ftagbar">
              {chanTags.map((t) => (
                <span key={t} className={`ftag ${tags.includes(t) ? "on" : ""}`}
                  onClick={() => setTags((x) => x.includes(t)
                    ? x.filter((z) => z !== t) : [...x, t])}>{t}</span>
              ))}
            </div>
          )}
          <textarea rows={3} value={body}
            placeholder="Write the post — markdown, @mentions, and emoji all work"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); }
            }} />
          {atts.length > 0 && (
            <div className="att-pending">
              {atts.map((a) => (
                <span key={a.id} className="att-chip">
                  <Ico n="clip" s={12} /> {a.name}
                  <button className="ghost"
                    onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}>
                    <Ico n="x" s={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="np-foot">
            <button className="ghost" title="Attach files" onClick={() => fileRef.current?.click()}>
              <Ico n="clip" s={14} /></button>
            <input ref={fileRef} type="file" multiple hidden onChange={pickFiles} />
            {err && <span className="np-err">{err}</span>}
            <span className="idehint" style={{ marginLeft: "auto" }}>ctrl+enter to post</span>
            <button className="primary" onClick={post}>Post</button>
          </div>
        </div>
      )}
      {posts.length === 0 && !open && (
        <div className="empty">
          <div className="big">📋</div>
          <div className="serif">No posts yet.</div>
          <div>Start the first thread — every post gets its own reply panel.</div>
        </div>
      )}
      {posts.map((m) => (
        <div key={m.id} className={`fpost ${m.pinned ? "pinned" : ""}`}
          onClick={() => onOpen?.(m)}>
          <div className="fpost-head">
            <Avatar user={m.author} size="sm" />
            <div className="fpost-title">
              {!!m.pinned && <span title="Pinned">📌 </span>}
              {m.title || (m.content || "").split("\n")[0].slice(0, 80) || "post"}
            </div>
            <span className="fpost-time" title={new Date(m.created_at * 1000).toLocaleString()}>
              {timeAgo(m.created_at)}</span>
          </div>
          {(m.tags || []).length > 0 && (
            <div className="ftagbar" style={{ margin: "4px 0 0 34px" }}>
              {m.tags.map((t) => <span key={t} className="ftag sm">{t}</span>)}
            </div>
          )}
          {(m.content || "").trim() && (
            <div className="fpost-snip">
              {(m.title ? m.content : (m.content || "").split("\n").slice(1).join(" ") || "")
                .slice(0, 220) || m.content.slice(0, 220)}
            </div>
          )}
          {m.attachments?.length > 0 && (
            <div className="fpost-atts">
              {m.attachments.map((a) => a.mime?.startsWith("image/")
                ? <img key={a.id} src={api.fileUrl(a.id)} alt={a.name} loading="lazy" />
                : <span key={a.id} className="att-chip"><Ico n="clip" s={11} /> {a.name}</span>)}
            </div>
          )}
          <div className="fpost-meta">
            <b style={{ color: m.author?.avatar_color }}>{m.author?.display_name}</b>
            <span>💬 {m.thread_count || 0}</span>
            {m.last_reply && (
              <span className="fpost-last" title={m.last_reply.content}>
                last by {m.last_reply.author?.display_name} · {timeAgo(m.last_reply.created_at)}
              </span>
            )}
            {m.reactions?.length > 0 && (
              <span className="fpost-reacts">
                {m.reactions.slice(0, 4).map((r) => `${r.emoji}${r.count}`).join(" ")}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
