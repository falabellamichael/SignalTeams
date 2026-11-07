import Ico from "./Ico";
import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { api, setToken } from "../api";

const FEATS = [
  ["✦", "summon agents in chat", "@souschef actually answers — live, in-channel"],
  ["⚡", "try before you bench", "every agent runs against your local models, streaming"],
  ["📦", "pack the whole toolkit", "bundle agents into a kit friends bench in one click"],
  ["↩", "real chat, not a feed", "replies, reactions, pins, mentions, files — realtime"],
];

export default function Login({ onAuth, joinCode }) {
  const [mode, setMode] = useState(joinCode ? "register" : "login");
  const [username, setUsername] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [prov, setProv] = useState("local");              // "supabase" | "local"
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const [invite, setInvite] = useState(null);
  const supaRef = useRef(null);

  useEffect(() => {
    api.raw("/api/stats").then(setStats).catch(() => {});
    api.authConfig().then((c) => {
      setCfg(c);
      if (c?.supabase) setProv("supabase");
    }).catch(() => {});
    if (joinCode) api.inviteInfo(joinCode).then(setInvite).catch(() => setInvite({ bad: true }));
  }, [joinCode]);
  // a code arriving after mount (link opened in the running app) defaults to register
  useEffect(() => { if (joinCode && !username && !email) setMode("register"); }, [joinCode]);

  function supa() {
    if (!supaRef.current && cfg?.supabase)
      supaRef.current = createClient(cfg.supabase_url, cfg.supabase_anon);
    return supaRef.current;
  }

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (prov === "supabase") {
        const c = supa();
        if (mode === "login") {
          const { data, error } = await c.auth.signInWithPassword(
            { email: email.trim(), password });
          if (error) throw new Error(error.message);
          const res = await api.supabaseAuth(data.session.access_token);
          setToken(res.token); onAuth(res.user);
        } else {
          const { data, error } = await c.auth.signUp({
            email: email.trim(), password,
            options: { data: { display_name: display.trim() || undefined } },
          });
          if (error) throw new Error(error.message);
          if (!data.session) {                    // email confirmation required
            setMode("login");
            throw new Error("Account created — confirm it from your email, then sign in.");
          }
          const res = await api.supabaseAuth(data.session.access_token);
          setToken(res.token); onAuth(res.user);
        }
      } else {
        const res = mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, display.trim());
        setToken(res.token);
        onAuth(res.user);
      }
    } catch (ex) {
      setErr(ex.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <div className="landing">
        <div className="pitch">
          <img className="bee-logo" src="/icon-192.png" alt="SignalTeams" />
          <h1>Signal<span className="word">Teams</span></h1>
          <p className="tag serif-i">where your crew's agents live.</p>
          <p className="blurb">
            Buzz's feed, Discord's channels — rebuilt around the thing you actually
            want to share: agents. Publish them, bench them, fork them — then
            @-summon them right into the conversation.
          </p>
          <ul className="feats">
            {FEATS.map(([ic, b, s]) => (
              <li key={b}><span className="fic">{ic}</span>
                <div><b>{b}</b><span>{s}</span></div></li>
            ))}
          </ul>
          {stats && (
            <div className="lstats">
              <span><b>{stats.online}</b> online</span>
              <span><b>{stats.agents}</b> agents</span>
              <span><b>{stats.packs}</b> packs</span>
              <span><b>{stats.messages}</b> messages</span>
            </div>
          )}
        </div>
        <form className="login-card" onSubmit={submit}>
          {invite && (
            invite.bad
              ? <div className="join-banner bad">This invite link is dead — ask for a fresh one.</div>
              : <div className="join-banner">
                  <span className="jb-ico">{invite.icon}</span>
                  <div>You've been invited to <b>{invite.name}</b>
                    <div className="jb-sub">{invite.members} member{invite.members === 1 ? "" : "s"} — {mode === "register" ? "sign up to join" : "sign in to join"}</div>
                  </div>
                </div>
          )}
          <h2 className="serif-i">{mode === "login" ? "Welcome back" : "Join your team"}</h2>
          {cfg?.supabase && (
            <div className="prov-tabs">
              <button type="button" className={prov === "supabase" ? "on" : ""}
                onClick={() => setProv("supabase")}><Ico n="bolt" s={13} /> Supabase</button>
              <button type="button" className={prov === "local" ? "on" : ""}
                onClick={() => setProv("local")}><Ico n="cube" s={13} /> crew account</button>
            </div>
          )}
          {prov === "supabase" ? (
            <>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoFocus />
              {mode === "register" && <>
                <label>Display name</label>
                <input value={display} onChange={(e) => setDisplay(e.target.value)}
                  placeholder="optional" />
              </>}
              <label>Password</label>
              <input type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "6+ characters" : ""} />
              <button className="primary"
                disabled={busy || !email.includes("@") || password.length < (mode === "register" ? 6 : 1)}>
                {busy ? "…" : mode === "login" ? "Sign in with Supabase" : "Create account"}
              </button>
            </>
          ) : (
            <>
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)}
                autoFocus={!cfg?.supabase} />
              {mode === "register" && <>
                <label>Display name</label>
                <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="optional" />
              </>}
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="primary" disabled={busy || !username.trim() || !password}>
                {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </>
          )}
          {err && <div className="err">{err}</div>}
          <div className="swap">
            {mode === "login" ? (
              <>New here? <a onClick={() => setMode("register")}>Create an account</a></>
            ) : (
              <>Already on the team? <a onClick={() => setMode("login")}>Sign in</a></>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
