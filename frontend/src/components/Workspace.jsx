import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { timeAgo } from "../util";
import CodeEditor from "./workspace/CodeEditor";
import WorkspaceChat from "./workspace/WorkspaceChat";
import { langFor } from "./workspace/highlight";

const LEVEL_BADGE = { read: "👁 read", write: "✏️ write", admin: "🛡 admin" };
const ACTION_ICON = {
  read: "👁", write: "✏️", create: "➕", delete: "🗑", move: "↔", mkdir: "📁",
  exec: "⌨", grant: "🔑", list: "📂", search: "🔎", download: "⬇",
};
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
const CHAT_TAB = "\u0000chat";      // sentinel path for the chat tab

function fileIcon(e) {
  if (e.dir) return "📁";
  const ext = (e.name.split(".").pop() || "").toLowerCase();
  if (IMAGE_EXT.includes(ext)) return "🖼";
  if (["md", "markdown", "txt", "rst"].includes(ext)) return "📝";
  if (["json", "yaml", "yml", "toml", "ini", "cfg"].includes(ext)) return "⚙";
  if (["js", "jsx", "ts", "tsx", "py", "go", "rs", "java", "c", "cpp", "cs", "rb", "php"].includes(ext)) return "⌨";
  if (["html", "htm", "css", "scss"].includes(ext)) return "🌐";
  if (["sh", "ps1", "bat", "cmd"].includes(ext)) return "🖥";
  return "📄";
}

function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const isImage = (path) => IMAGE_EXT.includes((path.split(".").pop() || "").toLowerCase());

