import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Ico from "../Ico";
import { highlight, langFor, matchBracket } from "./highlight";
import { playCue } from "../../audioCues";

const INDENT = "  ";
const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };

/**
 * A real code editor: transparent <textarea> over a highlighted <pre>.
 * Native caret/selection/undo/IME, plus line numbers, auto-indent, bracket
 * pairing, find & replace, and go-to-line.
 */
export default function CodeEditor({ path, value, onChange, readOnly, onSave, onCursor }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [find, setFind] = useState(null);        // {q, replace, idx, matches:[]}
  const [goto, setGoto] = useState(null);
  const [matchPos, setMatchPos] = useState(null);
  const lang = langFor(path);

  const lines = useMemo(() => value.split("\n"), [value]);
  const html = useMemo(() => highlight(value, lang), [value, lang]);

  // Keep the highlight layer and gutter locked to the textarea's scroll.
  // The <pre> is sized to its content (width: max-content) and translated by
  // the textarea's scroll offsets — that's what makes long lines scroll
  // horizontally while the gutter stays put.
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pre = preRef.current;
    if (pre) {
      // The <pre> is anchored at the textarea's content origin (left: 14px),
      // so a plain -scrollLeft keeps every glyph aligned at any offset.
      pre.style.transform =
        `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }, []);

  // re-sync whenever the content changes (new lines can change scroll height)
  useLayoutEffect(() => { syncScroll(); }, [value, syncScroll]);

  // Chromium only honours `wrap=off` when it is present as an ATTRIBUTE at
  // parse time — React sets it as a property, which the layout engine ignores
  // once a CSS width is applied. Re-assert it imperatively so long lines
  // scroll horizontally instead of soft-wrapping.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.setAttribute("wrap", "off");
    ta.wrap = "off";
    ta.style.whiteSpace = "pre";
    ta.style.overflowWrap = "normal";
    ta.style.wordBreak = "normal";
  }, [path]);

  // the textarea's scrollWidth only updates after layout — re-sync on resize
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncScroll());
    ro.observe(ta);
    return () => ro.disconnect();
  }, [syncScroll]);

  const reportCursor = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = value.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    setCursor({ line, col });
    setSel({ start: ta.selectionStart, end: ta.selectionEnd });
    setMatchPos(matchBracket(value, pos));
    onCursor?.({ line, col, pos, selected: ta.selectionEnd - ta.selectionStart });
  }, [value, onCursor]);

  useEffect(() => { reportCursor(); }, [value, reportCursor]);

  // reset scroll when switching files
  useEffect(() => {
    if (taRef.current) { taRef.current.scrollTop = 0; taRef.current.scrollLeft = 0; }
    syncScroll();
    setFind(null); setGoto(null);
  }, [path, syncScroll]);

  function setValue(next, caret) {
    onChange(next);
    if (caret != null) {
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.selectionStart = ta.selectionEnd = caret;
        reportCursor();
      });
    }
  }

  function onKeyDown(e) {
    const ta = e.target;
    const s = ta.selectionStart, t = ta.selectionEnd;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); playCue("send"); onSave?.(); return; }
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFind((f) => ({ q: f?.q || "", replace: f?.replace || "", idx: 0, matches: [] }));
      return;
    }
    if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault(); setGoto({ v: "" }); return;
    }
    if (e.key === "Escape" && (find || goto)) { setFind(null); setGoto(null); return; }
    if (readOnly) return;
    playCue("key", { key: e.key });

    // Tab / Shift+Tab — indent or outdent the selected lines
    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      if (s !== t || e.shiftKey) {
        const block = value.slice(lineStart, t);
        const rows = block.split("\n");
        const next = e.shiftKey
          ? rows.map((r) => r.replace(new RegExp(`^( {1,${INDENT.length}}|\t)`), "")).join("\n")
          : rows.map((r) => INDENT + r).join("\n");
        const delta = next.length - block.length;
        setValue(value.slice(0, lineStart) + next + value.slice(t),
          e.shiftKey ? Math.max(lineStart, s - INDENT.length) : s + INDENT.length);
        if (!e.shiftKey && delta === 0) return;
        return;
      }
      setValue(value.slice(0, s) + INDENT + value.slice(t), s + INDENT.length);
      return;
    }

    // Enter — keep indentation, and open a block one level deeper.
    // A line ending in `:` (python), `{` (js/css) or `=>` opens a block.
    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const line = value.slice(lineStart, s);
      const indent = (line.match(/^[ \t]*/) || [""])[0];
      const prev = value[s - 1], next = value[s];
      const opensBracket = prev && "([{".includes(prev);
      const closesBracket = next && ")]}".includes(next);
      // `def foo():` / `if x:` / `class A:` / `else:` / `try:` …
      const opensBlock = /(:\s*$|\{\s*$|=>\s*$)/.test(line);
      if (opensBracket && closesBracket) {
        // expand `{|}` into a block with the caret in the middle
        const body = "\n" + indent + INDENT + "\n" + indent;
        setValue(value.slice(0, s) + body + value.slice(t),
          s + 1 + indent.length + INDENT.length);
        return;
      }
      const deeper = opensBracket || opensBlock;
      const insert = "\n" + indent + (deeper ? INDENT : "");
      setValue(value.slice(0, s) + insert + value.slice(t), s + insert.length);
      return;
    }

    // Backspace inside an empty pair removes both halves
    if (e.key === "Backspace" && s === t && s > 0) {
      const a = value[s - 1], b = value[s];
      if (PAIRS[a] && PAIRS[a] === b) {
        e.preventDefault();
        setValue(value.slice(0, s - 1) + value.slice(s + 1), s - 1);
        return;
      }
      // outdent to the previous tab stop
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const before = value.slice(lineStart, s);
      if (before && /^[ \t]+$/.test(before)) {
        e.preventDefault();
        const cut = before.length % INDENT.length || INDENT.length;
        setValue(value.slice(0, s - cut) + value.slice(s), s - cut);
        return;
      }
    }

    // auto-close brackets and quotes
    if (PAIRS[e.key] && s === t) {
      const next = value[s];
      if (PAIRS[e.key] === e.key && next === e.key) {   // typing over a closing quote
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = s + 1;
        reportCursor();
        return;
      }
      // don't auto-close when the user is typing a closing char themselves
      if (next && ")]}".includes(e.key)) return;
      if (!next || /[\s)\]},;:]/.test(next)) {
        e.preventDefault();
        setValue(value.slice(0, s) + e.key + PAIRS[e.key] + value.slice(t), s + 1);
        return;
      }
    }

    // typing a closing bracket that's already there just steps over it
    if (s === t && ")]}".includes(e.key) && value[s] === e.key) {
      e.preventDefault();
      ta.selectionStart = ta.selectionEnd = s + 1;
      reportCursor();
      return;
    }
  }

  // ---- find & replace ----
  const matches = useMemo(() => {
    if (!find?.q) return [];
    const out = [];
    const q = find.q.toLowerCase();
    const hay = value.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0 && out.length < 500) {
      out.push(i);
      i = hay.indexOf(q, i + Math.max(1, q.length));
    }
    return out;
  }, [find?.q, value]);

  function jumpTo(pos, len) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.selectionStart = pos;
    ta.selectionEnd = pos + (len || 0);
    // scroll the match into view (vertically centred, horizontally revealed)
    const before = value.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    const lh = 20.8, cw = 7.53;          // 12.5px monospace metrics
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2);
    const x = col * cw;
    if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 40)
      ta.scrollLeft = Math.max(0, x - ta.clientWidth / 2);
    syncScroll();
    reportCursor();
  }

  function findNext(dir = 1) {
    if (!matches.length) return;
    const cur = taRef.current?.selectionStart ?? 0;
    let idx;
    if (dir > 0) idx = matches.findIndex((m) => m > cur - 1);
    else idx = [...matches].reverse().findIndex((m) => m < cur);
    if (dir > 0) idx = idx < 0 ? 0 : idx;
    else idx = idx < 0 ? matches.length - 1 : matches.length - 1 - idx;
    jumpTo(matches[idx], find.q.length);
  }

  function replaceOne() {
    const ta = taRef.current;
    if (!ta || !find?.q) return;
    const s = ta.selectionStart, t = ta.selectionEnd;
    if (value.slice(s, t).toLowerCase() === find.q.toLowerCase()) {
      const next = value.slice(0, s) + find.replace + value.slice(t);
      onChange(next);
      requestAnimationFrame(() => jumpTo(s + find.replace.length, 0));
    } else findNext(1);
  }

  function replaceAll() {
    if (!find?.q) return;
    const re = new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    onChange(value.replace(re, find.replace));
  }

  function doGoto() {
    const n = parseInt(goto?.v || "0", 10);
    if (!n || n < 1) { setGoto(null); return; }
    const lineStart = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    jumpTo(lineStart, 0);
    setGoto(null);
  }

  // ---- render ----
  const gutter = useMemo(() => {
    const out = [];
    for (let i = 1; i <= lines.length; i++) out.push(i);
    return out;
  }, [lines.length]);

  const activeLine = cursor.line;

  return (
    <div className="ce">
      {find && (
        <div className="ce-find">
          <Ico n="search" s={12} />
          <input autoFocus value={find.q} placeholder="find…"
            onChange={(e) => setFind({ ...find, q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") setFind(null);
            }} />
          <span className="ce-count">{matches.length ? `${matches.length} hit${matches.length > 1 ? "s" : ""}` : "no hits"}</span>
          <button className="ghost" title="Previous (Shift+Enter)" onClick={() => findNext(-1)}><Ico n="up" s={12} /></button>
          <button className="ghost" title="Next (Enter)" onClick={() => findNext(1)}><Ico n="down" s={12} /></button>
          {!readOnly && (
            <>
              <input value={find.replace} placeholder="replace…"
                onChange={(e) => setFind({ ...find, replace: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }} />
              <button className="ghost" title="Replace" onClick={replaceOne}>1×</button>
              <button className="ghost" title="Replace all" onClick={replaceAll}>all</button>
            </>
          )}
          <button className="ghost" title="Close (Esc)" onClick={() => setFind(null)}><Ico n="x" s={12} /></button>
        </div>
      )}
      {goto && (
        <div className="ce-find">
          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>go to line</span>
          <input autoFocus value={goto.v} placeholder="42" style={{ width: 80 }}
            onChange={(e) => setGoto({ v: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); doGoto(); }
              if (e.key === "Escape") setGoto(null);
            }} />
          <button className="ghost" onClick={doGoto}>go</button>
          <button className="ghost" onClick={() => setGoto(null)}><Ico n="x" s={12} /></button>
        </div>
      )}
      <div className="ce-body">
        <div className="ce-gutter" ref={gutterRef}>
          {gutter.map((n) => (
            <div key={n} className={`ce-ln ${n === activeLine ? "on" : ""}`}>{n}</div>
          ))}
        </div>
        <div className="ce-scroll">
          <div className="ce-hl" aria-hidden="true">
            <pre className="ce-pre" ref={preRef}
              dangerouslySetInnerHTML={{ __html: html + "\n" }} />
          </div>
          <textarea ref={taRef} className="ce-ta" value={value} spellCheck={false}
            readOnly={readOnly} wrap="off" cols={1} rows={1}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={syncScroll}
            onKeyUp={reportCursor}
            onClick={reportCursor}
            onSelect={reportCursor}
            onFocus={reportCursor} />
        </div>
      </div>
      <div className="ce-status">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        {sel.end > sel.start && <span>{sel.end - sel.start} selected</span>}
        <span>{lines.length} lines</span>
        <span>{lang}</span>
        {matchPos != null && <span className="ce-bracket">bracket match</span>}
        <span style={{ flex: 1 }} />
        <span className="ce-hint">Ctrl+S save · Ctrl+F find · Ctrl+G go to line · Tab indent</span>
      </div>
    </div>
  );
}
