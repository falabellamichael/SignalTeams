import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../util";
import Ico from "./Ico";

const VERBS = { starred: "starred", installed: "benched", forked: "forked",
  reviewed: "rated", published: "published", remixed: "remixed" };

export default function Bell({ me, refreshKey, onOpenAgent, onOpenChannel, onOpenPack }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [myAgentIds, setMyAgentIds] = useState(new Set());
  const ref = useRef(null);

  useEffect(() => {
    api.agents({ mine: 1 }).then((a) => setMyAgentIds(new Set(a.map((x) => x.id)))).catch(() => {});
  }, [me.id, refreshKey]);

  useEffect(() => {
    api.buzz().then((all) => {
      setItems(all.filter((i) =>
        i.user.id !== me.id &&
        (myAgentIds.has(i.payload?.agent_id) || i.payload?.to === me.id)
      ).slice(0, 15));
    }).catch(() => {});
  }, [me.id, myAgentIds, refreshKey]);

  const [seen, setSeen] = useState(me.seen_buzz || 0);
  useEffect(() => { setSeen((s) => Math.max(s, me.seen_buzz || 0)); }, [me.seen_buzz]);
  const unseen = items.filter((i) => i.created_at > seen).length;

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function toggle() {
    setOpen((o) => !o);
    const ts = Date.now() / 1000;
    setSeen(ts);
    api.updateMe({ seen_buzz: ts }).catch(() => {});
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="ghost" onClick={toggle} title="Notifications" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <Ico n="bell" s={15} />
        {unseen > 0 && <span className="rail-badge" style={{ position: "absolute", right: -4, top: -4 }}>
          {unseen}</span>}
      </button>
      {open && (
        <div className="spanel" style={{ top: "calc(100% + 8px)", right: 0, width: 320 }}>
          <label>What your agents have been up to</label>
          {items.length === 0 && <div className="idehint">Nothing yet — share an agent and watch the magic.</div>}
          {items.map((i) => (
            <div key={i.id} className="ideopt" style={{ display: "flex", gap: 8, cursor: "pointer" }}
              onClick={() => {
                setOpen(false);
                if (i.kind === "mentioned") onOpenChannel?.(i.payload.channel_id, i.payload.server_id);
                else if (i.payload.pack_id) onOpenPack?.(i.payload.pack_id);
                else if (i.payload.agent_id) onOpenAgent(i.payload.agent_id);
              }}>
              <span>{i.user.avatar_emoji}</span>
              <span style={{ flex: 1 }}>
                {i.kind === "mentioned" ? (
                  <>
                    <b>{i.user.display_name}</b> mentioned you in{" "}
                    <span style={{ color: "var(--honey)" }}>
                      {i.payload.server_id ? "#" : "@"}{i.payload.channel === "dm" ? " a DM" : i.payload.channel}</span>
                    {i.payload.excerpt && <div style={{ fontSize: 11, color: "var(--dim)" }}>{i.payload.excerpt}</div>}
                  </>
                ) : (
                  <>
                    <b>{i.user.display_name}</b> {VERBS[i.kind] || i.kind}{" "}
                    <span style={{ color: "var(--honey)" }}>{i.payload.name}</span>
                    {i.kind === "reviewed" && i.payload.rating ? " " + "★".repeat(i.payload.rating) : ""}
                  </>
                )}
                <div style={{ fontSize: 10.5, color: "var(--dim)" }}>{timeAgo(i.created_at)}</div>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
