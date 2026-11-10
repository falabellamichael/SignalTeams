import React, { useEffect, useState } from "react";
import Ico from "./Ico";
import StageFocus, { VideoStack } from "./StageFocus";
import { Avatar } from "../util";
import { SOUNDS, triggerSound, onSoundboard } from "../soundboard";
import ChatView from "./ChatView";

function VideoTile({ card, sel, onSel, onZoom, active, speaking }) {
  const { feeds, name } = card;
  const idx = Math.min(sel, feeds.length - 1);
  const f = feeds[idx];

  if (!f) return null;
  return (
    <div className={`voice-tile video-tile zoomable${active ? " active" : ""}${speaking ? " speaking" : ""}`}
      title={active ? "Back to grid" : "Expand"} onClick={onZoom}>
      {/* every feed stays mounted + playing — flipping is just an opacity swap,
          no srcObject re-attach, no black flash, no relayout */}
      <VideoStack feeds={feeds} sel={sel} />
      {f.kind === "screen" && <span className="live-badge">LIVE</span>}
      {feeds.length > 1 && (
        <button type="button" className="tile-flip"
          title={f.kind === "cam" ? "Show screen share" : "Show camera"}
          onClick={(e) => { e.stopPropagation(); onSel((s) => (s + 1) % feeds.length); }}>
          <Ico n="swap" s={14} />
        </button>
      )}
      <button type="button" className="vs-zoom" title={active ? "Back to grid" : "Expand"}
        onClick={(e) => { e.stopPropagation(); onZoom(); }}>
        <Ico n="expand" s={13} />
      </button>
      <div className="tile-footer">
        <span className="tile-name">{name} ({f.kind === "cam" ? "Cam" : "Screen"})</span>
      </div>
    </div>
  );
}

