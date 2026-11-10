"""Shared serializers, lookups, and pure helpers."""
import html
import json
import re
import urllib.error
import urllib.request

from .config import ENV_LLM as _ENV_LLM
from .db import now, row_to_dict

AVATAR_COLORS = ["#4da3ff", "#3fb950", "#d29922", "#f85149", "#a371f7", "#14b8a6", "#e85d75", "#d4af37"]


AVATAR_EMOJIS = ["🐝", "🤖", "🦊", "🐙", "🦉", "🍯", "⚡", "🌙"]


def public_user(u):
    return {
        "id": u["id"], "username": u["username"], "display_name": u["display_name"],
        "avatar_color": u["avatar_color"], "avatar_emoji": u["avatar_emoji"],
        "bio": u["bio"], "status": u["status"],
        "status_text": u["status_text"] if "status_text" in u.keys() else "",
        "seen_buzz": u["seen_buzz"] if "seen_buzz" in u.keys() else 0,
        "muted": json.loads(u["muted"]) if "muted" in u.keys() and u["muted"] else [],
        "server_muted": (json.loads(u["server_muted"])
                         if "server_muted" in u.keys() and u["server_muted"] else []),
        "notify_mentions": (json.loads(u["notify_mentions"])
                            if "notify_mentions" in u.keys() and u["notify_mentions"] else []),
        "keywords": (json.loads(u["keywords"])
                     if "keywords" in u.keys() and u["keywords"] else []),
        "banner_color": u["banner_color"] if "banner_color" in u.keys() else "",
        "pronouns": u["pronouns"] if "pronouns" in u.keys() else "",
        "is_admin": bool(u["is_admin"]) if "is_admin" in u.keys() else False,
        "role": (u["role"] if "role" in u.keys() and u["role"]
                 else ("admin" if "is_admin" in u.keys() and u["is_admin"] else "user")),
        "created_at": u["created_at"] if "created_at" in u.keys() else 0,
    }


def friend_ids(conn, uid):
    rows = conn.execute(
        "SELECT CASE WHEN user_id=? THEN friend_id ELSE user_id END AS fid "
        "FROM friendships WHERE status='accepted' AND (user_id=? OR friend_id=?)",
        (uid, uid, uid),
    ).fetchall()
    return [r["fid"] for r in rows]


def can_see_agent(conn, agent, uid):
    if agent["visibility"] == "public" or agent["owner_id"] == uid:
        return True
    if agent["visibility"] == "private":
        return False
    return agent["owner_id"] in friend_ids(conn, uid)


def can_use_agent(conn, agent, uid):
    """Summon-time gate — who may @-summon/DM this agent, and when. The owner
    can always use their own agent; everyone else is bound by the owner's
    Settings → Permissions choices (use_who falls back to visibility)."""
    if agent["owner_id"] == uid:
        return True
    who = agent["use_who"] or {
        "public": "public", "friends": "friends", "private": "private",
    }.get(agent["visibility"], "friends")
    if who == "private":
        return False
    if who == "friends" and agent["owner_id"] not in friend_ids(conn, uid):
        return False
    if who == "people" and not conn.execute(
            "SELECT 1 FROM agent_allowed_users WHERE agent_id=? AND user_id=?",
            (agent["id"], uid)).fetchone():
        return False
    when = agent["use_when"] or "always"
    if when == "off":
        return False
    if when == "online":
        o = conn.execute("SELECT status FROM users WHERE id=?",
                         (agent["owner_id"],)).fetchone()
        if not o or o["status"] == "offline":
            return False
    return True


