import React, { useEffect, useState } from "react";
import { api } from "../../../api";
import { timeAgo } from "../../../util";

export function StatsTab({ agent }) {
  const [s, setS] = useState(null);
  useEffect(() => { api.agentStats(agent.id).then(setS).catch(() => setS({ days: [] })); }, [agent.id]);
  if (!s) return <div className="msub">Counting…</div>;
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const max = Math.max(1, ...(s.days || []));
  const labels = (s.days || []).map((_, i) => {
    const d = new Date((s.day0 + i) * 86400 * 1000);
    return `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  });
  return (
    <div>
      {s.summons === 0 ? (
        <div className="msub">No summons yet — @ the agent in a channel or DM it to get it going.</div>
      ) : (
        <>
          <div className="pulse-bars">
            {(s.days || []).map((n, i) => (
              <div key={i} className="pb-col" title={`${labels[i]}: ${n} replies`}>
                <div className="pb-bar" style={{ height: `${Math.max(4, (n / max) * 64)}px` }} />
                {i % 2 === 0 && <div className="pb-lab">{labels[i].split(" ")[0]}</div>}
              </div>
            ))}
          </div>
          <div className="pulse-stats">
            <div className="ps"><b>{s.summons}</b><span>all-time summons</span></div>
            <div className="ps"><b>{(s.days || []).reduce((a, b) => a + b, 0)}</b><span>last 14 days</span></div>
            <div className="ps"><b>{s.last_used ? timeAgo(s.last_used) : "—"}</b><span>last used</span></div>
          </div>
          <div className="pulse-rows">
            {(s.top_summoners || []).map((t) => (
              <div key={t.user.id} className="pr">✦ <b>{t.user.display_name}</b>
                <span className="pr-n">{t.n} summons</span></div>
            ))}
            {(s.top_channels || []).map((c) => (
              <div key={c.id} className="pr">📍 <b>{c.name}</b>
                <span className="pr-n">{c.n} replies</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

