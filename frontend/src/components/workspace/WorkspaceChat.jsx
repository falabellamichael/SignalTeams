import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { setGuestChan, clearGuestChan } from "../../guestchan";
import ChatView from "../ChatView";

/** The workspace's shared channel — a real agent channel wired to the
 *  workspace, so everyone in the server can chat and @-summon agents that
 *  read & edit the files. Rendered as a normal editor tab; it registers as the
 *  "guest" channel so WS events reach it while it isn't the main channel.
 *
 *  `focusPath` is the file the user was last looking at — it's shown in the
 *  header so it's obvious which file an agent will see when summoned. */
export default function WorkspaceChat({ ws, chat, focusPath, members }) {
  const [ch, setCh] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    setCh(null); setErr("");
    api.wsChat(ws.id)
      .then((c) => { if (!dead) setCh(c); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [ws.id]);

  // One stable channel object for both ChatView and the guest registry —
  // ChatView attaches its _onMsg/_onUpdate handlers to the object it's given,
  // so the registered object must be the *same* one or live WS events
  // (agent replies streaming in) would never reach the view.
  const topic = `agents here can read & edit ${ws.root}`
    + (focusPath ? ` · looking at ${focusPath}` : "");
  const mch = useMemo(() => (ch ? { ...ch, topic } : null), [ch, topic]);

  useEffect(() => {
    if (!mch) return;
    setGuestChan(mch);
    window.dispatchEvent(new CustomEvent("st:guestchan", { detail: { id: mch.id } }));
    return () => clearGuestChan(mch);
  }, [mch]);

  if (err) return (
    <div className="empty"><div className="big">⚠️</div><div>{err}</div></div>);
  if (!ch) return (
    <div className="empty"><div className="big">💬</div>
      <div className="serif">Opening workspace chat…</div></div>);
  // ChatView renders its own channel header (#name + topic), so we don't add a
  // second one — we just hand it a topic that says what the workspace is.
  return (
    <div className="ws-chat">
      <ChatView key={mch.id} channel={mch} members={members} {...chat} />
    </div>
  );
}
