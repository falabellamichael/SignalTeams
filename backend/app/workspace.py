"""Workspace filesystem layer — sandboxed read/write for humans and agents.

A workspace is a folder on the host machine that a server's members (and the
agents they summon) can browse and edit. Every path is resolved *inside* the
workspace root: `..`, absolute paths, symlinks that escape, and reserved
names are all rejected before any I/O happens.

Permission model (per workspace, per user):
    read   — list + read files, see history
    write  — read + create/edit/delete/move files
    admin  — write + run commands + manage grants
The server owner is always admin. Agents inherit the level of the human who
summoned them, so an agent can never do more than the person talking to it.
"""
import difflib
import json
import os
import re
import shutil
import subprocess
import time

from .config import (WORKSPACE_EXEC, WORKSPACE_EXEC_TIMEOUT, WORKSPACE_MAX_BYTES,
                     WORKSPACE_MAX_FILES, WORKSPACE_ROOTS)
from .db import now

LEVELS = ("read", "write", "admin")
_RANK = {"read": 1, "write": 2, "admin": 3}

# never listed, never readable — keeps secrets and VCS noise out of the tree
HIDDEN_DIRS = {".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv",
               "venv", ".idea", ".vscode", "dist", "build", ".next", ".cache"}
HIDDEN_FILES = {".env", ".env.local", ".env.production", "id_rsa", "id_ed25519",
                ".npmrc", ".netrc", ".git-credentials"}
TEXT_EXT = {
    ".txt", ".md", ".markdown", ".rst", ".py", ".js", ".jsx", ".ts", ".tsx",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".html", ".htm", ".css", ".scss", ".sass", ".less", ".sql", ".sh", ".ps1",
    ".bat", ".cmd", ".c", ".h", ".cpp", ".hpp", ".cs", ".java", ".kt", ".go",
    ".rs", ".rb", ".php", ".lua", ".swift", ".dart", ".vue", ".svelte", ".xml",
    ".svg", ".csv", ".tsv", ".log", ".env.example", ".gitignore", ".dockerfile",
    ".makefile", ".gradle", ".properties", ".graphql", ".proto", ".tex",
}
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".pdf",
    ".zip", ".gz", ".tar", ".7z", ".rar", ".exe", ".dll", ".so", ".dylib",
    ".bin", ".dat", ".db", ".sqlite", ".mp3", ".mp4", ".wav", ".ogg", ".webm",
    ".woff", ".woff2", ".ttf", ".otf", ".pyc", ".class", ".jar", ".gguf",
    ".safetensors", ".onnx", ".pt", ".pth",
}
LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".json": "json", ".md": "markdown", ".css": "css",
    ".html": "html", ".yml": "yaml", ".yaml": "yaml", ".sh": "shell", ".ps1": "powershell",
    ".sql": "sql", ".go": "go", ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp",
    ".rb": "ruby", ".php": "php", ".toml": "toml", ".ini": "ini", ".xml": "xml",
}


class WorkspaceError(Exception):
    """Raised for anything the caller should see as a 4xx."""

    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


# ---------------------------------------------------------------- paths

def norm_rel(path: str) -> str:
    """Normalize a client-supplied relative path to posix form ('a/b/c.txt')."""
    p = (path or "").replace("\\", "/").strip()
    p = re.sub(r"^\./+", "", p)
    p = p.strip("/")
    if not p:
        return ""
    parts = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            raise WorkspaceError("Path escapes the workspace", 400)
        if "\x00" in seg:
            raise WorkspaceError("Bad path", 400)
        parts.append(seg)
    return "/".join(parts)


def _hidden(rel: str) -> bool:
    parts = rel.split("/")
    if any(p in HIDDEN_DIRS for p in parts):
        return True
    return parts[-1] in HIDDEN_FILES


_ABS = re.compile(r"^(?:[a-zA-Z]:[\\/]|[\\/]{2}|~[\\/])")


def resolve(root: str, rel: str, must_exist=False) -> str:
    """Absolute host path for `rel`, guaranteed to sit inside `root`.

    Absolute inputs that land inside the root are translated to the matching
    relative path (models love passing the advertised root folder back at us);
    anything outside is still rejected."""
    cand = (rel or "").strip()
    base = os.path.realpath(root)
    if _ABS.match(cand):
        full = os.path.realpath(os.path.expanduser(cand))
        if os.path.normcase(full) == os.path.normcase(base):
            cand = ""
        elif os.path.normcase(full).startswith(os.path.normcase(base) + os.sep):
            cand = os.path.relpath(full, base)
        else:
            raise WorkspaceError("Path escapes the workspace", 400)
    rel = norm_rel(cand)
    full = os.path.realpath(os.path.join(base, *rel.split("/"))) if rel else base
    if full != base and not full.startswith(base + os.sep):
        raise WorkspaceError("Path escapes the workspace", 400)
    if must_exist and not os.path.exists(full):
        raise WorkspaceError(f"No such file: {rel or '/'}", 404)
    return full


