import React, { useEffect, useState } from "react";
import Ico from "../Ico";
import { api } from "../../api";

// Settings → Connections — every AI provider a user can plug in: subscription
// logins imported from local CLIs (Codex / Claude Code / Gemini CLI / Qwen Code)
// plus plain API keys. A connected provider can be promoted to the personal
// endpoint that powers summons and the Try tab.
const DESKTOP = !!window.__TAURI__;   // Tauri shell routes popups to the system browser

export function ConnectionsPage({ me, onUseLlm }) {
  const [conns, setConns] = useState(null);
  const [local, setLocal] = useState([]);
  const [tab, setTab] = useState("ai");      // "ai" | "plugins"
  const [keys, setKeys] = useState({});      // pid -> typed key
  const [mdls, setMdls] = useState({});      // pid -> typed model
  const [urls, setUrls] = useState({});      // pid -> typed base URL (custom card)
  const [creds, setCreds] = useState({});    // pid -> {client_id, client_secret, tenant}
  const [openKey, setOpenKey] = useState({});// pid -> key/setup row expanded
  const [busy, setBusy] = useState({});      // pid -> action running
  const [probe, setProbe] = useState({});    // pid -> test result
  const [dev, setDev] = useState({});        // pid -> pending device/hosted flow
  const [allowSend, setAllowSend] = useState({}); // pid -> include send scope
  const [msg, setMsg] = useState("");

  function refresh() {
    api.connections().then(setConns).catch(() => setConns([]));
    api.llmProviders().then((ps) => setLocal(ps || [])).catch(() => {});
  }
  useEffect(() => { refresh(); }, []);

  // OAuth popup posts back when the callback lands
  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === "st-plugin-connected") {
        setMsg("✓ Connected — your account is linked.");
        setTimeout(() => setMsg(""), 5000);
        refresh();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const run = (pid, tag, fn) => async () => {
    setBusy((b) => ({ ...b, [pid]: tag })); setProbe((p) => ({ ...p, [pid]: null }));
    try {
      const r = await fn();
      if (tag === "test") setProbe((p) => ({ ...p, [pid]: r }));
      else if (tag === "use") {
        onUseLlm?.(r);
        const c = (conns || []).find((x) => x.id === pid);
        setMsg(`✓ ${c?.name || pid} now powers your summons and Try tab — see Settings → Models to change the model.`);
        setTimeout(() => setMsg(""), 5000);
      } else refresh();
    } catch (e) {
      if (tag === "test") setProbe((p) => ({ ...p, [pid]: { ok: false, error: e.message } }));
      else setProbe((p) => ({ ...p, [pid]: { ok: false, error: e.message } }));
    } finally {
      setBusy((b) => ({ ...b, [pid]: null }));
    }
  };

  async function pollFlow(c, flow) {
    // device/hosted flows complete when the user authorizes in the browser
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await api.connPoll(c.id, flow);
        if (r.connected) {
          setDev((d) => ({ ...d, [c.id]: null }));
          setMsg(`✓ ${c.name} connected${r.label ? ` — ${r.label}` : ""}.`);
          setTimeout(() => setMsg(""), 5000);
          refresh();
          return;
        }
      } catch (e) {
        setDev((d) => ({ ...d, [c.id]: null }));
        setProbe((p) => ({ ...p, [c.id]: { ok: false, error: e.message } }));
        return;
      }
    }
    setDev((d) => ({ ...d, [c.id]: null }));
  }

  async function pollCard(c) {
    // redirect flows finish in a window we don't own (system browser in the
    // desktop shell, noreferrer link in a blocked browser) — watch the list
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const list = await api.connections();
        const cur = (list || []).find((x) => x.id === c.id);
        if (cur?.connected) {
          setDev((d) => ({ ...d, [c.id]: null }));
          setMsg(`✓ ${c.name} connected${cur.label ? ` — ${cur.label}` : ""}.`);
          setTimeout(() => setMsg(""), 5000);
          refresh();
          return;
        }
      } catch { /* keep polling */ }
    }
    setDev((d) => ({ ...d, [c.id]: null }));
  }

  async function connectPlugin(c) {
    setBusy((b) => ({ ...b, [c.id]: "begin" }));
    setProbe((p) => ({ ...p, [c.id]: null }));
    // open the window inside the click's user-gesture — await afterwards would
    // lose it and Chrome would block the popup. In the desktop shell popups
    // are denied, so we skip this and hand the real URL to the system browser.
    const w = DESKTOP ? null : window.open("about:blank", "st-plugin", "width=640,height=740");
    try {
      const r = await api.connBegin(c.id, { allow_send: !!allowSend[c.id] });
      if (r.device) {
        setDev((d) => ({ ...d, [c.id]: r.device }));
        if (w) w.location.href = r.device.verify;
        else if (DESKTOP) window.open(r.device.verify, "_blank");
        pollFlow(c, r.device.flow);
      } else if (r.url) {
        if (w) w.location.href = r.url;
        else {
          // blocked popup → fallback link; desktop shell → straight to system browser
          if (DESKTOP) window.open(r.url, "_blank");
          setDev((d) => ({ ...d, [c.id]: { link: r.url, external: DESKTOP } }));
        }
        if (r.flow) {                            // hosted broker — poll to finish
          setDev((d) => ({ ...d, [c.id]: { hosted: true, link: w ? undefined : r.url, external: DESKTOP } }));
          pollFlow(c, r.flow);
        } else if (!w) {
          pollCard(c);                           // no postMessage channel — watch the list
        }
      } else {
        w?.close();
      }
    } catch (e) {
      w?.close();
      setProbe((p) => ({ ...p, [c.id]: { ok: false, error: e.message } }));
    } finally {
      setBusy((b) => ({ ...b, [c.id]: null }));
    }
  }

  async function savePluginCreds(c) {
    const d = creds[c.id] || {};
    await api.connSave(c.id, {
      client_id: d.client_id || "", client_secret: d.client_secret || "",
      tenant: d.tenant || "" });
    await refresh();
    connectPlugin(c);
  }

  function PluginCard({ c }) {
    const b = busy[c.id];
    const pr = probe[c.id];
    const df = dev[c.id];
    const setupOpen = openKey[c.id] || !c.configured;
    const cd = creds[c.id] || {};
    const canSend = ["gmail", "outlook"].includes(c.id);
    const appName = { google: "Google Cloud", microsoft: "Microsoft Entra",
      github: "GitHub", slack: "Slack", notion: "Notion", discord: "Discord" }[c.app] || c.app;
    const flowTag = { redirect: "browser sign-in", device: "device code",
      hosted: "one-click" }[c.flow] || "oauth";
    return (
      <div className={`con-card plugin ${c.connected ? "on" : ""}`}
        style={{ "--plug-hue": c.hue }}>
        <span className="con-mark" style={{ background: c.hue }}>
          {c.icon || c.name[0]}</span>
        <div className="con-body">
          <div className="con-top">
            <b>{c.name}</b>
            <span className="con-tag plugin">{flowTag}</span>
            {c.connected && <span className="con-ok">✓ connected</span>}
          </div>
          <div className="con-sub">{c.blurb}</div>
          <div className="con-scopes">
            <span className="scope-lab">{c.connected ? "granted" : "requests"}</span>
            {(c.scopes || []).slice(0, 4).map((s) => (
              <span key={s} className="scope">{s.split("/").pop()}</span>))}
          </div>
          {c.connected && (
            <div className="con-meta">
              {c.label && <span>{c.label}</span>}
              <span>· via browser sign-in</span>
            </div>
          )}
          <div className="con-actions">
            {c.connected ? (
              <>
                <button type="button" disabled={!!b}
                  onClick={run(c.id, "test", () => api.connTest(c.id))}>
                  {b === "test" ? "Testing…" : "Test"}
                </button>
                <button type="button" className="ghost" disabled={!!b}
                  onClick={run(c.id, "del", () => api.connDel(c.id))}>
                  {b === "del" ? "Removing…" : "Disconnect"}
                </button>
              </>
            ) : c.configured ? (
              <>
                <button type="button" className="primary" disabled={!!b || !!df}
                  onClick={() => connectPlugin(c)}>
                  {b === "begin" ? "Opening…" : df ? "Waiting for sign-in…" : `Connect ${c.name}`}
                </button>
                {canSend && (
                  <button type="button"
                    className={`con-send ${allowSend[c.id] ? "on" : ""}`}
                    onClick={() => setAllowSend((m) => ({ ...m, [c.id]: !m[c.id] }))}>
                    <span className="tick">{allowSend[c.id] ? "☑" : "☐"}</span>
                    also allow sending
                  </button>
                )}
                <button type="button" className="ghost con-creds" disabled={!!b}
                  onClick={() => setOpenKey((o) => ({ ...o, [c.id]: !setupOpen }))}>
                  App creds
                </button>
              </>
            ) : (
              <span className="con-meta" style={{ margin: 0 }}>
                needs a {appName} OAuth app — paste its client id below
              </span>
            )}
          </div>
          {df && !c.connected && (
            <div className="con-device">
              {df.code ? (
                <>Enter code <code className="con-code">{df.code}</code> at{" "}
                <a href={df.verify} target="_blank" rel="noreferrer">{df.verify}</a>
                {" "}— this card updates itself.</>
              ) : (
                <>{df.link
                  ? <>{df.external
                      ? "Sign-in opened in your browser"
                      : <>Popup was blocked — <a href={df.link} target="_blank" rel="noreferrer">open the sign-in page</a></>
                    }{" "}</>
                  : <>Finish sign-in in the browser tab that just opened — </>}
                  this card updates itself.</>
              )}
            </div>
          )}
          {!c.connected && setupOpen && (
            <div className="con-keyrow con-setup">
              <input value={cd.client_id || ""} placeholder="OAuth client id"
                onChange={(e) => setCreds((m) => ({ ...m, [c.id]: { ...cd, client_id: e.target.value } }))} />
              <input type="password" value={cd.client_secret || ""}
                placeholder="client secret"
                onChange={(e) => setCreds((m) => ({ ...m, [c.id]: { ...cd, client_secret: e.target.value } }))} />
              {c.app === "azure" && (
                <input value={cd.tenant || ""} className="con-mdl"
                  placeholder="tenant (common)"
                  onChange={(e) => setCreds((m) => ({ ...m, [c.id]: { ...cd, tenant: e.target.value } }))} />
              )}
              <button type="button" disabled={!!b || !(cd.client_id || "").trim()}
                onClick={run(c.id, "setup", () => savePluginCreds(c))}>
                {b === "setup" ? "Saving…" : "Save & connect"}
              </button>
            </div>
          )}
          {pr && (
            <div className={`con-probe ${pr.ok ? "ok" : "bad"}`}>
              {pr.ok
                ? `✓ ${pr.label || `reachable (${pr.latency_ms ?? "?"}ms)`}`
                : `✗ ${pr.error || "check failed"}`}
            </div>
          )}
        </div>
      </div>
    );
  }

  function ConnCard({ c }) {
    const b = busy[c.id];
    const pr = probe[c.id];
    const keyOpen = openKey[c.id] || c.group === "key";
    return (
      <div className={`con-card ${c.connected ? "on" : ""}`}>
        <span className="con-mark" style={{ background: c.hue }}>{c.name[0]}</span>
        <div className="con-body">
          <div className="con-top">
            <b>{c.name}</b>
            <span className={`con-tag ${c.group}`}>
              {c.group === "subscription" ? "subscription" : "api key"}
            </span>
            {c.connected && <span className="con-ok">✓ connected</span>}
            {c.connected && !c.usable && <span className="con-warn">stored</span>}
          </div>
          <div className="con-sub">{c.blurb}</div>
          {c.connected && (
            <div className="con-meta">
              {c.label && <span>{c.label}</span>}
              <span>· via {c.via === "cli" ? "local login" : "API key"}</span>
              {c.model && <span>· {c.model}</span>}
              {c.meta?.expired && <span className="con-warn">· token may need a refresh</span>}
            </div>
          )}
          {!c.connected && c.importable && (
            <div className="con-meta">
              {c.detected
                ? <span style={{ color: "var(--good)" }}>✓ local login found — import it, no API key needed</span>
                : <span>No local CLI login detected — or paste a key below</span>}
            </div>
          )}
          <div className="con-actions">
            {c.connected ? (
              <>
                {c.usable && (
                  <button type="button" className="primary" disabled={!!b}
                    onClick={run(c.id, "use", () => api.connUse(c.id))}>
                    {b === "use" ? "Wiring…" : "⚡ Use for agents"}
                  </button>
                )}
                {c.usable && (
                  <button type="button" disabled={!!b}
                    onClick={run(c.id, "test", () => api.connTest(c.id))}>
                    {b === "test" ? "Testing…" : "Test"}
                  </button>
                )}
                <button type="button" className="ghost" disabled={!!b}
                  onClick={run(c.id, "del", () => api.connDel(c.id))}>
                  {b === "del" ? "Removing…" : "Disconnect"}
                </button>
              </>
            ) : (
              <>
                {c.importable && (
                  <button type="button" className="primary" disabled={!!b || !c.detected}
                    title={c.detected ? "Import the login this CLI already holds" : "No local CLI login found on this machine"}
                    onClick={run(c.id, "import", () => api.connImport(c.id))}>
                    <Ico n="bolt" s={12} /> {b === "import" ? "Importing…" : "Import local login"}
                  </button>
                )}
                {c.group === "subscription" && !keyOpen && (
                  <button type="button" className="ghost" disabled={!!b}
                    onClick={() => setOpenKey((o) => ({ ...o, [c.id]: true }))}>
                    Use API key
                  </button>
                )}
              </>
            )}
          </div>
          {!c.connected && keyOpen && (
            <div className="con-keyrow">
              {c.custom && (
                <input value={urls[c.id] || ""} className="con-url"
                  placeholder="https://host/v1"
                  onChange={(e) => setUrls((u) => ({ ...u, [c.id]: e.target.value }))} />
              )}
              <input type="password" value={keys[c.id] || ""}
                placeholder="API key / bearer token"
                onChange={(e) => setKeys((k) => ({ ...k, [c.id]: e.target.value }))} />
              <input value={mdls[c.id] || ""} className="con-mdl"
                placeholder="model (optional)"
                onChange={(e) => setMdls((m) => ({ ...m, [c.id]: e.target.value }))} />
              <button type="button" disabled={!!b || !(keys[c.id] || "").trim()}
                onClick={run(c.id, "save", () =>
                  api.connSave(c.id, { api_key: keys[c.id], model: mdls[c.id] || "", url: urls[c.id] || "" }))}>
                {b === "save" ? "Connecting…" : "Connect"}
              </button>
            </div>
          )}
          {pr && (
            <div className={`con-probe ${pr.ok || pr.stored ? "ok" : "bad"}`}>
              {pr.stored
                ? `✓ ${pr.note || "credential stored"}`
                : pr.ok
                  ? `✓ reachable (${pr.latency_ms ?? "?"}ms)` +
                    (pr.models?.length ? ` — ${pr.models.length} model(s)` : "")
                  : `✗ ${pr.error || "check failed"}`}
              {pr.models?.length > 0 && (
                <div className="con-models">
                  {pr.models.slice(0, 14).map((m) => <span key={m} className="chip">{m}</span>)}
                  {pr.models.length > 14 && <span className="chip">+{pr.models.length - 14} more</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!conns) return <div className="msub">Loading connections…</div>;
  const subs = conns.filter((c) => c.group === "subscription");
  const keyed = conns.filter((c) => c.group === "key");
  const plugs = conns.filter((c) => c.group === "plugin");

  return (
    <div>
      <div className="con-toggle">
        <button type="button" className={tab === "ai" ? "on" : ""}
          onClick={() => setTab("ai")}>🧠 A.I</button>
        <button type="button" className={tab === "plugins" ? "on" : ""}
          onClick={() => setTab("plugins")}>🔌 Plugins</button>
      </div>
      {msg && <div className="con-flash">{msg}</div>}

      {tab === "plugins" ? (
        <>
          <div className="msub" style={{ margin: "4px 0 12px" }}>
            Sign in right in the browser — no keys to paste. Connect opens the
            provider's own authorize page (or shows a device code) and this card
            updates itself when you finish.
          </div>
          {plugs.map((c) => <PluginCard key={c.id} c={c} />)}
        </>
      ) : (
        <>
          <div className="msub" style={{ margin: "4px 0 12px" }}>
            Wire your AI accounts once — subscription imports read the login your coding
            CLIs already hold, so no API key is needed. Then hit <b>⚡ Use for agents</b> to
            make a connection power your summons.
          </div>

          <div className="con-sect">AI Subscriptions</div>
          {subs.map((c) => <ConnCard key={c.id} c={c} />)}

          <div className="con-sect">API Keys</div>
          {keyed.map((c) => <ConnCard key={c.id} c={c} />)}

          <div className="con-sect">Local Engines</div>
      <div className="con-card">
        <span className="con-mark" style={{ background: "#5a6b7c" }}>⬡</span>
        <div className="con-body">
          <div className="con-top"><b>On this machine</b>
            {local.length > 0 && <span className="con-ok">✓ running</span>}
          </div>
          <div className="con-sub">
            Ollama, LM Studio and your model folder are picked up automatically — no keys needed.
          </div>
          <div className="con-meta">
            {local.length
              ? local.map((p) => `${p.name} (${(p.models || []).length})`).join(" · ")
              : "nothing detected — start Ollama or LM Studio"}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
