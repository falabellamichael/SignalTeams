/**
 * SignalTeams Soothing Audio Cues & Tactile Sound FX Engine
 * Inspired by VS Code Audio Cues and premium lubed mechanical keyboard switches.
 * Pure Web Audio API synthesis - zero external audio files, zero latency.
 */

let audioCtx = null;
let lastClickTime = 0;
let lastKeyTime = 0;

// Configuration state persisted in localStorage
export const audioConfig = {
  get enabled() {
    return localStorage.getItem("st.audio_cues") !== "0";
  },
  set enabled(val) {
    localStorage.setItem("st.audio_cues", val ? "1" : "0");
  },
  get volume() {
    const v = parseFloat(localStorage.getItem("st.audio_vol"));
    return isNaN(v) ? 0.35 : Math.max(0, Math.min(1, v));
  },
  set volume(val) {
    localStorage.setItem("st.audio_vol", String(Math.max(0, Math.min(1, val))));
  },
  get typing() {
    return localStorage.getItem("st.audio_typing") !== "0";
  },
  set typing(val) {
    localStorage.setItem("st.audio_typing", val ? "1" : "0");
  },
  get profile() {
    return localStorage.getItem("st.audio_profile") || "thock"; // "thock" | "crisp" | "bubble"
  },
  set profile(val) {
    localStorage.setItem("st.audio_profile", val);
  },
};