def agent_json(conn, a, uid):
    d = row_to_dict(a)
    d["owner"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (a["owner_id"],)).fetchone())
    d["stars"] = conn.execute("SELECT COUNT(*) c FROM agent_stars WHERE agent_id=?", (a["id"],)).fetchone()["c"]
    d["installs"] = conn.execute("SELECT COUNT(*) c FROM agent_installs WHERE agent_id=?", (a["id"],)).fetchone()["c"]
    d["starred"] = bool(conn.execute(
        "SELECT 1 FROM agent_stars WHERE agent_id=? AND user_id=?", (a["id"], uid)).fetchone())
    d["installed"] = bool(conn.execute(
        "SELECT 1 FROM agent_installs WHERE agent_id=? AND user_id=?", (a["id"], uid)).fetchone())
    r = conn.execute(
        "SELECT AVG(rating) avg, COUNT(*) n FROM agent_reviews WHERE agent_id=? AND rating>0",
        (a["id"],)).fetchone()
    d["rating"] = round(r["avg"], 1) if r["avg"] else None
    d["rating_count"] = r["n"]
    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
    d["summons"] = conn.execute(
        "SELECT COUNT(*) c FROM messages m JOIN users u ON u.id=m.author_id "
        "WHERE u.username=?", (f"agent:{slug}",)).fetchone()["c"]
    d["has_api_key"] = bool(d.pop("api_key", None))
    d["has_api_headers"] = bool(d.pop("api_headers", None))
    d["has_context_headers"] = bool(d.pop("context_headers", None))
    d["api_kind"] = d.get("api_kind") or ""
    d["api_url"] = d.get("api_url") or ""
    d["context_method"] = d.get("context_method") or "GET"
    d["connected"] = bool(d["api_url"] or d.get("context_url"))
    d["use_who"] = d.get("use_who") or ""
    d["use_when"] = d.get("use_when") or "always"
    try:
        d["ai"] = json.loads(d.pop("ai_flags", None) or "{}")
    except Exception:
        d["ai"] = {}
    d["allowed_user_ids"] = [
        r["user_id"] for r in conn.execute(
            "SELECT user_id FROM agent_allowed_users WHERE agent_id=?",
            (a["id"],)).fetchall()] if a["owner_id"] == uid else []
    return d


def channel_member_ids(conn, ch):
    if ch["server_id"]:
        ids = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM server_members WHERE server_id=?", (ch["server_id"],)).fetchall()]
        rid = ch["role_id"] if "role_id" in ch.keys() else None
        if rid:
            have = {r["user_id"] for r in conn.execute(
                "SELECT user_id FROM member_roles WHERE server_id=? AND role_id=?",
                (ch["server_id"], rid)).fetchall()}
            owner = conn.execute("SELECT owner_id FROM servers WHERE id=?",
                                 (ch["server_id"],)).fetchone()
            if owner:
                have.add(owner["owner_id"])
            have |= {r["user_id"] for r in conn.execute(
                "SELECT user_id FROM channel_members WHERE channel_id=?",
                (ch["id"],)).fetchall()}          # knock-approved members
            ids = [u for u in ids if u in have]
        return ids
    return [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM channel_members WHERE channel_id=?", (ch["id"],)).fetchall()]


def reactions_json(conn, mid, uid):
    rows = conn.execute(
        "SELECT r.emoji, r.user_id, u.display_name FROM message_reactions r "
        "JOIN users u ON u.id=r.user_id WHERE r.message_id=? ORDER BY r.created_at",
        (mid,)).fetchall()
    grouped = {}
    for r in rows:
        g = grouped.setdefault(r["emoji"], {"emoji": r["emoji"], "count": 0, "mine": False, "users": []})
        g["count"] += 1
        g["users"].append(r["display_name"])
        if r["user_id"] == uid:
            g["mine"] = True
    return list(grouped.values())


def pack_agent_ids(conn, pid, uid):
    """Agent ids in a pack that viewer `uid` can actually see."""
    rows = conn.execute(
        "SELECT agent_id FROM pack_items WHERE pack_id=? ORDER BY position, agent_id", (pid,)).fetchall()
    out = []
    for r in rows:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (r["agent_id"],)).fetchone()
        if a and can_see_agent(conn, a, uid):
            out.append(a)
    return out


def can_see_pack(conn, p, uid):
    return p["owner_id"] == uid or p["owner_id"] in friend_ids(conn, uid)