def check_root(path: str) -> str:
    """Validate a workspace root folder against AGENTHIVE_WORKSPACE_ROOTS."""
    p = os.path.abspath(os.path.expanduser((path or "").strip()))
    if not p or not os.path.isdir(p):
        raise WorkspaceError("That folder doesn't exist on this machine", 400)
    real = os.path.realpath(p)
    if WORKSPACE_ROOTS:
        ok = False
        for allowed in WORKSPACE_ROOTS:
            a = os.path.realpath(os.path.abspath(os.path.expanduser(allowed)))
            if real == a or real.startswith(a + os.sep):
                ok = True
                break
        if not ok:
            raise WorkspaceError(
                "That folder is outside the allowed workspace roots "
                f"({', '.join(WORKSPACE_ROOTS)})", 403)
    return real


def is_text(rel: str) -> bool:
    ext = os.path.splitext(rel)[1].lower()
    if ext in BINARY_EXT:
        return False
    if ext in TEXT_EXT:
        return True
    return ext == ""          # extensionless files (Dockerfile, Makefile…) are text


def language(rel: str) -> str:
    return LANG.get(os.path.splitext(rel)[1].lower(), "text")


# ---------------------------------------------------------------- permissions

def level_of(conn, ws, uid) -> str:
    """Effective level for a user: owner > explicit grant > none."""
    if not uid:
        return ""
    srv = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                       (ws["server_id"],)).fetchone()
    if srv and srv["owner_id"] == uid:
        return "admin"
    g = conn.execute(
        "SELECT level FROM workspace_grants WHERE workspace_id=? AND user_id=?",
        (ws["id"], uid)).fetchone()
    return g["level"] if g and g["level"] in _RANK else ""


def can(conn, ws, uid, need="read") -> bool:
    lvl = level_of(conn, ws, uid)
    return bool(lvl) and _RANK[lvl] >= _RANK[need]


def require(conn, ws, uid, need="read"):
    if not can(conn, ws, uid, need):
        raise WorkspaceError(
            f"You need {need} access to this workspace", 403)


def audit(conn, ws_id, action, path="", detail="", ok=True, actor_id=None, agent_id=None):
    conn.execute(
        "INSERT INTO workspace_audit(workspace_id, actor_id, agent_id, action, path, "
        "detail, ok, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (ws_id, actor_id, agent_id, action, str(path or "")[:300],
         str(detail or "")[:400], 1 if ok else 0, now()))
    conn.execute(
        "DELETE FROM workspace_audit WHERE workspace_id=? AND id NOT IN "
        "(SELECT id FROM workspace_audit WHERE workspace_id=? ORDER BY id DESC LIMIT 800)",
        (ws_id, ws_id))


# ---------------------------------------------------------------- tree

def _entry(conn, ws_id, rel, full):
    st = os.stat(full)
    is_dir = os.path.isdir(full)
    row = conn.execute(
        "SELECT updated_by, updated_at FROM workspace_files WHERE workspace_id=? AND path=?",
        (ws_id, rel)).fetchone()
    return {
        "path": rel,
        "name": os.path.basename(full),
        "dir": is_dir,
        "size": 0 if is_dir else st.st_size,
        "mtime": st.st_mtime,
        "text": is_text(rel) if not is_dir else False,
        "lang": language(rel) if not is_dir else "",
        "updated_by": row["updated_by"] if row else None,
        "updated_at": row["updated_at"] if row else None,
    }


def tree(conn, ws, sub="", depth=2, limit=None):
    """Directory listing (recursive to `depth`), hidden + binary noise skipped."""
    limit = limit or WORKSPACE_MAX_FILES
    root = ws["root"]
    sub = norm_rel(sub)
    base = resolve(root, sub, must_exist=True)
    if not os.path.isdir(base):
        raise WorkspaceError("Not a folder", 400)
    out, count = [], 0

    def walk(full, rel, d):
        nonlocal count
        try:
            names = sorted(os.listdir(full), key=lambda n: (not os.path.isdir(os.path.join(full, n)), n.lower()))
        except OSError:
            return
        for name in names:
            if count >= limit:
                return
            child_rel = f"{rel}/{name}" if rel else name
            if _hidden(child_rel):
                continue
            child = os.path.join(full, name)
            if os.path.islink(child):
                continue
            try:
                e = _entry(conn, ws["id"], child_rel, child)
            except OSError:
                continue
            out.append(e)
            count += 1
            if e["dir"] and d > 1:
                walk(child, child_rel, d - 1)

    walk(base, sub, max(1, min(int(depth or 2), 6)))
    return {"root": sub, "entries": out, "truncated": count >= limit}


# ---------------------------------------------------------------- read / write

