import { getToken } from "./api";

const listeners = new Set();
let sock = null, retries = 0, closed = false;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(getToken())}`;
}

export function connectWS() {
  closed = false;
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return;
  if (!getToken()) return;
  sock = new WebSocket(wsUrl());
  sock.onopen = () => { retries = 0; emit({ type: "ws:open" }); };
  sock.onmessage = (e) => { try { emit(JSON.parse(e.data)); } catch { /* ignore */ } };
  sock.onclose = () => {
    emit({ type: "ws:close" });
    if (!closed && getToken()) {
      retries = Math.min(retries + 1, 5);
      setTimeout(connectWS, 500 * retries);
    }
  };
  sock.onerror = () => sock.close();
}

export function disconnectWS() {
  closed = true;
  sock?.close();
  sock = null;
}

export function sendWS(msg) {
  if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

function emit(evt) { listeners.forEach((fn) => fn(evt)); }
export function onWS(fn) { listeners.add(fn); return () => listeners.delete(fn); }
