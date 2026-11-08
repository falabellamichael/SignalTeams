import React, { useEffect, useRef, useState } from "react";
import Ico from "./Ico";
import { Avatar } from "../util";
import { SOUNDS, triggerSound, onSoundboard } from "../soundboard";
import ChatView from "./ChatView";

function VideoTile({ videoObj, label, isLive }) {
  const vidRef = useRef(null);

  useEffect(() => {
    if (vidRef.current && videoObj?.stream) {
      vidRef.current.srcObject = videoObj.stream;
      vidRef.current.play().catch(() => {});
    }
  }, [videoObj?.stream]);

  return (
    <div className="voice-tile video-tile">
      <video ref={vidRef} autoPlay playsInline muted />
      {isLive && <span className="live-badge">LIVE</span>}
      <div className="tile-footer">
        <span className="tile-name">{label}</span>
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
  const [lastSound, setLastSound] = useState(null);

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
            {/* If local camera is ON */}
            {voice.camOn && voice.camStream && (
              <VideoTile
                videoObj={{ stream: voice.camStream }}
                label={`${me?.display_name || "You"} (Camera)`}
              />
            )}

            {/* Remote videos (cam & screen shares) */}
            {Object.entries(voice.videos || {}).map(([key, v]) => {
              const u = currentRoster.find((m) => m.id === v.uid);
              const label = u ? `${u.display_name} (${v.kind === "screen" ? "Screen" : "Cam"})` : "Video";
              return (
                <VideoTile
                  key={key}
                  videoObj={v}
                  label={label}
                  isLive={v.kind === "screen"}
                />
              );
            })}

            {/* Avatar Tiles for all room participants */}
            {currentRoster.map((m) => {
              const isSpeaking = speakingSet.has(m.id);
              const isMe = m.id === me?.id;
              const isMuted = isMe ? voice.muted : m.muted;
              const isDeafened = isMe ? voice.deafened : m.deafened;

              return (
                <div
                  key={m.id}
                  className={`voice-tile avatar-tile ${isSpeaking ? "speaking" : ""}`}
                  onClick={() => onUserOpen?.(m)}>
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
        <div className="voice-chat-drawer">
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
