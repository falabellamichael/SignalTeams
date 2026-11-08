import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { onWS } from "../../ws";
import { Modal } from "./_shared";

function fmtWhen(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit" });
}

export function EventsModal({ server, me, onClose }) {
  const [events, setEvents] = useState(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [when, setWhen] = useState("");
  const [chId, setChId] = useState("");
  const [err, setErr] = useState("");
  const textCh = (server.channels || []).filter((c) => c.kind === "text" || c.kind === "forum");

  useEffect(() => {
    api.serverEvents(server.id).then(setEvents).catch((e) => setErr(e.message));
    return onWS((evt) => {
      if (evt.type !== "event" || evt.server_id !== server.id) return;
      const ev = evt.event;
      setEvents((list) => {
        if (!list) return list;
        const rest = list.filter((x) => x.id !== ev.id);
        if (ev.status === "cancelled") return rest;
        const prev = list.find((x) => x.id === ev.id);
        if (prev && prev.me_interested !== undefined && !("me_interested" in ev && ev.me_interested))
          ev.me_interested = prev.me_interested;   // broadcast is actor-relative — keep mine
        return [...rest, ev].sort((a, b) => a.starts_at - b.starts_at);
      });
    });
  }, [server.id]);

  async function create() {
    setErr("");
    const starts = new Date(when).getTime() / 1000;
    if (!name.trim()) return setErr("Give the event a name");
    if (!when || !isFinite(starts)) return setErr("Pick a start time");
    const ev = await api.addEvent(server.id, {
      name: name.trim(), description: desc.trim(), starts_at: starts,
      channel_id: chId ? Number(chId) : null }).catch((e) => (setErr(e.message), null));
    if (!ev) return;
    setEvents((l) => [...(l || []), ev].sort((a, b) => a.starts_at - b.starts_at));
    setName(""); setDesc(""); setWhen("");
  }

  async function interested(ev) {
    const r = await api.eventInterested(ev.id).catch((e) => (alert(e.message), null));
    if (r) setEvents((l) => l.map((x) => (x.id === ev.id ? { ...r, me_interested: r.me_interested } : x)));
  }

  async function cancel(ev) {
    if (!confirm(`Cancel "${ev.name}"?`)) return;
    await api.delEvent(ev.id).catch((e) => alert(e.message));
    setEvents((l) => l.filter((x) => x.id !== ev.id));
  }

  const canManage = (ev) => me.id === ev.creator_id || me.id === server.owner_id;

  return (
    <Modal title={`📅 Events — ${server.name}`} onClose={onClose}>
      {events === null && !err && <div className="dim">Loading…</div>}
      {(events || []).length === 0 && events !== null &&
        <div className="dim" style={{ marginBottom: 10 }}>No upcoming events — schedule one below.</div>}
      <div className="ev-list">
        {(events || []).map((ev) => (
          <div key={ev.id} className="ev-row">
            <div className="ev-when">
              <span className="ev-day">{new Date(ev.starts_at * 1000).getDate()}</span>
              <span className="ev-mon">{new Date(ev.starts_at * 1000).toLocaleString(undefined, { month: "short" })}</span>
            </div>
            <div className="ev-main">
              <b>{ev.name}</b> {ev.status === "live" && <span className="ev-live">LIVE</span>}
              <div className="dim">
                {fmtWhen(ev.starts_at)}
                {ev.channel_name && <> · #{ev.channel_name}</>}
                {" · "}{ev.interested_count} interested
              </div>
              {ev.description && <div className="dim ev-desc">{ev.description}</div>}
            </div>
            <div className="ev-acts">
              <button className={`ev-star ${ev.me_interested ? "on" : ""}`}
                title={ev.me_interested ? "Not interested" : "Interested — get pinged when it starts"}
                onClick={() => interested(ev)}>{ev.me_interested ? "★" : "☆"}</button>
              {canManage(ev) && <button className="ev-star" title="Cancel event"
                onClick={() => cancel(ev)}><b>✕</b></button>}
            </div>
          </div>
        ))}
      </div>
      <div className="side-group" style={{ marginTop: 14 }}>New event</div>
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Event name" maxLength={80} />
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
        placeholder="What's happening? (optional)" maxLength={400} rows={2} />
      <div style={{ display: "flex", gap: 8 }}>
        <input type="datetime-local" value={when} style={{ flex: 1 }}
          onChange={(e) => setWhen(e.target.value)} />
        <select value={chId} onChange={(e) => setChId(e.target.value)} style={{ flex: 1 }}
          title="Announcement channel">
          <option value="">Auto channel</option>
          {textCh.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={create} style={{ marginTop: 8 }}>Create event</button>
    </Modal>
  );
}
