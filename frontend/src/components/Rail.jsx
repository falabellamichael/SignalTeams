import React, { useRef, useState } from "react";
import { api } from "../api";
import Ico from "./Ico";

export default function Rail({ servers, active, onHome, onServer, onNewServer, pendingCount, serverUnread = {}, serverMentions = {}, onReorder }) {
  const dragFrom = useRef(-1);
  const [over, setOver] = useState(-1);
  const [badImg, setBadImg] = useState({});
  return (
    <div className="rail">
      <div className={`rail-ico ${active === "home" ? "on" : ""}`} onClick={onHome} title="Home — buzz, friends, library">
        📡
        {pendingCount > 0 && <span className="rail-badge">{pendingCount}</span>}
      </div>
      <div className="rail-sep" />
      {servers.map((s, i) => (
        <div key={s.id}
          className={`rail-ico ${active === s.id ? "on" : ""} ${over === i ? "drop-t" : ""}`}
          draggable
          onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={(e) => { e.preventDefault(); setOver(i); }}
          onDragLeave={() => setOver((o) => (o === i ? -1 : o))}
          onDrop={(e) => {
            e.preventDefault(); setOver(-1);
            const from = dragFrom.current; dragFrom.current = -1;
            if (from >= 0 && from !== i) onReorder?.(from, i);
          }}
          onClick={() => onServer(s.id)} title={`${s.name} — drag to reorder`}>
          {s.icon_file && !badImg[s.icon_file]
            ? <img className="rail-ico-img" src={api.fileUrl(s.icon_file)} alt=""
                onError={() => setBadImg((b) => ({ ...b, [s.icon_file]: true }))} />
            : s.icon}
          {serverMentions[s.id] > 0
            ? <span className="rail-badge ping" title={`${serverMentions[s.id]} mention${serverMentions[s.id] > 1 ? "s" : ""}`}>@{serverMentions[s.id]}</span>
            : serverUnread[s.id] > 0 && <span className="rail-badge">{serverUnread[s.id]}</span>}
        </div>
      ))}
      <div className="rail-ico" onClick={onNewServer} title="Create or join a server"><Ico n="plus" s={18} /></div>
      <div className="spacer" />
    </div>
  );
}
