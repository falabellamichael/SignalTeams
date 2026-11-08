import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import Ico from "./components/Ico";
import { api, getToken, setToken } from "./api";
import { connectWS, disconnectWS, onWS, sendWS } from "./ws";
import { getGuestChans, isGuestChan } from "./guestchan";
import { onVoice, joinVoice, leaveVoice, toggleVoiceMute, toggleDeafen, toggleShare, toggleCam } from "./voice";
import Rail from "./components/Rail";
import { HomeSidebar, ServerSidebar, MeBar, VoiceConnectedBar } from "./components/Sidebar";
import Bell from "./components/Bell";

const Login = lazy(() => import("./components/Login"));
const ChatView = lazy(() => import("./components/ChatView"));
const VoiceRoom = lazy(() => import("./components/VoiceRoom"));
const Library = lazy(() => import("./components/Library"));
const Buzz = lazy(() => import("./components/Buzz"));
const Friends = lazy(() => import("./components/Friends"));
const Saved = lazy(() => import("./components/Saved"));
const AgentModal = lazy(() => import("./components/modals/agent/index.jsx").then((m) => ({ default: m.AgentModal })));
const PublishModal = lazy(() => import("./components/modals/publish.jsx").then((m) => ({ default: m.PublishModal })));
const ShareModal = lazy(() => import("./components/modals/share.jsx").then((m) => ({ default: m.ShareModal })));
const ServerModal = lazy(() => import("./components/modals/server.jsx").then((m) => ({ default: m.ServerModal })));
const ServerSettingsModal = lazy(() => import("./components/modals/serversettings.jsx").then((m) => ({ default: m.ServerSettingsModal })));
const ChannelModal = lazy(() => import("./components/modals/channel.jsx").then((m) => ({ default: m.ChannelModal })));
const PackModal = lazy(() => import("./components/modals/packs.jsx").then((m) => ({ default: m.PackModal })));
const PackCreateModal = lazy(() => import("./components/modals/packs.jsx").then((m) => ({ default: m.PackCreateModal })));
const ProfileModal = lazy(() => import("./components/modals/profile.jsx").then((m) => ({ default: m.ProfileModal })));
const GlobalSearchModal = lazy(() => import("./components/modals/search.jsx").then((m) => ({ default: m.GlobalSearchModal })));
const ForwardModal = lazy(() => import("./components/modals/forward.jsx").then((m) => ({ default: m.ForwardModal })));
const GroupDmModal = lazy(() => import("./components/modals/groupdm.jsx").then((m) => ({ default: m.GroupDmModal })));
const InboxModal = lazy(() => import("./components/modals/inbox.jsx").then((m) => ({ default: m.InboxModal })));
const PulseModal = lazy(() => import("./components/modals/pulse.jsx").then((m) => ({ default: m.PulseModal })));
const ShortcutsModal = lazy(() => import("./components/modals/shortcuts.jsx").then((m) => ({ default: m.ShortcutsModal })));
const PickAgentModal = lazy(() => import("./components/modals/pickagent.jsx").then((m) => ({ default: m.PickAgentModal })));
const SettingsModal = lazy(() => import("./components/modals/settings.jsx").then((m) => ({ default: m.SettingsModal })));
const EventsModal = lazy(() => import("./components/modals/events.jsx").then((m) => ({ default: m.EventsModal })));
const WorkspaceModal = lazy(() => import("./components/modals/workspace.jsx").then((m) => ({ default: m.WorkspaceModal })));
const Workspace = lazy(() => import("./components/Workspace"));