def read_file(conn, ws, rel, uid=None, agent_id=None, record=True):
    rel = norm_rel(rel)
    if not rel:
        raise WorkspaceError("Pick a file", 400)
    if _hidden(rel):
        raise WorkspaceError("That file is hidden from workspaces", 403)
    full = resolve(ws["root"], rel, must_exist=True)
    if os.path.isdir(full):
        raise WorkspaceError("That's a folder", 400)
    size = os.path.getsize(full)
    if size > WORKSPACE_MAX_BYTES:
        raise WorkspaceError(f"File is too big to open ({size // 1024} KB)", 413)
    if not is_text(rel):
        raise WorkspaceError("Binary file — download it instead", 415)
    with open(full, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    if record:
        audit(conn, ws["id"], "read", rel, f"{len(content)} chars",
              actor_id=uid, agent_id=agent_id)
    return {"path": rel, "content": content, "size": size,
            "mtime": os.path.getmtime(full), "lang": language(rel)}


IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"}


def file_meta(conn, ws, rel):
    """Cheap stat for the editor: size, mtime, kind, and who last touched it."""
    rel = norm_rel(rel)
    if _hidden(rel):
        raise WorkspaceError("That file is hidden from workspaces", 403)
    full = resolve(ws["root"], rel, must_exist=True)
    if os.path.isdir(full):
        raise WorkspaceError("That's a folder", 400)
    st = os.stat(full)
    ext = os.path.splitext(rel)[1].lower()
    row = conn.execute(
        "SELECT f.updated_by, f.updated_at, u.display_name, u.avatar_emoji "
        "FROM workspace_files f LEFT JOIN users u ON u.id=f.updated_by "
        "WHERE f.workspace_id=? AND f.path=?", (ws["id"], rel)).fetchone()
    return {"path": rel, "size": st.st_size, "mtime": st.st_mtime,
            "text": is_text(rel), "image": ext in IMAGE_EXT,
            "lang": language(rel),
            "updated_by": ({"id": row["updated_by"], "display_name": row["display_name"],
                            "avatar_emoji": row["avatar_emoji"]}
                           if row and row["updated_by"] else None),
            "updated_at": row["updated_at"] if row else None}


def read_bytes(conn, ws, rel, uid=None, agent_id=None):
    """Raw bytes for download / image preview (any file type, size-capped)."""
    rel = norm_rel(rel)
    if not rel or _hidden(rel):
        raise WorkspaceError("That file is hidden from workspaces", 403)
    full = resolve(ws["root"], rel, must_exist=True)
    if os.path.isdir(full):
        raise WorkspaceError("That's a folder", 400)
    size = os.path.getsize(full)
    if size > 25 * 1024 * 1024:
        raise WorkspaceError("File is too big to download (25 MB max)", 413)
    with open(full, "rb") as f:
        data = f.read()
    audit(conn, ws["id"], "download", rel, f"{size} bytes",
          actor_id=uid, agent_id=agent_id)
    return data, os.path.basename(full)


def _snapshot(conn, ws, rel, full, uid, agent_id, source, note):
    """Keep the previous bytes before overwriting (bounded history per path)."""
    if not os.path.exists(full) or not is_text(rel):
        return
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            old = f.read(WORKSPACE_MAX_BYTES)
    except OSError:
        return
    conn.execute(
        "INSERT INTO workspace_revisions(workspace_id, path, content, size, author_id, "
        "agent_id, source, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (ws["id"], rel, old, len(old), uid, agent_id, source, note[:200], now()))
    conn.execute(
        "DELETE FROM workspace_revisions WHERE workspace_id=? AND path=? AND id NOT IN "
        "(SELECT id FROM workspace_revisions WHERE workspace_id=? AND path=? "
        "ORDER BY id DESC LIMIT 25)", (ws["id"], rel, ws["id"], rel))


def write_file(conn, ws, rel, content, uid=None, agent_id=None, source="human",
               note="", create_only=False, base_mtime=None, force=False):
    """Write a text file. `base_mtime` is the mtime the editor loaded — if the
    file changed on disk since then the write is refused with a 409 so nobody
    silently clobbers someone else's edit (pass force=True to override)."""
    rel = norm_rel(rel)
    if not rel:
        raise WorkspaceError("Pick a file name", 400)
    if _hidden(rel):
        raise WorkspaceError("That path is reserved", 403)
    if not is_text(rel):
        raise WorkspaceError("Only text files can be edited here", 415)
    data = content if isinstance(content, str) else str(content)
    if len(data.encode("utf-8")) > WORKSPACE_MAX_BYTES:
        raise WorkspaceError("File too large (2 MB max)", 413)
    full = resolve(ws["root"], rel)
    existed = os.path.exists(full)
    if create_only and existed:
        raise WorkspaceError(f"{rel} already exists", 409)
    if existed and os.path.isdir(full):
        raise WorkspaceError("That's a folder", 400)
    if existed and base_mtime and not force:
        cur = os.path.getmtime(full)
        if abs(cur - float(base_mtime)) > 0.001:
            who = conn.execute(
                "SELECT u.display_name, a.name aname FROM workspace_files f "
                "LEFT JOIN users u ON u.id=f.updated_by "
                "LEFT JOIN agents a ON a.id=(SELECT agent_id FROM workspace_audit "
                "  WHERE workspace_id=? AND path=? AND agent_id IS NOT NULL "
                "  ORDER BY id DESC LIMIT 1) "
                "WHERE f.workspace_id=? AND f.path=?",
                (ws["id"], rel, ws["id"], rel)).fetchone()
            by = (who["aname"] or who["display_name"]) if who else None
            raise WorkspaceError(
                f"{rel} changed on disk since you opened it"
                + (f" ({by} edited it)" if by else "")
                + " — reload to see the new version, or save anyway to overwrite.", 409)
    os.makedirs(os.path.dirname(full) or ws["root"], exist_ok=True)
    _snapshot(conn, ws, rel, full, uid, agent_id, source, note)
    with open(full, "w", encoding="utf-8", newline="") as f:
        f.write(data)
    st = os.stat(full)
    conn.execute(
        "INSERT INTO workspace_files(workspace_id, path, size, mtime, updated_by, updated_at) "
        "VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id, path) DO UPDATE SET "
        "size=excluded.size, mtime=excluded.mtime, updated_by=excluded.updated_by, "
        "updated_at=excluded.updated_at",
        (ws["id"], rel, st.st_size, st.st_mtime, uid, now()))
    audit(conn, ws["id"], "write" if existed else "create", rel,
          f"{len(data)} chars" + (f" — {note}" if note else ""),
          actor_id=uid, agent_id=agent_id)
    return {"path": rel, "size": st.st_size, "created": not existed,
            "mtime": st.st_mtime, "lines": data.count("\n") + 1}


def edit_file(conn, ws, rel, find, replace, uid=None, agent_id=None, note=""):
    """Replace one exact occurrence of `find` with `replace`.

    Much cheaper than rewriting a whole file, and it refuses ambiguous edits:
    if `find` is missing or appears more than once the agent gets a clear error
    instead of silently mangling the file.
    """
    rel = norm_rel(rel)
    if not find:
        raise WorkspaceError("`find` must not be empty", 400)
    cur = read_file(conn, ws, rel, uid=uid, agent_id=agent_id, record=False)
    text = cur["content"]
    n = text.count(find)
    if n == 0:
        raise WorkspaceError(
            f"`find` text not present in {rel} — read the file and copy the exact text", 400)
    if n > 1:
        raise WorkspaceError(
            f"`find` matches {n} places in {rel} — include more surrounding context "
            "so the edit is unambiguous", 400)
    new = text.replace(find, replace, 1)
    r = write_file(conn, ws, rel, new, uid=uid, agent_id=agent_id, source="agent",
                   note=note or f"replaced {len(find)} chars")
    return {**r, "replaced": 1}


def delete_path(conn, ws, rel, uid=None, agent_id=None):
    rel = norm_rel(rel)
    if not rel:
        raise WorkspaceError("Can't delete the workspace root", 400)
    full = resolve(ws["root"], rel, must_exist=True)
    if os.path.isdir(full):
        shutil.rmtree(full)
        conn.execute("DELETE FROM workspace_files WHERE workspace_id=? AND "
                     "(path=? OR path LIKE ?)", (ws["id"], rel, rel + "/%"))
    else:
        _snapshot(conn, ws, rel, full, uid, agent_id, "human", "before delete")
        os.remove(full)
        conn.execute("DELETE FROM workspace_files WHERE workspace_id=? AND path=?",
                     (ws["id"], rel))
    audit(conn, ws["id"], "delete", rel, "", actor_id=uid, agent_id=agent_id)
    return {"deleted": rel}


def move_path(conn, ws, src, dst, uid=None, agent_id=None):
    src, dst = norm_rel(src), norm_rel(dst)
    if not src or not dst:
        raise WorkspaceError("Both paths are required", 400)
    if _hidden(dst):
        raise WorkspaceError("That destination is reserved", 403)
    a = resolve(ws["root"], src, must_exist=True)
    b = resolve(ws["root"], dst)
    if os.path.exists(b):
        raise WorkspaceError(f"{dst} already exists", 409)
    os.makedirs(os.path.dirname(b) or ws["root"], exist_ok=True)
    shutil.move(a, b)
    conn.execute("UPDATE workspace_files SET path=? WHERE workspace_id=? AND path=?",
                 (dst, ws["id"], src))
    conn.execute("UPDATE workspace_files SET path=? || substr(path, ?) WHERE workspace_id=? "
                 "AND path LIKE ?", (dst, len(src) + 1, ws["id"], src + "/%"))
    # history follows the file so a rename doesn't orphan its revisions
    conn.execute("UPDATE workspace_revisions SET path=? WHERE workspace_id=? AND path=?",
                 (dst, ws["id"], src))
    conn.execute("UPDATE workspace_revisions SET path=? || substr(path, ?) "
                 "WHERE workspace_id=? AND path LIKE ?",
                 (dst, len(src) + 1, ws["id"], src + "/%"))
    audit(conn, ws["id"], "move", src, f"→ {dst}", actor_id=uid, agent_id=agent_id)
    return {"from": src, "to": dst}


def mkdir(conn, ws, rel, uid=None, agent_id=None):
    rel = norm_rel(rel)
    if not rel:
        raise WorkspaceError("Name the folder", 400)
    full = resolve(ws["root"], rel)
    if os.path.exists(full):
        raise WorkspaceError("Already exists", 409)
    os.makedirs(full)
    audit(conn, ws["id"], "mkdir", rel, "", actor_id=uid, agent_id=agent_id)
    return {"path": rel}


# ---------------------------------------------------------------- history / diff

def revisions(conn, ws, rel):
    rel = norm_rel(rel)
    rows = conn.execute(
        "SELECT r.id, r.size, r.source, r.note, r.created_at, r.author_id, r.agent_id, "
        "u.display_name, u.avatar_emoji, a.name aname, a.icon aicon "
        "FROM workspace_revisions r LEFT JOIN users u ON u.id=r.author_id "
        "LEFT JOIN agents a ON a.id=r.agent_id "
        "WHERE r.workspace_id=? AND r.path=? ORDER BY r.id DESC LIMIT 25",
        (ws["id"], rel)).fetchall()
    return [{"id": r["id"], "size": r["size"], "source": r["source"], "note": r["note"],
             "created_at": r["created_at"],
             "author": ({"id": r["author_id"], "display_name": r["display_name"],
                         "avatar_emoji": r["avatar_emoji"]} if r["author_id"] else None),
             "agent": ({"id": r["agent_id"], "name": r["aname"], "icon": r["aicon"]}
                       if r["agent_id"] else None)} for r in rows]


def diff(conn, ws, rel, rev_id=None):
    """Unified diff between a stored revision and the file as it is now."""
    rel = norm_rel(rel)
    full = resolve(ws["root"], rel, must_exist=True)
    with open(full, "r", encoding="utf-8", errors="replace") as f:
        cur = f.read()
    if rev_id:
        r = conn.execute("SELECT * FROM workspace_revisions WHERE id=? AND workspace_id=? "
                         "AND path=?", (rev_id, ws["id"], rel)).fetchone()
        if not r:
            raise WorkspaceError("No such revision", 404)
        old, label = r["content"], f"rev {r['id']}"
    else:
        r = conn.execute("SELECT * FROM workspace_revisions WHERE workspace_id=? AND path=? "
                         "ORDER BY id DESC LIMIT 1", (ws["id"], rel)).fetchone()
        if not r:
            return {"path": rel, "diff": "", "empty": True}
        old, label = r["content"], f"rev {r['id']}"
    lines = list(difflib.unified_diff(
        old.splitlines(keepends=True), cur.splitlines(keepends=True),
        fromfile=f"{rel} ({label})", tofile=f"{rel} (now)", n=3))
    return {"path": rel, "diff": "".join(lines)[:200_000], "empty": not lines}


def restore(conn, ws, rel, rev_id, uid=None, agent_id=None):
    rel = norm_rel(rel)
    r = conn.execute("SELECT * FROM workspace_revisions WHERE id=? AND workspace_id=? "
                     "AND path=?", (rev_id, ws["id"], rel)).fetchone()
    if not r:
        raise WorkspaceError("No such revision", 404)
    return write_file(conn, ws, rel, r["content"], uid=uid, agent_id=agent_id,
                      source="restore", note=f"restored rev {rev_id}")


# ---------------------------------------------------------------- search

def search(conn, ws, q, limit=40):
    q = (q or "").strip()
    if len(q) < 2:
        return []
    root = ws["root"]
    needle = q.lower()
    hits, scanned = [], 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in HIDDEN_DIRS and not d.startswith(".")]
        for name in filenames:
            rel = os.path.relpath(os.path.join(dirpath, name), root).replace("\\", "/")
            if _hidden(rel) or not is_text(rel):
                continue
            scanned += 1
            if scanned > WORKSPACE_MAX_FILES:
                return hits
            try:
                if os.path.getsize(os.path.join(dirpath, name)) > WORKSPACE_MAX_BYTES:
                    continue
                with open(os.path.join(dirpath, name), "r", encoding="utf-8",
                          errors="replace") as f:
                    for i, line in enumerate(f, 1):
                        if needle in line.lower():
                            hits.append({"path": rel, "line": i,
                                         "text": line.strip()[:200]})
                            if len(hits) >= limit:
                                return hits
            except OSError:
                continue
    return hits


# ---------------------------------------------------------------- exec

def run_command(conn, ws, cmd, uid=None, agent_id=None):
    """Run a shell command inside the workspace root (admin only)."""
    if not WORKSPACE_EXEC:
        raise WorkspaceError("Command execution is disabled on this host", 403)
    cmd = (cmd or "").strip()
    if not cmd:
        raise WorkspaceError("Nothing to run", 400)
    if len(cmd) > 2000:
        raise WorkspaceError("Command too long", 400)
    shell = ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd] \
        if os.name == "nt" else ["/bin/sh", "-c", cmd]
    t0 = time.time()
    try:
        p = subprocess.run(shell, cwd=ws["root"], capture_output=True,
                           timeout=WORKSPACE_EXEC_TIMEOUT)
        out = (p.stdout or b"").decode("utf-8", "replace")
        err = (p.stderr or b"").decode("utf-8", "replace")
        code = p.returncode
    except subprocess.TimeoutExpired:
        out, err, code = "", f"timed out after {int(WORKSPACE_EXEC_TIMEOUT)}s", -1
    except Exception as e:                       # noqa: BLE001 — surface anything
        out, err, code = "", str(e), -1
    audit(conn, ws["id"], "exec", "", f"$ {cmd} → {code}",
          ok=(code == 0), actor_id=uid, agent_id=agent_id)
    return {"cmd": cmd, "code": code, "stdout": out[-8000:], "stderr": err[-4000:],
            "ms": int((time.time() - t0) * 1000)}


