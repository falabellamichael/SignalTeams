import React, { useState } from "react";
import { api } from "./api";
import Ico from "./components/Ico";
import KnotMark from "./components/KnotMark";

const BOT_UN = /^(agent|bot|hook):/;

export function Avatar({ user, size, showStatus }) {
  if (!user) return <div className={`avatar ${size || ""}`} />;
  const status = showStatus ? (user.online === false ? "offline" : (user.status || "online")) : null;
  const bot = BOT_UN.test(user.username || "");
  return (
    <div className={`avatar ${size || ""}${bot ? " bot" : ""}`} style={{ background: `${user.avatar_color}33`, border: `1px solid ${user.avatar_color}55` }}>
      {bot ? <KnotMark /> : <span>{user.avatar_emoji}</span>}
      {status && <span className={`dot ${status}`} />}
    </div>
  );
}

export function timeAgo(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function timeUntil(ts) {
  const s = ts - Date.now() / 1000;
  if (s < 0) return "overdue";
  if (s < 60) return "in <1m";
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

export function msgTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="md-pre">
      {code}
      <button type="button" className={`code-copy ${copied ? "copied" : ""}`}
        title={copied ? "Copied!" : "Copy code"}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}>
        <Ico n={copied ? "check" : "copy"} s={12} />
      </button>
    </pre>
  );
}

// markdown-lite: ```blocks```, `code`, **bold**, *italic*, links, @mentions, #channels, :emotes:
export function Md({ text, members, me, agents, emojis, roles, channels, onUser, onAgent, onChannel }) {
  const parts = [];
  let key = 0;
  const names = new Set((members || []).map((u) => u?.username?.toLowerCase()).filter(Boolean));
  const slugs = new Set((agents || []).map((a) => agentSlug(a?.name)).filter(Boolean));
  const emap = new Map((emojis || []).map((e) => [e.name, e.file_id]));
  const rmap = new Map((roles || []).map((r) => [agentSlug(r?.name), r]));
  const cmap = new Map((channels || []).map((c) => [c?.name?.toLowerCase(), c]));
  const blocks = String(text).split(/```([\s\S]*?)```/g);
  blocks.forEach((b, i) => {
    if (i % 2 === 1) {
      parts.push(<CodeBlock key={key++} code={b.replace(/^\n/, "")} />);
    } else if (b) {
      parts.push(...blockify(b, key, names, slugs, me, members, agents,
        emap, rmap, cmap, onUser, onAgent, onChannel));
      key += 100;
    }
  });
  return <>{parts}</>;
}

// line-level constructs: > quotes, - / * bullets, # headers
function blockify(b, keyBase, names, slugs, me, members, agents, emap, rmap, cmap, onUser, onAgent, onChannel) {
  const args = [names, slugs, me, members, agents, emap, rmap, cmap, onUser, onAgent, onChannel];
  const lines = b.split("\n");
  const out = [];
  let k = keyBase, list = null, prevBlock = false;
  const flush = () => {
    if (list) { out.push(<ul key={k++} className="md-ul">{list}</ul>); list = null; }
  };
  lines.forEach((ln, i) => {
    if (/^\s*[-*] /.test(ln)) {
      list = list || [];
      list.push(<li key={k++}>{inline(ln.replace(/^\s*[-*] /, ""), k, ...args)}</li>);
      k += 20;
      prevBlock = true;
      return;
    }
    flush();
    const quote = /^>\s?/.test(ln), head = /^#{1,3}\s/.test(ln);
    if (quote || head) {
      const stripped = ln.replace(quote ? /^>\s?/ : /^#{1,3}\s/, "");
      out.push(quote
        ? <div key={k++} className="md-quote">{inline(stripped, k, ...args)}</div>
        : <div key={k++} className="md-h">{inline(stripped, k, ...args)}</div>);
      k += 20;
      prevBlock = true;
      return;
    }
    out.push(<React.Fragment key={k++}>{i > 0 && !prevBlock ? "\n" : ""}{ln ? inline(ln, k, ...args) : null}</React.Fragment>);
    k += 20;
    prevBlock = false;
  });
  flush();
  return out;
}

const SEARCH_FILTER_RE = /\b(from|in|has|mentions|pinned|is|before|after|during):\S/i;
export const hasSearchQuery = (v) => v.trim().length >= 2 || SEARCH_FILTER_RE.test(v);

export function agentSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inline(text, keyBase, names, slugs, me, members, agents, emap, rmap, cmap, onUser, onAgent, onChannel) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(__[^_\n]+__)|(\|\|[^|\n]+\|\|)|(https?:\/\/[^\s<]+)|(:[a-z0-9_]{2,32}:)|(#\w+)|(@\w+)/g;
  let last = 0, m, k = keyBase;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [full] = m;
    if (full.startsWith("`")) out.push(<code key={k++} className="md-code">{full.slice(1, -1)}</code>);
    else if (full.startsWith("**")) out.push(<b key={k++}>{full.slice(2, -2)}</b>);
    else if (full.startsWith("~~")) out.push(<s key={k++}>{full.slice(2, -2)}</s>);
    else if (full.startsWith("__")) out.push(<u key={k++}>{full.slice(2, -2)}</u>);
    else if (full.startsWith("||")) out.push(
      <span key={k++} className="md-spoiler" title="spoiler — click to reveal"
        onClick={(e) => e.currentTarget.classList.add("open")}>{full.slice(2, -2)}</span>);
    else if (full.startsWith("*")) out.push(<i key={k++}>{full.slice(1, -1)}</i>);
    else if (full.startsWith("http")) out.push(<a key={k++} href={full} target="_blank" rel="noreferrer">{full}</a>);
    else if (full.startsWith(":")) {
      const fid = emap?.get(full.slice(1, -1));
      out.push(fid
        ? <img key={k++} className="md-emoji" src={api.fileUrl(fid)} title={full} alt={full} />
        : full);
    } else if (full.startsWith("#")) {
      const c = cmap?.get(full.slice(1).toLowerCase());
      out.push(c
        ? <span key={k++} className="md-mention ch" title={`jump to #${c.name}`}
            onClick={() => onChannel?.(c)}>#{c.name}</span>
        : full);
    } else {
      const uname = full.slice(1).toLowerCase();
      if (uname === "everyone" || uname === "here") {
        out.push(<span key={k++} className="md-mention bcast"
          title={uname === "everyone" ? "notifies everyone in the channel" : "notifies online members"}>{full}</span>);
      } else if (names.has(uname)) {
        const u = (members || []).find((x) => x?.username?.toLowerCase() === uname);
        out.push(<span key={k++} className={`md-mention ${me?.username?.toLowerCase() === uname ? "me" : ""}`}
          style={u && onUser ? { cursor: "pointer" } : undefined}
          onClick={() => u && onUser?.(u)}>{full}</span>);
      } else if (rmap?.has(uname)) {
        const r = rmap.get(uname);
        out.push(<span key={k++} className="md-mention role"
          style={{ color: r.color, background: r.color + "1f" }}
          title={`role — pings everyone with ${r.name}`}>@{r.name}</span>);
      } else if (slugs.has(uname)) {
        const a = (agents || []).find((x) => agentSlug(x?.name) === uname);
        out.push(<span key={k++} className="md-mention ag" title="agent — it may reply"
          style={a && onAgent ? { cursor: "pointer" } : undefined}
          onClick={() => a && onAgent?.(a)}>{full}</span>);
      } else out.push(full);
    }
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function msgDay(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yd = new Date(today); yd.setDate(yd.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yd.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}
