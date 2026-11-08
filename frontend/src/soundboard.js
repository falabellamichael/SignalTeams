import { sendWS, onWS } from "./ws";

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx && typeof window !== "undefined") {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioCtx = new AudioCtor();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const SOUNDS = [
  { id: "airhorn", name: "Airhorn", icon: "📯", desc: "The iconic hype airhorn" },
  { id: "quack", name: "Quack", icon: "🦆", desc: "Resonant comedy duck" },
  { id: "badumtss", name: "Ba-Dum-Tss", icon: "🥁", desc: "Punchline drum rimshot" },
  { id: "fanfare", name: "Victory", icon: "🏆", desc: "Triumphant fanfare chord" },
  { id: "coin", name: "Coin Pickup", icon: "🪙", desc: "8-bit retro arcade coin" },
  { id: "gong", name: "Meditation Gong", icon: "🛎️", desc: "Deep resonant bronze gong" },
  { id: "buzzer", name: "Buzzer", icon: "❌", desc: "Game show wrong answer" },
  { id: "crickets", name: "Crickets", icon: "🦗", desc: "Awkward silence chirps" },
];

export function playSound(id) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (id === "airhorn") {
    // 3 dissonant saw oscillators for the authentic brass cluster
    const freqs = [466.16, 587.33, 698.46];
    freqs.forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f * 0.95, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.08);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.7);
    });
  } else if (id === "quack") {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.25);

    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.25);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } else if (id === "badumtss") {
    // Kick (sine sweep)
    const kickOsc = ctx.createOscillator();
    const kickGain = ctx.createGain();
    kickOsc.frequency.setValueAtTime(150, now);
    kickOsc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    kickGain.gain.setValueAtTime(0.35, now);
    kickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    kickOsc.connect(kickGain);
    kickGain.connect(ctx.destination);
    kickOsc.start(now);
    kickOsc.stop(now + 0.15);

    // Snare (at 0.14s)
    const snareOsc = ctx.createOscillator();
    const snareGain = ctx.createGain();
    snareOsc.frequency.setValueAtTime(200, now + 0.14);
    snareOsc.frequency.exponentialRampToValueAtTime(80, now + 0.25);
    snareGain.gain.setValueAtTime(0.3, now + 0.14);
    snareGain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
    snareOsc.connect(snareGain);
    snareGain.connect(ctx.destination);
    snareOsc.start(now + 0.14);
    snareOsc.stop(now + 0.3);

    // Cymbal crash (noise shimmer at 0.3s)
    const bufSize = ctx.sampleRate * 0.6;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hiPass = ctx.createBiquadFilter();
    hiPass.type = "highpass";
    hiPass.frequency.value = 5000;
    const cymbalGain = ctx.createGain();
    cymbalGain.gain.setValueAtTime(0.25, now + 0.3);
    cymbalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    noise.connect(hiPass);
    hiPass.connect(cymbalGain);
    cymbalGain.connect(ctx.destination);
    noise.start(now + 0.3);
  } else if (id === "fanfare") {
    // 4-note victory arpeggio: C5, E5, G5, C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.11;
      const dur = idx === 3 ? 0.6 : 0.18;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  } else if (id === "coin") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } else if (id === "gong") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.9);
  } else if (id === "buzzer") {
    [150, 215].forEach((f) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    });
  } else if (id === "crickets") {
    for (let c = 0; c < 3; c++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + c * 0.16;
      osc.type = "sine";
      osc.frequency.setValueAtTime(4500, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }
}

// Global sound event listener
const listeners = new Set();
export function onSoundboard(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function triggerSound(channelId, soundId) {
  playSound(soundId);
  sendWS({ type: "soundboard", channel_id: channelId, sound: soundId });
  listeners.forEach((fn) => fn({ channel_id: channelId, sound: soundId, local: true }));
}

// Listen for peer soundboard events via WebSocket
onWS((evt) => {
  if (evt.type === "soundboard") {
    playSound(evt.sound);
    listeners.forEach((fn) => fn(evt));
  }
});