# ---------------------------------------------------------------- presence

def touch_session(conn, ws_id, uid, path=""):
    conn.execute(
        "INSERT INTO workspace_sessions(workspace_id, user_id, path, last_seen) "
        "VALUES (?,?,?,?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET "
        "path=excluded.path, last_seen=excluded.last_seen",
        (ws_id, uid, str(path or "")[:300], now()))


def sessions(conn, ws_id, ttl=90):
    rows = conn.execute(
        "SELECT s.user_id, s.path, s.last_seen, u.display_name, u.username, "
        "u.avatar_emoji, u.avatar_color FROM workspace_sessions s "
        "JOIN users u ON u.id=s.user_id WHERE s.workspace_id=? AND s.last_seen>? "
        "ORDER BY s.last_seen DESC", (ws_id, now() - ttl)).fetchall()
    return [{"user": {"id": r["user_id"], "display_name": r["display_name"],
                      "username": r["username"], "avatar_emoji": r["avatar_emoji"],
                      "avatar_color": r["avatar_color"]},
             "path": r["path"], "last_seen": r["last_seen"]} for r in rows]


# ---------------------------------------------------------------- serializers

def workspace_json(conn, ws, uid):
    lvl = level_of(conn, ws, uid)
    n_files = conn.execute(
        "SELECT COUNT(*) c FROM workspace_files WHERE workspace_id=?",
        (ws["id"],)).fetchone()["c"]
    last = conn.execute(
        "SELECT a.*, u.display_name, u.avatar_emoji, ag.name aname, ag.icon aicon "
        "FROM workspace_audit a LEFT JOIN users u ON u.id=a.actor_id "
        "LEFT JOIN agents ag ON ag.id=a.agent_id WHERE a.workspace_id=? "
        "ORDER BY a.id DESC LIMIT 1", (ws["id"],)).fetchone()
    grants = conn.execute(
        "SELECT g.user_id, g.level, u.username, u.display_name, u.avatar_emoji, "
        "u.avatar_color FROM workspace_grants g JOIN users u ON u.id=g.user_id "
        "WHERE g.workspace_id=? ORDER BY g.level DESC, u.username", (ws["id"],)).fetchall()
    return {
        "id": ws["id"], "server_id": ws["server_id"], "name": ws["name"],
        "icon": ws["icon"], "root": ws["root"], "description": ws["description"],
        "created_by": ws["created_by"], "created_at": ws["created_at"],
        "level": lvl, "can_read": _RANK.get(lvl, 0) >= 1,
        "can_write": _RANK.get(lvl, 0) >= 2, "can_admin": _RANK.get(lvl, 0) >= 3,
        "files": n_files,
        "chat_channel_id": (ws["chat_channel_id"]
                            if "chat_channel_id" in ws.keys() else None),
        "grants": [{"user_id": g["user_id"], "level": g["level"],
                    "username": g["username"], "display_name": g["display_name"],
                    "avatar_emoji": g["avatar_emoji"],
                    "avatar_color": g["avatar_color"]} for g in grants],
        "last": ({"action": last["action"], "path": last["path"],
                  "detail": last["detail"], "ok": bool(last["ok"]),
                  "created_at": last["created_at"],
                  "actor": last["display_name"], "agent": last["aname"],
                  "icon": last["aicon"] or last["avatar_emoji"]} if last else None),
    }


