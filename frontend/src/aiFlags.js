import { useEffect, useReducer } from "react";

// Per-channel AI capability flags — server truth (channel.ai, PATCH-broadcast
// to all members) with a localStorage layer so DM channels and pre-broadcast
// updates still work. Components subscribe so a toggle in the channel-tools
// menu immediately reaches ChatView behaviors (mic, speak-aloud, translate).
const subs = new Set();
const KEY = (cid) => `signalteams.ai.${cid}`;

export function localAi(cid) {
  try { return JSON.parse(localStorage.getItem(KEY(cid)) || "{}"); }
  catch { return {}; }
}

export function setLocalAi(cid, flags) {
  try { localStorage.setItem(KEY(cid), JSON.stringify(flags)); } catch { /* ignore */ }
  subs.forEach((f) => f(cid));
}

export function getAi(channel) {
  return channel?.ai ?? localAi(channel?.id);
}

export function useAi(channel) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const f = (cid) => { if (channel && cid === channel.id) force(); };
    subs.add(f);
    return () => subs.delete(f);
  }, [channel?.id]);
  return getAi(channel);
}
