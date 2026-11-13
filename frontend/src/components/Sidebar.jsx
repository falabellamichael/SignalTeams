import { toggleShare, toggleCam } from "../voice";
import React from "react";
import { Avatar } from "../util";
import { api } from "../api";
import Ico from "./Ico";

function NavItem({ ic, txt, on, onClick, count, cls }) {
  return (
    <div className={`nav-item ${on ? "on" : ""} ${cls || ""}`} onClick={onClick}>
      <span className="ic">{ic}</span>
      <span className="txt">{txt}</span>
      {count > 0 && <span className="cnt">{count}</span>}
    </div>
  );
}

export function HomeSidebar({ view, setView, dms, onOpenDm, onNewGroupDm, onLeaveDm, onMarkAllRead, pendingCount, unread = {}, mentions = {}, muted, mentionsOnly, onToggleMute, voiceRosters = {}, typingMap = {} }) {
  return (
    <div className="side">
      <div className="side-head">
        <div>
          <div className="name">Signal<span className="serif" style={{ color: "var(--honey)" }}>Hive</span></div>
          <div className="sub">your crew's agents</div>
        </div>
      </div>
      <div className="side-body">
        <div className="side-group">Feed</div>
        <NavItem ic="🐝" txt="Buzz" on={view === "buzz"} onClick={() => setView("buzz")} />
        <NavItem ic="🧰" txt="Agent Library" on={view === "library"} onClick={() => setView("library")} />
        <NavItem ic="⭐" txt="My Bench" on={view === "bench"} onClick={() => setView("bench")} />
        <NavItem ic="🔖" txt="Saved" on={view === "saved"} onClick={() => setView("saved")} />
        <div className="side-group">People</div>
        <NavItem ic="👥" txt="Friends" on={view === "friends"} onClick={() => setView("friends")} count={pendingCount} />
        <div className="side-group">Direct messages
          <button type="button" className="ch-mute" style={{ float: "right" }} title="New group DM"
            onClick={(e) => { e.stopPropagation(); onNewGroupDm?.(); }}><Ico n="plus" s={13} /></button>
          <button type="button" className="ch-mute" style={{ float: "right", marginRight: 4 }}
            title="Mark all read — clears every badge"
            onClick={(e) => { e.stopPropagation(); onMarkAllRead?.(); }}><Ico n="check" s={12} /></button></div>
        {dms.length === 0 && <div style={{ fontSize: 11.5, color: "var(--dim)", padding: "2px 8px" }}>
          No DMs yet — poke a friend.</div>}
        {dms.map((d) => (
          <React.Fragment key={d.id}>
            <div className={`nav-item ${view === `dm-${d.id}` ? "on" : ""}`}
              onClick={() => onOpenDm(d)}>
              {(d.members || []).length > 1 ? (
                <>
                  <span className="gdm-ico">{d.members.slice(0, 2).map((u) => u.avatar_emoji).join("")}</span>
                  <span className="txt">{d.name || d.members.map((u) => u.display_name.split(" ")[0]).join(", ")}
                    <span className="gdm-n"> {d.members.length + 1}</span></span>
                </>
              ) : (
                <>
                  <Avatar user={d.other} size="sm" showStatus />
                  <span className="txt">
                    {(d.other?.username || "").startsWith("agent:") ? "✦ " : ""}
                    {d.other?.display_name || "?"}</span>
                </>
              )}
              {mentions[d.id] > 0
                ? <span className="cnt ping" title={`${mentions[d.id]} mention${mentions[d.id] > 1 ? "s" : ""}`}>@{mentions[d.id]}</span>
                : unread[d.id] > 0 && <span className="cnt">{unread[d.id]}</span>}
              {(d.members || []).length > 1 && onLeaveDm &&
                <button type="button" className="ch-mute" title="Leave group"
                  onClick={(e) => { e.stopPropagation(); onLeaveDm(d); }}><Ico n="x" s={11} /></button>}
              <MuteBtn state={muted?.has(d.id) ? 2 : mentionsOnly?.has(d.id) ? 1 : 0}
                onToggle={(e) => { e.stopPropagation(); onToggleMute?.(d); }} />
            </div>
            {(voiceRosters[d.id] || []).length > 0 && (
              <div className="ch-voice">
                {(voiceRosters[d.id] || []).map((m) => (
                  <span key={m.id} className="ch-vm" title={`${m.display_name} is in voice`}>
                    <span className="ch-vm-av" style={{ background: m.avatar_color }}>{m.avatar_emoji}</span>
                    {m.display_name}{m.muted ? " 🔇" : ""}{m.deafened ? " 🚫" : ""}{m.sharing ? " 🖥" : ""}{m.cam ? " 📹" : ""}
                  </span>
                ))}
              </div>
            )}
            {Object.keys(typingMap[d.id] || {}).length > 0 && (() => {
              const names = Object.values(typingMap[d.id])
                .map((u) => (u && typeof u === "object") ? (u.display_name || u.username) : u);
              return (
                <div className="ch-voice dm-ty">
                  <span className="ch-vm ty">
                    {names.length > 2 ? `${names.length} people` : names.join(", ")} typing…
                  </span>
                </div>
              );
            })()}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function MuteBtn({ state = 0, onToggle }) {
  const [ic, tip] = [
    [<Ico n="bell" s={11} />, "Notifications: all — click for mentions-only"],
    [<Ico n="at" s={11} />, "Notifications: mentions only — click to mute"],
    [<Ico n="bellOff" s={11} />, "Muted — click to re-enable"],
  ][state];
  return (
    <button type="button" className={`ch-mute s${state}`} title={tip}
      onClick={onToggle}>{ic}</button>
  );
}

export function ServerSidebar({ server, channel, me, voice, onJoinVoice, onChannel, onAddChannel, onEditChannel, onCategorySettings, onAddCategory, onServerSettings, onMoveChannel, onToggleSrvMute, srvMuted, onEvents, evCount = 0, unread = {}, mentions = {}, muted, mentionsOnly, onToggleMute, voiceRosters = {}, workspaces = [], activeWs, onWorkspace, onNewWorkspace, typingMap = {} }) {
  const text = server.channels.filter((c) => c.kind === "text" || c.kind === "forum" || c.kind === "voice");
  // workspace chat channels are scoped to their workspace — they get there via
  // the workspace's own chat tab, not the generic agent-channel list
  const agentCh = server.channels.filter((c) => c.kind === "agents" && !c.workspace);
  const [copied, setCopied] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(new Set());
  const [imgErr, setImgErr] = React.useState(false);
  React.useEffect(() => setImgErr(false), [server.icon_file]);
  const cats = [];
  for (const c of text) if (c.category && !cats.includes(c.category)) cats.push(c.category);
  const uncategorized = text.filter((c) => !c.category);
  const toggleCat = (name) => setCollapsed((s) => {
    const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const owner = me?.id === server.owner_id;
  function copyInvite() {
    navigator.clipboard?.writeText(`${location.origin}/invite/${server.invite_code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  const chRow = (c, agent) => {
    const vroom = voiceRosters[c.id] || [];
    return (
      <React.Fragment key={c.id}>
        <div className={`nav-item ${agent ? "ch-agent" : ""} ${channel?.id === c.id ? "on" : ""}`}
          onClick={() => {
            onChannel(c);
            if (c.kind === "voice" && (!voice?.joined || voice?.channelId !== c.id)) {
              onJoinVoice?.(c.id);
            }
          }}>
          <span className="ch-hash">{c.locked ? <Ico n="lock" s={13} /> : c.workspace ? "🗂" : agent ? "✦" : c.kind === "voice" ? "🔊" : c.kind === "forum" ? "📋" : "#"}</span>
          <span className="txt" title={c.topic || c.name}>{c.name}</span>
          {(() => {
            const bots = Object.values(typingMap[c.id] || {})
              .filter((u) => u && typeof u === "object" && (u.bot || /^[a-z-]+:/.test(String(u.id || ""))));
            if (!bots.length) return null;
            const names = bots.map((u) => u.display_name || u.username).join(", ");
            const phase = bots.map((u) => u.phase).filter(Boolean)[0];
            return <img className="ch-knot" src="/brand/knot-loop.png" alt=""
              title={`${names} ${phase || "working"}…`} />;
          })()}
          {localStorage.getItem("st.draft." + c.id) &&
            <span className="ch-draft" title="You have an unsent draft here"><Ico n="edit" s={11} /></span>}
          {mentions[c.id] > 0
            ? <span className="cnt ping" title={`${mentions[c.id]} mention${mentions[c.id] > 1 ? "s" : ""}`}>@{mentions[c.id]}</span>
            : unread[c.id] > 0 && <span className="cnt">{unread[c.id]}</span>}
          <MuteBtn state={muted?.has(c.id) ? 2 : mentionsOnly?.has(c.id) ? 1 : 0}
            onToggle={(e) => { e.stopPropagation(); onToggleMute?.(c); }} />
          {c.slowmode_secs > 0 && (
            <span className="ch-slow" title={`Slowmode — ${c.slowmode_secs}s between messages`}>🐌</span>)}
          {c.voice_cap > 0 && (
            <span className="ch-slow" title={`Voice capacity ${vroom.length}/${c.voice_cap}`}>
              {vroom.length}/{c.voice_cap}</span>)}
          {(c.lurkers || []).length > 0 && (
            <span className="ch-slow" title="Lurking agents — auto-reply to new messages">⚡</span>)}
          {owner && <button type="button" className="ch-gear" title="Move up"
            onClick={(e) => { e.stopPropagation(); onMoveChannel?.(c, -1); }}><Ico n="up" s={11} /></button>}
          {owner && <button type="button" className="ch-gear" title="Move down"
            onClick={(e) => { e.stopPropagation(); onMoveChannel?.(c, 1); }}><Ico n="down" s={11} /></button>}
          {owner && <button type="button" className="ch-gear" title="Edit channel"
            onClick={(e) => { e.stopPropagation(); onEditChannel(c); }}><Ico n="gear" s={11} /></button>}
        </div>
        {vroom.length > 0 && (
          <div className="ch-voice">
            {vroom.map((m) => (
              <span key={m.id} className="ch-vm" title={`${m.display_name} is in voice`}>
                <span className="ch-vm-av" style={{ background: m.avatar_color }}>{m.avatar_emoji}</span>
                {m.display_name}{m.muted ? " 🔇" : ""}{m.sharing ? " 🖥" : ""}{m.cam ? " 📹" : ""}
              </span>
            ))}
          </div>
        )}
      </React.Fragment>
    );
  };
  return (
    <div className="side">
      <div className="side-head">
        <div>
          <div className="name">{server.icon_file && !imgErr
              ? <img src={api.fileUrl(server.icon_file)} alt="" onError={() => setImgErr(true)}
                  style={{ width: 18, height: 18, borderRadius: 5, verticalAlign: "-3px", marginRight: 4 }} />
              : server.icon} {server.name}
            <button type="button" className="srv-gear" title={srvMuted ? "Unmute server" : "Mute server"}
              style={srvMuted ? { opacity: 1 } : undefined}
              onClick={(e) => { e.stopPropagation(); onToggleSrvMute?.(server); }}>{srvMuted ? <Ico n="bellOff" s={13} /> : <Ico n="bell" s={13} />}</button>
            <button type="button" className="srv-gear" title={owner ? "Server settings" : "Leave server"}
              onClick={() => onServerSettings(server)}>{owner ? <Ico n="gear" s={13} /> : <Ico n="logout" s={13} />}</button></div>
          <div className="sub" style={{ cursor: "pointer" }} onClick={copyInvite}
            title="Click to copy invite link">
            invite: <code>{server.invite_code}</code> {copied && "· link copied!"}
          </div>
        </div>
      </div>
      <div className="side-body">
        <div className="nav-item" onClick={() => onEvents?.(server)} title="Scheduled events">
          <span className="ch-hash">📅</span>
          <span className="txt">Events</span>
          {evCount > 0 && <span className="cnt">{evCount}</span>}
        </div>
        <div className="side-group">
          <span>Text channels</span>
          <span className="ch-cnt">{text.length}</span>
          <span className="group-actions" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {owner && <button type="button" className="add" title="Create category" onClick={() => onAddCategory?.()}><Ico n="folderPlus" s={12} /></button>}
            <button type="button" className="add" title="Add text channel" onClick={() => onAddChannel("text")}><Ico n="plus" s={13} /></button>
          </span>
        </div>
        {uncategorized.map((c) => chRow(c, false))}
        {cats.map((cat) => (
          <React.Fragment key={cat}>
            <div className="side-group cat" onClick={() => toggleCat(cat)}>
              <span className={`cat-arrow ${collapsed.has(cat) ? "" : "open"}`}>▾</span>
              <span className="cat-name">{cat}</span>
              {owner && (
                <span className="cat-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="add" title={`New channel under ${cat}`}
                    onClick={() => onAddChannel("text", cat)}><Ico n="plus" s={13} /></button>
                  <button type="button" className="ch-gear" title="Category settings"
                    onClick={() => onCategorySettings?.(cat)}><Ico n="gear" s={11} /></button>
                </span>
              )}
            </div>
            {!collapsed.has(cat) && text.filter((c) => c.category === cat).map((c) => chRow(c, false))}
          </React.Fragment>
        ))}
        <div className="side-group">Agent channels
          <span className="ch-cnt">{agentCh.length}</span>
          <button type="button" className="add" title="Add agent channel" onClick={() => onAddChannel("agents")}><Ico n="plus" s={13} /></button></div>
        {agentCh.map((c) => chRow(c, true))}
        {(workspaces.length > 0 || owner) && (
          <>
            <div className="side-group">Workspaces
              <span className="ch-cnt">{workspaces.length}</span>
              {owner && <button type="button" className="add" title="Link a folder on this machine"
                onClick={() => onNewWorkspace?.()}><Ico n="plus" s={13} /></button>}</div>
            {workspaces.map((w) => (
              <div key={w.id} className={`nav-item ws-nav ${activeWs === w.id ? "on" : ""}`}
                onClick={() => onWorkspace?.(w)} title={`${w.root} — ${w.files} files`}>
                <span className="ch-hash">{w.icon}</span>
                <span className="txt">{w.name}</span>
                <span className={`ws-lvl-mini ${w.level}`} title={`your access: ${w.level}`}>
                  {w.level === "admin" ? "🛡" : w.level === "write" ? "✏️" : "👁"}</span>
              </div>
            ))}
            {workspaces.length === 0 && (
              <div style={{ fontSize: 11.5, color: "var(--dim)", padding: "2px 8px" }}>
                No workspaces — link a folder so agents can edit real files.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function VoiceConnectedBar({ voice, channel, server, onDisconnect, onJump }) {
  if (!voice?.joined) return null;
  const chName = channel?.name ? `#${channel.name}` : (voice.channelId ? `channel #${voice.channelId}` : "voice");
  const srvName = server?.name || "Server";

  return (
    <div className="voice-connected-bar">
      <div className="vcb-status" onClick={() => onJump?.(voice.channelId)} title="Click to view voice room">
        <div className="vcb-icon-wrap" title="RTC Connected · 24ms">
          <span className="vcb-pulse-dot" />
          <Ico n="dish" s={14} />
        </div>
        <div className="vcb-info">
          <div className="vcb-title">Voice Connected</div>
          <div className="vcb-sub">{chName} / {srvName}</div>
        </div>
      </div>
      <div className="vcb-actions">
        <button
          className={`ghost vcb-btn ${voice.sharing ? "active" : ""}`}
          title={voice.sharing ? "Stop Sharing Screen" : "Share Your Screen"}
          onClick={toggleShare}>
          <Ico n="screen" s={14} />
        </button>
        <button
          className={`ghost vcb-btn ${voice.camOn ? "active" : ""}`}
          title={voice.camOn ? "Turn Off Camera" : "Turn On Camera"}
          onClick={toggleCam}>
          <Ico n="video" s={14} />
        </button>
        <button
          className="ghost vcb-btn disconnect"
          title="Disconnect from Voice"
          onClick={onDisconnect}>
          <Ico n="hangup" s={14} />
        </button>
      </div>
    </div>
  );
}

export function MeBar({ me, voice, onSettings, onToggleMute, onToggleDeafen }) {
  const isMuted = voice?.muted;
  const isDeafened = voice?.deafened;
  const [menu, setMenu] = React.useState(null);
  const bar = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const dismiss = (e) => { if (!bar.current?.contains(e.target)) setMenu(null); };
    const escape = (e) => { if (e.key === "Escape") { setMenu(null); bar.current?.querySelector(`[data-audio-menu="${menu}"]`)?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menu]);

  return (
    <div className="me-bar" ref={bar}>
      <button type="button" className="me-profile" onClick={onSettings} title="Edit your profile">
      <Avatar user={me} size="sm" showStatus />
      <span className="who">
        <span className="n">{me.display_name}</span>
        <span className="s">{me.status_text || me.status || "Online"}</span>
      </span>
      </button>
      <div className="me-actions">
        <div className="me-control">
        <button
          className={`ghost me-btn ${isMuted ? "muted" : ""}`}
          aria-pressed={!!isMuted}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          onClick={onToggleMute}>
          <Ico n={isMuted ? "micOff" : "mic"} s={21} w="fill" />
        </button>
        <button className="ghost me-btn me-chevron" title="Microphone options" data-audio-menu="mic"
          aria-expanded={menu === "mic"} onClick={() => setMenu(menu === "mic" ? null : "mic")}><Ico n="caretD" s={13} w="bold" /></button>
        </div>
        <div className="me-control">
        <button
          className={`ghost me-btn ${isDeafened ? "deafened" : ""}`}
          aria-pressed={!!isDeafened}
          title={isDeafened ? "Undeafen" : "Deafen"}
          onClick={onToggleDeafen}>
          <Ico n={isDeafened ? "undeaf" : "phones"} s={23} w="fill" />
        </button>
        <button className="ghost me-btn me-chevron" title="Headphone options" data-audio-menu="phones"
          aria-expanded={menu === "phones"} onClick={() => setMenu(menu === "phones" ? null : "phones")}><Ico n="caretD" s={13} w="bold" /></button>
        </div>
        <button className="ghost me-btn" title="Settings" onClick={onSettings}>
          <Ico n="gear" s={24} w="fill" />
        </button>
      </div>
      {menu && <div className="me-audio-popover">
        <strong>{menu === "mic" ? "Microphone" : "Headphones"}</strong>
        <button onClick={() => { menu === "mic" ? onToggleMute() : onToggleDeafen(); setMenu(null); }}>
          {menu === "mic" ? (isMuted ? "Unmute microphone" : "Mute microphone") : (isDeafened ? "Undeafen" : "Deafen")}
        </button>
        <button onClick={() => { setMenu(null); onSettings(); }}>Open settings</button>
      </div>}
    </div>
  );
}