def audit_json(conn, ws_id, before=0, limit=60):
    q = ("SELECT a.*, u.display_name, u.username, u.avatar_emoji, u.avatar_color, "
         "ag.name aname, ag.icon aicon FROM workspace_audit a "
         "LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN agents ag ON ag.id=a.agent_id "
         "WHERE a.workspace_id=?")
    args = [ws_id]
    if before:
        q += " AND a.id<?"
        args.append(before)
    q += " ORDER BY a.id DESC LIMIT ?"
    args.append(limit)
    return [{"id": r["id"], "action": r["action"], "path": r["path"],
             "detail": r["detail"], "ok": bool(r["ok"]), "created_at": r["created_at"],
             "actor": ({"id": r["actor_id"], "display_name": r["display_name"],
                        "username": r["username"], "avatar_emoji": r["avatar_emoji"],
                        "avatar_color": r["avatar_color"]} if r["actor_id"] else None),
             "agent": ({"id": r["agent_id"], "name": r["aname"], "icon": r["aicon"]}
                       if r["agent_id"] else None)}
            for r in conn.execute(q, args).fetchall()]


def agent_prompt(conn, ws, uid, focus=""):
    """The system-prompt block that turns any agent into a workspace coder.

    Shared by the agent desk and by @-summons in a workspace chat channel so
    both surfaces behave identically.
    """
    lvl = level_of(conn, ws, uid)
    names = [t["function"]["name"] for t in agent_tools(conn, ws, uid)]
    lines = [
        f'You are working inside the shared workspace "{ws["name"]}" '
        f'(folder: {ws["root"]}).',
        f"Your access level is {lvl} — you can never do more than the person "
        "who summoned you.",
        "",
        "You have real filesystem tools. To call one, reply with ONLY a JSON "
        'object like {"tool": "read_file", "args": {"path": "README.md"}} — '
        "one call per reply. The result comes back and you continue.",
        "",
        "Tools available to you: " + ", ".join(names) + ".",
        "",
        "How to work:",
        "- Look before you leap: list_files / search_files / read_file first.",
        "- Prefer edit_file over write_file for small changes — it replaces one "
        "exact snippet and refuses ambiguous matches.",
        "- Keep edits minimal and in the existing style of the file.",
        "- When you are done, summarize what you changed in plain language.",
        "- If a tool returns an error, read it and adjust — don't repeat the "
        "same failing call.",
        "- Tool paths are relative to the workspace root — pass \"\" for the "
        "root itself.",
        "- Never narrate or fake tool steps — no ⚙ receipt lines, no "
        "step-by-step recaps. Emit a tool's JSON or plain answer text, nothing "
        "in between.",
    ]
    if focus:
        try:
            f = read_file(conn, ws, focus, uid=uid, record=False)
            lines += ["", f"The user currently has `{focus}` open:",
                      "```", f["content"][:6000], "```"]
        except WorkspaceError:
            pass
    return "\n".join(lines)


