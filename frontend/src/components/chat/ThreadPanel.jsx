import React, { useEffect, useRef, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";
import { Md } from "../../util";
import { Message } from "./Message";

export function ThreadPanel({ channel, thread, me, members, agents, emojis, roles, channels, onFwdJump, onClose, onDelete,
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