def channel_json(conn, ch, uid=None):
    d = dict(ch)
    try:
        roster = json.loads(d.get("roster") or "[]")
    except Exception:
        roster = []
    out = []
    for aid in roster:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if a and (uid is None or can_see_agent(conn, a, uid)):
            out.append({"id": a["id"], "name": a["name"], "icon": a["icon"],
                        "owner_id": a["owner_id"]})
    d["roster"] = out
    try:
        lurk = json.loads(d.get("lurkers") or "[]")
    except Exception:
        lurk = []
    d["lurkers"] = []
    for aid in lurk:
        la = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
        if la and (uid is None or can_see_agent(conn, la, uid)):
            d["lurkers"].append(aid)
    try:
        d["forum_tags"] = json.loads(d.get("forum_tags") or "[]")
    except Exception:
        d["forum_tags"] = []
    try:
        d["ai"] = json.loads(d.get("ai_flags") or "{}")
    except Exception:
        d["ai"] = {}
    d.pop("ai_flags", None)
    wid = d.get("workspace_id")
    if wid:
        w = conn.execute("SELECT id, name, icon FROM workspaces WHERE id=?", (wid,)).fetchone()
        d["workspace"] = {"id": w["id"], "name": w["name"], "icon": w["icon"]} if w else None
    else:
        d["workspace"] = None
    d["locked"] = bool(d.get("role_id")) and uid is not None and \
        uid not in channel_member_ids(conn, ch)
    if d["locked"]:
        d["knocked"] = bool(conn.execute(
            "SELECT 1 FROM channel_knocks WHERE channel_id=? AND user_id=?",
            (d["id"], uid)).fetchone())
    dj = conn.execute(
        "SELECT d.*, a.name aname, a.icon aicon FROM digest_jobs d "
        "LEFT JOIN agents a ON a.id=d.agent_id WHERE d.channel_id=?",
        (d["id"],)).fetchone()
    if dj:
        d["digest"] = {"agent_id": dj["agent_id"], "interval_secs": dj["interval_secs"],
                       "last_run": dj["last_run"],
                       "agent_name": dj["aname"], "agent_icon": dj["aicon"]}
    return d


def pack_json(conn, p, uid):
    d = dict(p)
    d["owner"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (p["owner_id"],)).fetchone())
    agents = pack_agent_ids(conn, p["id"], uid)
    d["count"] = len(agents)
    d["icons"] = [a["icon"] for a in agents[:5]]
    return d