def agent_tools(conn, ws, uid):
    """Tool schemas handed to the LLM when an agent works inside a workspace.

    The set is the full filesystem surface the caller's level allows: read
    tools for everyone with access, write tools for `write`, and the shell for
    `admin`. Agents never get more than the human who summoned them.
    """
    lvl = level_of(conn, ws, uid)
    tools = [
        {"type": "function", "function": {
            "name": "list_files",
            "description": "List files and folders in the workspace (recursive, 2 levels). "
                           "Use '' for the root.",
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string", "description": "folder, '' for root"}}}}},
        {"type": "function", "function": {
            "name": "read_file",
            "description": "Read a text file from the workspace.",
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string"}}, "required": ["path"]}}},
        {"type": "function", "function": {
            "name": "search_files",
            "description": "Grep the workspace for a string; returns path:line hits.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"}}, "required": ["query"]}}},
        {"type": "function", "function": {
            "name": "file_info",
            "description": "Stat a path: size, mtime, whether it is text/image, who last edited it.",
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string"}}, "required": ["path"]}}},
    ]
    if _RANK.get(lvl, 0) >= 2:
        tools += [
            {"type": "function", "function": {
                "name": "write_file",
                "description": "Create or overwrite a text file with full content. "
                               "The previous version is kept as a revision.",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}, "content": {"type": "string"},
                    "note": {"type": "string", "description": "one-line summary of the change"}},
                    "required": ["path", "content"]}}},
            {"type": "function", "function": {
                "name": "edit_file",
                "description": "Replace an exact substring in a file — cheaper and safer "
                               "than rewriting the whole file. Fails if `find` is not "
                               "present exactly once.",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"},
                    "find": {"type": "string", "description": "exact text to replace"},
                    "replace": {"type": "string", "description": "replacement text"},
                    "note": {"type": "string"}},
                    "required": ["path", "find", "replace"]}}},
            {"type": "function", "function": {
                "name": "delete_file",
                "description": "Delete a file or folder from the workspace.",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}}, "required": ["path"]}}},
            {"type": "function", "function": {
                "name": "move_file",
                "description": "Move or rename a file/folder. History follows the file.",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}, "to": {"type": "string"}},
                    "required": ["path", "to"]}}},
            {"type": "function", "function": {
                "name": "make_dir",
                "description": "Create a folder (parents are created as needed).",
                "parameters": {"type": "object", "properties": {
                    "path": {"type": "string"}}, "required": ["path"]}}},
        ]
    if _RANK.get(lvl, 0) >= 3:
        tools.append({"type": "function", "function": {
            "name": "run_command",
            "description": "Run a shell command in the workspace root and return its output.",
            "parameters": {"type": "object", "properties": {
                "cmd": {"type": "string"}}, "required": ["cmd"]}}})
    return tools


