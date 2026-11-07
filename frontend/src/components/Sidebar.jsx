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
          <div className="name">Signal<span className="serif" style={{ color: "var(--honey)" }}>Teams</span></div>
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
          <span className="ch-mute" style={{ float: "right" }} title="New group DM"
            onClick={(e) => { e.stopPropagation(); onNewGroupDm?.(); }}><Ico n="plus" s={13} /></span>
          <span className="ch-mute" style={{ float: "right", marginRight: 4 }}
            title="Mark all read — clears every badge"
            onClick={(e) => { e.stopPropagation(); onMarkAllRead?.(); }}><Ico n="check" s={12} /></span></div>
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
                <span className="ch-mute" title="Leave group"
                  onClick={(e) => { e.stopPropagation(); onLeaveDm(d); }}><Ico n="x" s={11} /></span>}
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
              const names = Object.values(typingMap[d.id]);
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
    <span className={`ch-mute s${state}`} title={tip}
      onClick={onToggle}>{ic}</span>
  );
}

export function ServerSidebar({ server, channel, me, onChannel, onAddChannel, onEditChannel, onServerSettings, onMoveChannel, onToggleSrvMute, srvMuted, unread = {}, mentions = {}, muted, mentionsOnly, onToggleMute, voiceRosters = {} }) {
  const text = server.channels.filter((c) => c.kind === "text");
  const agentCh = server.channels.filter((c) => c.kind === "agents");
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
    navigator.clipboard?.writeText(`${location.origin}/#join/${server.invite_code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  const chRow = (c, agent) => {
    const vroom = voiceRosters[c.id] || [];
    return (
      <React.Fragment key={c.id}>
        <div className={`nav-item ${agent ? "ch-agent" : ""} ${channel?.id === c.id ? "on" : ""}`}
          onClick={() => onChannel(c)}>
          <span className="ch-hash">{c.locked ? <Ico n="lock" s={13} /> : agent ? "✦" : "#"}</span>
          <span className="txt" title={c.topic || c.name}>{c.name}</span>
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
          {owner && <span className="ch-gear" title="Move up"
            onClick={(e) => { e.stopPropagation(); onMoveChannel?.(c, -1); }}><Ico n="up" s={11} /></span>}
          {owner && <span className="ch-gear" title="Move down"
            onClick={(e) => { e.stopPropagation(); onMoveChannel?.(c, 1); }}><Ico n="down" s={11} /></span>}
          {owner && <span className="ch-gear" title="Edit channel"
            onClick={(e) => { e.stopPropagation(); onEditChannel(c); }}><Ico n="gear" s={11} /></span>}
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
            <span className="srv-gear" title={srvMuted ? "Unmute server" : "Mute server"}
              style={srvMuted ? { opacity: 1 } : undefined}
              onClick={(e) => { e.stopPropagation(); onToggleSrvMute?.(server); }}>{srvMuted ? <Ico n="bellOff" s={13} /> : <Ico n="bell" s={13} />}</span>
            <span className="srv-gear" title={owner ? "Server settings" : "Leave server"}
              onClick={() => onServerSettings(server)}>{owner ? <Ico n="gear" s={13} /> : <Ico n="logout" s={13} />}</span></div>
          <div className="sub" style={{ cursor: "pointer" }} onClick={copyInvite}
            title="Click to copy invite link">
            invite: <code>{server.invite_code}</code> {copied && "· link copied!"}
          </div>
        </div>
      </div>
      <div className="side-body">
        <div className="side-group">Text channels
          <span className="ch-cnt">{text.length}</span>
          <span className="add" onClick={() => onAddChannel("text")}><Ico n="plus" s={13} /></span></div>
        {uncategorized.map((c) => chRow(c, false))}
        {cats.map((cat) => (
          <React.Fragment key={cat}>
            <div className="side-group cat" onClick={() => toggleCat(cat)}>
              <span className={`cat-arrow ${collapsed.has(cat) ? "" : "open"}`}>▾</span> {cat}
            </div>
            {!collapsed.has(cat) && text.filter((c) => c.category === cat).map((c) => chRow(c, false))}
          </React.Fragment>
        ))}
        <div className="side-group">Agent channels
          <span className="ch-cnt">{agentCh.length}</span>
          <span className="add" onClick={() => onAddChannel("agents")}><Ico n="plus" s={13} /></span></div>
        {agentCh.map((c) => chRow(c, true))}
      </div>
    </div>
  );
}

export function MeBar({ me, onSettings }) {
  return (
    <div className="me-bar">
      <Avatar user={me} size="sm" showStatus />
      <div className="who">
        <div className="n">{me.display_name}</div>
        <div className="s">{me.status_text || `@${me.username} · ${me.status}`}</div>
      </div>
      <button className="ghost" title="Settings" onClick={onSettings}><Ico n="gear" s={15} /></button>
    </div>
  );
}
