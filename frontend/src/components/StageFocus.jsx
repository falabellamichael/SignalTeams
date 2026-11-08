import React, { useEffect } from "react";
import Ico from "./Ico";

// All feeds stay mounted + playing on their own <video>; switching is an
// opacity crossfade — no srcObject re-attach, no black flash, no relayout.
export function VideoStack({ feeds, sel }) {
  const idx = Math.min(sel, feeds.length - 1);
  return feeds.map((fd, i) => (
    <video key={fd.stream.id} autoPlay playsInline muted
      className={i === idx ? "on" : "off"}
      ref={(el) => { if (el && el.srcObject !== fd.stream) { el.srcObject = fd.stream; el.play().catch(() => {}); } }} />
  ));
}

// In-layout focus view: the selected card's feed fills the pane (chat area in
// ChatView, stage in VoiceRoom) while the user strip stays where it was.
// A stream can feed several <video> elements, so the big view binds the SAME
// MediaStreams as the strip tile — playback never blinks.
export default function StageFocus({ card, sel, onSel, onClose }) {
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const idx = Math.min(sel, card.feeds.length - 1);
  const f = card.feeds[idx];
  if (!f) return null;
  return (
    <div className="vs-focus">
      <VideoStack feeds={card.feeds} sel={sel} />
      {f.kind === "screen" && <span className="live-badge">LIVE</span>}
      <span className="vsf-name">{card.name} · {f.kind === "cam" ? "Camera" : "Screen share"}</span>
      <span className="vsf-actions">
        {card.feeds.length > 1 && (
          <button type="button" className="vsf-btn"
            title={f.kind === "cam" ? "Show screen share" : "Show camera"}
            onClick={() => onSel((s) => (s + 1) % card.feeds.length)}>
            <Ico n="swap" s={15} />
          </button>
        )}
        <button type="button" className="vsf-btn" title="Back to chat (Esc)" onClick={onClose}>
          <Ico n="x" s={15} />
        </button>
      </span>
    </div>
  );
}