def message_json(conn, m, viewer_id=None):
    d = row_to_dict(m)
    d["author"] = public_user(conn.execute("SELECT * FROM users WHERE id=?", (m["author_id"],)).fetchone())
    if "webhook_id" in m.keys() and m["webhook_id"]:
        h = conn.execute("SELECT name FROM channel_hooks WHERE id=?",
                         (m["webhook_id"],)).fetchone()
        d["hook"] = h["name"] if h else "webhook"
        if "author_name" in m.keys() and m["author_name"]:
            d["author"]["display_name"] = m["author_name"]
    if m["agent_id"]:
        a = conn.execute("SELECT * FROM agents WHERE id=?", (m["agent_id"],)).fetchone()
        d["agent"] = agent_json(conn, a, viewer_id or m["author_id"]) if a else None
    if m["pack_id"]:
        p = conn.execute("SELECT * FROM agent_packs WHERE id=?", (m["pack_id"],)).fetchone()
        d["pack"] = pack_json(conn, p, viewer_id or m["author_id"]) if p else None
    d["thread_count"] = conn.execute(
        "SELECT COUNT(*) c FROM messages WHERE thread_root=?", (m["id"],)).fetchone()["c"]
    if d["thread_count"]:
        lr = conn.execute(
            "SELECT * FROM messages WHERE thread_root=? ORDER BY id DESC LIMIT 1",
            (m["id"],)).fetchone()
        d["last_reply"] = {"id": lr["id"], "created_at": lr["created_at"],
                           "content": (lr["content"] or "")[:80],
                           "author": public_user(conn.execute(
                               "SELECT * FROM users WHERE id=?",
                               (lr["author_id"],)).fetchone())}
    if m["reply_to"]:
        r = conn.execute("SELECT * FROM messages WHERE id=?", (m["reply_to"],)).fetchone()
        if r:
            d["reply"] = {"id": r["id"], "content": r["content"][:140],
                          "author": public_user(conn.execute(
                              "SELECT * FROM users WHERE id=?", (r["author_id"],)).fetchone())}
        else:
            d["reply"] = {"id": m["reply_to"], "content": "", "author": None}
    d["reactions"] = reactions_json(conn, m["id"], viewer_id or m["author_id"])
    if "fwd_of" in m.keys() and m["fwd_of"]:
        o = conn.execute("SELECT * FROM messages WHERE id=?", (m["fwd_of"],)).fetchone()
        if o:
            oc = conn.execute("SELECT * FROM channels WHERE id=?", (o["channel_id"],)).fetchone()
            ou = conn.execute("SELECT * FROM users WHERE id=?", (o["author_id"],)).fetchone()
            d["fwd"] = {"msg_id": o["id"], "channel_id": o["channel_id"],
                        "channel": oc["name"] if oc else "?",
                        "server_id": oc["server_id"] if oc else None,
                        "dm": oc["kind"] == "dm" if oc else False,
                        "author": public_user(ou) if ou else None}
        else:
            d["fwd"] = {"msg_id": m["fwd_of"], "channel": "deleted", "author": None}
    if m["embed"]:
        try:
            d["embed"] = json.loads(m["embed"])
        except Exception:
            d["embed"] = None
    if "poll" in m.keys() and m["poll"]:
        try:
            d["poll"] = json.loads(m["poll"])
        except Exception:
            d["poll"] = None
    if "tags" in m.keys():
        try:
            d["tags"] = json.loads(m["tags"] or "[]")
        except Exception:
            d["tags"] = []
    return d


def _meta_content(html, key):
    """content= value of the <meta> tag whose property/name matches `key`."""
    for tag in re.findall(r"<meta\s[^>]*>", html, re.I):
        if re.search(r'(?:property|name)=["\']%s["\']' % re.escape(key), tag, re.I):
            c = re.search(r'content=["\']([^"\']*)["\']', tag, re.I)
            if c:
                return c.group(1).strip()
    return None


def unfurl(url):
    """Fetch title/description for a public http(s) URL. SSRF-guarded."""
    import html as htmlmod
    import socket
    import urllib.request
    from urllib.parse import urlparse
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            return None
        host = p.hostname.lower().rstrip(".")
        if host == "localhost" or host.endswith((".local", ".internal")):
            return None
        ip = socket.gethostbyname(host)
        o = ip.split(".")
        if ip == "::1" or len(o) == 4 and (
                o[0] in ("127", "10", "0") or
                o[0] == "192" and o[1] == "168" or
                o[0] == "169" and o[1] == "254" or
                o[0] == "172" and 16 <= int(o[1]) <= 31):
            return None
        req = urllib.request.Request(url, headers={"User-Agent": "SignalTeams/1.0 (+unfurl)"})
        with urllib.request.urlopen(req, timeout=5) as r:
            if "html" not in (r.headers.get("content-type") or ""):
                return None
            raw = r.read(300_000).decode("utf-8", "replace")
        title = (_meta_content(raw, "og:title") or
                 (re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S) or [None, ""])[1].strip())
        if not title:
            return None
        clean = lambda s: htmlmod.unescape(re.sub(r"\s+", " ", s or "")).strip()
        return {"url": url[:500], "title": clean(title)[:200],
                "desc": clean(_meta_content(raw, "og:description") or
                              _meta_content(raw, "description") or "")[:300],
                "site": clean(_meta_content(raw, "og:site_name") or "")[:80],
                "image": _meta_content(raw, "og:image")}
    except Exception:
        return None


URL_RE = re.compile(r"https?://[^\s<>'\"]+")


def is_blocked(conn, a: int, b: int):
    """True if either user has the other blocked."""
    return bool(conn.execute(
        "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
        (a, b, b, a)).fetchone())


AUDIT_KEEP = 500        # per-server cap — oldest rows roll off