def run_tool(conn, ws, uid, agent_id, name, args):
    """Execute one agent tool call. Returns a JSON-able result dict."""
    args = args or {}
    try:
        if name == "list_files":
            t = tree(conn, ws, args.get("path") or "", depth=2)
            return {"ok": True, "entries": [
                {"path": e["path"], "dir": e["dir"], "size": e["size"]}
                for e in t["entries"][:200]]}
        if name == "read_file":
            r = read_file(conn, ws, args.get("path"), uid=uid, agent_id=agent_id)
            return {"ok": True, "path": r["path"], "content": r["content"][:20000]}
        if name == "search_files":
            return {"ok": True, "hits": search(conn, ws, args.get("query"))}
        if name == "file_info":
            return {"ok": True, **file_meta(conn, ws, args.get("path"))}
        if name == "write_file":
            require(conn, ws, uid, "write")
            r = write_file(conn, ws, args.get("path"), args.get("content", ""),
                           uid=uid, agent_id=agent_id, source="agent",
                           note=args.get("note") or "agent edit")
            return {"ok": True, **r}
        if name == "edit_file":
            require(conn, ws, uid, "write")
            return {"ok": True, **edit_file(
                conn, ws, args.get("path"), args.get("find", ""),
                args.get("replace", ""), uid=uid, agent_id=agent_id,
                note=args.get("note") or "agent edit")}
        if name == "delete_file":
            require(conn, ws, uid, "write")
            return {"ok": True, **delete_path(conn, ws, args.get("path"),
                                              uid=uid, agent_id=agent_id)}
        if name == "move_file":
            require(conn, ws, uid, "write")
            return {"ok": True, **move_path(conn, ws, args.get("path"),
                                             args.get("to"), uid=uid,
                                             agent_id=agent_id)}
        if name == "make_dir":
            require(conn, ws, uid, "write")
            return {"ok": True, **mkdir(conn, ws, args.get("path"),
                                         uid=uid, agent_id=agent_id)}
        if name == "run_command":
            require(conn, ws, uid, "admin")
            return {"ok": True, **run_command(conn, ws, args.get("cmd"),
                                              uid=uid, agent_id=agent_id)}
        return {"ok": False, "error": f"unknown tool {name}"}
    except WorkspaceError as e:
        audit(conn, ws["id"], name.replace("_file", ""), args.get("path") or "",
              str(e), ok=False, actor_id=uid, agent_id=agent_id)
        return {"ok": False, "error": str(e)}
    except Exception as e:                       # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


