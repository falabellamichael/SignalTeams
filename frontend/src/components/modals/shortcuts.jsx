import React from "react";
import Ico from "../Ico";
import { Modal } from "./_shared.jsx";
import { SLASH_COMMANDS } from "../chat/consts";


const KEY_SHORTCUTS = [
  ["Ctrl + K", "Quick switcher & search everywhere"],
  ["Ctrl + /  or  ?", "Keyboard shortcuts & slash commands"],
  ["Alt + ↑ / ↓", "Cycle previous / next channel or DM"],
  ["Ctrl + Alt + ↑ / ↓", "Jump to previous / next unread channel"],
  ["Shift + Esc", "Mark all channels in current server as read"],
  ["↑ (empty composer)", "Edit your last sent message"],
  ["Ctrl + B / I / U", "Bold / italic / underline the selection"],
  ["Ctrl + Shift + X / Ctrl + `", "Strikethrough / inline code"],
  ["Shift + Enter", "Insert a newline in the composer"],
  ["Esc", "Close active modal, cancel reply, or clear unread"],
];

const SLASH_CMDS = SLASH_COMMANDS.map((c) => [
  `/${c.cmd}${c.usage ? " " + c.usage : ""}`, c.desc]);

export function ShortcutsModal({ onClose }) {
  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico n="kb" s={17} /> Shortcuts &amp; Slash Commands</span>}
      sub="Navigate at keyboard speed or drive the composer with slash commands." onClose={onClose} wide>
      <div className="sc-grid">
        <div>
          <label style={{ marginTop: 0 }}><Ico n="kb" s={12} /> Keyboard shortcuts</label>
          <div className="sc-list">
            {KEY_SHORTCUTS.map(([k, d]) => (
              <div key={k} className="sc-row">
                <kbd className="sc-kbd">{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label style={{ marginTop: 0 }}><Ico n="term" s={12} /> Composer slash commands</label>
          <div className="sc-list">
            {SLASH_CMDS.map(([c, d]) => (
              <div key={c} className="sc-row">
                <code className="sc-cmd">{c}</code>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mfoot">
        <button className="primary" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}