def audit(conn, sid, actor_id, action, target="", detail=""):
    """One audit-log row; prunes the tail so the table stays bounded."""
    conn.execute(
        "INSERT INTO audit_log(server_id, actor_id, action, target, detail, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (sid, actor_id, action, str(target or "")[:120], str(detail or "")[:300], now()))
    conn.execute(
        "DELETE FROM audit_log WHERE server_id=? AND id NOT IN "
        "(SELECT id FROM audit_log WHERE server_id=? ORDER BY id DESC LIMIT ?)",
        (sid, sid, AUDIT_KEEP))


def agent_bot_user(conn, a):
    """Get-or-create the synthetic chat user that posts as this agent."""
    slug = re.sub(r"[^a-z0-9]+", "", a["name"].lower())[:24] or f"a{a['id']}"
    uname = f"agent:{slug}"
    u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    if not u:
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, avatar_color, "
            "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uname, a["name"], "!", "#d4af37", a["icon"] or "🤖",
             (a["tagline"] or "")[:160], "bot", now()))
        u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    else:
        conn.execute(
            "UPDATE users SET display_name=?, avatar_emoji=?, bio=? WHERE id=?",
            (a["name"], a["icon"] or "🤖", (a["tagline"] or "")[:160], u["id"]))
        u = conn.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    return u


STAR_EMOJI = "⭐"


def hook_bot_user(conn, hook):
    """Get-or-create the synthetic chat user a webhook posts as (hook:<id>)."""
    uname = f"hook:{hook['id']}"
    u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    if not u:
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, avatar_color, "
            "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uname, hook["name"], "!", "#8b949e", hook["icon"] or "🪝",
             "Incoming webhook — external services post through it.", "bot", now()))
        u = conn.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    else:
        conn.execute(
            "UPDATE users SET display_name=?, avatar_emoji=? WHERE id=?",
            (hook["name"], hook["icon"] or "🪝", u["id"]))
        u = conn.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    return u


def starboard_bot_user(conn):
    """Get-or-create the synthetic user that authors starboard reposts."""
    u = conn.execute("SELECT * FROM users WHERE username='bot:starboard'").fetchone()
    if not u:
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, avatar_color, "
            "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
            ("bot:starboard", "Starboard", "!", "#d4af37", "⭐",
             "Reposts messages the crew starred.", "bot", now()))
        u = conn.execute("SELECT * FROM users WHERE username='bot:starboard'").fetchone()
    return u


def _gated_channel(conn, cid):
    ch = conn.execute("SELECT * FROM channels WHERE id=? AND role_id IS NOT NULL",
                      (cid,)).fetchone()
    return ch


def _fmt_due(secs: int) -> str:
    for unit, div in (("d", 86400), ("h", 3600), ("m", 60)):
        if secs % div == 0 and secs >= div:
            return f"{secs // div}{unit}"
    return f"{secs}s"


_SEARCH_KEYS = ("from", "in", "has", "mentions", "pinned", "is",
                "before", "after", "during")


def _day_ts(s: str):
    """Parse YYYY-MM-DD into an epoch float, or None."""
    try:
        y, m, d = (int(x) for x in s.split("-"))
        import datetime as _dt
        return _dt.datetime(y, m, d).timestamp()
    except Exception:
        return None


