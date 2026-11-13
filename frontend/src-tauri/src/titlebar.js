// Custom desktop titlebar for SignalHive (Tauri v2).
(() => {
  const workspace = new URL("__APP_URL__");
  const bootstrap = new URL("__BOOTSTRAP_URL__");
  if (window.top !== window || ![workspace.origin, bootstrap.origin].includes(location.origin)) return;

  document.addEventListener("DOMContentLoaded", () => {
    const appWindow = window.__TAURI__.window.getCurrentWindow();
    const host = document.createElement("header");
    host.setAttribute("aria-label", "SignalHive title bar");
    const root = host.attachShadow({ mode: "open" });
    const pageStyle = document.createElement("style");
    pageStyle.textContent = `
      html { --desktop-titlebar-height: 38px; }
      body { box-sizing: border-box; padding-top: var(--desktop-titlebar-height); }
      #root > .app, #root > .login-wrap { height: calc(100vh - var(--desktop-titlebar-height)); }
      @media (max-width: 760px) {
        #root .app .side-wrap, #root .app .side-scrim, #root .app .thread-panel { top: var(--desktop-titlebar-height) !important; }
      }
    `;
    root.innerHTML = `
      <style>
        :host {
          position: fixed; inset: 0 0 auto; height: var(--desktop-titlebar-height);
          z-index: 2147483647; color: #e6edf3; color-scheme: dark;
          font: 13px "Segoe UI", -apple-system, sans-serif; user-select: none;
        }
        .bar {
          height: 100%; display: flex; align-items: stretch;
          background: #0a0d12; border-bottom: 1px solid #2d333b;
        }
        .brand {
          display: flex; align-items: center; gap: 8px; padding: 0 13px 0 10px;
          font-weight: 600; white-space: nowrap; letter-spacing: -.01em;
        }
        .brand img { width: 22px; height: 22px; border-radius: 5px; object-fit: contain; }
        .brand .word { font-family: Georgia, "Times New Roman", serif; font-style: italic; color: #d4af37; }
        .badge {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
          padding: 1.5px 6px; border-radius: 999px; color: #d4af37;
          background: rgba(212, 175, 55, 0.12); border: 1px solid rgba(212, 175, 55, 0.3);
          margin-left: 2px;
        }
        .space { flex: 1; }
        .brand, .conditions, .controls { position: relative; flex-shrink: 0; }
        .brand::after, .conditions::before, .controls::before {
          content: ""; position: absolute; top: 50%; width: 1px; height: 20px;
          transform: translateY(-50%); pointer-events: none;
          background: linear-gradient(transparent, #ffffff14 25%, #ffffff45 50%, #ffffff14 75%, transparent);
        }
        .brand::after { right: 0; }
        .conditions::before, .controls::before { left: 0; }
        .conditions { display: flex; align-items: center; gap: 13px; padding: 0 16px; color: #8b949e; }
        .conditions[hidden] { display: none; }
        .clock { color: #e6edf3; font-weight: 600; }
        .date { display: flex; align-items: center; gap: 6px; }
        .conditions svg { width: 15px; height: 15px; stroke-width: 1.5; }
        .controls { display: flex; }
        button {
          width: 44px; display: grid; place-items: center; padding: 0;
          font: inherit; color: inherit; border: 0; background: none; cursor: default;
        }
        button:hover { background: #ffffff14; }
        button:focus-visible { outline: 1px solid #d4af37; outline-offset: -3px; }
        button.close:hover { background: #c42b1c; color: white; }
        svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.2; }
      </style>
      <div class="bar">
        <div class="brand">
          <img src="data:image/png;base64,__LOGO__" alt="" draggable="false">
          <span>Signal<span class="word">Hive</span></span>
          <span class="badge">Desktop</span>
        </div>
        <div class="space"></div>
        <div class="conditions" aria-label="Time and date">
          <time class="clock"></time>
          <span class="date">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v16H4zM8 2v6m8-6v6M4 10h16"/></svg>
            <time></time>
          </span>
        </div>
        <div class="controls">
          <button type="button" class="minimize" title="Minimize" aria-label="Minimize window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10"/></svg>
          </button>
          <button type="button" class="maximize" title="Maximize" aria-label="Maximize window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1h10v10H1z"/></svg>
          </button>
          <button type="button" class="close" title="Close" aria-label="Close window">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10M11 1 1 11"/></svg>
          </button>
        </div>
      </div>
    `;
    document.head.append(pageStyle);
    document.body.prepend(host);

    const maximize = root.querySelector(".maximize");
    async function updateMaximize() {
      const maximized = await appWindow.isMaximized();
      const label = maximized ? "Restore window" : "Maximize window";
      maximize.title = label;
      maximize.setAttribute("aria-label", label);
      maximize.querySelector("path").setAttribute("d", maximized
        ? "M4 3V1h7v7H9M1 4h7v7H1z"
        : "M1 1h10v10H1z");
    }

    const reportError = (error) => console.error("SignalHive window control:", error);
    root.querySelector(".minimize").onclick = () => appWindow.minimize().catch(reportError);
    root.querySelector(".close").onclick = () => appWindow.close().catch(reportError);
    const toggleMaximize = () => appWindow.toggleMaximize().then(updateMaximize).catch(reportError);
    maximize.onclick = toggleMaximize;
    root.querySelector(".bar").addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest(".controls")) return;
      event.preventDefault();
      if (event.detail === 2) toggleMaximize();
      else if (event.detail === 1) appWindow.startDragging().catch(reportError);
    });
    window.addEventListener("resize", () => updateMaximize().catch(reportError));
    updateMaximize().catch(reportError);

    const clock = root.querySelector(".clock");
    const date = root.querySelector(".date time");
    const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
    const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
    const fullDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

    function refreshClock() {
      const now = new Date();
      clock.textContent = timeFormat.format(now);
      clock.dateTime = now.toTimeString().slice(0, 5);
      date.textContent = dateFormat.format(now);
      date.dateTime = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, "0")).join("-");
      date.title = fullDateFormat.format(now);
    }

    refreshClock();
    const clockTimer = setInterval(refreshClock, 15_000);
    window.addEventListener("pagehide", () => clearInterval(clockTimer), { once: true });
  }, { once: true });
})();
