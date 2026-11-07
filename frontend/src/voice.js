import { onWS, sendWS } from "./ws";

let me = null, channelId = 0, localStream = null, muted = false, deafened = false, joined = false;
let screenTrack = null, screenStream = null, sharing = false;
let camTrack = null, camStream = null, camOn = false;
let err = "";
const streamKinds = new Map();
let audioCtx = null;
const speaking = new Set();
const analysers = [];
const peers = new Map();
const videos = new Map();
const rosters = new Map();
const subs = new Set();

function snap() {
  return {
    channelId, joined, muted, sharing, deafened,
    roster: channelId ? rosters.get(channelId) || [] : [],
    rosters: Object.fromEntries(rosters),
    videos: Object.fromEntries(videos),
    speaking: [...speaking],
    camOn, camStream, err,
  };
}

function notify() { const s = snap(); subs.forEach((fn) => fn(s)); }
export function onVoice(fn) { subs.add(fn); fn(snap()); return () => subs.delete(fn); }

function ensurePeer(uid) {
  let p = peers.get(uid);
  if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: [] });
  const audio = new Audio();
  audio.autoplay = true;
  p = { pc, audio };
  peers.set(uid, p);
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
  if (screenTrack) pc.addTrack(screenTrack, screenStream);
  if (camTrack) pc.addTrack(camTrack, camStream);
  pc.onicecandidate = (e) => {
    if (e.candidate) sendWS({ type: "voice_signal", channel_id: channelId, to: uid, data: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    if (e.track.kind === "video") {
      const s = e.streams[0], key = `${uid}:${s.id}`;
      videos.set(key, { stream: s, uid, kind: streamKinds.get(s.id) || "screen" });
      s.onremovetrack = () => { videos.delete(key); notify(); };
    } else {
      p.audio.srcObject = e.streams[0];
      p.audio.play().catch(() => {});
      watchAudio(uid, e.streams[0]);
    }
    notify();
  };
  pc.onconnectionstatechange = () => notify();
  return p;
}

function dropPeer(uid) {
  const p = peers.get(uid);
  if (!p) return;
  p.pc.close();
  p.audio.srcObject = null;
  peers.delete(uid);
  const idx = analysers.findIndex((a) => a.uid === uid);
  if (idx > -1) { analysers[idx].src.disconnect(); analysers.splice(idx, 1); }
  speaking.delete(uid);
}

function syncPeers(members) {
  const want = new Set(members.filter((m) => m.id !== me?.id).map((m) => m.id));
  for (const uid of [...peers.keys()]) if (!want.has(uid)) dropPeer(uid);
  for (const uid of want) {
    ensurePeer(uid);
    if (me.id < uid) {
      const p = peers.get(uid);
      if (!p.offerSent && p.pc.signalingState === "stable") {
        p.offerSent = true;
        p.pc.createOffer().then((sdp) => {
          p.pc.setLocalDescription(sdp);
          sendWS({ type: "voice_signal", channel_id: channelId, to: uid, data: { sdp } });
        }).catch(() => {});
      }
    }
  }
  notify();
}

onWS(async (evt) => {
  if (evt.type === "voice") {
    rosters.set(evt.channel_id, evt.members || []);
    for (const [k, v] of [...videos.entries()]) {
      const m = (evt.members || []).find((x) => x.id === v.uid);
      if (!m || !(m.sharing || m.cam)) videos.delete(k);
    }
    if (joined && evt.channel_id === channelId) {
      syncPeers(evt.members || []);
      broadcastMediaHints();
    } else notify();
  } else if (evt.type === "voice_reject" && joined && evt.channel_id === channelId) {
    err = evt.reason || "Can't join voice";
    for (const uid of [...peers.keys()]) dropPeer(uid);
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null; joined = false; channelId = 0;
    notify();
  } else if (evt.type === "voice_media" && joined && evt.channel_id === channelId) {
    const d = evt.data || {};
    if (d.stream_id) {
      streamKinds.set(d.stream_id, d.kind || "screen");
      for (const [k, v] of videos.entries()) if (k.endsWith(":" + d.stream_id)) v.kind = d.kind || "screen";
      notify();
    }
  } else if (evt.type === "voice_signal" && joined && evt.channel_id === channelId) {
    const p = ensurePeer(evt.from);
    const d = evt.data || {};
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === "offer") {
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          sendWS({ type: "voice_signal", channel_id: channelId, to: evt.from, data: { sdp: ans } });
        }
      } else if (d.candidate) {
        await p.pc.addIceCandidate(d.candidate).catch(() => {});
      }
    } catch { /* ignore */ }
  } else if (evt.type === "ws:open" && joined) {
    sendWS({ type: "voice_join", channel_id: channelId });
  }
});

function watchAudio(uid, stream) {
  if (!audioCtx || analysers.some((a) => a.uid === uid)) return;
  try {
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    analysers.push({ uid, an, src, buf: new Uint8Array(an.frequencyBinCount), t: 0 });
  } catch { /* ignore */ }
}