def _parse_search(q: str, user):
    """Pull Discord-style filters out of a search query.
    Returns (free_text, where_clauses, params) — clauses AND onto m.*."""
    clauses, params, found = [], [], []
    def repl(mo):
        key, val = mo.group(1).lower(), mo.group(3) or mo.group(2) or ""
        found.append((key, val))
        return " "
    free = re.sub(
        r"(?<!\S)(\w+):(?:\"([^\"]*)\"|(\S+))",
        lambda mo: repl(mo) if mo.group(1).lower() in _SEARCH_KEYS else mo.group(0),
        q).strip()
    for key, val in found:
        v = val.strip()
        if not v:
            continue
        if key == "from":
            if v.lower() == "me":
                clauses.append("m.author_id=?"); params.append(user["id"])
            else:
                clauses.append(
                    "m.author_id IN (SELECT id FROM users WHERE username=? COLLATE NOCASE "
                    "OR display_name=? COLLATE NOCASE)")
                params += [v.lstrip("@"), v.lstrip("@")]
        elif key == "in":
            clauses.append(
                "m.channel_id IN (SELECT id FROM channels WHERE name=? COLLATE NOCASE)")
            params.append(v.lstrip("#"))
        elif key == "mentions":
            if v.lower() == "me":
                clauses.append("m.content LIKE ?"); params.append(f"%@{user['username']}%")
            else:
                clauses.append("m.content LIKE ?"); params.append(f"%@{v.lstrip('@')}%")
        elif key == "has":
            kind = v.lower()
            if kind == "link":
                clauses.append("m.content LIKE '%http%'")
            elif kind in ("attachment", "file"):
                clauses.append("m.attachments IS NOT NULL AND m.attachments != '[]'")
            elif kind == "image":
                clauses.append(
                    "(m.attachments LIKE '%.png%' OR m.attachments LIKE '%.jpg%' "
                    "OR m.attachments LIKE '%.jpeg%' OR m.attachments LIKE '%.gif%' "
                    "OR m.attachments LIKE '%.webp%')")
            elif kind == "embed":
                clauses.append("m.embed IS NOT NULL")
            elif kind == "poll":
                clauses.append("m.poll IS NOT NULL")
            elif kind == "reaction":
                clauses.append(
                    "EXISTS (SELECT 1 FROM message_reactions r WHERE r.message_id=m.id)")
        elif key == "is":
            if v.lower() == "pinned":
                clauses.append("m.pinned=1")
        elif key == "pinned":
            if v.lower() in ("true", "yes", "1"):
                clauses.append("m.pinned=1")
            elif v.lower() in ("false", "no", "0"):
                clauses.append("(m.pinned IS NULL OR m.pinned=0)")
        elif key in ("before", "after", "during"):
            ts = _day_ts(v)
            if ts is not None:
                if key == "before":
                    clauses.append("m.created_at<?"); params.append(ts)
                elif key == "after":
                    clauses.append("m.created_at>=?"); params.append(ts + 86400)
                else:
                    clauses.append("m.created_at>=? AND m.created_at<?")
                    params += [ts, ts + 86400]
    if len(free) >= 2:
        clauses.append("(m.content LIKE ? OR m.title LIKE ?)")
        params += [f"%{free}%", f"%{free}%"]
    return free, clauses, params, len(found)


_PLACEHOLDER_MODELS = {
    "", "any", "default", "local-llm", "local-model", "local-embeddings", "crew-model"
}


def _split_model(spec):
    """'ollama:llama3' → ('ollama', 'llama3'); bare names → (None, name).
    Seed/placeholder model tags ('any', 'local-llm', 'local-embeddings', etc.) map to (None, None)."""
    s = (spec or "").strip()
    if s.lower() in _PLACEHOLDER_MODELS:
        return None, None
    if ":" in s:
        p, m = s.split(":", 1)
        if p in ("ollama", "lmstudio", "custom") and m:
            return p, (None if m.lower() in _PLACEHOLDER_MODELS else m)
    return None, s


JOIN_GREETINGS = [
    "joined the server.",
    "hopped into the server.",
    "just showed up. Everyone look busy!",
    "joined the party.",
    "is here. Welcome!",
    "slid into the server.",
    "spawned in the server.",
    "just landed. We hope you brought pizza.",
    "arrived. Say hello!",
]


def _sys_post(conn, sid, uid, kind):
    """Insert a join/leave system message into the server's first text channel.
    Returns (channel_id, member_ids, message_json) for the caller to broadcast."""
    import random
    ch = conn.execute(
        "SELECT * FROM channels WHERE server_id=? AND kind IN ('text','forum') "
        "ORDER BY position, id LIMIT 1", (sid,)).fetchone()
    if not ch:
        return None
    content = random.choice(JOIN_GREETINGS) if kind == "join" else "left the server."
    cur = conn.execute(
        "INSERT INTO messages(channel_id, author_id, content, system, created_at) "
        "VALUES (?,?,?,?,?)", (ch["id"], uid, content, kind, now()))
    m = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    return ch["id"], channel_member_ids(conn, ch), message_json(conn, m, uid)