export function getAudioContext() {
  if (!audioCtx && typeof window !== "undefined") {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) {
      audioCtx = new AudioCtor();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Ensure audio context resumes on user interaction
if (typeof window !== "undefined") {
  const resume = () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", resume, { once: true, passive: true });
  window.addEventListener("keydown", resume, { once: true, passive: true });
}

/**
 * Play a synthesized audio cue
 * @param {"click"|"select"|"switch"|"send"|"receive"|"pop"|"join"|"leave"|"mute"|"unmute"|"key"} cue 
 * @param {object} [opts] - optional overrides (pitch, vol)
 */
export function playCue(cue, opts = {}) {
  if (!audioConfig.enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterVol = audioConfig.volume * (opts.vol ?? 1);
  if (masterVol <= 0.001) return;

  const prof = opts.profile || audioConfig.profile;

  // Natural analog pitch jitter (+/- 4%) so rapid clicks never sound repetitive
  const jitter = 1 + (Math.random() * 0.08 - 0.04);

  switch (cue) {
    case "click":
    case "select": {
      // Throttle click sounds so bubbling events don't double-trigger
      const perfNow = performance.now();
      if (perfNow - lastClickTime < 32) return;
      lastClickTime = perfNow;

      if (prof === "bubble") {
        playBubblePop(ctx, now, masterVol, jitter * 1.1);
      } else if (prof === "crisp") {
        playCrispClick(ctx, now, masterVol, jitter);
      } else {
        // Default: Soothing VS Code lubed mechanical "thock"
        playSoothingThock(ctx, now, masterVol, jitter);
      }
      break;
    }

    case "switch": {
      const perfNow = performance.now();
      if (perfNow - lastClickTime < 32) return;
      lastClickTime = perfNow;
      playCrispClick(ctx, now, masterVol * 0.9, jitter * 1.15);
      break;
    }

    case "key": {
      if (!audioConfig.typing) return;
      const perfNow = performance.now();
      if (perfNow - lastKeyTime < 42) return;
      lastKeyTime = perfNow;

      const keyPitch = opts.key === " " ? 0.75 : opts.key === "Enter" ? 0.85 : opts.key === "Backspace" ? 0.9 : jitter;
      if (prof === "bubble") {
        playBubblePop(ctx, now, masterVol * 0.45, keyPitch * 1.2);
      } else if (prof === "crisp") {
        playCrispClick(ctx, now, masterVol * 0.4, keyPitch);
      } else {
        playSoothingThock(ctx, now, masterVol * 0.5, keyPitch);
      }
      break;
    }

    case "send": {
      // Ascending satisfying tactile send swoosh-pop
      playSendCue(ctx, now, masterVol);
      break;
    }

    case "receive": {
      // VS Code style soothing harmonic chime (E5 + B5 warm marimba interval)
      playHarmonicChime(ctx, now, masterVol);
      break;
    }

    case "pop": {
      // Bubbly pop for reactions, emoji picks, chip toggles
      playBubblePop(ctx, now, masterVol * 1.1, jitter);
      break;
    }

    case "join": {
      // Warm 3-note ascending chord (F4 -> A4 -> C5)
      playChordCue(ctx, now, [349.23, 440.00, 523.25], masterVol);
      break;
    }

    case "leave": {
      // Warm 3-note descending chord (C5 -> A4 -> F4)
      playChordCue(ctx, now, [523.25, 440.00, 349.23], masterVol);
      break;
    }

    case "mute": {
      // Mechanical latch down (460Hz -> 280Hz)
      playLatchCue(ctx, now, 460, 260, masterVol);
      break;
    }

    case "unmute": {
      // Mechanical latch up (280Hz -> 500Hz)
      playLatchCue(ctx, now, 280, 520, masterVol);
      break;
    }

    default:
      playSoothingThock(ctx, now, masterVol, jitter);
      break;
  }
}

/**
 * VS Code / Lubed Mechanical "Thock"
 * Combination of high-frequency micro-transient (switch contact) + warm resonant body (housing bottom-out)
 */
function playSoothingThock(ctx, now, vol, pitchMult = 1) {
  // 1. High-frequency micro-transient (3ms tick)
  const oscTick = ctx.createOscillator();
  const tickFilter = ctx.createBiquadFilter();
  const tickGain = ctx.createGain();

  oscTick.type = "triangle";
  oscTick.frequency.setValueAtTime(2400 * pitchMult, now);
  oscTick.frequency.exponentialRampToValueAtTime(800 * pitchMult, now + 0.008);

  tickFilter.type = "bandpass";
  tickFilter.frequency.value = 2200;
  tickFilter.Q.value = 2.5;

  tickGain.gain.setValueAtTime(0.14 * vol, now);
  tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

  oscTick.connect(tickFilter);
  tickFilter.connect(tickGain);
  tickGain.connect(ctx.destination);
  oscTick.start(now);
  oscTick.stop(now + 0.015);

  // 2. Warm resonant cavity body (25ms deep thock)
  const oscBody = ctx.createOscillator();
  const bodyFilter = ctx.createBiquadFilter();
  const bodyGain = ctx.createGain();

  oscBody.type = "sine";
  oscBody.frequency.setValueAtTime(440 * pitchMult, now);
  oscBody.frequency.exponentialRampToValueAtTime(220 * pitchMult, now + 0.024);

  bodyFilter.type = "lowpass";
  bodyFilter.frequency.value = 850;
  bodyFilter.Q.value = 3.0;

  bodyGain.gain.setValueAtTime(0.35 * vol, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

  oscBody.connect(bodyFilter);
  bodyFilter.connect(bodyGain);
  bodyGain.connect(ctx.destination);
  oscBody.start(now);
  oscBody.stop(now + 0.035);
}

/**
 * Crisp Tactile Click (Mechanical Mouse / Blue Switch)
 */
function playCrispClick(ctx, now, vol, pitchMult = 1) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(3600 * pitchMult, now);
  osc.frequency.exponentialRampToValueAtTime(1200 * pitchMult, now + 0.009);

  filter.type = "highpass";
  filter.frequency.value = 1600;

  gain.gain.setValueAtTime(0.22 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.018);
}

/**
 * Soft Bubble Pop / Pebble
 */
function playBubblePop(ctx, now, vol, pitchMult = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(280 * pitchMult, now);
  osc.frequency.exponentialRampToValueAtTime(740 * pitchMult, now + 0.022);

  gain.gain.setValueAtTime(0.28 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

/**
 * VS Code style soothing harmonic chime (E5 + B5 warm marimba / chime)
 */
function playHarmonicChime(ctx, now, vol) {
  const freqs = [659.25, 987.77]; // E5, B5 (pure fifth)
  freqs.forEach((f, idx) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = f;

    filter.type = "lowpass";
    filter.frequency.value = 2200;

    const delay = idx * 0.035; // slight strum
    const start = now + delay;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.18 * vol, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
}

/**
 * Ascending Send Confirmation Cue
 */
function playSendCue(ctx, now, vol) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(820, now + 0.055);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.24 * vol, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

/**
 * Multi-note chord arpeggio for Voice Join / Leave
 */
function playChordCue(ctx, now, notes, vol) {
  notes.forEach((f, idx) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.value = f;

    filter.type = "lowpass";
    filter.frequency.value = 1800;

    const start = now + idx * 0.065;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.16 * vol, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.25);
  });
}

/**
 * Mechanical toggle latch (Mute / Unmute)
 */
function playLatchCue(ctx, now, startFreq, endFreq, vol) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.035);

  filter.type = "bandpass";
  filter.frequency.value = (startFreq + endFreq) / 2;
  filter.Q.value = 1.8;

  gain.gain.setValueAtTime(0.22 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

/**
 * Attach global event listener to window so clicking interactive UI elements
 * automatically triggers the soothing click sound without manual onclick calls everywhere.
 */
export function initGlobalAudioCues() {
  if (typeof window === "undefined") return;

  const handleClick = (e) => {
    if (!audioConfig.enabled) return;
    // Don't play if element explicitly opts out with data-no-sound
    const target = e.target;
    if (!target) return;

    const el = target.closest("button, .nav-item, .tab, .seg button, .rchip, .srv-icon, .ghost, .ch-gear, .sb-btn, .sound-chip, .emoji-chip, .opt, [role='button']");
    if (!el || el.dataset?.noSound !== undefined) return;

    if (el.classList.contains("rchip") || el.classList.contains("sound-chip")) {
      playCue("pop");
    } else {
      playCue("click");
    }
  };

  window.addEventListener("click", handleClick, { capture: true, passive: true });
}