setInterval(() => {
  if (!joined || !analysers.length) return;
  let dirty = false;
  const now = performance.now();
  for (const a of analysers) {
    a.an.getByteFrequencyData(a.buf);
    let sum = 0;
    for (let i = 4; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
    const rms = Math.sqrt(sum / (a.buf.length - 4)) / 255;
    const id = a.uid === "me" ? me?.id : a.uid;
    if (rms > 0.045) {
      a.t = now;
      if (id && !speaking.has(id)) { speaking.add(id); dirty = true; }
    } else if (now - a.t > 350 && id && speaking.delete(id)) {
      dirty = true;
    }
  }
  if (dirty) notify();
}, 140);

export async function joinVoice(cid, user) {
  if (joined && channelId === cid) return;
  if (joined) leaveVoice();
  me = user; err = "";
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    watchAudio("me", localStream);
  } catch { /* ignore */ }
  channelId = cid; joined = true; muted = false; deafened = false;
  sendWS({ type: "voice_join", channel_id: cid });
  notify();
}

export function leaveVoice() {
  if (!joined) return;
  sendWS({ type: "voice_leave", channel_id: channelId });
  for (const uid of [...peers.keys()]) dropPeer(uid);
  localStream?.getTracks().forEach((t) => t.stop());
  screenTrack?.stop();
  camTrack?.stop();
  localStream = null; screenTrack = null; screenStream = null;
  camTrack = null; camStream = null; camOn = false;
  joined = false; muted = false; deafened = false; sharing = false;
  videos.clear(); streamKinds.clear(); speaking.clear();
  for (const a of analysers.splice(0)) a.src.disconnect();
  const prev = channelId; channelId = 0;
  rosters.set(prev, []);
  notify();
}

async function renegotiate() {
  for (const [uid, p] of peers) {
    if (p.pc.signalingState === "stable") {
      try {
        const sdp = await p.pc.createOffer();
        await p.pc.setLocalDescription(sdp);
        sendWS({ type: "voice_signal", channel_id: channelId, to: uid, data: { sdp } });
      } catch { /* ignore */ }
    }
  }
}

function broadcastMediaHints() {
  if (!joined) return;
  if (screenStream) sendWS({ type: "voice_media", channel_id: channelId, data: { stream_id: screenStream.id, kind: "screen" } });
  if (camStream) sendWS({ type: "voice_media", channel_id: channelId, data: { stream_id: camStream.id, kind: "cam" } });
}

async function startShare() {
  if (!joined || screenTrack) return;
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
  screenStream = s; screenTrack = s.getVideoTracks()[0];
  screenTrack.onended = () => { stopShare(); };
  for (const { pc } of peers.values()) pc.addTrack(screenTrack, s);
  await renegotiate();
  sharing = true;
  sendWS({ type: "voice_screen", channel_id: channelId, sharing: true });
  broadcastMediaHints();
  notify();
}

async function stopShare() {
  if (!screenTrack) return;
  const t = screenTrack; screenTrack = null; screenStream = null;
  for (const { pc } of peers.values()) {
    const sender = pc.getSenders().find((s) => s.track === t);
    if (sender) pc.removeTrack(sender);
  }
  t.stop();
  await renegotiate();
  sharing = false;
  sendWS({ type: "voice_screen", channel_id: channelId, sharing: false });
  notify();
}

export function toggleShare() { return screenTrack ? stopShare() : startShare(); }

async function startCam() {
  if (!joined || camTrack) return;
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } });
  camStream = s; camTrack = s.getVideoTracks()[0];
  camTrack.onended = () => { stopCam(); };
  for (const { pc } of peers.values()) pc.addTrack(camTrack, s);
  await renegotiate();
  camOn = true;
  sendWS({ type: "voice_cam", channel_id: channelId, cam: true });
  broadcastMediaHints();
  notify();
}

async function stopCam() {
  if (!camTrack) return;
  const t = camTrack; camTrack = null; camStream = null;
  for (const { pc } of peers.values()) {
    const sender = pc.getSenders().find((s) => s.track === t);
    if (sender) pc.removeTrack(sender);
  }
  t.stop();
  await renegotiate();
  camOn = false;
  sendWS({ type: "voice_cam", channel_id: channelId, cam: false });
  notify();
}

export function toggleCam() {
  return camTrack ? stopCam() : startCam().catch((e) => ({ error: e.message || "camera unavailable" }));
}

export function toggleVoiceMute() {
  if (!muted && deafened) { toggleDeafen(); return deafened; }
  muted = !muted;
  localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  sendWS({ type: "voice_mute", channel_id: channelId, muted });
  notify();
  return muted;
}

export function toggleDeafen() {
  deafened = !deafened;
  if (deafened && !muted) {
    muted = true;
    localStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    sendWS({ type: "voice_mute", channel_id: channelId, muted: true });
  }
  for (const { audio } of peers.values()) audio.muted = deafened;
  sendWS({ type: "voice_deafen", channel_id: channelId, deafened });
  notify();
  return deafened;
}

export function askVoiceRoster(cid) {
  sendWS({ type: "voice_status", channel_id: cid });
}

if (typeof window !== "undefined") window.__voicePeers = peers;