def _pub_server(d):
    """Strip secrets from a serialized server — llm_key is write-only."""
    if isinstance(d, dict) and "llm_key" in d:
        d["has_llm_key"] = bool(d.pop("llm_key"))
    if isinstance(d, dict) and "automod" in d:
        try:
            d["automod"] = json.loads(d["automod"] or "{}")
        except Exception:
            d["automod"] = {}
    return d


_AUTOMOD_KEYS = {"words", "block_links", "link_allow", "caps_min_len",
                 "caps_pct", "max_mentions"}


def _clean_automod(cfg):
    """Normalize an automod rule blob — unknown keys dropped, sizes clamped."""
    if not isinstance(cfg, dict):
        return {}
    out = {}
    if cfg.get("words"):
        out["words"] = [str(w).strip()[:60] for w in cfg["words"][:100]
                        if str(w).strip()]
    if cfg.get("block_links"):
        out["block_links"] = True
        out["link_allow"] = [
            re.sub(r"^https?://", "", str(d).strip().lower()).split("/")[0][:80]
            for d in (cfg.get("link_allow") or [])[:50] if str(d).strip()]
    if cfg.get("caps_min_len"):
        out["caps_min_len"] = max(4, min(int(cfg["caps_min_len"]), 500))
        out["caps_pct"] = max(50, min(int(cfg.get("caps_pct") or 70), 100))
    if cfg.get("max_mentions"):
        out["max_mentions"] = max(1, min(int(cfg["max_mentions"]), 25))
    return {k: v for k, v in out.items() if k in _AUTOMOD_KEYS}


def _automod_check(content, cfg):
    """Return a block reason if content violates server automod rules, else None."""
    if not cfg:
        return None
    low = (content or "").lower()
    if any(w.lower() in low for w in cfg.get("words") or []):
        return "contains a blocked word"
    if cfg.get("block_links"):
        allow = [d.lower() for d in cfg.get("link_allow") or []]
        for u in URL_RE.findall(content):
            host = re.sub(r"^www\.", "",
                          (u.split("/", 3)[2] if "//" in u else u.split("/")[0])
                          .split(":")[0].lower())
            if not any(host == d or host.endswith("." + d) for d in allow):
                return "links aren't allowed in this server"
    msl = int(cfg.get("caps_min_len") or 0)
    if msl and len(content) >= msl:
        alpha = [c for c in content if c.isalpha()]
        if alpha and 100 * sum(c.isupper() for c in alpha) / len(alpha) \
                >= int(cfg.get("caps_pct") or 70):
            return "too much shouting — turn caps lock down"
    mx = int(cfg.get("max_mentions") or 0)
    if mx and len(re.findall(r"@\w+", content or "")) > mx:
        return f"too many mentions (max {mx})"
    return None


def _grounding(url, method="GET", message="", headers=None):
    """Fetch an agent's live-context URL — GET reads data, POST sends the
    prompt and reads the response (any HTTP service becomes an agent tool).
    Supports custom request headers (JSON). Best-effort, 6s timeout, 2KB cap."""
    import urllib.request as _u
    try:
        extra = {}
        if headers:
            extra = {str(k): str(v) for k, v in (json.loads(headers) if isinstance(headers, str) else headers).items()}
        if (method or "GET").upper() == "POST":
            req = _u.Request(url, data=json.dumps(
                {"prompt": message}).encode(),
                headers={"User-Agent": "SignalTeams-agent/1.0",
                         "Content-Type": "application/json", **extra}, method="POST")
        else:
            req = _u.Request(url, headers={"User-Agent": "SignalTeams-agent/1.0", **extra})
        with _u.urlopen(req, timeout=6) as r:
            body = r.read(4000)
            return body.decode("utf-8", "replace")[:2000]
    except Exception:
        return ""