_TOOL_NAMES = frozenset((
    "list_files", "read_file", "search_files", "file_info",
    "write_file", "edit_file", "delete_file", "move_file",
    "make_dir", "run_command",
    "web_search", "web_fetch"))


def _json_spans(text):
    """(start, end) spans of every balanced {...} / [...] region in text,
    ignoring brackets inside "..." strings."""
    spans, depth, start, instr, esc = [], 0, -1, False, False
    for i, ch in enumerate(text):
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch in "{[":
            if not depth:
                start = i
            depth += 1
        elif ch in "}]" and depth:
            depth -= 1
            if not depth:
                spans.append((start, i + 1))
    return spans


def _call_items(d, out):
    for it in (d if isinstance(d, list) else [d]):
        if not isinstance(it, dict):
            continue
        name = it.get("tool") or it.get("name") or it.get("function")
        args = it.get("args") or it.get("arguments") or it.get("parameters") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if name in _TOOL_NAMES:
            out.append({"name": name, "args": args})
    return out


def parse_tool_calls(text):
    """Pull tool calls out of a model reply — fenced ```json blocks, a reply
    that is entirely JSON, or inline {"tool":…} objects mixed into prose."""
    if not text:
        return []
    cands = re.findall(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.S)
    stripped = text.strip()
    if stripped.startswith(("{", "[")):
        cands.append(stripped)
    cands += [text[s:e] for s, e in _json_spans(text)]
    out, seen = [], set()
    for c in cands:
        try:
            d = json.loads(c)
        except Exception:
            continue
        for call in _call_items(d, []):
            key = (call["name"], json.dumps(call["args"], sort_keys=True))
            if key not in seen:
                seen.add(key)
                out.append(call)
    return out


def strip_tool_calls(text):
    """Drop inline {"tool":…} JSON blobs from a reply — they already ran, so
    showing them to humans is just noise."""
    if not text:
        return ""
    out = text
    for s, e in reversed(_json_spans(text)):
        try:
            d = json.loads(text[s:e])
        except Exception:
            continue
        if _call_items(d, []):
            out = out[:s] + out[e:]
    out = re.sub(r"[^\S\n]+\n", "\n", out)       # trailing spaces before newlines
    out = re.sub(r"\n\s*\n\s*\n+", "\n\n", out)  # collapse blank-line runs
    return out.strip()

# qa save test

# qa save test

# x

# x