/** Diff renderer — unified diff lines coloured by kind, with line numbers. */
function DiffView({ diff }) {
  if (!diff) return <div className="idehint">No changes against the last revision.</div>;
  let oldN = 0, newN = 0;
  return (
    <pre className="ws-diff">
      {diff.split("\n").map((l, i) => {
        let cls = "d-ctx", a = "", b = "";
        if (l.startsWith("+++") || l.startsWith("---")) cls = "d-head";
        else if (l.startsWith("@@")) {
          cls = "d-hunk";
          const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
          if (m) { oldN = +m[1]; newN = +m[2]; }
        } else if (l.startsWith("+")) { cls = "d-add"; b = newN++; }
        else if (l.startsWith("-")) { cls = "d-del"; a = oldN++; }
        else if (l) { a = oldN++; b = newN++; }
        return (
          <div key={i} className={cls}>
            <span className="d-n">{a}</span>
            <span className="d-n">{b}</span>
            <span className="d-t">{l || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

export default function Workspace({ workspace, me, members = [], agents = [], onClose, onOpenAgent, chat }) {
  const [ws, setWs] = useState(workspace);
  const [panelW, setPanelW] = useState(() => +(localStorage.getItem("st.wspanel") || 280));
  const [tree, setTree] = useState([]);
  const [expanded, setExpanded] = useState(new Set([""]));
  const [tabs, setTabs] = useState([]);            // [{path, content, mtime, size, lang, image, dirty, draft}]
  const [active, setActive] = useState("");        // active tab path
  const [tab, setTab] = useState("file");          // file | diff | history | activity | people
  const [history, setHistory] = useState([]);
  const [diff, setDiff] = useState(null);
  const [activity, setActivity] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);  // {path, message}
  const [agentId, setAgentId] = useState(agents[0]?.id || 0);
  const [agentAsk, setAgentAsk] = useState("");
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentReply, setAgentReply] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [agentDraft, setAgentDraft] = useState("");
  const [agentMeta, setAgentMeta] = useState("");
  const agentAbort = useRef(null);
  const agentRunId = useRef("");
  const [agentT0, setAgentT0] = useState(0);
  const [, setAgentTick] = useState(0);
  const [term, setTerm] = useState("");
  const [termOut, setTermOut] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(null);  // "file" | "dir" | null
  const [savedAt, setSavedAt] = useState(0);
  const [focusPath, setFocusPath] = useState("");   // file the chat agent should see
  const tabsRef = useRef([]);
  tabsRef.current = tabs;

  // re-render once a second while the desk agent is working — drives the
  // elapsed counter in the status line
  useEffect(() => {
    if (!agentBusy) return;
    const iv = setInterval(() => setAgentTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [agentBusy]);

  const canWrite = ws?.can_write;
  const canAdmin = ws?.can_admin;
  const cur = tabs.find((t) => t.path === active) || null;
  const isChat = cur?.kind === "chat";
  const dirtyCount = tabs.filter((t) => t.dirty).length;

  const loadTree = useCallback(async (root = "") => {
    const t = await api.wsTree(ws.id, root, 2).catch((e) => (setErr(e.message), null));
    if (!t) return;
    // Loading the root replaces the whole tree; loading a subfolder replaces
    // just that subtree. (The old filter never matched for root="", so every
    // refresh appended a duplicate copy of every file.)
    if (!root) { setTree(t.entries); return; }
    setTree((prev) => {
      const rest = prev.filter((e) => e.path !== root && !e.path.startsWith(root + "/"));
      return [...rest, ...t.entries].sort((a, b) => a.path.localeCompare(b.path));
    });
  }, [ws?.id]);

  useEffect(() => {
    setWs(workspace);
    setTree([]); setTabs([]); setActive(""); setActivity([]); setSessions([]);
    setHits(null); setErr(""); setMsg(""); setConflict(null);
    setAgentSteps([]); setAgentReply(""); setTermOut(null);
    api.workspace(workspace.id).then((w) => { setWs(w); setSessions(w.sessions || []); })
      .catch((e) => setErr(e.message));
    api.wsTree(workspace.id, "", 2).then((t) => setTree(t.entries)).catch((e) => setErr(e.message));
    api.wsAudit(workspace.id).then(setActivity).catch(() => {});
  }, [workspace.id]);

  // live refresh when anyone (human or agent) touches the workspace
  useEffect(() => {
    const h = (e) => {
      const d = e.detail || {};
      if (d.workspace_id !== ws.id) return;
      loadTree("");
      api.wsAudit(ws.id).then(setActivity).catch(() => {});
      api.wsSessions(ws.id).then(setSessions).catch(() => {});
      if (d.action === "file" && d.path) {
        const t = tabsRef.current.find((x) => x.path === d.path);
        if (t && !t.dirty) reloadTab(d.path);
        else if (t && t.dirty) setConflict({ path: d.path, message: `${d.by || "Someone"} saved ${d.path} while you were editing.` });
      }
    };
    window.addEventListener("st:workspace", h);
    return () => window.removeEventListener("st:workspace", h);
  }, [ws?.id]);

  // warn before closing the tab/window with unsaved work
  useEffect(() => {
    const h = (e) => {
      if (tabsRef.current.some((t) => t.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  async function reloadTab(path) {
    const f = await api.wsFile(ws.id, path).catch(() => null);
    if (!f) return;
    setTabs((ts) => ts.map((t) => t.path === path
      ? { ...t, content: f.content, draft: f.content, mtime: f.mtime, size: f.size, dirty: false }
      : t));
  }

  async function openFile(path) {
    setErr(""); setMsg(""); setConflict(null);
    const existing = tabs.find((t) => t.path === path);
    if (existing) { setActive(path); setTab("file"); return; }
    if (isImage(path)) {
      const meta = await api.wsMeta(ws.id, path).catch(() => null);
      setTabs((ts) => [...ts, { path, image: true, content: "", draft: "", dirty: false,
        size: meta?.size || 0, mtime: meta?.mtime || 0, lang: "image" }]);
      setActive(path); setTab("file");
      return;
    }
    const f = await api.wsFile(ws.id, path).catch((e) => (setErr(e.message), null));
    if (!f) return;
    setTabs((ts) => [...ts, { path, content: f.content, draft: f.content, mtime: f.mtime,
      size: f.size, lang: f.lang || langFor(path), dirty: false, image: false }]);
    setActive(path); setTab("file");
  }

  /** Chat is just another tab — same tab bar, same close button, same
   *  persistence. `kind: "chat"` marks it so the renderer picks ChatView. */
  function openChat() {
    const existing = tabs.find((t) => t.kind === "chat");
    if (existing) { setActive(existing.path); return; }
    setTabs((ts) => [...ts, { kind: "chat", path: CHAT_TAB, content: "", draft: "",
      dirty: false, image: false, lang: "chat" }]);
    setActive(CHAT_TAB);
  }

  function closeTab(path) {
    const t = tabs.find((x) => x.path === path);
    if (t?.dirty && !confirm(`Discard unsaved changes to ${path}?`)) return;
    setTabs((ts) => {
      const next = ts.filter((x) => x.path !== path);
      if (active === path) setActive(next.length ? next[next.length - 1].path : "");
      return next;
    });
  }

  function setDraft(path, value) {
    setTabs((ts) => ts.map((t) => t.path === path
      ? { ...t, draft: value, dirty: value !== t.content } : t));
  }

  async function save(force = false) {
    const t = cur;
    if (!t || t.image) return;
    const sent = t.draft;                 // snapshot what we're writing
    setBusy(true);
    const r = await api.wsSave(ws.id, t.path, sent, "", false, t.mtime, force)
      .catch((e) => (setErr(e.message), e.status === 409 ? e : null));
    setBusy(false);
    if (!r) return;
    if (r.status === 409) { setConflict({ path: t.path, message: r.message }); return; }
    setConflict(null);
    // Only clear the dirty flag if the buffer still matches what we saved —
    // typing during the request must keep the tab marked unsaved.
    setTabs((ts) => ts.map((x) => x.path === t.path
      ? { ...x, content: sent, mtime: r.mtime, size: r.size,
          dirty: x.draft !== sent } : x));
    setSavedAt(Date.now());
    setMsg(`Saved ${t.path} ✓`);
    loadTree("");
  }

  async function saveAll() {
    for (const t of tabs.filter((x) => x.dirty && !x.image)) {
      const r = await api.wsSave(ws.id, t.path, t.draft, "", false, t.mtime, false)
        .catch(() => null);
      if (r && r.mtime) {
        setTabs((ts) => ts.map((x) => x.path === t.path
          ? { ...x, content: t.draft, mtime: r.mtime, size: r.size, dirty: false } : x));
      }
    }
    setSavedAt(Date.now());
    setMsg("All files saved ✓");
    loadTree("");
  }

  async function newEntry(kind) {
    const name = newName.trim();
    if (!name) return;
    const base = active.includes("/") ? active.slice(0, active.lastIndexOf("/") + 1) : "";
    const path = base + name;
    const r = kind === "dir"
      ? await api.wsMkdir(ws.id, path).catch((e) => (setErr(e.message), null))
      : await api.wsSave(ws.id, path, "", "created", true).catch((e) => (setErr(e.message), null));
    if (!r) return;
    setNewName(""); setCreating(null); setErr("");
    await loadTree("");
    if (kind === "file") openFile(path);
  }

  async function remove(path) {
    if (!confirm(`Delete ${path}? A revision is kept so you can restore it.`)) return;
    const r = await api.wsDelete(ws.id, path).catch((e) => (setErr(e.message), null));
    if (!r) return;
    setTabs((ts) => {
      const next = ts.filter((t) => t.path !== path && !t.path.startsWith(path + "/"));
      if (active === path || active.startsWith(path + "/"))
        setActive(next.length ? next[next.length - 1].path : "");
      return next;
    });
    loadTree("");
  }

  async function rename(path) {
    const to = prompt("Move / rename to:", path);
    if (!to || to === path) return;
    const r = await api.wsMove(ws.id, path, to).catch((e) => (setErr(e.message), null));
    if (!r) return;
    setTabs((ts) => ts.map((t) => t.path === path ? { ...t, path: to } : t));
    if (active === path) setActive(to);
    loadTree("");
  }

  async function showHistory() {
    if (!cur) return;
    setTab("history");
    const h = await api.wsHistory(ws.id, cur.path).catch(() => []);
    setHistory(h);
  }

  async function showDiff(rev = 0) {
    if (!cur) return;
    setTab("diff");
    const d = await api.wsDiff(ws.id, cur.path, rev).catch((e) => (setErr(e.message), null));
    if (d) setDiff(d.diff);
  }

  async function restore(rev) {
    if (!confirm(`Restore revision ${rev}? The current version is kept as a revision.`)) return;
    const r = await api.wsRestore(ws.id, cur.path, rev).catch((e) => (setErr(e.message), null));
    if (!r) return;
    await reloadTab(cur.path);
    setMsg(`Restored rev ${rev} ✓`);
    setTab("file");
  }

  async function search(v) {
    setQ(v);
    if (v.trim().length < 2) { setHits(null); return; }
    setHits(await api.wsSearch(ws.id, v.trim()).catch(() => []));
  }

  async function runAgent() {
    const ask = agentAsk.trim();
    if (!ask || !agentId) return;
    setAgentBusy(true); setAgentSteps([]); setAgentReply(""); setErr("");
    setAgentStatus("investigating"); setAgentT0(Date.now()); setAgentDraft(""); setAgentMeta("");
    agentAbort.current = new AbortController();
    agentRunId.current = crypto.randomUUID?.() || String(Date.now());
    let hop = 0;
    const r = await api.wsAgent(ws.id, agentId, ask, active, (ev) => {
      if (ev.type === "thinking") {
        if (ev.hop) hop = ev.hop;
        setAgentStatus(`thinking${ev.n ? ` (${ev.n})` : ""}${hop > 1 ? ` · hop ${hop}` : ""}`);
        setAgentDraft("");
      } else if (ev.type === "token") setAgentDraft((d) => d + ev.t);
      else if (ev.type === "meta") setAgentMeta(`${ev.provider} · ${ev.model}`);
      else if (ev.type === "step") {
        setAgentStatus(`running ${ev.tool}${hop > 1 ? ` · hop ${hop}` : ""}`);
        setAgentSteps((ss) => [...ss, { tool: ev.tool, args: ev.args, pending: true }]);
      } else if (ev.type === "step_done") {
        setAgentSteps((ss) => {
          const ix = [...ss.keys()].reverse().find(
            (i) => ss[i].pending && ss[i].tool === ev.tool);
          return ix === undefined ? ss : ss.map((s, i) => i === ix
            ? { ...s, pending: false, secs: ev.secs,
                result: { ok: ev.ok, error: ev.error } } : s);
        });
      } else if (ev.type === "stopped") setErr("run stopped")
      else if (ev.type === "error") setErr(ev.error);
    }, agentAbort.current.signal, agentRunId.current).catch((e) =>
      e.name === "AbortError"
        ? (setErr("stopped — run cancelled"),
           setAgentSteps((ss) => ss.map((s) =>
             s.pending ? { ...s, pending: false, stopped: true } : s)),
           null)
        : (setErr(e.message), null));
    setAgentBusy(false); setAgentStatus(""); setAgentDraft("");
    if (!r) return;
    setAgentSteps(r.steps || []);
    setAgentReply(r.reply || "");
    setAgentAsk("");
    loadTree("");
    api.wsAudit(ws.id).then(setActivity).catch(() => {});
    if (active) reloadTab(active);
  }

  async function runTerm() {
    const cmd = term.trim();
    if (!cmd) return;
    setTermOut({ pending: true, cmd });
    const r = await api.wsExec(ws.id, cmd).catch((e) => ({ code: -1, stderr: e.message }));
    setTermOut(r);
    setTerm("");
    loadTree("");
  }

  async function grant(uid, level) {
    const w = await api.wsGrant(ws.id, uid, level).catch((e) => (setErr(e.message), null));
    if (w) { setWs(w); setMsg(level ? "Access updated ✓" : "Access revoked"); }
  }

  // group the flat tree into a nested, collapsible list
  const rows = useMemo(() => {
    const out = [];
    const sorted = [...tree].sort((a, b) => a.path.localeCompare(b.path));
    for (const e of sorted) {
      const parts = e.path.split("/");
      let hidden = false;
      for (let i = 1; i < parts.length; i++) {
        const anc = parts.slice(0, i).join("/");
        if (!expanded.has(anc)) { hidden = true; break; }
      }
      if (hidden) continue;
      out.push({ ...e, depth: parts.length - 1 });
    }
    return out;
  }, [tree, expanded]);

  const toggleDir = (p) => setExpanded((s) => {
    const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n;
  });

  useEffect(() => {
    localStorage.setItem("st.wspanel", String(panelW));
  }, [panelW]);

  // the chat tab always knows which file you were last looking at, and the
  // backend records it so a chat summon hands the agent the same context
  useEffect(() => {
    const t = tabs.find((x) => x.path === active);
    if (!t || t.kind === "chat") return;
    setFocusPath(t.path);
    api.wsFocus(ws.id, t.path).catch(() => {});
  }, [active, tabs, ws?.id]);

  // drag the agent panel's left edge to resize it
  function startPanelDrag(e) {
    e.preventDefault();
    const startX = e.clientX, startW = panelW;
    document.body.classList.add("col-resizing");
    const move = (ev) =>
      setPanelW(Math.min(640, Math.max(220, startW + startX - ev.clientX)));
    const up = () => {
      document.body.classList.remove("col-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const grantMap = useMemo(() => {
    const m = {};
    (ws?.grants || []).forEach((g) => { m[g.user_id] = g.level; });
    return m;
  }, [ws?.grants]);

  const here = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { if (s.path) m[s.path] = s.user; });
    return m;
  }, [sessions]);

  return (
    <div className="ws">
      <div className="ws-head">
        <span className="ws-ico">{ws.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ws-name">{ws.name}
            <span className={`ws-lvl ${ws.level}`}>{LEVEL_BADGE[ws.level] || "no access"}</span>
            {dirtyCount > 0 && <span className="ws-dirty">{dirtyCount} unsaved</span>}
          </div>
          <div className="ws-root" title={ws.root}>{ws.root}</div>
        </div>
        {sessions.length > 0 && (
          <div className="ws-here" title={sessions.map((s) => `${s.user.display_name}${s.path ? " · " + s.path : ""}`).join("\n")}>
            {sessions.slice(0, 4).map((s) => (
              <span key={s.user.id} className="ws-av" style={{ background: s.user.avatar_color }}>
                {s.user.avatar_emoji}</span>
            ))}
            <span className="ws-here-n">{sessions.length} here</span>
          </div>
        )}
        <button className="ghost" title="Close workspace" onClick={onClose}><Ico n="x" s={15} /></button>
      </div>

      <div className={`ws-body ${isChat ? "chat-mode" : ""}`}>
        <div className="ws-side">
          <div className="ws-search">
            <Ico n="search" s={13} />
            <input value={q} placeholder="search files…" onChange={(e) => search(e.target.value)} />
          </div>
          {canWrite && (
            <div className="ws-new">
              <button className="ghost" title="New file"
                onClick={() => setCreating(creating === "file" ? null : "file")}>
                <Ico n="plus" s={12} /> file</button>
              <button className="ghost" title="New folder"
                onClick={() => setCreating(creating === "dir" ? null : "dir")}>
                <Ico n="plus" s={12} /> folder</button>
            </div>
          )}
          {creating && (
            <div className="ws-newrow">
              <input autoFocus value={newName} placeholder={creating === "dir" ? "folder name" : "file name"}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") newEntry(creating);
                  if (e.key === "Escape") { setCreating(null); setNewName(""); }
                }} />
              <button onClick={() => newEntry(creating)}>ok</button>
            </div>
          )}
          {hits !== null ? (
            <div className="ws-hits">
              <div className="ws-hits-head">{hits.length} hit{hits.length === 1 ? "" : "s"}
                <button className="ghost" onClick={() => { setHits(null); setQ(""); }}><Ico n="x" s={11} /></button>
              </div>
              {hits.map((h, i) => (
                <div key={i} className="ws-hit" onClick={() => openFile(h.path)}>
                  <b>{h.path}</b><span>:{h.line}</span>
                  <div>{h.text}</div>
                </div>
              ))}
              {hits.length === 0 && <div className="idehint">No matches.</div>}
            </div>
          ) : (
            <div className="ws-tree">
              {rows.map((e) => (
                <div key={e.path}
                  className={`ws-row ${active === e.path ? "on" : ""}`}
                  style={{ paddingLeft: 6 + e.depth * 13 }}
                  onClick={() => (e.dir ? toggleDir(e.path) : openFile(e.path))}>
                  <span className="ws-caret">{e.dir ? (expanded.has(e.path) ? "▾" : "▸") : ""}</span>
                  <span className="ws-fico">{fileIcon(e)}</span>
                  <span className="ws-fname" title={e.path}>{e.name}</span>
                  {tabs.some((t) => t.path === e.path && t.dirty) && <span className="ws-tab-dot" />}
                  {here[e.path] && (
                    <span className="ws-av" style={{ background: here[e.path].avatar_color, width: 15, height: 15, fontSize: 9 }}
                      title={`${here[e.path].display_name} has this open`}>{here[e.path].avatar_emoji}</span>
                  )}
                  {!e.dir && <span className="ws-fsize">{fmtSize(e.size)}</span>}
                  {canWrite && (
                    <span className="ws-row-act">
                      <span title="Move / rename" onClick={(ev) => { ev.stopPropagation(); rename(e.path); }}>↔</span>
                      <span title="Delete" onClick={(ev) => { ev.stopPropagation(); remove(e.path); }}>🗑</span>
                    </span>
                  )}
                </div>
              ))}
              {rows.length === 0 && <div className="idehint" style={{ padding: 10 }}>
                Empty folder — {canWrite ? "create a file to get started." : "ask for write access."}</div>}
            </div>
          )}
        </div>

        <div className="ws-main">
          <div className="ws-tabbar">
            {tabs.map((t) => (
              <div key={t.path} className={`ws-tab ${active === t.path ? "on" : ""} ${t.kind === "chat" ? "ws-tab-chat" : ""}`}
                onClick={() => { setActive(t.path); setTab("file"); }}
                title={t.kind === "chat" ? "Workspace chat — agents here can read & edit the files" : t.path}>
                <span>{t.kind === "chat" ? "💬" : fileIcon({ name: t.path })}</span>
                <span className="ws-tab-name">{t.kind === "chat" ? "chat" : t.path.split("/").pop()}</span>
                {t.dirty && <span className="ws-tab-dot" />}
                <span className="ws-tab-x" title="Close"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.path); }}>✕</span>
              </div>
            ))}
            {!tabs.some((t) => t.kind === "chat") && (
              <div className="ws-tab ws-tab-add" title="Open workspace chat"
                onClick={openChat}>💬 chat</div>
            )}
            {tabs.length === 0 && <div className="ws-tab" style={{ cursor: "default", opacity: .5 }}>no file open</div>}
          </div>
          {/* The editor sub-tabs (file/diff/history/…) belong to files, not to
              the chat tab — hide them there so chat gets the full height. */}
          {!isChat && (
          <div className="ws-tabs">
            <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>📄 file</button>
            <button className={tab === "diff" ? "on" : ""} disabled={!cur || cur.image} onClick={() => showDiff(0)}>± diff</button>
            <button className={tab === "history" ? "on" : ""} disabled={!cur || cur.image} onClick={showHistory}>🕘 history</button>
            <button className={tab === "activity" ? "on" : ""} onClick={() => {
              setTab("activity"); api.wsAudit(ws.id).then(setActivity).catch(() => {});
            }}>📋 activity</button>
            <button className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>👥 access</button>
            <div style={{ flex: 1 }} />
            {cur && !cur.image && tab === "file" && (
              <>
                {cur.dirty
                  ? <span className="ws-dirty">● unsaved</span>
                  : <span className="ws-saved">✓ saved{savedAt > 0 ? " " + timeAgo(savedAt / 1000) : ""}</span>}
                <button className={cur.dirty ? "primary" : ""}
                  disabled={!cur.dirty || busy || !canWrite} onClick={() => save(false)}
                  title={!canWrite ? "You have read-only access"
                    : cur.dirty ? "Save (Ctrl+S)" : "No changes to save"}>
                  <Ico n="save" s={12} /> {busy ? "saving…" : "save"}</button>
              </>
            )}
            {dirtyCount > 1 && (
              <button onClick={saveAll} title="Save every modified file">save all</button>
            )}
          </div>
          )}

          {err && <div className="ws-err">{err}</div>}
          {msg && <div className="ws-msg">{msg}</div>}
          {conflict && (
            <div className="ws-banner warn">
              <Ico n="warn" s={13} />
              <span>{conflict.message}</span>
              <span className="sp" />
              <button onClick={async () => { await reloadTab(conflict.path); setConflict(null); }}>
                reload theirs</button>
              <button onClick={() => { setConflict(null); save(true); }}>overwrite</button>
              <button className="ghost" onClick={() => setConflict(null)}><Ico n="x" s={11} /></button>
            </div>
          )}

          {tab === "file" && (cur ? (
            cur.kind === "chat" ? (
              <WorkspaceChat ws={ws} chat={chat} focusPath={focusPath}
                members={members} />
            ) : cur.image ? (
              <div className="ws-preview">
                <img src={api.wsRawUrl(ws.id, cur.path)} alt={cur.path} />
                <div className="pv-meta">{cur.path} · {fmtSize(cur.size)}</div>
                <a className="ghost" href={api.wsRawUrl(ws.id, cur.path)} download
                  style={{ fontSize: 12 }}><Ico n="dl" s={12} /> download</a>
              </div>
            ) : (
              <CodeEditor path={cur.path} value={cur.draft} readOnly={!canWrite}
                onChange={(v) => setDraft(cur.path, v)}
                onSave={() => { if (cur.dirty) save(false); }} />
            )
          ) : (
            <div className="empty">
              <div className="big">🗂</div>
              <div className="serif">Pick a file to edit.</div>
              <div>Open <b>💬 chat</b> in the tab bar to talk to agents that can read and edit these files.</div>
            </div>
          ))}

          {tab === "diff" && <div className="ws-pane"><DiffView diff={diff} /></div>}

          {tab === "history" && (
            <div className="ws-pane">
              {history.length === 0 && <div className="idehint">No revisions yet — save the file once.</div>}
              {history.map((r) => (
                <div key={r.id} className="ws-rev">
                  <span className="ws-rev-ico">{r.agent ? (r.agent.icon || "🤖") : (r.author?.avatar_emoji || "👤")}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.agent ? r.agent.name : (r.author?.display_name || "someone")}</b>
                    <span className="ws-rev-meta"> · {r.source} · {fmtSize(r.size)} · {timeAgo(r.created_at)}</span>
                    {r.note && <div className="ws-rev-note">{r.note}</div>}
                  </div>
                  <button className="ghost" onClick={() => showDiff(r.id)}>diff</button>
                  {canWrite && <button className="ghost" onClick={() => restore(r.id)}>restore</button>}
                </div>
              ))}
            </div>
          )}

          {tab === "activity" && (
            <div className="ws-pane">
              {activity.length === 0 && <div className="idehint">Nothing yet.</div>}
              {activity.map((a) => (
                <div key={a.id} className={`ws-act ${a.ok ? "" : "bad"}`}>
                  <span className="ws-act-ico">{ACTION_ICON[a.action] || "•"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{a.agent ? `${a.agent.icon || "🤖"} ${a.agent.name}` : (a.actor?.display_name || "system")}</b>
                    <span> {a.action}</span>
                    {a.path && <code className="ws-act-path">{a.path}</code>}
                    {a.detail && <span className="ws-act-detail"> — {a.detail}</span>}
                  </div>
                  <span className="ws-act-time">{timeAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "people" && (
            <div className="ws-pane">
              <div className="ws-sec">Who can do what</div>
              <div className="idehint" style={{ marginBottom: 8 }}>
                Agents inherit the access level of whoever summons them — an agent can never
                do more than the person talking to it. The server owner is always admin.
              </div>
              {members.map((m) => (
                <div key={m.id} className="ws-person">
                  <span className="ws-av" style={{ background: m.avatar_color }}>{m.avatar_emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{m.display_name}</b> <span className="ws-person-un">@{m.username}</span>
                  </div>
                  {canAdmin ? (
                    <select value={grantMap[m.id] || ""} onChange={(e) => grant(m.id, e.target.value)}>
                      <option value="">no access</option>
                      <option value="read">read</option>
                      <option value="write">write</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span className={`ws-lvl ${grantMap[m.id] || ""}`}>
                      {LEVEL_BADGE[grantMap[m.id]] || "no access"}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ws-drag" onMouseDown={startPanelDrag}
          title="Drag to resize the agent panel" />
        <div className="ws-agent" style={{ width: panelW }}>
          <div className="ws-sec">✦ Agent desk</div>
          <div className="idehint ws-desk-hint">
            Ask an agent to work on these files — it reads, edits and reports back.
          </div>
          <select value={agentId} onChange={(e) => setAgentId(+e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon || "🤖"} {a.name}</option>)}
            {agents.length === 0 && <option value={0}>no agents visible</option>}
          </select>
          <textarea rows={3} value={agentAsk} placeholder={
            active ? `e.g. "add a docstring to ${active.split("/").pop()}"` : "e.g. \"summarize this repo\""}
            onChange={(e) => setAgentAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAgent(); }
            }} />
          <button className="primary" disabled={agentBusy || !agentAsk.trim() || !agentId}
            onClick={runAgent}>{agentBusy ? "working…" : "send to agent"}</button>
          {agentBusy && (
            <div className="ws-status">
              <img className="typknot" src="/brand/knot-loop.png" alt="" />
              {agentStatus}…{Math.floor((Date.now() - agentT0) / 1000) >= 3 &&
                ` (${Math.floor((Date.now() - agentT0) / 1000)}s)`}
              <button className="ghost ws-stop" title="stop this run"
                onClick={() => {
                  if (agentRunId.current)
                    api.wsAgentStop(ws.id, agentRunId.current).catch(() => {});
                  agentAbort.current?.abort();
                }}>✕</button>
            </div>
          )}
          {agentSteps.length > 0 && (
            <div className="ws-steps">
              {agentSteps.map((s, i) => (
                <div key={i} className={`ws-step ${s.pending ? "run" : s.stopped ? "" : s.result?.ok ? "" : "bad"}`}>
                  <b>{s.tool}</b>
                  <code>{s.args?.path || s.args?.query || s.args?.cmd || ""}</code>
                  {s.pending ? <span> …</span> : s.stopped
                    ? <span className="ws-stopped"> — stopped</span>
                    : (s.result?.ok
                    ? <span className="ws-ok"> ✓{s.secs != null && ` · ${s.secs}s`}</span>
                    : <span> ✗ {s.result?.error}</span>)}
                </div>
              ))}
            </div>
          )}
          {agentReply && <div className="ws-reply">{agentReply}</div>}
          {agentReply && agentMeta && <div className="ws-meta">{agentMeta}</div>}
          {agentBusy && agentDraft && (
            <div className="ws-reply ws-draft">{agentDraft}▌</div>
          )}

          {canAdmin && ws.exec_enabled && (
            <>
              <div className="ws-sec">⌨ Terminal</div>
              <div className="ws-term">
                <input value={term} placeholder="command…" title="Runs in the workspace root"
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runTerm(); }} />
                <button onClick={runTerm} disabled={!term.trim()}>run</button>
              </div>
              {termOut && (
                <pre className="ws-term-out">
                  {termOut.pending ? `$ ${termOut.cmd}\n…` :
                    `$ ${termOut.cmd}\n${termOut.stdout || ""}${termOut.stderr ? "\n" + termOut.stderr : ""}\n[exit ${termOut.code}]`}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