def _agent_llm(a):
    """Agent's own dedicated API connection — overrides server/user default when configured."""
    if not a:
        return None
    keys = a.keys() if hasattr(a, "keys") else a
    url = ((a["api_url"] if "api_url" in keys else "") or "").strip().rstrip("/")
    if not url:
        return None
    kind = ((a["api_kind"] if "api_kind" in keys else "") or "openai").strip() or "openai"
    mdl = ((a["model"] if "model" in keys else "") or "").strip()
    if mdl.lower() in _PLACEHOLDER_MODELS:
        mdl = ""
    return {
        "url": url,
        "key": (a["api_key"] if "api_key" in keys else "") or "",
        "model": mdl,
        "kind": kind,
        "headers": (a["api_headers"] if "api_headers" in keys else None),
        "label": f"agent:{kind}",
        "source": "agent",
    }


def _sysprompt(a, ctx=""):
    base = a["system_prompt"] or \
        f"You are {a['name']}, a helpful AI agent. {a['tagline']}"
    if ctx:
        base += f"\n\nLive context (fetched from your grounding URL):\n{ctx}"
    return base


def _memories(conn, uid, who=""):
    """Personal-context memory — lines the user asked the assistant to keep.
    Injected into agent prompts so 'remember I take coffee black' sticks."""
    try:
        r = conn.execute("SELECT value FROM kv WHERE key=?",
                         (f"mem:{uid}",)).fetchone()
        items = json.loads(r["value"]) if r and r["value"] else []
    except Exception:
        items = []
    if not items:
        return ""
    return ("\n\nThings " + (who or "the user") +
            " asked you to remember — honor these in every reply: " +
            " • ".join(str(i.get("t", ""))[:120]
                       for i in items[-20:] if i.get("t")))


def _server_llm(conn, sid):
    """Server's shared LLM endpoint — owner's pick for the whole crew."""
    if not sid:
        return None
    r = conn.execute(
        "SELECT llm_url, llm_key, llm_model, llm_kind FROM servers WHERE id=?",
        (sid,)).fetchone()
    if not r or not (r["llm_url"] or "").strip():
        return None
    mdl = (r["llm_model"] or "").strip()
    if mdl.lower() in _PLACEHOLDER_MODELS:
        mdl = ""
    kind = (r["llm_kind"] or "openai").strip() or "openai"
    return {"url": r["llm_url"].strip().rstrip("/"), "key": r["llm_key"] or "",
            "model": mdl, "kind": kind, "label": f"server:{kind}", "source": "server"}


def _user_llm(conn, uid):
    """User's custom LLM endpoint — theirs first, host's env endpoint as the
    crew-wide fallback (any OpenAI-compatible API or webhook)."""
    r = conn.execute(
        "SELECT llm_url, llm_key, llm_model, llm_kind, llm_headers FROM users WHERE id=?",
        (uid,)).fetchone()
    if not r or not (r["llm_url"] or "").strip():
        return _ENV_LLM
    mdl = (r["llm_model"] or "").strip()
    if mdl.lower() in _PLACEHOLDER_MODELS:
        mdl = ""
    kind = (r["llm_kind"] or "openai").strip() or "openai"
    url = r["llm_url"].strip().rstrip("/")
    key = r["llm_key"] or ""
    # Short-lived session tokens (Copilot ~30min): re-exchange the stored
    # refresh material so a promoted connection keeps driving chat.
    if "githubcopilot.com" in url:
        try:
            from .connections import fresh
            cr = conn.execute(
                "SELECT * FROM user_connections WHERE user_id=? AND provider='copilot'",
                (uid,)).fetchone()
            if cr and cr["refresher"]:
                new = fresh(conn, cr)
                if new and new["api_key"] != key:
                    key = new["api_key"] or ""
                    conn.execute("UPDATE users SET llm_key=? WHERE id=?", (key, uid))
        except Exception:
            pass
    return {"url": url, "key": key,
            "model": mdl, "kind": kind, "headers": r["llm_headers"],
            "label": f"user:{kind}", "source": "user"}