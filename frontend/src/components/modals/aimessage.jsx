import React, { useState, useEffect } from "react";
import Ico from "../Ico";
import { Modal } from "./_shared";
import { api } from "../../api";

const OPS = [
  { id: "summarize", label: "Summarize", icon: "sparkle", hint: "One tight line summary" },
  { id: "explain", label: "Explain", icon: "help", hint: "Explains meaning, jargon, and tone" },
  { id: "rephrase", label: "Rephrase", icon: "edit", hint: "Clearer and friendlier rewrite" },
  { id: "translate", label: "Translate", icon: "swap", hint: "Translate to English or requested language" },
  { id: "reply", label: "Draft Reply", icon: "reply", hint: "Draft a smart response in tone" },
];

export function MessageAiModal({ msg, initialOp = "summarize", onClose, onInsertDraft, onReplyWith }) {
  const [op, setOp] = useState(initialOp);
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function execute(targetOp, targetExtra) {
    if (!msg?.id) return;
    setLoading(true);
    setErr("");
    try {
      const res = await api.messageAi(msg.id, targetOp, targetExtra);
      setResult(res);
    } catch (e) {
      setErr(e.message || "AI operation failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOp(initialOp);
    execute(initialOp, "");
  }, [msg?.id, initialOp]);

  function switchOp(newOp) {
    setOp(newOp);
    execute(newOp, extra);
  }

  function copyResult() {
    if (!result?.reply) return;
    navigator.clipboard?.writeText(result.reply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const curOp = OPS.find((o) => o.id === op) || OPS[0];

  return (
    <Modal title="AI Message Assistant" sub={curOp.hint} onClose={onClose} wide>
      {msg && (
        <div className="reply-quote" style={{ marginBottom: 14, maxHeight: 72, overflow: "hidden" }}>
          <b>{msg.author?.display_name || msg.author?.username || "Author"}</b>: {msg.content || "(no text)"}
        </div>
      )}

      <div className="seg" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {OPS.map((o) => (
          <button key={o.id} className={op === o.id ? "on" : ""} onClick={() => switchOp(o.id)} type="button">
            <Ico n={o.icon} s={12} /> {o.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder={op === "translate" ? "Target language (leave empty for English)..." : "Extra instruction or tone note (optional)..."}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) {
              e.preventDefault();
              execute(op, extra);
            }
          }}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={() => execute(op, extra)} disabled={loading} type="button">
          {loading ? "Thinking…" : "Run"}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--dim)" }}>
          <Ico n="sparkle" s={22} className="spin" />
          <div style={{ marginTop: 10, fontSize: 13 }}>Thinking…</div>
        </div>
      ) : err ? (
        <div style={{ padding: 12, background: "rgba(235, 87, 87, 0.1)", border: "1px solid var(--bad)", borderRadius: 8, color: "var(--bad)", fontSize: 13 }}>
          {err}
        </div>
      ) : result ? (
        <div>
          <div className="prompt-view" style={{ minHeight: 90, maxHeight: 240, marginBottom: 14, userSelect: "text" }}>
            {result.reply}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              {result.model ? `via ${result.model}` : result.provider ? `via ${result.provider}` : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="ghost" onClick={copyResult} type="button">
                <Ico n={copied ? "check" : "copy"} s={12} /> {copied ? "Copied!" : "Copy"}
              </button>
              {onInsertDraft && (
                <button className="ghost" onClick={() => { onInsertDraft(result.reply); onClose(); }} type="button">
                  Insert in composer
                </button>
              )}
              {onReplyWith && (
                <button className="primary" onClick={() => { onReplyWith(msg, result.reply); onClose(); }} type="button">
                  <Ico n="reply" s={12} /> Reply with this
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