export default function VoiceRoom({
  channel, server, me, voice,
  onJoinVoice, onLeaveVoice,
  onToggleMute, onToggleDeafen,
  onToggleShare, onToggleCam,
  onUserOpen, onDm,
  // ChatView pass-through props for in-voice text chat drawer
  members, emojis, roles, channels, onAgentOpen, onPackOpen,
  onShareAgent, onForward, onFwdJump, focusMsg, blocked
}) {
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatW, setChatW] = useState(() => +(localStorage.getItem("st.vchatw") || 380));
  useEffect(() => { localStorage.setItem("st.vchatw", String(chatW)); }, [chatW]);
  function startChatDrag(e) {
    e.preventDefault();
    const startX = e.clientX, startW = chatW;
    document.body.classList.add("col-resizing");
    const move = (ev) =>
      setChatW(Math.min(640, Math.max(280, startW - (ev.clientX - startX))));
    const up = () => {
      document.body.classList.remove("col-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  const [lastSound, setLastSound] = useState(null);
  const [focus, setFocus] = useState(null);        // expanded video card id
  const [sels, setSels] = useState({});            // picked feed index per card

  const isInThisRoom = voice.joined && voice.channelId === channel.id;
  const currentRoster = isInThisRoom
    ? voice.roster
    : (voice.rosters?.[channel.id] || []);

  const speakingSet = new Set(voice.speaking || []);

  // Listen for soundboard animations
  useEffect(() => {
    return onSoundboard((evt) => {
      if (evt.channel_id === channel.id) {
        const item = SOUNDS.find((s) => s.id === evt.sound);
        if (item) {
          setLastSound({ ...item, key: Math.random() });
          setTimeout(() => setLastSound(null), 2000);
        }
      }
    });
  }, [channel.id]);

  // one card per video user — cam + screen feeds grouped on it
  const videoCards = [];
  const myFeeds = [
    voice.camOn && voice.camStream && { stream: voice.camStream, kind: "cam" },
    voice.sharing && voice.screenStream && { stream: voice.screenStream, kind: "screen" },
  ].filter(Boolean);
  if (myFeeds.length) videoCards.push({ id: "me", name: me?.display_name || "You", feeds: myFeeds });
  const vidByUid = new Map();
  for (const v of Object.values(voice.videos || {})) {
    const k = String(v.uid);
    if (!vidByUid.has(k)) vidByUid.set(k, []);
    vidByUid.get(k).push(v);
  }
  for (const [uid, feeds] of vidByUid) {
    // a sharer's screen is the feed people come to watch — default to it
    feeds.sort((a, b) => (b.kind === "screen") - (a.kind === "screen"));
    const u = currentRoster.find((m) => m.id === uid);
    videoCards.push({ id: uid, name: u?.display_name || "Video", feeds });
  }
  const focusCard = videoCards.find((c) => c.id === focus) || null;
  const vSel = (id) => sels[id] ?? 0;
  const setSelFor = (id, v) => setSels((s) => ({ ...s, [id]: typeof v === "function" ? v(s[id] ?? 0) : v }));

  return (
    <div className="voice-stage-layout">
      <div className="voice-stage-main">
        {/* Top Channel Bar */}
        <div className="voice-stage-header">
          <div className="vsh-left">
            <span className="vsh-icon">🔊</span>
            <span className="vsh-name">{channel.name}</span>
            {channel.topic && <span className="vsh-topic">— {channel.topic}</span>}
          </div>
          <div className="vsh-right">
            {isInThisRoom && (
              <span className="rtc-pill" title="RTC Connected · 24ms">
                <span className="rtc-dot" /> RTC Connected
              </span>
            )}
            <button
              className={`ghost stage-top-btn ${chatOpen ? "on" : ""}`}
              title={chatOpen ? "Hide Voice Text Chat" : "Open Voice Text Chat"}
              onClick={() => setChatOpen((o) => !o)}>
              <Ico n="chat" s={16} />
            </button>
          </div>
        </div>

        {/* Floating Soundboard Banner if active */}
        {lastSound && (
          <div className="soundboard-toast">
            <span className="st-icon">{lastSound.icon}</span>
            <span className="st-name">{lastSound.name}</span>
          </div>
        )}

        {/* Voice Grid Content */}
        {!isInThisRoom ? (
          <div className="voice-preview-hero">
            <div className="vph-card">
              <span className="vph-icon">🔊</span>
              <h2>{channel.name}</h2>
              <p>{channel.topic || "Ready to talk? Hop into voice and video with your crew."}</p>
              {currentRoster.length > 0 && (
                <div className="vph-members">
                  <span>In this room:</span>
                  <div className="vph-avatar-row">
                    {currentRoster.map((m) => (
                      <span key={m.id} title={m.display_name}>
                        <Avatar user={m} size="sm" />
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button className="primary join-voice-btn" onClick={() => onJoinVoice?.(channel.id)}>
                Join Voice
              </button>
            </div>
          </div>
        ) : (
          <div className="voice-grid">
            {/* One card per video user — cam and/or screen share on a flippable card */}
            {videoCards.map((c) => (
              <VideoTile key={c.id} card={c} sel={vSel(c.id)} onSel={(v) => setSelFor(c.id, v)}
                active={focus === c.id}
                speaking={c.id === "me" ? speakingSet.has(me?.id)
                  : [...speakingSet].some((x) => String(x) === c.id)}
                onZoom={() => setFocus((f) => (f === c.id ? null : c.id))} />
            ))}

            {/* Avatar Tiles for room participants without a live video feed */}
            {currentRoster.map((m) => {
              // users with an active cam/screen feed render as a VideoTile above
              if (vidByUid.has(String(m.id))) return null;
              const isMe = m.id === me?.id;
              if (isMe && myFeeds.length) return null;
              const isSpeaking = speakingSet.has(m.id);
              const isMuted = isMe ? voice.muted : m.muted;
              const isDeafened = isMe ? voice.deafened : m.deafened;

              return (
                <div
                  key={m.id}
                  className={`voice-tile avatar-tile ${isSpeaking ? "speaking" : ""}`}
                  onClick={(e) => onUserOpen?.(m, e)}>
                  <div className={`tile-avatar-wrap ${isSpeaking ? "glow" : ""}`}>
                    <Avatar user={m} size="lg" />
                  </div>
                  <div className="tile-footer">
                    <span className="tile-name">{m.nickname || m.display_name}</span>
                    <div className="tile-icons">
                      {isMuted && <span className="tile-badge muted" title="Muted">🔇</span>}
                      {isDeafened && <span className="tile-badge deafened" title="Deafened">🎧</span>}
                      {m.sharing && <span className="tile-badge live" title="Streaming Screen">🖥️</span>}
                      {m.cam && <span className="tile-badge cam" title="Camera On">📹</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Focused feed — fills the stage; tiles stay mounted beneath */}
        {focusCard && (
          <StageFocus card={focusCard} sel={vSel(focusCard.id)}
            onSel={(v) => setSelFor(focusCard.id, v)}
            onClose={() => setFocus(null)} />
        )}

        {/* Floating Voice Control Dock */}
        {isInThisRoom && (
          <div className="voice-dock">
            <button
              className={`ghost dock-btn ${voice.camOn ? "active" : ""}`}
              title={voice.camOn ? "Turn Off Camera" : "Turn On Camera"}
              onClick={onToggleCam}>
              <Ico n="video" s={18} />
            </button>
            <button
              className={`ghost dock-btn ${voice.sharing ? "active" : ""}`}
              title={voice.sharing ? "Stop Sharing Screen" : "Share Screen"}
              onClick={onToggleShare}>
              <Ico n="screen" s={18} />
            </button>
            <button
              className={`ghost dock-btn ${soundboardOpen ? "active" : ""}`}
              title="Soundboard"
              onClick={() => setSoundboardOpen((o) => !o)}>
              <Ico n="gift" s={18} />
            </button>
            <div className="dock-sep" />
            <button
              className={`ghost dock-btn ${voice.muted ? "danger" : ""}`}
              title={voice.muted ? "Unmute Microphone" : "Mute Microphone"}
              onClick={onToggleMute}>
              <Ico n={voice.muted ? "micOff" : "mic"} s={18} />
            </button>
            <button
              className={`ghost dock-btn ${voice.deafened ? "danger" : ""}`}
              title={voice.deafened ? "Undeafen" : "Deafen"}
              onClick={onToggleDeafen}>
              <Ico n={voice.deafened ? "undeaf" : "phones"} s={18} />
            </button>
            <button
              className="ghost dock-btn disconnect"
              title="Disconnect"
              onClick={onLeaveVoice}>
              <Ico n="hangup" s={18} />
            </button>

            {/* Soundboard Popover */}
            {soundboardOpen && (
              <>
                <div className="menu-scrim" onClick={() => setSoundboardOpen(false)} />
                <div className="soundboard-popover">
                  <div className="sb-header">
                    <span>🔊 Server Soundboard</span>
                    <button className="ghost sb-close" onClick={() => setSoundboardOpen(false)}>
                      <Ico n="x" s={12} />
                    </button>
                  </div>
                  <div className="sb-grid">
                    {SOUNDS.map((s) => (
                      <button
                        key={s.id}
                        className="sb-item"
                        title={s.desc}
                        onClick={() => triggerSound(channel.id, s.id)}>
                        <span className="sb-icon">{s.icon}</span>
                        <span className="sb-label">{s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* In-Voice Text Chat Drawer */}
      {chatOpen && (
        <div className="voice-chat-drawer" style={{ width: chatW }}>
          <div className="side-drag" onMouseDown={startChatDrag}
            title="Drag to resize the chat panel" />
          <ChatView
            channel={channel}
            server={server}
            onDm={onDm}
            members={members}
            me={me}
            emojis={emojis}
            roles={roles}
            channels={channels}
            onAgentOpen={onAgentOpen}
            onPackOpen={onPackOpen}
            onShareAgent={onShareAgent}
            onUserOpen={onUserOpen}
            onForward={onForward}
            onFwdJump={onFwdJump}
            focusMsg={focusMsg}
            blocked={blocked}
          />
        </div>
      )}
    </div>
  );
}
