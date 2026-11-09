import React, { useEffect, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { sendWS } from "../ws";
import { Avatar, Md, agentSlug, msgDay } from "../util";
import { onVoice, joinVoice, leaveVoice, toggleVoiceMute, toggleDeafen, toggleShare, toggleCam, askVoiceRoster } from "../voice";
import { QUICK, EMOJI_PICK, SLASH_COMMANDS, STANDARD_EMOJIS } from "./chat/consts";
import { Message } from "./chat/Message";
import StageFocus, { VideoStack } from "./StageFocus";
import { ChannelTools } from "./chat/ChannelTools";
import { ThreadPanel } from "./chat/ThreadPanel";
import { ForumFeed } from "./chat/ForumView";
import { MessageAiModal } from "./modals/aimessage";
import { playCue } from "../audioCues";
import { useAi } from "../aiFlags";

// rough "is this message mostly non-Latin script" — the translate flag only
// fires on text worth translating (CJK, Cyrillic, Arabic, …)
function _nonLatin(s) {
  const t = (s || "").replace(/[\s\p{P}\p{N}]/gu, "");
  if (t.length < 8) return false;
  const latin = (t.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return latin / t.length < 0.5;
}

export default function ChatView({ channel, server, onDm, members, me, emojis, roles, channels = [], onAgentOpen, onPackOpen, onShareAgent, onUserOpen, onForward, onFwdJump, focusMsg, newSince = 0, onGroupAdd, onGroupRename, blocked, onMarkUnread, onWorkspace, onEditChannel }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [atts, setAtts] = useState([]);
  const [typers, setTypers] = useState({});
  const [, setTypTick] = useState(0);   // 1s re-render while typers exist (elapsed counter)
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
  const [userMenu, setUserMenu] = useState(null); // {x, y, u}
  const [aiModalMsg, setAiModalMsg] = useState(null); // {msg, initialOp}
  const [hasMore, setHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQ, setEmojiQ] = useState("");
  const [lastSent, setLastSent] = useState(0);
  const [sendErr, setSendErr] = useState("");
  const loadingOlder = useRef(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingSent = useRef(0);
  const pendingJump = useRef(null);   // msg id to scroll+flash once rendered
  const jumpTries = useRef(0);        // pages pulled while hunting a pendingJump target
  const scrollMem = useRef({});       // channel.id -> scrollTop when we left it
  const justPaged = useRef(false);    // suppress bottom-scroll after prepending a page
  const newSeen = useRef(false);      // landed on the unread divider once per channel open
  const atBottom = useRef(true);      // scrolled to the live edge
  const prevLen = useRef(0);
  const [pendingNew, setPendingNew] = useState(0);
  const [editTarget, setEditTarget] = useState(null);  // {id, n} — ArrowUp opens that msg's editor
  const [listening, setListening] = useState(false);   // AI "speech to text" dictation
  const recRef = useRef(null);
  const dictBase = useRef("");                          // draft text before dictation began
  const aiFlags = useAi(channel);                       // AI capability toggles (server + local)
  const aiFlagsRef = useRef(aiFlags);
  aiFlagsRef.current = aiFlags;                         // WS handlers read fresh flags

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
    const cid = channel.id;
    setMsgs([]); setThread(null); setHasMore(false); loadingOlder.current = false;
    recRef.current?.stop(); setListening(false);
    newSeen.current = false;
    setDraft(localStorage.getItem("st.draft." + channel.id) || "");
    setSendErr(""); setLastSent(0);
    setReads(channel.reads || {});
    setKnocked(channel.knocked || false);
    askVoiceRoster(channel.id);
    if (channel.kind === "dm") api.markRead(channel.id).catch(() => {});
    atBottom.current = true; prevLen.current = 0; setPendingNew(0); setEditTarget(null);
    // switching channels lands you in the composer, ready to type
    setTimeout(() => inputRef.current?.focus(), 0);
    if (!channel.locked) {
      api.messages(channel.id).then((m) => { setMsgs(m); setHasMore(m.length >= 50); }).catch(() => {});
      api.saved().then((s) => setSavedIds(new Set(s.map((x) => x.id)))).catch(() => {});
      if (channel.role_id) api.knocks(channel.id).then(setKnocks).catch(() => setKnocks([]));
      else setKnocks([]);
    }
    // leaving this channel — stash the scroll offset so coming back
    // puts you where you were, not the bottom
    return () => { scrollMem.current[cid] = listRef.current?.scrollTop ?? null; };
  }, [channel.id, channel.locked]);

  const [knocks, setKnocks] = useState([]);
  const [knocked, setKnocked] = useState(false);
  const [voice, setVoice] = useState({ channelId: 0, joined: false, muted: false, roster: [], rosters: {} });
  const [vsFocus, setVsFocus] = useState(null);   // expanded video card id
  const [vsSels, setVsSels] = useState({});       // picked feed index per card
  useEffect(() => onVoice(setVoice), []);
  useEffect(() => { if (voice.err) setSendErr(voice.err); }, [voice.err]);
  async function joinCall() {
    try { await joinVoice(channel.id, me); }
    catch (e) { console.warn("voice join failed:", e); setSendErr("No mic access — allow microphone to join voice"); }
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
      if (!el) {
        if (hasMore && jumpTries.current < 15) { jumpTries.current++; loadOlder(); }
        else pendingJump.current = null;    // hit channel start — message deleted/unreachable
        return;
      }
      const id = pendingJump.current;
      pendingJump.current = null;
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1800);
      return;
    }
    if (justPaged.current) { justPaged.current = false; prevLen.current = msgs.length; return; }
    if (prevLen.current === 0 && msgs.length) {
      // returning to a channel you had scrolled — put the view back where it was
      const mem = scrollMem.current[channel.id];
      const el = listRef.current;
      if (mem != null && mem > 120 && el) {
        el.scrollTop = mem; atBottom.current = false; newSeen.current = true;
        prevLen.current = msgs.length;
        return;
      }
    }
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
    jumpTries.current = 0;
    const el = document.getElementById("msg-" + id);
    if (el) {
      pendingJump.current = null;
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1800);
    } else if (hasMore) {
      loadOlder();                    // hunt backward — each page re-checks pendingJump
    } else {
      pendingJump.current = null;
    }
  }

  // App-level jump (global search / mention click): focusMsg = {id, ch, n}
  useEffect(() => {
    if (focusMsg && focusMsg.ch === channel.id) jumpTo(focusMsg.id);
  }, [focusMsg, channel.id]);

  // live message events are pushed in by App via this prop registration
  useEffect(() => {
    channel._onMsg = (m) => {
      if (m.author?.id !== me?.id) { playCue("receive"); }
      if (m.thread_root) {
        // thread reply — bump the root's chip, feed the open panel
        setMsgs((prev) => prev.map((p) =>
          p.id === m.thread_root ? { ...p, thread_count: (p.thread_count || 0) + 1,
            last_reply: { id: m.id, created_at: m.created_at,
                          content: (m.content || "").slice(0, 80), author: m.author } } : p));
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
      // AI toggles — read agent replies aloud / translate foreign messages
      const uname = m.author?.username || "";
      if (aiFlagsRef.current.tts && m.author?.id !== me?.id && m.content
          && /^(agent|bot):/.test(uname)) {
        try {
          speechSynthesis.cancel();
          speechSynthesis.speak(new SpeechSynthesisUtterance(
            m.content.replace(/[*_`#>|[\]]/g, "").slice(0, 600)));
        } catch { /* speech synthesis unavailable */ }
      }
      if (aiFlagsRef.current.translate && m.author?.id !== me?.id
          && _nonLatin(m.content)) {
        api.translate(channel.id, m.content).then((r) => r?.text &&
          setMsgs((prev) => prev.map((p) => p.id === m.id ? { ...p, _tl: r.text } : p))
        ).catch(() => {});
      }
    };
    channel._onRead = (uid, ts) => setReads((r) => ({ ...r, [uid]: Math.max(r[uid] || 0, ts) }));
    channel._onTyping = (u, on) => setTypers((t) =>
      ({ ...t, [u.id]: on ? { ...u, _t0: t[u.id]?._t0 || Date.now() } : undefined }));
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

  // 1s tick while anyone's typing — drives the elapsed counter in the
  // working indicator ("thinking… (14s)")
  useEffect(() => {
    if (!Object.keys(typers).length) return;
    const iv = setInterval(() => setTypTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [typers]);

  async function onPin(m) {
    await api.pinMessage(m.id).catch(() => {});
  }

  async function onReact(m, emoji) {
    playCue("pop");
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
      const at = Math.max(v.lastIndexOf("@", caret - 1),
                          v.lastIndexOf(":", caret - 1),
                          v.lastIndexOf("#", caret - 1));
      const sym = at >= 0 ? v[at] : null;
      if (at >= 0 && (at === 0 || /\s/.test(v[at - 1]))) {
        const query = v.slice(at + 1, caret);
        // channel names carry hyphens — the query char set follows the symbol
        const qok = sym === "#" ? /^[\w-]*$/.test(query) : /^\w*$/.test(query);
        if (qok && (sym === "@" || sym === "#" || query.length >= 1)) {
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
    const ins = mention.sym === ":" ? (o.char ? o.char : ":" + o.insert + ":")
      : mention.sym === "/" ? "/" + o.insert
      : mention.sym === "#" ? "#" + o.insert : "@" + o.insert;
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
    if (v === "/flip") return Math.random() < 0.5 ? "🪙 flipped a coin: **Heads**!" : "🪙 flipped a coin: **Tails**!";
    if (v.startsWith("/spoiler ")) return "||" + v.slice(9).trim() + "||";
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

  // AI "speech to text" — dictate into the composer via the Web Speech API;
  // interim results paint live, committed finals stay in the draft
  function toggleDictate() {
    if (listening) { recRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    recRef.current = r;
    dictBase.current = draft ? draft.replace(/\s+$/, "") + " " : "";
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let finals = "", inter = "";
      for (const res of e.results) {
        if (res.isFinal) finals += res[0].transcript;
        else inter += res[0].transcript;
      }
      setDraft((dictBase.current + finals + inter).trimStart());
    };
    r.onend = r.onerror = () => setListening(false);
    try { r.start(); setListening(true); } catch { setListening(false); }
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
    const nick = v.match(/^\/nick(?:\s+(.+))?$/i);
    if (nick) {
      if (!channel.server_id) { setSendErr("Nicknames can only be set in servers"); return; }
      setDraft("");
      try {
        const newNick = nick[1]?.trim() || "";
        await api.setNick(channel.server_id, newNick);
        setSendErr("");
      } catch (e) { setDraft(v); setSendErr(e.message); }
      return;
    }
    const sm = v.match(/^\/slowmode(?:\s+(\d+))?$/i);
    if (sm) {
      const s = Math.max(0, Math.min(parseInt(sm[1] || "0", 10), 21600));
      setDraft("");
      try {
        await api.editChannel(channel.id, { slowmode_secs: s });
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
    if (v === "/clear") {
      setDraft(""); setSendErr("");
      return;
    }
    const topic = v.match(/^\/topic(?:\s+(.+))?$/i);
    if (topic) {
      if (channel.kind === "dm" || !channel.server_id) {
        setSendErr("Topics can only be set on server channels"); return;
      }
      setDraft("");
      try {
        await api.editChannel(channel.id, { topic: (topic[1] || "").trim().slice(0, 200) });
        setSendErr("");
      } catch (e) { setDraft(v); setSendErr(e.message); }
      return;
    }
    const ball = v.match(/^\/8ball(?:\s+(.+))?$/i);
    if (ball) {
      const answers = [
        "It is certain", "Without a doubt", "Yes, definitely", "Most likely",
        "Signs point to yes", "Reply hazy, try again", "Ask again later",
        "Cannot predict now", "Don't count on it", "My reply is no",
        "Outlook not so good", "Very doubtful"];
      const pickA = answers[Math.floor(Math.random() * answers.length)];
      setDraft("");
      try {
        const m = await api.send(channel.id,
          `🎱 ${ball[1] ? `“${ball[1].trim()}” — ` : ""}${pickA}`, null, [], null, replyTo?.id || null);
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
    playCue("send");
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

  function handleWave(targetUser) {
    playCue("pop");
    playCue("send");
    const greeting = targetUser
      ? `👋 Welcome to the server, @${targetUser.username}!`
      : `👋 Hello everyone!`;
    api.send(channel.id, greeting)
      .then((m) => {
        setMsgs((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m]);
      })
      .catch((e) => setSendErr(e.message || "Wave failed"));
  }

  function onReply(m) {
    setReplyTo(m);
    inputRef.current?.focus();
  }

  function openMenu(x, y, m, setEditing) {
    setMenu({
      x: Math.min(Math.max(10, x), window.innerWidth - 220),
      y: Math.min(Math.max(10, y), Math.max(10, window.innerHeight - 440)),
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

  function onPaste(e) {
    // screenshots/clipped files land as clipboard files — attach them
    // instead of pasting nothing (text still pastes normally)
    if (e.clipboardData?.files?.length) {
      e.preventDefault();
      uploadFiles(e.clipboardData.files);
    }
  }

  const matches = mention
    ? mention.sym === ":"
      ? [
          ...(emojis || []).filter((e) =>
            e.name.toLowerCase().startsWith(mention.query.toLowerCase()))
            .slice(0, 5).map((e) => ({ kind: "emoji", id: "e" + e.id, insert: e.name, e })),
          ...STANDARD_EMOJIS.filter((e) =>
            e.name.startsWith(mention.query.toLowerCase()))
            .slice(0, 5).map((e) => ({ kind: "stdemoji", id: "s" + e.name, insert: e.name, char: e.char, e })),
        ]
    : mention.sym === "#"
      ? (channels || []).filter((c) =>
          c.name.toLowerCase().replace(/-/g, "").includes(
            mention.query.toLowerCase().replace(/-/g, "")))
          .slice(0, 6).map((c) => ({ kind: "chan", id: "ch" + c.id, insert: c.name, c }))
    : mention.sym === "/"
      ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(mention.query.toLowerCase()))
          .map((c) => ({ kind: "cmd", id: "c" + c.cmd, insert: c.cmd, c }))
    : [
      ...("silent".startsWith(mention.query.toLowerCase()) && mention.query
        ? [{ kind: "silent", id: "silent", insert: "silent" }] : []),
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
    playCue("key", { key: e.key });
    if (e.key === "Backspace" && !draft && replyTo) { setReplyTo(null); return; }
    if (mention && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel + 1) % matches.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel + matches.length - 1) % matches.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        const pick = matches[mention.sel] || matches[0];
        // a fully-typed /command runs on Enter — re-picking it would just fill the same text
        if (e.key === "Enter" && mention.sym === "/" && pick.insert === mention.query) {
          e.preventDefault(); setMention(null); send(); return;
        }
        e.preventDefault(); pickMention(pick); return;
      }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); return; }
    // Discord parity — ArrowUp in an empty composer edits your last message
    if (e.key === "ArrowUp" && !draft) {
      e.preventDefault();
      const last = [...msgs].reverse()
        .find((x) => x.author?.id === me?.id && !x.system && !x.agent);
      if (last) setEditTarget({ id: last.id, n: Date.now() });
    }
  }

  const typerList = Object.values(typers).filter(Boolean);
  const isBotTyper = (t) => !!(t?.bot || /^[a-z-]+:/.test(t?.id || ""));
  const typerLabel = (t) => {
    const base = t?.phase === "tools" ? `running ${t.tool || "tools"}`
      : t?.phase || (isBotTyper(t) ? "investigating" : "typing");
    const secs = t?._t0 ? Math.floor((Date.now() - t._t0) / 1000) : 0;
    return `${base}…${secs >= 4 ? ` (${secs}s)` : ""}`;
  };
  const agentic = typerList.some(isBotTyper);
  let lastDay = "", lastAuthor = null, lastTs = 0;

  // DM read receipt — who's caught up past my last message
  const lastOwn = [...msgs].reverse().find((m) => !m.thread_root && m.author?.id === me?.id);
  const dmMembers = members || [channel.other, me].filter(Boolean);
  const seenBy = channel.kind === "dm" && lastOwn
    ? dmMembers.filter((u) => u && u.id !== me?.id && (reads[u.id] || 0) >= lastOwn.created_at)
    : [];

  // one card per video user — cam + screen feeds grouped on it; the strip
  // stays up top and a focused card fills the chat area below
  const videoCards = [];
  const mine = [
    voice.camStream && { stream: voice.camStream, kind: "cam" },
    voice.screenStream && { stream: voice.screenStream, kind: "screen" },
  ].filter(Boolean);
  if (mine.length) videoCards.push({ id: "me", name: me?.display_name || "You", short: "your", feeds: mine });
  const vidByUid = new Map();
  for (const v of Object.values(voice.videos || {})) {
    if (!vidByUid.has(v.uid)) vidByUid.set(v.uid, []);
    vidByUid.get(v.uid).push(v);
  }
  for (const [uid, feeds] of vidByUid) {
    // a sharer's screen is the feed people come to watch — default to it
    feeds.sort((a, b) => (b.kind === "screen") - (a.kind === "screen"));
    const m = voice.roster.find((x) => x.id === uid);
    videoCards.push({ id: uid, name: m?.display_name || "…", short: `${m?.display_name || "…"}'s`, feeds });
  }
  const focusCard = videoCards.find((c) => c.id === vsFocus) || null;
  const vsSel = (id) => vsSels[id] ?? 0;
  const setVsSel = (id, v) => setVsSels((s) => ({ ...s, [id]: typeof v === "function" ? v(s[id] ?? 0) : v }));

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
          voice={voice} onJoinCall={joinCall} onLeaveCall={leaveVoice}
          onWorkspace={onWorkspace} />
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
        {videoCards.length > 0 && (
          <div className="voice-stage">
            {videoCards.map((c) => (
              <VsTile key={c.id} card={c} sel={vsSel(c.id)} onSel={(v) => setVsSel(c.id, v)}
                active={vsFocus === c.id}
                onZoom={() => setVsFocus((f) => (f === c.id ? null : c.id))} />
            ))}
          </div>
        )}
        {focusCard && (
          <StageFocus card={focusCard} sel={vsSel(focusCard.id)}
            onSel={(v) => setVsSel(focusCard.id, v)}
            onClose={() => setVsFocus(null)} />
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
            {channel.roster.map((a) => {
              const w = typerList.find((t) => isBotTyper(t) &&
                (t.display_name === a.name || String(t.id) === `agent:${agentSlug(a.name)}`));
              return (
                <button key={a.id} className={`r-chip ${w ? "working" : ""}`}
                  title={w ? `${a.name} — ${typerLabel(w)}` : `Summon @${agentSlug(a.name)}`}
                  onClick={() => onAgentOpen(agents.find((x) => x.id === a.id) || a)}>
                  {w && <img className="r-knot" src="/brand/knot-loop.png" alt="" />}
                  {a.icon} {a.name}
                </button>
              );
            })}
            <button className="r-chip r-huddle" title="Summon every resident"
              disabled={huddling}
              onClick={async () => {
                setHuddling(true);
                try { await api.huddle(channel.id); }
                finally { setTimeout(() => setHuddling(false), 3000); }
              }}>✦ huddle</button>
          </div>
        )}
        <div className={`msgs${focusCard ? " hidden" : ""}`} ref={listRef} onScroll={onListScroll}
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
          ) : channel.kind === "forum" ? (
          <>
          {hasMore && <div className="idehint" style={{ textAlign: "center", padding: "4px 0" }}>
            scroll up for earlier posts…</div>}
          <ForumFeed channel={channel} me={me} msgs={msgs}
            onOpen={openThread}
            onPosted={(m) => setMsgs((prev) => prev.some((p) => p.id === m.id) ? prev : [...prev, m])} />
          </>) : (<>
          {hasMore && <div className="idehint" style={{ textAlign: "center", padding: "4px 0" }}>
            scroll up for earlier messages…</div>}
          {!hasMore && (
            <ChannelGreeting channel={channel} me={me} onWave={handleWave}
              onEditChannel={onEditChannel} owner={me?.id === server?.owner_id} />
          )}
          {msgs.map((m, i) => {
            const day = msgDay(m.created_at);
            const grouped = day === lastDay && m.author?.id === lastAuthor
              && m.created_at - lastTs < 300 && !m.agent && !m.pack && !m.system;
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
                  onFwdJump={onFwdJump} onWave={handleWave} editTarget={editTarget}
                  onJump={jumpTo}
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
          {typerList.length > 0 && (() => {
            const names = [...new Set(typerList.map((t) => t.display_name))];
            const lt = typerList.find((t) => t.phase && !/cooling|skipped/.test(t.phase))
              || typerList.find((t) => t.phase) || typerList[0];
            return (
              <span>{agentic && <img className="typknot" src="/brand/knot-loop.png" alt="" />}
                <b>{names.join(", ")}</b>
                {names.length === 1 ? " is" : " are"} {typerLabel(lt)}
                {agentic && <button className="ghost ty-stop" title="stop the agent"
                  onClick={() => typerList.filter(isBotTyper).forEach((t) =>
                    api.agentStop(channel.id, t.id).catch(() => {}))}>✕</button>}</span>
            );
          })()}
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
                {(a.mime || "").startsWith("image/")
                  ? <img className="att-thumb" src={api.fileUrl(a.id)} alt={a.name} />
                  : <Ico n="clip" s={12} />} {a.name}
                <button className="ghost" title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`}
                  onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}><Ico n="x" s={11} /></button>
              </span>
            ))}
          </div>
        )}
        {!channel.locked && channel.kind !== "forum" && (
        <div className="composer">
          {matches.length > 0 && (
            <div className="mention-pop">
              {matches.map((o, i) => (
                <div key={o.id} className={`mopt ${i === mention.sel ? "sel" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); pickMention(o); }}>
                  {o.kind === "chan" ? (
                    <><span className="aicon">{o.c.kind === "voice" ? "🔊" : o.c.kind === "forum" ? "📋" : "#"}</span>
                      <b>#{o.c.name}</b><span>{o.c.topic || "channel"}</span></>
                  ) : o.kind === "cmd" ? (
                    <><span className="aicon">{o.c.icon}</span>
                      <b>/{o.c.cmd} <i>{o.c.usage}</i></b><span>{o.c.desc}</span></>
                  ) : o.kind === "silent" ? (
                    <><span className="aicon">🔕</span>
                      <b>@silent</b><span>send quietly — mentions don't ping</span></>
                  ) : o.kind === "emoji" ? (
                    <><img className="md-emoji" src={api.fileUrl(o.e.file_id)} alt="" />
                      <b>:{o.insert}:</b><span>custom emoji</span></>
                  ) : o.kind === "stdemoji" ? (
                    <><span className="aicon">{o.char}</span>
                      <b>:{o.insert}:</b><span>emoji</span></>
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
              <input className="ep-search" autoFocus placeholder="Find an emoji…"
                value={emojiQ} onChange={(e) => setEmojiQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEmojiOpen(false);
                  if (e.key === "Enter") {
                    const q = emojiQ.toLowerCase(), hit =
                      (emojis || []).find((x) => x.name.toLowerCase().includes(q)) ||
                      STANDARD_EMOJIS.find((x) => x.name.includes(q));
                    if (hit) { insertEmoji(hit.char || ":" + hit.name + ":"); setEmojiQ(""); }
                  }
                }} />
              {(() => {
                const q = emojiQ.toLowerCase();
                const srv = (emojis || []).filter((e) => !q || e.name.toLowerCase().includes(q));
                const std = q ? STANDARD_EMOJIS.filter((e) => e.name.includes(q)) : EMOJI_PICK.map((c) => ({ char: c }));
                return (<>
                  {srv.length > 0 && (
                    <>
                      <div className="ep-head">Server emoji</div>
                      {srv.map((e) => (
                        <span key={"c" + e.id} title={":" + e.name + ":"}
                          onClick={() => { insertEmoji(":" + e.name + ":"); setEmojiQ(""); }}>
                          <img className="md-emoji" src={api.fileUrl(e.file_id)} alt={":" + e.name + ":"} />
                        </span>
                      ))}
                    </>)}
                  {std.length > 0 && <div className="ep-head">Emoji</div>}
                  {std.map((e) => (
                    <span key={e.name || e.char} title={e.name ? ":" + e.name + ":" : e.char}
                      onClick={() => { insertEmoji(e.char); setEmojiQ(""); }}>{e.char}</span>
                  ))}
                  {q && srv.length + std.length === 0 && (
                    <div className="ep-head">No emoji match “{emojiQ}”</div>)}
                </>);
              })()}
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
            onClick={() => { setEmojiOpen((o) => !o); setEmojiQ(""); }}><Ico n="emoji" /></button>
          <button className={`ghost cbtn ${preview ? "on" : ""}`} title="Preview markdown"
            onClick={() => setPreview((p) => !p)}><Ico n="eye" /></button>
          {aiFlags.stt && (window.SpeechRecognition || window.webkitSpeechRecognition) && (
            <button className={`ghost cbtn mic ${listening ? "on rec" : ""}`}
              title={listening ? "Stop dictation" : "Dictate message (speech to text)"}
              onClick={toggleDictate}><Ico n={listening ? "micOff" : "mic"} /></button>
          )}
          <textarea ref={inputRef} rows={1} value={draft}
            placeholder={`Message ${channel.kind === "dm" ? "@" + (channel.other?.display_name || channel.name || "") : "#" + channel.name}`}
            onChange={onType} onKeyDown={key} onPaste={onPaste}
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
              <div className="mrow" key={m.id} style={{ cursor: "pointer" }}
                onClick={(e) => onUserOpen?.(m, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setUserMenu({
                    x: Math.min(e.clientX, window.innerWidth - 220),
                    y: Math.min(e.clientY, window.innerHeight - 300),
                    u: m
                  });
                }}>
                <Avatar user={m} size="sm" showStatus />
                <span className="n" style={mRoles[0] ? { color: mRoles[0].color } : undefined}
                  title={m.nickname ? `@${m.username}` : undefined}>
                  {m.nickname || m.display_name}</span>
                {mRoles.slice(0, 2).map((r) => (
                  <span key={r.id} className="role-pill" style={{ borderColor: r.color, color: r.color }}>
                    {r.name}</span>
                ))}
                {m.status_text && <span className="mstatus">{m.status_text}</span>}
                {typers[m.id] && <span className="mtype">
                  {isBotTyper(typers[m.id]) && <img className="typknot" src="/brand/knot-loop.png" alt="" />}
                  {typerLabel(typers[m.id])}</span>}
              </div>
            );
          })}
          <div className="mgroup">Offline — {members.filter((m) => !m.online).length}</div>
          {members.filter((m) => !m.online).map((m) => {
            const mRoles = (roles || []).filter((r) => (m.role_ids || []).includes(r.id));
            return (
              <div className="mrow off" key={m.id} style={{ cursor: "pointer" }}
                onClick={(e) => onUserOpen?.(m, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setUserMenu({
                    x: Math.min(e.clientX, window.innerWidth - 220),
                    y: Math.min(e.clientY, window.innerHeight - 300),
                    u: m
                  });
                }}>
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
            {menu.m.content && (
              <>
                <div className="mm-sep" />
                <div className="mm-subhead">AI Actions</div>
                <div className="mm-item" onClick={() => { setAiModalMsg({ msg: menu.m, initialOp: "summarize" }); setMenu(null); }}>
                  <Ico n="sparkle" s={13} /> Summarize
                </div>
                <div className="mm-item" onClick={() => { setAiModalMsg({ msg: menu.m, initialOp: "explain" }); setMenu(null); }}>
                  <Ico n="help" s={13} /> Explain
                </div>
                <div className="mm-item" onClick={() => { setAiModalMsg({ msg: menu.m, initialOp: "rephrase" }); setMenu(null); }}>
                  <Ico n="edit" s={13} /> Rephrase
                </div>
                <div className="mm-item" onClick={() => { setAiModalMsg({ msg: menu.m, initialOp: "translate" }); setMenu(null); }}>
                  <Ico n="swap" s={13} /> Translate
                </div>
                <div className="mm-item" onClick={() => { setAiModalMsg({ msg: menu.m, initialOp: "reply" }); setMenu(null); }}>
                  <Ico n="reply" s={13} /> Draft reply
                </div>
              </>
            )}
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
      {aiModalMsg && (
        <MessageAiModal
          msg={aiModalMsg.msg}
          initialOp={aiModalMsg.initialOp}
          onClose={() => setAiModalMsg(null)}
          onInsertDraft={(text) => {
            setDraft((d) => (d ? d + " " + text : text));
            inputRef.current?.focus();
          }}
          onReplyWith={(m, text) => {
            setReplyTo(m);
            setDraft(text);
            inputRef.current?.focus();
          }}
        />
      )}
    
      {userMenu && (
        <>
          <div className="menu-scrim" onClick={() => setUserMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setUserMenu(null); }} />
          <div className="msg-menu user-ctx-menu" style={{ left: userMenu.x, top: userMenu.y }}>
            <div className="ucm-header" onClick={() => { onUserOpen?.(userMenu.u, { clientX: userMenu.x, clientY: userMenu.y }); setUserMenu(null); }}>
              <Avatar user={userMenu.u} size="sm" showStatus />
              <div className="ucm-who">
                <div className="ucm-name">{userMenu.u.nickname || userMenu.u.display_name}</div>
                <div className="ucm-handle">@{userMenu.u.username}</div>
              </div>
            </div>
            <div className="mm-item" onClick={() => { onUserOpen?.(userMenu.u, { clientX: userMenu.x, clientY: userMenu.y }); setUserMenu(null); }}>
              <Ico n="user" s={14} /> Profile
            </div>
            <div className="mm-item" onClick={() => {
              const ins = `@${userMenu.u.username} `;
              setDraft((d) => d + ins);
              setUserMenu(null);
              inputRef.current?.focus();
            }}>
              <Ico n="at" s={14} /> Mention
            </div>
            {onDm && userMenu.u.id !== me?.id && (
              <div className="mm-item" onClick={() => { onDm(userMenu.u); setUserMenu(null); }}>
                <Ico n="chat" s={14} /> Message
              </div>
            )}
            <div className="mm-item" onClick={() => {
              navigator.clipboard?.writeText(String(userMenu.u.id));
              setUserMenu(null);
            }}>
              <Ico n="copy" s={14} /> Copy User ID
            </div>
            {server && (server.owner_id === me?.id || me?.is_admin) && userMenu.u.id !== me?.id && (
              <>
                <div className="mm-sep" />
                <div className="mm-item" onClick={async () => {
                  const curr = userMenu.u.nickname || "";
                  const n = prompt(`Change nickname for ${userMenu.u.display_name}:`, curr);
                  if (n !== null) {
                    await api.setNick(server.id, n.trim(), userMenu.u.id).catch((e) => alert(e.message));
                    setUserMenu(null);
                  }
                }}>
                  <Ico n="edit" s={14} /> Change Nickname
                </div>
                <div className="mm-item warn" onClick={async () => {
                  if (confirm(`Timeout ${userMenu.u.display_name} for 5 minutes?`)) {
                    await api.timeoutMember(server.id, userMenu.u.id, 5).catch((e) => alert(e.message));
                    setUserMenu(null);
                  }
                }}>
                  <Ico n="clock" s={14} /> Timeout (5m)
                </div>
                <div className="mm-item danger" onClick={async () => {
                  if (confirm(`Kick ${userMenu.u.display_name} from ${server.name}?`)) {
                    await api.kickMember(server.id, userMenu.u.id).catch((e) => alert(e.message));
                    setUserMenu(null);
                  }
                }}>
                  <Ico n="userMinus" s={14} /> Kick Member
                </div>
                <div className="mm-item danger" onClick={async () => {
                  const reason = prompt(`Ban ${userMenu.u.display_name} from ${server.name}? Reason:`);
                  if (reason !== null) {
                    await api.banMember(server.id, userMenu.u.id, reason).catch((e) => alert(e.message));
                    setUserMenu(null);
                  }
                }}>
                  <Ico n="ban" s={14} /> Ban Member
                </div>
              </>
            )}
          </div>
        </>
      )}

    </div>
  );
}


function VsTile({ card, sel, onSel, onZoom, active }) {
  const { feeds, short } = card;
  const idx = Math.min(sel, feeds.length - 1);
  const f = feeds[idx];
  if (!f) return null;
  return (
    <div className={`vs-tile zoomable${active ? " active" : ""}`}
      title={active ? "Back to chat" : "Expand"} onClick={onZoom}>
      <VideoStack feeds={feeds} sel={sel} />
      {feeds.length > 1 && (
        <button type="button" className="vs-flip"
          title={f.kind === "cam" ? "Show screen share" : "Show camera"}
          onClick={(e) => { e.stopPropagation(); onSel((s) => (s + 1) % feeds.length); }}>
          <Ico n="swap" s={13} />
        </button>
      )}
      <button type="button" className="vs-zoom" title={active ? "Back to chat" : "Expand"}
        onClick={(e) => { e.stopPropagation(); onZoom(); }}>
        <Ico n="expand" s={12} />
      </button>
      <span className="vs-name">{short} {f.kind === "cam" ? "camera" : "screen"}</span>
    </div>
  );
}


function ChannelGreeting({ channel, me, onWave, onEditChannel, owner }) {
  const isDm = channel.kind === "dm";
  const other = channel.other;
  const isAgent = channel.kind === "agents";
  const isVoice = channel.kind === "voice";
  const isForum = channel.kind === "forum";

  return (
    <div className="channel-greeting">
      <div className="cg-icon-wrap">
        {isDm ? (
          other ? <Avatar user={other} size="lg" /> : <span className="cg-hash">@</span>
        ) : (
          <span className="cg-hash">
            {channel.workspace ? "🗂" : isAgent ? "✦" : isVoice ? "🔊" : isForum ? "📋" : "#"}
          </span>
        )}
      </div>
      <h2 className="cg-title">
        {isDm
          ? (channel.name || `Direct message with ${other?.display_name || "Friend"}`)
          : `Welcome to #${channel.name}!`}
      </h2>
      <div className="cg-sub">
        {isDm
          ? `This is the start of your direct message history with @${other?.username || other?.display_name || "this user"}. Say hello!`
          : channel.topic
          ? channel.topic
          : `This is the start of the #${channel.name} channel.`}
      </div>
      <div className="cg-actions">
        {isDm && other?.id !== me?.id && (
          <button className="ghost cg-btn wave-btn" onClick={() => onWave(other)}>
            👋 Wave to {other?.display_name?.split(" ")[0] || "them"}
          </button>
        )}
        {!isDm && (
          <button className="ghost cg-btn wave-btn" onClick={() => onWave(null)}>
            👋 Wave hello
          </button>
        )}
        {!isDm && owner && onEditChannel && (
          <button className="ghost cg-btn" onClick={() => onEditChannel(channel)}>
            <Ico n="edit" s={13} /> Edit Channel
          </button>
        )}
      </div>
    </div>
  );
}
