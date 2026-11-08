import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import KnotMark from "./components/KnotMark";
import "./styles.css";
import { initGlobalAudioCues } from "./audioCues";

initGlobalAudioCues();

// Last-line error boundary — nothing else in the tree catches render errors,
// so without this a single failed lazy chunk blanks the entire app.
class CrashGuard extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crashguard">
        <KnotMark size={46} />
        <div className="cg-title serif">SignalTeams hit a snag</div>
        <p className="cg-msg">{String(this.state.err?.message || this.state.err)}</p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

document.documentElement.dataset.density = localStorage.getItem("st.density") || "cozy";
createRoot(document.getElementById("root")).render(
  <CrashGuard><Suspense fallback={null}><App /></Suspense></CrashGuard>
);
