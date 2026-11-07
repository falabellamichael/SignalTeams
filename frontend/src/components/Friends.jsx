import Ico from "./Ico";
import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Avatar } from "../util";

export default function Friends({ onDm, refreshKey, onlineIds }) {
  const [tab, setTab] = useState("all");
  const [data, setData] = useState({ accepted: [], incoming: [], outgoing: [] });
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try { setData(await api.friends()); } catch { /* ignore */ }
    try {
      const ids = await api.blocks();
      const users = await Promise.all(
        ids.map((id) => api.profile(id).then((p) => p.user).catch(() => null)));
      setBlockedUsers(users.filter(Boolean));
    } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, [refreshKey]);

  async function add() {
    setMsg("");
    try {
      const r = await api.addFriend(name.trim());
      setMsg(r.status === "accepted" ? "You're friends now 🤝" : "Request sent 📨");
      setName("");
      load();
    } catch (e) { setMsg(e.message); }
  }

  const withOnline = (f) => ({ ...f, online: onlineIds?.includes(f.id) });
  const rows = {
    all: data.accepted,
    online: data.accepted.filter((f) => onlineIds?.includes(f.id)),
    pending: data.incoming,
    requests: data.outgoing,
    blocked: blockedUsers,
  }[tab] || [];

  return (
    <div className="friends">
      <div className="lib-head"><h2>Your <span className="serif">crew</span></h2></div>
      <div className="lib-sub">Friends see your agents. Agents see nothing. (They're agents.)</div>
      <div className="ftabs">
        {[["all", `All — ${data.accepted.length}`], ["online", "Online"],
          ["pending", `Pending — ${data.incoming.length}`],
          ["requests", "Sent"], ["blocked", `Blocked — ${blockedUsers.length}`],
          ["add", "+ Add friend"]].map(([k, l]) => (
          <button key={k} className={`ftab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "add" ? (
        <>
          <div className="addfriend">
            <input placeholder="Their username…" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="primary" onClick={add} disabled={!name.trim()}>Send request</button>
          </div>
          {msg && <div style={{ color: "var(--dim)", fontSize: 12.5 }}>{msg}</div>}
        </>
      ) : rows.length === 0 ? (
        <div className="empty"><div className="big">👥</div>
          <div className="serif">
            {tab === "pending" ? "No pending requests." : tab === "requests" ? "Nothing sent."
              : tab === "blocked" ? "Nobody blocked."
              : "No friends here yet."}
          </div>
          <div>{tab === "blocked" ? "Block people from their profile card."
            : <>Hit <b>+ Add friend</b> and type their username.</>}</div>
        </div>
      ) : rows.map((f) => (
        <div className="frow" key={f.id}>
          <Avatar user={withOnline(f)} showStatus />
          <div className="who">
            <div className="n">{f.display_name}</div>
            <div className="s">@{f.username}{f.bio ? ` — ${f.bio}` : ""}</div>
          </div>
          <div className="acts">
            {tab === "pending" && (
              <button className="primary" onClick={() => api.acceptFriend(f.friendship_id).then(load)}>
                Accept</button>
            )}
            {tab === "blocked" ? (
              <button onClick={() => api.block(f.id).then(load)}>Unblock</button>
            ) : (
              <>
                {tab !== "requests" && tab !== "pending" && (
                  <button onClick={() => onDm(f)}>Message</button>
                )}
                <button className="ghost danger" title="Remove"
                  onClick={() => api.removeFriend(f.friendship_id).then(load)}><Ico n="x" s={12} /></button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
