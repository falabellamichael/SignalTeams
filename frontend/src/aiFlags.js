import { useEffect, useReducer } from "react";

// Per-channel AI capability flags — server truth (channel.ai, PATCH-broadcast
// to all members) with a localStorage layer so DM channels and pre-broadcast
// updates still work. Components subscribe so a toggle in the channel-tools
// menu immediately reaches ChatView behaviors (mic, speak-aloud, translate).
const subs = new Set();
const KEY = (cid) => `signalteams.ai.${cid}`;
const memoryCache = new Map(); // cid -> { ...flags }
const lastServerAi = new Map(); // cid -> channel.ai reference

export function localAi(cid) {
  if (memoryCache.has(cid)) return memoryCache.get(cid);
  try {
    const raw = localStorage.getItem(KEY(cid));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed) return parsed;
  } catch { /* ignore */ }
  return {};
}

export function setLocalAi(cid, flags, channel) {
  const cur = memoryCache.get(cid) || localAi(cid);
  const merged = { ...cur, ...flags };
  memoryCache.set(cid, merged);
  if (channel) {
    channel.ai = { ...(channel.ai || {}), ...merged };
    lastServerAi.set(cid, channel.ai);
  }
  try {
    localStorage.setItem(KEY(cid), JSON.stringify(merged));
  } catch { /* ignore */ }
  subs.forEach((f) => f(cid));
}

export function getAi(channel) {
  if (!channel?.id) return {};
  const cid = channel.id;

  // If channel carries a fresh server .ai object reference that differs from what we tracked,
  // merge it in so incoming server broadcasts or fetches sync to cache
  if (channel.ai && typeof channel.ai === "object") {
    if (lastServerAi.get(cid) !== channel.ai) {
      lastServerAi.set(cid, channel.ai);
      const existing = memoryCache.get(cid) || localAi(cid);
      const updated = { ...existing, ...channel.ai };
      memoryCache.set(cid, updated);
      return updated;
    }
  }

  if (memoryCache.has(cid)) {
    return memoryCache.get(cid);
  }

  const stored = localAi(cid);
  const fromServer = channel.ai && typeof channel.ai === "object" ? channel.ai : {};
  const initial = { ...stored, ...fromServer };
  memoryCache.set(cid, initial);
  return initial;
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