export default function App() {
  const [me, setMe] = useState(null);
  const [booted, setBooted] = useState(false);
  const [servers, setServers] = useState([]);
  const [server, setServer] = useState(null);          // full server detail
  const [view, setView] = useState("buzz");            // buzz|library|bench|friends|dm-N|server
  const [channel, setChannel] = useState(null);        // active channel object
  const [dms, setDms] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);
  const [friendsData, setFriendsData] = useState({ accepted: [], incoming: [] });
  const [theme, setTheme] = useState(() => localStorage.getItem("signalteams.theme") || "dark");
  const [voice, setVoice] = useState({ rosters: {} });
  const [refresh, setRefresh] = useState(0);
  const [focusMsg, setFocusMsg] = useState(null);  // {id, ch, n} — ChatView scrolls+flashes
  const [sideOpen, setSideOpen] = useState(
    () => !window.matchMedia?.("(max-width: 760px)").matches);
  const [modal, setModal] = useState(null);            // {kind, ...props}
  const [unread, setUnread] = useState({});            // channelId -> count
  const [mentions, setMentions] = useState({});        // channelId -> @me count
  const [blocked, setBlocked] = useState(new Set());   // user ids I've blocked
  const [benchCount, setBenchCount] = useState(0);
  const [welcomeOn, setWelcomeOn] = useState(() =>
    localStorage.getItem("st.welcome") !== "0");
  const [pendingJoin, setPendingJoin] = useState(() => {
    const m = location.hash.match(/^#join\/(.+)/);
    return m ? m[1] : null;
  });
  // links opened while the app is already running still capture the code
  useEffect(() => {
    const onHash = () => {
      const m = location.hash.match(/^#join\/(.+)/);
      if (m) setPendingJoin(m[1]);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [newSince, setNewSince] = useState(null);      // {ch, n} — unread count when channel opened
  const channelRef = useRef(null);
  const serverRef = useRef(null);
  const meRef = useRef(null);
  const navRef = useRef({});
  const typingTimers = useRef({});           // "cid:uid" -> timeout id
  const [dmTyping, setDmTyping] = useState({});   // channelId -> {uid: name}
  const [events, setEvents] = useState([]);            // upcoming events for `server`
  const [workspaces, setWorkspaces] = useState([]);    // workspaces in `server`
  const [wsOpen, setWsOpen] = useState(null);          // workspace object being edited
  const [wsAgents, setWsAgents] = useState([]);        // agents visible to me (agent desk)
  const chanServer = useRef({});                       // channelId -> serverId
  channelRef.current = channel;
  serverRef.current = server;
  meRef.current = me;
  navRef.current = { server, channel, dms, selectChannel, openDmEntry,
                     unread, mentions, openChannelById };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("signalteams.theme", theme);
  }, [theme]);

  // global keys: ⌘/Ctrl+K = search everywhere, Esc = close modal
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal({ kind: "gsearch" });
      } else if (((e.metaKey || e.ctrlKey) && e.key === "/") ||
                 (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey &&
                  !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) &&
                  !document.activeElement?.isContentEditable)) {
        e.preventDefault();
        setModal((m) => m?.kind === "shortcuts" ? null : { kind: "shortcuts" });
      } else if (e.altKey && !e.ctrlKey && !e.metaKey &&
                 (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const n = navRef.current;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const list = n.server
          ? (n.server.channels || []).filter((c) => !c.locked)
          : (n.dms || []);
        if (!list.length) return;
        const i = list.findIndex((c) => c.id === n.channel?.id);
        const next = list[((i < 0 ? 0 : i) + dir + list.length) % list.length];
        if (n.server) n.selectChannel(next); else n.openDmEntry(next);
      } else if (e.altKey && e.ctrlKey &&
                 (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const n = navRef.current, dir = e.key === "ArrowDown" ? 1 : -1;
        const list = [
          ...Object.values(fullServers.current)
            .flatMap((s) => (s.channels || []).filter((c) => !c.locked)),
          ...(n.dms || [])];
        const i = list.findIndex((c) => c.id === n.channel?.id);
        for (let k = 1; k <= list.length; k++) {
          const c = list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir * k + list.length) % list.length];
          if (((n.unread[c.id] || 0) + (n.mentions[c.id] || 0)) > 0) {
            const sid = chanServer.current[c.id];
            if (sid) n.openChannelById(c.id, sid);
            else n.openDmEntry(c);
            break;
          }
        }
      } else if (e.key === "Escape") {
        setModal((m) => (m ? null : m));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // auto-idle: 5 quiet minutes flips status to 🌙 (only when manually "online")
  const autoIdle = useRef(false);
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const EV = ["mousemove", "keydown", "mousedown", "wheel", "touchstart"];
    const mark = () => {
      if (Date.now() - lastActive.current < 5000) return;
      lastActive.current = Date.now();
      if (autoIdle.current) {
        autoIdle.current = false;
        sendWS({ type: "status", status: "online" });
      }
    };
    const iv = setInterval(() => {
      if (!autoIdle.current && meRef.current?.status === "online"
          && Date.now() - lastActive.current > 5 * 60 * 1000) {
        autoIdle.current = true;
        sendWS({ type: "status", status: "idle" });
      }
    }, 20000);
    EV.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => { clearInterval(iv); EV.forEach((e) => window.removeEventListener(e, mark)); };
  }, []);

  // tab title shows live mention count, Discord-style "(3) SignalTeams"
  // + a red favicon dot so pings are visible at tab-strip glance
  const favOrig = useRef(null);
  useEffect(() => {
    const m = Object.values(mentions).reduce((a, b) => a + b, 0);
    document.title = m > 0 ? `(${m}) SignalTeams` : "SignalTeams";
    const link = document.querySelector("link[rel~='icon']") || (() => {
      const l = document.createElement("link");
      l.rel = "icon"; document.head.appendChild(l); return l;
    })();
    if (!favOrig.current) favOrig.current = link.href || "/icon.svg";
    if (m > 0) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0, 32, 32);
        g.beginPath(); g.arc(24, 24, 8, 0, Math.PI * 2);
        g.fillStyle = "#e5484d"; g.fill();
        g.strokeStyle = "#1b1d22"; g.lineWidth = 2; g.stroke();
        link.href = c.toDataURL();
      };
      img.src = favOrig.current;
    } else if (link.href !== favOrig.current) link.href = favOrig.current;
  }, [mentions]);

  // boot: restore session
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { setMe(await api.me()); } catch { setToken(null); }
      }
      setBooted(true);
    })();
  }, []);

  // permalink routing — origin/#/s/{sid}/c/{cid}/m/{mid} deep-links a message
  useEffect(() => {
    const resolve = () => {
      const m = (location.hash || "").match(/#\/s\/(\d+)\/c\/(\d+)\/m\/(\d+)/);
      if (m) openChannelById(+m[2], +m[1] || null, +m[3]);
      const a = (location.hash || "").match(/#\/agent\/(\d+)/);
      if (a) api.agent(+a[1]).then((ag) => openAgent(ag)).catch(() => {});
    };
    if (me) resolve();
    window.addEventListener("hashchange", resolve);
    return () => window.removeEventListener("hashchange", resolve);
  }, [me?.id]);

  const refreshLists = useCallback(async () => {
    const [sv, dm, fr, bl] = await Promise.all([
      api.servers().catch(() => []),
      api.dms().catch(() => []),
      api.friends().catch(() => ({ accepted: [], incoming: [] })),
      api.blocks().catch(() => []),
    ]);
    api.bench().then((b) => setBenchCount(b.length)).catch(() => {});
    setServers(sv); setDms(dm); setFriendsData(fr); setBlocked(new Set(bl));
    dm.forEach((d) => { chanServer.current[d.id] = null; });
    if (server) {
      const full = await api.server(server.id).catch(() => null);
      if (full) {
        setServer(full);
        full.channels.forEach((c) => { chanServer.current[c.id] = full.id; });
      }
    }
  }, [server?.id]);

  // build channel→server map for badges on all servers (small N, friends-scale)
  const fullServers = useRef({});
  useEffect(() => {
    servers.forEach((s) => api.server(s.id).then((full) => {
      fullServers.current[s.id] = full;
      full.channels.forEach((c) => { chanServer.current[c.id] = s.id; });
    }).catch(() => {}));
  }, [servers.length]);

  // invite link: #join/<code> → after auth, join and land in the server
  useEffect(() => {
    if (!me || !pendingJoin) return;
    setPendingJoin(null);
    history.replaceState(null, "", location.pathname);
    api.joinServer(pendingJoin)
      .then(async (s) => { await refreshLists(); pickServer(s.id); })
      .catch((e) => alert(e.message));
  }, [me, pendingJoin]);

  useEffect(() => {
    if (!me) return;
    connectWS();
    refreshLists();
    const offVoice = onVoice(setVoice);
    const off = onWS((evt) => {
      if (evt.type === "presence") {
        setOnlineIds(evt.online);
      } else if (evt.type === "message") {
        const ch = channelRef.current;
        const guests = getGuestChans().filter((g) => g.id === evt.channel_id);
        const isActive = ch && ch.id === evt.channel_id;
        const guestActive = guests.length > 0;
        if (isActive && ch._onMsg) ch._onMsg(evt.message);
        for (const g of guests) {
          if (g._onMsg) g._onMsg(evt.message);
        }
        if (guestActive) {
          setUnread((u) => u[evt.channel_id] ? { ...u, [evt.channel_id]: 0 } : u);
          setMentions((mp) => mp[evt.channel_id] ? { ...mp, [evt.channel_id]: 0 } : mp);
        }
        if (!isActive && !guestActive) {
          setUnread((u) => ({ ...u, [evt.channel_id]: (u[evt.channel_id] || 0) + 1 }));
          if (evt.mentions?.includes(me.id))
            setMentions((mp) => ({ ...mp, [evt.channel_id]: (mp[evt.channel_id] || 0) + 1 }));
        }
        maybeNotify(evt);
        refreshLists();
      } else if (evt.type === "message_deleted") {
        const ch = channelRef.current;
        if (ch && ch.id === evt.channel_id && ch._onDel) ch._onDel(evt.id);
        for (const g of getGuestChans())
          if (g.id === evt.channel_id && g._onDel) g._onDel(evt.id);
      } else if (evt.type === "reaction") {
        const ch = channelRef.current;
        if (ch && ch.id === evt.channel_id && ch._onReact) ch._onReact(evt.message_id, evt.reactions);
        for (const g of getGuestChans())
          if (g.id === evt.channel_id && g._onReact) g._onReact(evt.message_id, evt.reactions);
      } else if (evt.type === "message_updated") {
        const ch = channelRef.current;
        if (ch && ch.id === evt.channel_id && ch._onUpdate) ch._onUpdate(evt.message);
        for (const g of getGuestChans())
          if (g.id === evt.channel_id && g._onUpdate) g._onUpdate(evt.message);
      } else if (evt.type === "typing") {
        const ch = channelRef.current;
        if (ch && ch.id === evt.channel_id && ch._onTyping) ch._onTyping(evt.user, evt.on);
        for (const g of getGuestChans())
          if (g.id === evt.channel_id && g._onTyping) g._onTyping(evt.user, evt.on);
        const u = evt.user;
        if (u && u.id !== meRef.current?.id) {
          const key = `${evt.channel_id}:${u.id}`;
          clearTimeout(typingTimers.current[key]);
          if (evt.on) {
            typingTimers.current[key] = setTimeout(() => {
              setDmTyping((t) => {
                const cur = { ...(t[evt.channel_id] || {}) };
                delete cur[u.id];
                const next = { ...t };
                Object.keys(cur).length ? next[evt.channel_id] = cur : delete next[evt.channel_id];
                return next;
              });
            }, 7000);
          }
          setDmTyping((t) => {
            const cur = { ...(t[evt.channel_id] || {}) };
            if (evt.on) cur[u.id] = u; else delete cur[u.id];
            const next = { ...t };
            Object.keys(cur).length ? next[evt.channel_id] = cur : delete next[evt.channel_id];
            return next;
          });
        }
      } else if (evt.type === "read") {
        const ch = channelRef.current;
        if (ch && ch.id === evt.channel_id && ch._onRead) ch._onRead(evt.user_id, evt.ts);
        for (const g of getGuestChans())
          if (g.id === evt.channel_id && g._onRead) g._onRead(evt.user_id, evt.ts);
      } else if (evt.type === "buzz") {
        setRefresh((r) => r + 1);
      } else if (evt.type === "status") {
        setOnlineIds((ids) => evt.status === "offline" ? ids.filter((i) => i !== evt.user_id) : ids);
      } else if (evt.type === "event") {
        if (serverRef.current?.id === evt.server_id) {
          const ev = evt.event;
          setEvents((list) => {
            const rest = list.filter((x) => x.id !== ev.id);
            return ev.status === "cancelled" ? rest
              : [...rest, ev].sort((a, b) => a.starts_at - b.starts_at);
          });
        }
      } else if (evt.type === "server_deleted" || evt.type === "server_left") {
        setServers((sv) => sv.filter((s) => s.id !== evt.server_id));
        if (serverRef.current?.id === evt.server_id) goHome();
      } else if (evt.type === "workspace") {
        if (serverRef.current?.id) {
          api.workspaces(serverRef.current.id).then(setWorkspaces).catch(() => {});
        }
        window.dispatchEvent(new CustomEvent("st:workspace", { detail: evt }));
      } else if (evt.type === "server_changed") {
        if (serverRef.current?.id === evt.server_id) {
          api.server(evt.server_id).then((full) => {
            full.channels.forEach((c) => { chanServer.current[c.id] = full.id; });
            setServer(full);
            setChannel((cur) => cur && full.channels.find((c) => c.id === cur.id)
              ? full.channels.find((c) => c.id === cur.id) : full.channels[0] || null);
          }).catch(() => {});
        }
      }
    });
    return () => { off(); offVoice(); };
  }, [me]);

  useEffect(() => { window.__st = { unread, me }; });

  // ---- actions ----

  // opening the workspace Chat tab clears that channel's badges
  useEffect(() => {
    const h = (e) => {
      const cid = e.detail?.id;
      if (!cid) return;
      setUnread((u) => ({ ...u, [cid]: 0 }));
      setMentions((mp) => ({ ...mp, [cid]: 0 }));
    };
    window.addEventListener("st:guestchan", h);
    return () => window.removeEventListener("st:guestchan", h);
  }, []);

  function maybeNotify(evt) {
    if (localStorage.getItem("signalteams.notifs") === "0") return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const m = evt.message;
    if (!m || m.author?.id === me.id || me.muted?.includes(evt.channel_id)) return;
    const isDm = !chanServer.current[evt.channel_id];
    const pinged = evt.mentions?.includes(me.id);
    if (!pinged && !isDm) return;
    if (srvMutedSet.has(chanServer.current[evt.channel_id])) return; // muted server
    if (!pinged && me.notify_mentions?.includes(evt.channel_id)) return; // mention-only channel
    const watching = channelRef.current?.id === evt.channel_id
      || isGuestChan(evt.channel_id);
    if (!document.hidden && watching) return;
    const n = new Notification(
      pinged ? `${m.author?.display_name} mentioned you` : (m.author?.display_name || "SignalTeams"),
      { body: (m.content || "📎 attachment").slice(0, 120),
        icon: "/icon-192.png", tag: "st-" + evt.channel_id });
    n.onclick = () => {
      window.focus();
      openChannelById(evt.channel_id, chanServer.current[evt.channel_id]);
    };
    if (localStorage.getItem("st.sound") !== "0") try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.12);
      setTimeout(() => ctx.close(), 400);
    } catch { /* audio blocked — silent is fine */ }
  }

  function selectChannel(c) {
    setWsOpen(null);
    setChannel(c);
    if (c) {
      setNewSince({ ch: c.id, n: unread[c.id] || 0 });
      setUnread((u) => ({ ...u, [c.id]: 0 }));
      setMentions((mp) => ({ ...mp, [c.id]: 0 }));
    }
  }

  async function moveChannel(c, dir) {
    if (!server) return;
    const chans = [...server.channels];
    const grp = (x) => x.kind === "agents" ? "a" : "t:" + (x.category || "");
    const i = chans.findIndex((x) => x.id === c.id);
    let j = -1;
    for (let k = i + dir; k >= 0 && k < chans.length; k += dir) {
      if (grp(chans[k]) === grp(c)) { j = k; break; }
    }
    if (i < 0 || j < 0) return;
    [chans[i], chans[j]] = [chans[j], chans[i]];
    setServer((s) => s ? { ...s, channels: chans } : s);   // optimistic
    await api.reorderChannels(server.id, chans.map((x) => x.id))
      .catch(async () => setServer(await api.server(server.id)));   // rollback on failure
  }

  async function pickServer(id) {
    const full = await api.server(id).catch(() => null);
    if (!full) return;
    full.channels.forEach((c) => { chanServer.current[c.id] = id; });
    setServer(full);
    api.serverEvents(id).then(setEvents).catch(() => setEvents([]));
    api.workspaces(id).then(setWorkspaces).catch(() => setWorkspaces([]));
    setView("server");
    const firstUnread = full.channels.find((c) => visUnread[c.id] > 0) || full.channels[0];
    selectChannel(firstUnread || null);
  }

  function goHome() {
    setServer(null); setChannel(null); setWsOpen(null);
    setView("buzz");
  }

  async function openDm(target) {
    const { id } = await api.openDm(target.id);
    const dm = { id, kind: "dm", name: target.display_name, other: target };
    setServer(null); selectChannel(dm); setView(`dm-${id}`);
    refreshLists();
  }

  const dmShape = (d) => (d.members || []).length > 1
    ? { id: d.id, kind: "dm", group: true,
        name: d.name || d.members.map((u) => u.display_name.split(" ")[0]).join(", "),
        members: [...d.members, me], reads: d.reads || {} }
    : { id: d.id, kind: "dm", name: d.other?.display_name, other: d.other,
        reads: d.reads || {} };

  function openDmEntry(d) {
    setServer(null); selectChannel(dmShape(d)); setView(`dm-${d.id}`);
  }

  async function openAgentDm(a) {
    const r = await api.dmAgent(a.id).catch((e) => (alert(e.message), null));
    if (!r) return;
    const list = await api.dms().catch(() => []);
    const d = list.find((x) => x.id === r.id);
    if (d) { setModal(null); openDmEntry(d); }
  }

  async function addChannel(name, kind, topic, roster, category, slowmode, vcap, roleId, lurkers = [], forumTags = []) {
    const c = await api.addChannel(server.id, name, kind, topic, roster, category, slowmode, roleId || 0, vcap || 0, lurkers, forumTags);
    const full = await api.server(server.id);
    setServer(full);
    setChannel(full.channels.find((x) => x.id === c.id));
    setModal(null);
  }

  async function saveChannel(name, kind, topic, roster, category, slowmode, vcap, roleId, lurkers, forumTags, workspaceId) {
    const c = await api.editChannel(modal.channel.id, { name, topic, roster, category, slowmode_secs: slowmode, role_id: roleId ?? 0, voice_cap: vcap ?? 0, ...(lurkers !== undefined ? { lurkers } : {}), ...(forumTags !== undefined ? { forum_tags: forumTags } : {}), ...(workspaceId !== undefined ? { workspace_id: workspaceId } : {}) }).catch((e) => (alert(e.message), null));
    if (!c) return;
    const full = await api.server(server.id);
    setServer(full);
    if (channel?.id === c.id) setChannel(full.channels.find((x) => x.id === c.id));
    setModal(null);
  }

  async function removeChannel(c) {
    if (!confirm(`Delete #${c.name}? Messages go with it — can't be undone.`)) return;
    const r = await api.deleteChannel(c.id).catch((e) => (alert(e.message), null));
    if (!r) return;
    const full = await api.server(server.id);
    setServer(full);
    if (channel?.id === c.id) selectChannel(full.channels[0] || null);
    setModal(null);
  }

  async function starAgent(a) {
    await api.starAgent(a.id);
    setRefresh((r) => r + 1);
    if (modal?.kind === "agent") setModal({ kind: "agent", agent: await api.agent(a.id) });
  }
  async function installAgent(a) {
    await api.installAgent(a.id);
    setRefresh((r) => r + 1);
    if (modal?.kind === "agent") setModal({ kind: "agent", agent: await api.agent(a.id) });
  }
  async function forkAgent(a) {
    const copy = await api.forkAgent(a.id).catch((e) => { alert(e.message); return null; });
    if (copy) {
      setRefresh((r) => r + 1);
      setModal({ kind: "publish", initial: copy });
    }
  }

  async function deleteAgent(a) {
    if (!confirm(`Delete ${a.name}? This can't be undone.`)) return;
    await api.deleteAgent(a.id);
    setModal(null);
    setRefresh((r) => r + 1);
  }

  function closeSide() {
    if (window.matchMedia?.("(max-width: 760px)").matches) setSideOpen(false);
  }

  async function openChannelById(cid, sid, msgId) {
    if (msgId) setFocusMsg({ id: msgId, ch: cid, n: Date.now() });
    if (sid) {
      const full = await api.server(sid).catch(() => null);
      if (!full) return;
      full.channels.forEach((c) => { chanServer.current[c.id] = sid; });
      setServer(full); setView("server"); setWsOpen(null);
      selectChannel(full.channels.find((c) => c.id === cid) || null);
    } else {
      const list = await api.dms().catch(() => []);
      const d = list.find((x) => x.id === cid);
      if (d) openDmEntry(d);
    }
  }

  async function openAgent(a) {
    if (a?.tags) return setModal({ kind: "agent", agent: a });
    const full = await api.agent(a.id).catch(() => null);
    if (full) setModal({ kind: "agent", agent: full });
  }

  async function openPack(p) {
    const full = p?.agents ? p : await api.pack(p?.id ?? p).catch(() => null);
    if (full) setModal({ kind: "pack", pack: full });
  }

  async function benchPackAll() { setRefresh((r) => r + 1); }

  async function deletePack(p) {
    if (!confirm(`Delete pack "${p.name}"? The agents stay — just the bundle goes.`)) return;
    await api.deletePack(p.id);
    setModal(null);
    setRefresh((r) => r + 1);
  }

  // ---- render ----

  if (!booted) return null;
  if (!me) return <Login onAuth={setMe} joinCode={pendingJoin} />;

  const pendingCount = friendsData.incoming?.length || 0;
  const dmChannel = channel?.kind === "dm";
  const mutedSet = new Set(me?.muted || []);
  const mentionSet = new Set(me?.notify_mentions || []);
  const srvMutedSet = new Set(me?.server_muted || []);
  const quietSet = new Set([...mutedSet, ...mentionSet]);   // no plain-unread badges
  const srvQuieted = (cid) => srvMutedSet.has(chanServer.current[cid]);
  const visUnread = Object.fromEntries(
    Object.entries(unread).filter(([cid]) => !quietSet.has(+cid) && !srvQuieted(+cid)));
  const visMentions = Object.fromEntries(
    Object.entries(mentions).filter(([cid]) => !mutedSet.has(+cid) && !srvQuieted(+cid)));
  const serverMentions = Object.entries(visMentions).reduce((acc, [cid, n]) => {
    const sid = chanServer.current[cid];
    if (sid && n > 0) acc[sid] = (acc[sid] || 0) + n;
    return acc; }, {});
  const serverUnread = Object.entries(visUnread).reduce((acc, [cid, n]) => {
    const sid = chanServer.current[cid];
    if (sid) acc[sid] = (acc[sid] || 0) + n;
    return acc;
  }, {});
  const homeUnread = Object.entries(visUnread)
    .filter(([cid]) => !chanServer.current[cid])
    .reduce((a, [, n]) => a + n, 0);
  async function cycleNotify(c) {
    // default → @mentions → muted → default
    let muted = me.muted || [], nm = me.notify_mentions || [];
    if (mentionSet.has(c.id)) {
      nm = nm.filter((id) => id !== c.id); muted = [...muted, c.id];
    } else if (mutedSet.has(c.id)) {
      muted = muted.filter((id) => id !== c.id);
    } else {
      nm = [...nm, c.id];
    }
    setMe(await api.updateMe({ muted, notify_mentions: nm }));
  }
  const members = server && !dmChannel
    ? server.members.map((m) => ({ ...m, online: onlineIds.includes(m.id) || m.id === me.id }))
    : channel?.group
      ? (channel.members || []).map((m) => ({ ...m, online: onlineIds.includes(m.id) || m.id === me.id }))
      : null;

  let main;
  if (view === "buzz") main = (
    <Buzz refreshKey={refresh}
      onOpenAgent={(id) => openAgent({ id })}
      onOpenPack={openPack}
      onOpenChannel={openChannelById}
      onUser={(u) => setModal({ kind: "profile", user: u })} />
  );
  else if (view === "library") main = (
    <Library me={me} refreshKey={refresh}
      onOpenAgent={(a) => setModal({ kind: "agent", agent: a })}
      onStar={starAgent} onInstall={installAgent}
      onShare={(a) => setModal({ kind: "share", agent: a })}
      onDm={openAgentDm}
      onPublish={() => setModal({ kind: "publish" })}
      onOpenPack={openPack} onNewPack={() => setModal({ kind: "packcreate" })}
      onBenchPack={benchPackAll} onDeletePack={deletePack} />
  );
  else if (view === "bench") main = (
    <Library me={me} refreshKey={refresh} benchOnly
      onOpenAgent={(a) => setModal({ kind: "agent", agent: a })}
      onStar={starAgent} onInstall={installAgent}
      onShare={(a) => setModal({ kind: "share", agent: a })} />
  );
  else if (view === "friends") main = (
    <Friends refreshKey={refresh} onlineIds={onlineIds} onDm={openDm} />
  );
  else if (view === "saved") main = (
    <Saved onJump={(m) => openChannelById(m.channel_id, m.server_id, m.id)} />
  );
  else if (wsOpen) main = (
    <Workspace workspace={wsOpen} me={me} agents={wsAgents}
      members={server?.members || []}
      onClose={() => setWsOpen(null)}
      onOpenAgent={openAgent}
      chat={{
        server, me, members, emojis: server?.emojis || [], roles: server?.roles || [],
        channels: server?.channels || [], blocked, onDm: openDm,
        onAgentOpen: openAgent, onPackOpen: openPack,
        onShareAgent: () => setModal({ kind: "share", agent: null }),
        onUserOpen: (u) => setModal({ kind: "profile", user: u }),
        onForward: (m) => setModal({ kind: "forward", msg: m }),
        onFwdJump: openChannelById,
      }} />
  );
  else if (channel?.kind === "voice") main = (
    <VoiceRoom
      channel={channel}
      server={server}
      me={me}
      voice={voice}
      onJoinVoice={(cid) => joinVoice(cid, me)}
      onLeaveVoice={leaveVoice}
      onToggleMute={toggleVoiceMute}
      onToggleDeafen={toggleDeafen}
      onToggleShare={toggleShare}
      onToggleCam={toggleCam}
      onUserOpen={(u) => setModal({ kind: "profile", user: u })}
      onDm={openDm}
      members={members}
      emojis={server?.emojis || []}
      roles={server?.roles || []}
      channels={server?.channels || []}
      onAgentOpen={openAgent}
      onPackOpen={openPack}
      onShareAgent={() => setModal({ kind: "share", agent: null })}
      onForward={(m) => setModal({ kind: "forward", msg: m })}
      onEditChannel={(c) => setModal({ kind: "channel", channel: c })}
      onFwdJump={openChannelById}
      focusMsg={focusMsg}
      blocked={blocked}
    />
  );
  else if (channel) main = (
    <ChatView channel={channel} server={server} onDm={openDm} members={members} me={me} blocked={blocked}
      emojis={server?.emojis || []} roles={server?.roles || []}
      channels={server?.channels || []}
      focusMsg={focusMsg}
      newSince={newSince?.ch === channel?.id ? newSince.n : 0}
      onForward={(m) => setModal({ kind: "forward", msg: m })}
      onFwdJump={openChannelById}
      onMarkUnread={(m, n) => {
        setUnread((u) => ({ ...u, [channel.id]: Math.max(n, 1) }));
        setNewSince({ ch: channel.id, n });
        if (channel.kind === "dm") api.markUnread(channel.id, m.id).catch(() => {});
      }}
      onUserOpen={(u) => setModal({ kind: "profile", user: u })}
      onAgentOpen={openAgent}
      onPackOpen={openPack}
      onShareAgent={() => setModal({ kind: "share", agent: null })}
      onWorkspace={(w) => {
        const full = workspaces.find((x) => x.id === w.id) || w;
        setWsOpen(full); setChannel(null);
        api.agents({}).then(setWsAgents).catch(() => {});
      }}
      onGroupAdd={() => setModal({ kind: "groupdm", channel })}
      onGroupRename={async () => {
        const n = prompt("Rename group:", channel.name || "");
        if (n === null) return;
        await api.dmRename(channel.id, n.trim()).catch((e) => alert(e.message));
        const list = await api.dms().catch(() => []);
        const d = list.find((x) => x.id === channel.id);
        if (d) setChannel(dmShape(d));
        refreshLists();
      }} />
  );
  else main = <div className="empty"><div className="big">📡</div><div className="serif">Pick a channel.</div></div>;

  const title = wsOpen ? `${wsOpen.icon} ${wsOpen.name} — workspace`
    : dmChannel ? `@ ${channel.name}`
    : channel ? `${channel.kind === "agents" ? "✦" : channel.kind === "voice" ? "🔊" : channel.kind === "forum" ? "📋" : "#"} ${channel.name}`
    : { buzz: "🐝 The Buzz", library: "🧰 Agent Library", bench: "⭐ My Bench", friends: "👥 Friends", saved: "🔖 Saved" }[view] || "SignalTeams";

  return (
    <div className="app">
      <Rail servers={servers} active={server ? server.id : "home"}
        onHome={goHome} onServer={pickServer}
        onNewServer={() => setModal({ kind: "server" })}
        pendingCount={pendingCount + homeUnread}
        serverUnread={serverUnread} serverMentions={serverMentions}
        onReorder={(from, to) => {
          const next = [...servers];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setServers(next);
          api.updateMe({ server_order: next.map((s) => s.id) }).catch(() => {});
        }} />
      <div className={`side-wrap ${sideOpen ? "open" : ""}`}
        style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {server ? (
          <ServerSidebar server={server} channel={channel} me={me} voice={voice} onJoinVoice={(cid) => joinVoice(cid, me)}
            onChannel={(c) => { selectChannel(c); closeSide(); }} unread={visUnread}
            mentions={visMentions}
            muted={mutedSet} mentionsOnly={mentionSet} onToggleMute={cycleNotify}
            voiceRosters={voice.rosters || {}} typingMap={dmTyping}
            onAddChannel={(kind) => setModal({ kind: "channel", channelKind: kind })}
            onEditChannel={(c) => setModal({ kind: "chanedit", channel: c, channelKind: c.kind })}
            onMoveChannel={moveChannel}
            srvMuted={srvMutedSet.has(server.id)}
            onToggleSrvMute={async (s) => {
              const cur = new Set(me.server_muted || []);
              cur.has(s.id) ? cur.delete(s.id) : cur.add(s.id);
              const u = await api.updateMe({ server_muted: [...cur] }).catch(() => null);
              if (u) setMe(u);
            }}
            onEvents={() => setModal({ kind: "events", server })}
            evCount={events.filter((e) => e.status !== "cancelled").length}
            workspaces={workspaces} activeWs={wsOpen?.id}
            onWorkspace={(w) => {
              setWsOpen(w); setChannel(null);
              api.agents({}).then(setWsAgents).catch(() => {});
            }}
            onNewWorkspace={() => setModal({ kind: "workspace", server })}
            onServerSettings={(s) => setModal({ kind: "srvsettings", server: s })} />
        ) : (
          <HomeSidebar view={view} setView={(v) => { setView(v); closeSide(); }} dms={dms}
            onOpenDm={(d) => { openDmEntry(d); closeSide(); }}
            onNewGroupDm={() => setModal({ kind: "groupdm" })}
            onMarkAllRead={() => {
              api.readAll().catch(() => {});
              setUnread({}); setMentions({});
            }}
            onLeaveDm={async (d) => {
              if (!confirm(`Leave "${d.name || "this group"}"?`)) return;
              await api.leaveDm(d.id).catch((e) => alert(e.message));
              if (channel?.id === d.id) goHome();
              refreshLists();
            }}
            pendingCount={pendingCount} unread={visUnread} mentions={visMentions}
            muted={mutedSet} mentionsOnly={mentionSet} onToggleMute={cycleNotify}
            voiceRosters={voice.rosters || {}} typingMap={dmTyping} />
        )}
        {voice?.joined && (
          <VoiceConnectedBar
            voice={voice}
            channel={server?.channels?.find((c) => c.id === voice.channelId) || (channel?.id === voice.channelId ? channel : null)}
            server={server}
            onDisconnect={leaveVoice}
            onJump={(cid) => {
              if (server?.channels?.some((c) => c.id === cid)) openChannelById(cid, server.id);
            }}
          />
        )}
        <MeBar
          me={{ ...me, online: true }}
          voice={voice}
          onSettings={() => setModal({ kind: "settings" })}
          onToggleMute={toggleVoiceMute}
          onToggleDeafen={toggleDeafen}
        />
      </div>
      {sideOpen && <div className="side-scrim" onClick={() => setSideOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <button className="ghost burger" title="Menu"
            onClick={() => setSideOpen((o) => !o)}><Ico n="list" s={16} /></button>
          <div className="title">{title}</div>
          <div className="topic">{channel?.topic || ""}</div>
          {server && (
            <button className="ghost" title="Server pulse — last 7 days" style={{ marginRight: 4 }}
              onClick={() => setModal({ kind: "pulse" })}><Ico n="trend" s={15} /></button>)}
          <button className="ghost" title="Search everywhere" style={{ marginRight: 4 }}
            onClick={() => setModal({ kind: "gsearch" })}><Ico n="search" s={15} /></button>
          <button className="ghost" title="Inbox — every @you" style={{ marginRight: 4 }}
            onClick={() => setModal({ kind: "inbox" })}><Ico n="tray" s={15} /></button>
          <button className="ghost" title="Shortcuts & slash commands (?)" style={{ marginRight: 4 }}
            onClick={() => setModal({ kind: "shortcuts" })}><Ico n="question" s={15} /></button>
          <Bell me={me} refreshKey={refresh}
            onOpenAgent={async (id) => setModal({ kind: "agent", agent: await api.agent(id) })}
            onOpenChannel={openChannelById}
            onOpenPack={openPack} />
        </div>
        {!server && !channel && welcomeOn && (() => {
          const steps = [
            [servers.length > 0, "Create or join a crew", () => setModal({ kind: "server" })],
            [friendsData.accepted.length > 0, "Add a friend", () => setView("friends")],
            [benchCount > 0, "Bench your first agent", () => setView("library")],
          ];
          if (steps.every(([d]) => d)) return null;
          return (
            <div className="welcome-card">
              <div className="wc-head">👋 Welcome to SignalTeams
                <button className="wc-x" title="Dismiss" onClick={() => {
                  localStorage.setItem("st.welcome", "0"); setWelcomeOn(false);
                }}><Ico n="x" s={13} /></button></div>
              <div className="wc-sub">Three quick things and you're set up:</div>
              {steps.map(([done, label, act]) => (
                <div key={label} className={`wc-step ${done ? "done" : ""}`}>
                  <span className="wc-check">{done ? "✓" : "○"}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {!done && <button onClick={act}>go</button>}
                </div>
              ))}
              <div className="wc-tip">💡 In any channel: <b>@agentname</b> summons them live.</div>
            </div>
          );
        })()}
        {main}
      </div>

      <Suspense fallback={null}>
      {modal?.kind === "agent" && (
        <AgentModal agent={modal.agent} me={me} onClose={() => setModal(null)}
          onStar={starAgent} onInstall={installAgent}
          onShare={(a) => setModal({ kind: "share", agent: a })}
          onEdit={(a) => setModal({ kind: "publish", initial: a })}
          onFork={forkAgent}
          onDelete={deleteAgent} onDm={openAgentDm}
          onUpdated={(a) => { setModal({ kind: "agent", agent: a }); setRefresh((r) => r + 1); }} />
      )}
      {modal?.kind === "publish" && (
        <PublishModal initial={modal.initial} onClose={() => setModal(null)}
          onDone={() => { setModal(null); setRefresh((r) => r + 1); }} />
      )}
      {modal?.kind === "share" && (
        (modal.agent || modal.pack) ? (
          <ShareModal agent={modal.agent} pack={modal.pack} servers={servers} dms={dms}
            onClose={() => setModal(null)}
            onShared={() => { setModal(null); setRefresh((r) => r + 1); }} />
        ) : (
          <PickAgentModal me={me} onClose={() => setModal(null)}
            onPick={(a) => setModal({ kind: "share", agent: a })}
            onPickPack={(p) => setModal({ kind: "share", pack: p })} />
        )
      )}
      {modal?.kind === "pack" && (
        <PackModal pack={modal.pack} me={me} onClose={() => setModal(null)}
          onOpenAgent={(a) => setModal({ kind: "agent", agent: a })}
          onBench={benchPackAll}
          onShare={(p) => setModal({ kind: "share", pack: p })}
          onFork={() => setRefresh((r) => r + 1)}
          onDelete={deletePack} />
      )}
      {modal?.kind === "packcreate" && (
        <PackCreateModal me={me} onClose={() => setModal(null)}
          onDone={() => { setModal(null); setRefresh((r) => r + 1); }} />
      )}
      {modal?.kind === "server" && (
        <ServerModal onClose={() => setModal(null)}
          onDone={(s) => { setModal(null); refreshLists().then(() => pickServer(s.id)); }} />
      )}
      {modal?.kind === "channel" && (
        <ChannelModal kind={modal.channelKind} me={me} roles={server?.roles || []}
          workspaces={workspaces}
          onClose={() => setModal(null)} onDone={addChannel} />
      )}
      {modal?.kind === "chanedit" && (
        <ChannelModal kind={modal.channelKind} channel={modal.channel} me={me}
          roles={server?.roles || []} workspaces={workspaces}
          onClose={() => setModal(null)} onDone={saveChannel} onDelete={removeChannel} />
      )}
      {modal?.kind === "inbox" && (
        <InboxModal onClose={() => setModal(null)}
          onJump={(p) => { setModal(null); openChannelById(p.channel_id, p.server_id, p.msg_id); }} />
      )}
      {modal?.kind === "groupdm" && (
        <GroupDmModal friends={friendsData.accepted} me={me}
          channel={modal.channel} onClose={() => setModal(null)}
          onAddAgent={async (aid) => {
            await api.dmAddAgent(modal.channel.id, aid)
              .then((r) => { if (r?.added === 0) alert(`${modal.channel.name || "The group"} already has that agent`); })
              .catch((e) => alert(e.message));
            const list = await api.dms().catch(() => []);
            const d = list.find((x) => x.id === modal.channel.id);
            refreshLists();
            if (d && channel?.id === d.id) setChannel(dmShape(d));
          }}
          onAdd={async (ids) => {
            await api.dmAdd(modal.channel.id, ids).catch((e) => alert(e.message));
            const list = await api.dms().catch(() => []);
            const d = list.find((x) => x.id === modal.channel.id);
            setModal(null); refreshLists();
            if (d && channel?.id === d.id) setChannel(dmShape(d));
          }}
          onCreate={async (ids, name) => {
            const r = await api.groupDm(ids, name).catch((e) => (alert(e.message), null));
            if (!r) return;
            const list = await api.dms().catch(() => []);
            setModal(null); refreshLists();
            const d = list.find((x) => x.id === r.id);
            if (d) openDmEntry(d);
          }} />
      )}
      {modal?.kind === "forward" && (
        <ForwardModal msg={modal.msg} servers={servers} dms={dms}
          onClose={() => setModal(null)}
          onPick={async (t) => {
            const m = modal.msg;
            setModal(null);
            await api.send(t.cid, m.content, null,
              (m.attachments || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
              null, null, null, m.id).catch((e) => alert(e.message));
            openChannelById(t.cid, t.sid);
          }} />
      )}
      {modal?.kind === "gsearch" && (
        <GlobalSearchModal onClose={() => setModal(null)}
          onPick={(m) => { setModal(null); openChannelById(m.channel_id, m.server_id, m.id); }}
          dests={{
            channels: Object.values(fullServers.current).flatMap((s) =>
              (s.channels || []).filter((c) => !c.locked).map((c) => ({ ...c, sid: s.id, sname: s.name }))),
            dms, friends: friendsData.accepted || [], servers,
          }}
          onJump={(t, x) => {
            setModal(null);
            if (t === "channel") openChannelById(x.id, x.sid);
            else if (t === "dm") openDmEntry(x);
            else if (t === "agent") openAgent(x);
            else if (t === "friend") openDm(x);
            else if (t === "server") pickServer(x.id);
          }} />
      )}
      {modal?.kind === "profile" && (
        <ProfileModal user={modal.user} me={me} onClose={() => setModal(null)}
          blockedIds={blocked}
          roles={server?.roles || []}
          onDm={(u) => { setModal(null); openDm(u); }}
          onOpenAgent={(a) => setModal({ kind: "agent", agent: a })}
          onBlock={async (u) => {
            const wasBlocked = blocked.has(u.id);
            if (!wasBlocked && !confirm(`Block ${u.display_name}? They can't DM you and their messages collapse.`)) return;
            const r = await api.block(u.id).catch((e) => { alert(e.message); return null; });
            if (!r) return;
            setBlocked((s) => { const n = new Set(s); r.blocked ? n.add(u.id) : n.delete(u.id); return n; });
            if (r.blocked) setModal(null);
            refreshLists();
          }}
          onFriend={async (u) => {
            await api.addFriend(u.username).catch((e) => alert(e.message));
            setModal(null); setRefresh((r) => r + 1);
          }} />
      )}
      {modal?.kind === "events" && (
        <EventsModal server={modal.server} me={me} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "workspace" && (
        <WorkspaceModal server={modal.server} onClose={() => setModal(null)}
          onCreated={(w) => {
            setModal(null);
            api.workspaces(modal.server.id).then(setWorkspaces).catch(() => {});
            setWsOpen(w); setChannel(null);
            api.agents({}).then(setWsAgents).catch(() => {});
          }} />
      )}
      {modal?.kind === "pulse" && server && (
        <PulseModal server={server} onClose={() => setModal(null)}
          onJump={(tm) => { setModal(null); openChannelById(tm.channel_id, server.id, tm.id); }} />
      )}
      {modal?.kind === "srvsettings" && (
        <ServerSettingsModal server={modal.server} me={me} onClose={() => setModal(null)}
          onOpenWorkspace={(w) => {
            setModal(null); setWsOpen(w); setChannel(null);
            api.agents({}).then(setWsAgents).catch(() => {});
          }}
          onNewWorkspace={() => setModal({ kind: "workspace", server: modal.server })}
          onSaved={async (s) => {
            const full = await api.server(s.id);
            setServer(full); refreshLists(); setModal(null);
          }}
          onDeleted={async (s) => {
            if (!confirm(`Delete ${s.name}? Channels and messages go with it.`)) return;
            await api.deleteServer(s.id).catch((e) => (alert(e.message), null));
            setModal(null); goHome(); refreshLists();
          }}
          onLeft={async (s) => {
            if (!confirm(`Leave ${s.name}?`)) return;
            await api.leaveServer(s.id).catch((e) => (alert(e.message), null));
            setModal(null); goHome(); refreshLists();
          }}
          onKick={async (m) => {
            if (!confirm(`Kick ${m.display_name} from ${modal.server.name}?`)) return;
            await api.kickMember(modal.server.id, m.id).catch((e) => (alert(e.message), null));
            const full = await api.server(modal.server.id).catch(() => null);
            if (full) { setServer(full); setModal({ kind: "srvsettings", server: full }); }
          }}
          onBan={async (m) => {
            const reason = prompt(`Ban ${m.display_name} from ${modal.server.name}? Reason (optional):`);
            if (reason === null) return;
            await api.banMember(modal.server.id, m.id, reason).catch((e) => (alert(e.message), null));
            const full = await api.server(modal.server.id).catch(() => null);
            if (full) { setServer(full); setModal({ kind: "srvsettings", server: full }); }
          }}
          onTimeout={async (m) => {
            if (m.timeout_until && m.timeout_until > Date.now() / 1000) {
              await api.timeoutMember(modal.server.id, m.id, 0).catch((e) => (alert(e.message), null));
            } else {
              const mins = parseInt(prompt(`Time out ${m.display_name} for how many minutes? (0 = cancel)`) || "0", 10);
              if (!mins) return;
              await api.timeoutMember(modal.server.id, m.id, mins).catch((e) => (alert(e.message), null));
            }
            const full = await api.server(modal.server.id).catch(() => null);
            if (full) { setServer(full); setModal({ kind: "srvsettings", server: full }); }
          }}
          onTransfer={async (m) => {
            if (!confirm(`Make ${m.display_name} the owner of ${modal.server.name}? You'll become a regular member.`)) return;
            await api.transferServer(modal.server.id, m.id).catch((e) => (alert(e.message), null));
            const full = await api.server(modal.server.id).catch(() => null);
            if (full) { setServer(full); setModal({ kind: "srvsettings", server: full }); }
          }} />
      )}
      {modal?.kind === "settings" && (
        <SettingsModal me={me} theme={theme} onTheme={setTheme}
          onClose={() => setModal(null)} onSaved={(u) => { setMe(u); setModal(null); }}
          onLogout={() => { setToken(null); disconnectWS(); setMe(null); setModal(null); }} />
      )}
      {modal?.kind === "shortcuts" && (
        <ShortcutsModal onClose={() => setModal(null)} />
      )}
      </Suspense>
    </div>
  );
}


