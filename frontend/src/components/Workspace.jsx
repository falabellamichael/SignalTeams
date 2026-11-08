import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ico from "./Ico";
import { api } from "../api";
import { timeAgo } from "../util";

const LEVEL_BADGE = { read: "👁 read", write: "✏️ write", admin: "🛡 admin" };
const ACTION_ICON = {
  read: "👁", write: "✏️", create: "➕", delete: "🗑", move: "↔", mkdir: "📁",
  exec: "⌨", grant: "🔑", list: "📂", search: "🔎",
};

function fileIcon(e) {
  if (e.dir) return "📁";
  const ext = (e.name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) return "🖼";
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

/** Diff renderer — unified diff lines coloured by kind. */
function DiffView({ diff }) {
  if (!diff) return <div className="idehint">No changes against the last revision.</div>;
  return (
    <pre className="ws-diff">
      {diff.split("\n").map((l, i) => (
        <div key={i} className={
          l.startsWith("+++") || l.startsWith("---") ? "d-head"
            : l.startsWith("@@") ? "d-hunk"
            : l.startsWith("+") ? "d-add"
            : l.startsWith("-") ? "d-del" : "d-ctx"}>{l || " "}</div>
      ))}
    </pre>
  );
}

export default function Workspace({ workspace, me, members = [], agents = [], onClose, onOpenAgent }) {
  const [ws, setWs] = useState(workspace);
  const [tree, setTree] = useState([]);
  const [expanded, setExpanded] = useState(new Set([""]));
  const [openPath, setOpenPath] = useState("");
  const [file, setFile] = useState(null);          // {path, content, lang}
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
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
  const [agentId, setAgentId] = useState(agents[0]?.id || 0);
  const [agentAsk, setAgentAsk] = useState("");
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentReply, setAgentReply] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [term, setTerm] = useState("");
  const [termOut, setTermOut] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(null);  // "file" | "dir" | null
  const taRef = useRef(null);

  const canWrite = ws?.can_write;
  const canAdmin = ws?.can_admin;

  const loadTree = useCallback(async (root = "") => {
    const t = await api.wsTree(ws.id, root, 2).catch((e) => (setErr(e.message), null));
    if (!t) return;
    setTree((prev) => {
      const rest = prev.filter((e) => !(e.path === root || e.path.startsWith(root ? root + "/" : "\u0000")));
      return [...rest, ...t.entries].sort((a, b) => a.path.localeCompare(b.path));
    });
  }, [ws?.id]);

  useEffect(() => {
    setWs(workspace);
    setTree([]); setOpenPath(""); setFile(null); setDraft(""); setDirty(false);
    setActivity([]); setSessions([]); setHits(null); setErr(""); setMsg("");
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
      if (d.action === "file" && d.path === openPath && !dirty) openFile(openPath, true);
    };
    window.addEventListener("st:workspace", h);
    return () => window.removeEventListener("st:workspace", h);
  }, [ws?.id, openPath, dirty]);

  async function openFile(path, force = false) {
    if (dirty && !force && !confirm("Discard unsaved changes?")) return;
    const f = await api.wsFile(ws.id, path).catch((e) => (setErr(e.message), null));
    if (!f) return;
    setFile(f); setDraft(f.content); setDirty(false); setOpenPath(path);
    setTab("file"); setErr(""); setMsg("");
    setHistory([]); setDiff(null);
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    const r = await api.wsSave(ws.id, file.path, draft, "").catch((e) => (setErr(e.message), null));
    setBusy(false);
    if (!r) return;
    setDirty(false); setMsg(`Saved ${r.path} ✓`);
    setFile((f) => ({ ...f, content: draft, size: r.size }));
    loadTree("");
  }

  async function newEntry(kind) {
    const name = newName.trim();
    if (!name) return;
    const base = openPath.includes("/") ? openPath.slice(0, openPath.lastIndexOf("/") + 1) : "";
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
    if (openPath === path || openPath.startsWith(path + "/")) {
      setOpenPath(""); setFile(null); setDraft(""); setDirty(false);
    }
    loadTree("");
  }

  async function rename(path) {
    const to = prompt("Move / rename to:", path);
    if (!to || to === path) return;
    const r = await api.wsMove(ws.id, path, to).catch((e) => (setErr(e.message), null));
    if (!r) return;
    if (openPath === path) setOpenPath(to);
    loadTree("");
  }

  async function showHistory() {
    if (!file) return;
    setTab("history");
    const h = await api.wsHistory(ws.id, file.path).catch(() => []);
    setHistory(h);
  }

  async function showDiff(rev = 0) {
    if (!file) return;
    setTab("diff");
    const d = await api.wsDiff(ws.id, file.path, rev).catch((e) => (setErr(e.message), null));
    if (d) setDiff(d.diff);
  }

  async function restore(rev) {
    if (!confirm(`Restore revision ${rev}? The current version is kept as a revision.`)) return;
    const r = await api.wsRestore(ws.id, file.path, rev).catch((e) => (setErr(e.message), null));
    if (!r) return;
    openFile(file.path, true);
    setMsg(`Restored rev ${rev} ✓`);
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
    const r = await api.wsAgent(ws.id, agentId, ask, openPath)
      .catch((e) => (setErr(e.message), null));
    setAgentBusy(false);
    if (!r) return;
    setAgentSteps(r.steps || []);
    setAgentReply(r.reply || "");
    setAgentAsk("");
    loadTree("");
    api.wsAudit(ws.id).then(setActivity).catch(() => {});
    if (openPath) openFile(openPath, true);
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
    const byPath = new Map(tree.map((e) => [e.path, e]));
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

  const grantMap = useMemo(() => {
    const m = {};
    (ws?.grants || []).forEach((g) => { m[g.user_id] = g.level; });
    return m;
  }, [ws?.grants]);

  return (
    <div className="ws">
      <div className="ws-head">
        <span className="ws-ico">{ws.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ws-name">{ws.name}
            <span className={`ws-lvl ${ws.level}`}>{LEVEL_BADGE[ws.level] || "no access"}</span>
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

      <div className="ws-body">
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
                  className={`ws-row ${openPath === e.path ? "on" : ""}`}
                  style={{ paddingLeft: 6 + e.depth * 13 }}
                  onClick={() => (e.dir ? toggleDir(e.path) : openFile(e.path))}>
                  <span className="ws-caret">{e.dir ? (expanded.has(e.path) ? "▾" : "▸") : ""}</span>
                  <span className="ws-fico">{fileIcon(e)}</span>
                  <span className="ws-fname" title={e.path}>{e.name}</span>
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
          <div className="ws-tabs">
            <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
              {file ? fileIcon({ name: file.path }) + " " + file.path.split("/").pop() : "📄 file"}</button>
            <button className={tab === "diff" ? "on" : ""} disabled={!file} onClick={() => showDiff(0)}>± diff</button>
            <button className={tab === "history" ? "on" : ""} disabled={!file} onClick={showHistory}>🕘 history</button>
            <button className={tab === "activity" ? "on" : ""} onClick={() => {
              setTab("activity"); api.wsAudit(ws.id).then(setActivity).catch(() => {});
            }}>📋 activity</button>
            <button className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>👥 access</button>
            <div style={{ flex: 1 }} />
            {file && tab === "file" && (
              <>
                {dirty && <span className="ws-dirty">● unsaved</span>}
                <button className="primary" disabled={!dirty || busy || !canWrite} onClick={save}>
                  <Ico n="save" s={12} /> save</button>
              </>
            )}
          </div>

          {err && <div className="ws-err">{err}</div>}
          {msg && <div className="ws-msg">{msg}</div>}

          {tab === "file" && (file ? (
            <div className="ws-editor">
              <div className="ws-ed-head">
                <span>{file.path}</span>
                <span className="ws-ed-meta">{file.lang} · {fmtSize(file.size)} · edited {timeAgo(file.mtime)}</span>
              </div>
              <textarea ref={taRef} className="ws-code" spellCheck={false}
                value={draft} readOnly={!canWrite}
                onChange={(e) => { setDraft(e.target.value); setDirty(e.target.value !== file.content); }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                    e.preventDefault(); if (dirty) save();
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const ta = e.target, s = ta.selectionStart, t = ta.selectionEnd;
                    const next = draft.slice(0, s) + "  " + draft.slice(t);
                    setDraft(next); setDirty(next !== file.content);
                    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
                  }
                }} />
            </div>
          ) : (
            <div className="empty">
              <div className="big">🗂</div>
              <div className="serif">Pick a file to edit.</div>
              <div>Agents summoned in a workspace channel can read and write these files too.</div>
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

        <div className="ws-agent">
          <div className="ws-sec">✦ Agent desk</div>
          <div className="idehint" style={{ marginBottom: 6 }}>
            Ask an agent to work on these files. It reads, edits and reports back — every
            action lands in the activity log.
          </div>
          <select value={agentId} onChange={(e) => setAgentId(+e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.icon || "🤖"} {a.name}</option>)}
            {agents.length === 0 && <option value={0}>no agents visible</option>}
          </select>
          <textarea rows={3} value={agentAsk} placeholder={
            openPath ? `e.g. "add a docstring to ${openPath.split("/").pop()}"` : "e.g. \"summarize this repo\""}
            onChange={(e) => setAgentAsk(e.target.value)} />
          <button className="primary" disabled={agentBusy || !agentAsk.trim() || !agentId}
            onClick={runAgent}>{agentBusy ? "working…" : "send to agent"}</button>
          {agentSteps.length > 0 && (
            <div className="ws-steps">
              {agentSteps.map((s, i) => (
                <div key={i} className={`ws-step ${s.result?.ok ? "" : "bad"}`}>
                  <b>{s.tool}</b>
                  <code>{s.args?.path || s.args?.query || s.args?.cmd || ""}</code>
                  {!s.result?.ok && <span> ✗ {s.result?.error}</span>}
                </div>
              ))}
            </div>
          )}
          {agentReply && <div className="ws-reply">{agentReply}</div>}

          {canAdmin && ws.exec_enabled && (
            <>
              <div className="ws-sec" style={{ marginTop: 14 }}>⌨ Terminal</div>
              <div className="ws-term">
                <input value={term} placeholder="run a command in the root…"
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
