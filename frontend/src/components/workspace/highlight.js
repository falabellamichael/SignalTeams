// Tiny, dependency-free syntax highlighter.
// Produces HTML for a code string; the editor paints it on a <pre> layer that
// sits exactly under a transparent <textarea>, so the caret, selection, IME
// and undo stack all stay native while the text looks highlighted.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// language → [regex, className], ... ]  (order matters: first match wins)
const RULES = {
  python: [
    [/(^|\n)([ \t]*)(#[^\n]*)/g, null, "comment"],
    [/("""[\s\S]*?"""|'''[\s\S]*?''')/g, "string"],
    [/(f?"(?:[^"\\\n]|\\.)*"|f?'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(def|class|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|import|from|as|with|try|except|finally|raise|yield|lambda|pass|break|continue|global|nonlocal|assert|del|async|await|self|print)\b/g, "kw"],
    [/\b(\d+\.?\d*|\.\d+)\b/g, "num"],
    [/(@\w+)/g, "deco"],
    [/\b([A-Za-z_]\w*)(?=\()/g, "fn"],
  ],
  javascript: [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/(`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|void|delete|yield|static|get|set)\b/g, "kw"],
    [/\b(\d+\.?\d*|0x[0-9a-fA-F]+)\b/g, "num"],
    [/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, "fn"],
    [/(<\/?[A-Za-z][\w-]*)/g, "tag"],
  ],
  typescript: null,   // filled below (same as javascript + types)
  json: [
    [/("(?:[^"\\]|\\.)*")(\s*:)/g, "key"],
    [/("(?:[^"\\]|\\.)*")/g, "string"],
    [/\b(true|false|null)\b/g, "kw"],
    [/-?\b(\d+\.?\d*([eE][+-]?\d+)?)\b/g, "num"],
  ],
  css: [
    [/\/\*[\s\S]*?\*\//g, "comment"],
    [/(@[\w-]+)/g, "deco"],
    [/([.#][\w-]+)/g, "tag"],
    [/([a-z-]+)(\s*:)/g, "key"],
    [/(#[0-9a-fA-F]{3,8}\b)/g, "num"],
    [/(\b\d+\.?\d*(px|em|rem|%|vh|vw|s|ms|deg|fr)?\b)/g, "num"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, "string"],
  ],
  html: [
    [/<!--[\s\S]*?-->/g, "comment"],
    [/(<\/?[\w-]+)/g, "tag"],
    [/([\w-]+)(=)/g, "key"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, "string"],
  ],
  markdown: [
    [/^(#{1,6} .*)$/gm, "kw"],
    [/(\*\*[^*\n]+\*\*|__[^_\n]+__)/g, "bold"],
    [/(`[^`\n]+`)/g, "string"],
    [/(```[\s\S]*?```)/g, "string"],
    [/(\[[^\]\n]*\]\([^)\n]*\))/g, "fn"],
    [/^(\s*[-*+] |\s*\d+\. )/gm, "deco"],
    [/^> .*$/gm, "comment"],
  ],
  shell: [
    [/(#[^\n]*)/g, "comment"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|echo|cd|set|source)\b/g, "kw"],
    [/(\$[\w{][\w}]*)/g, "deco"],
    [/\b(\d+)\b/g, "num"],
  ],
  sql: [
    [/(--[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/('(?:[^'\\]|\\.)*')/g, "string"],
    [/\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|DEFAULT|CASE|WHEN|THEN|ELSE|END|DISTINCT|COUNT|SUM|AVG|MIN|MAX)\b/gi, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  yaml: [
    [/(#[^\n]*)/g, "comment"],
    [/^(\s*)([\w.-]+)(\s*:)/gm, "key"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, "string"],
    [/\b(true|false|null|yes|no)\b/g, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  toml: [
    [/(#[^\n]*)/g, "comment"],
    [/^(\s*\[[^\]]+\])/gm, "tag"],
    [/^(\s*[\w.-]+)(\s*=)/gm, "key"],
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, "string"],
    [/\b(true|false)\b/g, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  go: [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/(`[^`]*`|"(?:[^"\\\n]|\\.)*")/g, "string"],
    [/\b(func|package|import|return|if|else|for|range|var|const|type|struct|interface|map|chan|go|defer|select|case|switch|break|continue|nil|true|false|make|new|len|append)\b/g, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
    [/\b([A-Za-z_]\w*)(?=\()/g, "fn"],
  ],
  rust: [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*")/g, "string"],
    [/\b(fn|let|mut|const|static|struct|enum|impl|trait|pub|use|mod|match|if|else|for|while|loop|return|self|Self|Some|None|Ok|Err|true|false|async|await|move|ref|where|type)\b/g, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
    [/(#\[[^\]]*\])/g, "deco"],
  ],
  java: [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*")/g, "string"],
    [/\b(public|private|protected|class|interface|extends|implements|static|final|void|int|long|double|float|boolean|char|String|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|null|true|false|this|super|abstract|synchronized)\b/g, "kw"],
    [/\b(\d+\.?\d*)\b/g, "num"],
    [/(@\w+)/g, "deco"],
  ],
  c: [
    [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(int|char|float|double|void|long|short|unsigned|signed|struct|union|enum|typedef|static|const|extern|return|if|else|for|while|do|switch|case|break|continue|goto|sizeof|include|define|NULL)\b/g, "kw"],
    [/(#\w+)/g, "deco"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  ruby: [
    [/(#[^\n]*)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(def|class|module|end|if|elsif|else|unless|while|until|for|in|do|return|yield|require|include|attr_accessor|nil|true|false|self|new|puts)\b/g, "kw"],
    [/(:\w+)/g, "deco"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  php: [
    [/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(function|class|public|private|protected|static|return|if|else|elseif|foreach|for|while|new|echo|print|namespace|use|extends|implements|null|true|false|array|isset|unset)\b/g, "kw"],
    [/(\$\w+)/g, "deco"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  powershell: [
    [/(#[^\n]*)/g, "comment"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g, "string"],
    [/\b(function|param|if|else|elseif|foreach|for|while|do|switch|return|try|catch|finally|throw|begin|process|end|filter)\b/gi, "kw"],
    [/(\$\w+)/g, "deco"],
    [/(-\w+)/g, "tag"],
    [/\b(\d+\.?\d*)\b/g, "num"],
  ],
  text: [],
};
RULES.typescript = RULES.javascript;
RULES.jsx = RULES.javascript;
RULES.tsx = RULES.javascript;
RULES.vue = RULES.html;
RULES.svelte = RULES.html;
RULES.xml = RULES.html;
RULES.scss = RULES.css;
RULES.less = RULES.css;
RULES.ini = RULES.toml;
RULES.dockerfile = RULES.shell;
RULES.makefile = RULES.shell;

const ALIAS = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", ts: "typescript", tsx: "tsx", md: "markdown", markdown: "markdown",
  yml: "yaml", sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell",
  htm: "html", rs: "rust", kt: "java", cs: "java", cpp: "c", hpp: "c", h: "c",
  rb: "ruby", toml: "toml", cfg: "toml", conf: "toml", jsonc: "json",
};

export function langFor(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ALIAS[ext] || ext || "text";
}

/** Highlight `code` for `lang`, returning HTML with <span class="t-*"> tokens. */
export function highlight(code, lang) {
  const rules = RULES[lang] || RULES.text;
  if (!rules || !rules.length) return esc(code);

  // Collect non-overlapping matches across all rules, first rule wins.
  const marks = new Array(code.length).fill(null);
  for (const [re, cls, cls2] of rules) {
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(code)) !== null && guard++ < 20000) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      // rules with a leading (^|\n) group: skip the newline itself
      let start = m.index;
      let text = m[0];
      if (m.length > 2 && m[1] !== undefined && (m[1] === "\n" || m[1] === "")) {
        start += m[1].length;
        text = m[0].slice(m[1].length);
      }
      const end = start + text.length;
      let free = true;
      for (let i = start; i < end; i++) if (marks[i]) { free = false; break; }
      if (free) {
        const c = cls2 || cls;
        for (let i = start; i < end; i++) marks[i] = c;
      }
    }
  }

  // Emit runs of equal class.
  let out = "", i = 0;
  while (i < code.length) {
    const c = marks[i];
    let j = i + 1;
    while (j < code.length && marks[j] === c) j++;
    const chunk = esc(code.slice(i, j));
    out += c ? `<span class="t-${c}">${chunk}</span>` : chunk;
    i = j;
  }
  return out;
}

/** Bracket pairs for the caret position — used to flash the matching brace. */
export function matchBracket(text, pos) {
  const open = "([{", close = ")]}";
  const ch = text[pos];
  let dir = 0, target = "";
  if (open.includes(ch)) { dir = 1; target = close[open.indexOf(ch)]; }
  else if (close.includes(ch)) { dir = -1; target = open[close.indexOf(ch)]; }
  else return null;
  let depth = 0;
  for (let i = pos; i >= 0 && i < text.length; i += dir) {
    if (text[i] === ch) depth++;
    else if (text[i] === target) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}
