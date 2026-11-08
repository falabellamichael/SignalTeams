"""Async background services: bot posts, starboard, agent replies, reminders."""
import asyncio
import json
import queue
import re
import threading
import time

from .config import WORKSPACE_AGENT_TOOLS
from .db import db, emit_buzz, now
from .hub import hub

from .helpers import STAR_EMOJI, _agent_llm, _grounding, _server_llm, _split_model, _sysprompt, _user_llm, agent_bot_user, can_see_agent, channel_member_ids, friend_ids, message_json, starboard_bot_user
from . import workspace as wsx


async def _server_changed(conn, sid):
    members = [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM server_members WHERE server_id=?", (sid,)).fetchall()]
    await hub.send_many(members, {"type": "server_changed", "server_id": sid})


_agent_cool = {}
_reply_cancel = set()      # (cid, bot_user_id) — in-flight replies a member stopped


async def starboard_check(mid: int):
    """After a ⭐ reaction toggles, maintain the server's #starboard repost:
    create at threshold, live-update the count, delete at zero."""
    sends = []
    server_changed = None
    try:
        with db() as conn:
            m = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            if not m:
                return
            ch = conn.execute("SELECT * FROM channels WHERE id=?",
                              (m["channel_id"],)).fetchone()
            if not ch or not ch["server_id"]:
                return                                     # no starboard in DMs
            s = conn.execute("SELECT * FROM servers WHERE id=?",
                             (ch["server_id"],)).fetchone()
            thresh = s["star_threshold"] or 0
            if not thresh or ch["id"] == s["starboard_cid"]:
                return                                     # disabled, or board posts don't re-board
            stars = conn.execute(
                "SELECT COUNT(*) c FROM message_reactions WHERE message_id=? AND emoji=?",
                (mid, STAR_EMOJI)).fetchone()["c"]
            row = conn.execute(
                "SELECT * FROM starboard_posts WHERE src_msg_id=?", (mid,)).fetchone()
            bcid = s["starboard_cid"]
            bch = bcid and conn.execute(
                "SELECT * FROM channels WHERE id=?", (bcid,)).fetchone()
            members = channel_member_ids(conn, bch) if bch else []
            if stars >= thresh and not row:
                if not bch:                                # find-or-create the board channel
                    cur = conn.execute(
                        "INSERT INTO channels(server_id, kind, name, topic, position, created_at) "
                        "VALUES (?,?,?,?,?,?)",
                        (s["id"], "text", "starboard",
                         f"⭐ hall of fame — {thresh}+ stars land here", 90, now()))
                    bcid = cur.lastrowid
                    conn.execute("UPDATE servers SET starboard_cid=? WHERE id=?",
                                 (bcid, s["id"]))
                    bch = conn.execute("SELECT * FROM channels WHERE id=?", (bcid,)).fetchone()
                    members = channel_member_ids(conn, bch)
                    server_changed = s["id"]
                bot = starboard_bot_user(conn)
                cur = conn.execute(
                    "INSERT INTO messages(channel_id, author_id, content, fwd_of, created_at) "
                    "VALUES (?,?,?,?,?)",
                    (bcid, bot["id"], f"{STAR_EMOJI} **{stars}**", mid, now()))
                conn.execute(
                    "INSERT INTO starboard_posts(src_msg_id, board_msg_id, stars) "
                    "VALUES (?,?,?)", (mid, cur.lastrowid, stars))
                bm = conn.execute("SELECT * FROM messages WHERE id=?",
                                  (cur.lastrowid,)).fetchone()
                sends.append((members, {"type": "message", "channel_id": bcid,
                                        "message": message_json(conn, bm, bot["id"])}))
            elif row and stars == 0:
                conn.execute("DELETE FROM starboard_posts WHERE src_msg_id=?", (mid,))
                conn.execute("DELETE FROM messages WHERE id=?", (row["board_msg_id"],))
                sends.append((members, {"type": "message_deleted", "channel_id": bcid,
                                        "id": row["board_msg_id"]}))
            elif row and stars != row["stars"]:
                conn.execute("UPDATE starboard_posts SET stars=? WHERE src_msg_id=?", (stars, mid))
                conn.execute("UPDATE messages SET content=? WHERE id=?",
                             (f"{STAR_EMOJI} **{stars}**", row["board_msg_id"]))
                bm = conn.execute("SELECT * FROM messages WHERE id=?",
                                  (row["board_msg_id"],)).fetchone()
                sends.append((members, {"type": "message_updated", "channel_id": bcid,
                                        "message": message_json(conn, bm, bm["author_id"])}))
    except Exception:
        return
    for members, payload in sends:
        await hub.send_many(members, payload)
    if server_changed:
        with db() as conn:
            await _server_changed(conn, server_changed)


async def bot_post(cid: int, bot_key: str, bot_name: str, bot_emoji: str,
                   content: str, ping_uid: int | None = None):
    """Post a message as a synthetic bot user, broadcast it, and optionally
    route a real mention ping (inbox/buzz/badge) to ping_uid."""
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            return None
        u = conn.execute("SELECT * FROM users WHERE username=?", (bot_key,)).fetchone()
        if not u:
            conn.execute(
                "INSERT INTO users(username, display_name, password_hash, avatar_color, "
                "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (bot_key, bot_name, "!", "#d4af37", bot_emoji,
                 "A SignalTeams helper bot.", "bot", now()))
            u = conn.execute("SELECT * FROM users WHERE username=?", (bot_key,)).fetchone()
        cur = conn.execute(
            "INSERT INTO messages(channel_id, author_id, content, created_at) "
            "VALUES (?,?,?,?)", (cid, u["id"], content, now()))
        m = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
        members = channel_member_ids(conn, ch)
        mentions = []
        if ping_uid and ping_uid in members:
            mentions = [ping_uid]
            emit_buzz(conn, u["id"], "mentioned", {
                "to": ping_uid, "channel_id": cid, "server_id": ch["server_id"],
                "channel": ch["name"], "msg_id": m["id"], "excerpt": content[:100]})
        payload = {"type": "message", "channel_id": cid,
                   "message": message_json(conn, m, u["id"]), "mentions": mentions}
    await hub.send_many(members, payload)
    for uid in mentions:
        await hub.send_many([uid], {"type": "buzz"})
    return m["id"]


SCRIBE_BOT = ("bot:scribe", "Scribe", "📝")


async def _summarize_task(cid: int, asker_id: int, count: int):
    from .llm import chat as llm_chat
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        asker = conn.execute("SELECT * FROM users WHERE id=?", (asker_id,)).fetchone()
        rows = conn.execute(
            "SELECT m.content, u.display_name dn, u.username un FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE m.channel_id=? "
            "AND m.thread_root IS NULL ORDER BY m.id DESC LIMIT ?",
            (cid, count)).fetchall()
        bot_u = conn.execute(
            "SELECT * FROM users WHERE username=?", (SCRIBE_BOT[0],)).fetchone()
        if not bot_u:
            conn.execute(
                "INSERT INTO users(username, display_name, password_hash, avatar_color, "
                "avatar_emoji, bio, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (SCRIBE_BOT[0], SCRIBE_BOT[1], "!", "#d4af37", SCRIBE_BOT[2],
                 "Recaps conversations on request.", "bot", now()))
            bot_u = conn.execute(
                "SELECT * FROM users WHERE username=?", (SCRIBE_BOT[0],)).fetchone()
        members = channel_member_ids(conn, ch)
        scribe_ep = ((_server_llm(conn, ch["server_id"]) if ch and ch["server_id"] else None)
                     or _user_llm(conn, asker_id))
    if not ch or not asker:
        return
    history = [{"role": "user", "content": f"{r['dn'] or r['un']}: {r['content']}"}
               for r in reversed(rows)
               if not (r["un"] or "").startswith("bot:")]
    if len(history) < 3:
        await bot_post(cid, *SCRIBE_BOT,
                       f"@{asker['username']} 📝 not enough here to recap — "
                       "make some conversation first.", ping_uid=asker_id)
        return
    typing = {"type": "typing", "channel_id": cid,
              "user": {"id": bot_u["id"], "display_name": SCRIBE_BOT[1], "bot": True}}
    await hub.send_many(members, {**typing, "on": True})
    try:
        summary, _prov, _model = await asyncio.to_thread(
            llm_chat,
            "You are Scribe, a chat recapper. Summarize the conversation into "
            "3-6 tight bullets: decisions, plans, who's doing what, open "
            "questions. Be terse, specific, and keep names.",
            history[:-1],
            f"Summarize these {len(history)} messages from #{ch['name']}.",
            endpoint=scribe_ep)
    except Exception:
        summary = "my brain's offline — no local LLM reachable right now"
    finally:
        await hub.send_many(members, {**typing, "on": False})
    await bot_post(
        cid, *SCRIBE_BOT,
        f"@{asker['username']} 📝 **recap — last {len(history)} messages**\n{summary[:3000]}",
        ping_uid=asker_id)


REMIND_BOT = ("bot:reminders", "Reminders", "⏰")

DIGEST_BOT = ("bot:digest", "Digest", "📅")


def _fmt_span(secs: int) -> str:
    if secs < 3600:
        return f"{max(1, secs // 60)}-minute"
    if secs == 3600:
        return "hourly"
    if secs == 86400:
        return "daily"
    if secs == 604800:
        return "weekly"
    if secs % 3600 == 0:
        return f"{secs // 3600}-hour"
    return f"{secs // 60}-minute"


async def _run_digest(job):
    """Fire one scheduled digest: recap the interval's messages as the agent."""
    from .llm import chat as llm_chat
    cid, since = job["channel_id"], job["last_run"]
    with db() as conn:
        ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
        if not ch:
            return
        rows = conn.execute(
            "SELECT m.content, u.display_name dn, u.username un FROM messages m "
            "JOIN users u ON u.id=m.author_id WHERE m.channel_id=? "
            "AND m.created_at>? AND m.thread_root IS NULL ORDER BY m.id LIMIT 60",
            (cid, since)).fetchall()
        a = conn.execute("SELECT * FROM agents WHERE id=?",
                         (job["agent_id"],)).fetchone() if job["agent_id"] else None
        bot = agent_bot_user(conn, a) if a else None
        ep = (_agent_llm(a) if a else None) \
            or (_server_llm(conn, ch["server_id"]) if ch["server_id"] else None) \
            or _user_llm(conn, job["created_by"])
    history = [{"role": "user", "content": f"{r['dn'] or r['un']}: {r['content']}"}
               for r in rows
               if not (r["un"] or "").startswith(("bot:", "agent:", "hook:"))]
    if len(history) < 4:
        return  # quiet interval — a digest that says "nothing happened" is spam
    span = _fmt_span(job["interval_secs"])
    sysp = (f"{_sysprompt(a)}\n\nYou are posting the scheduled {span} digest of "
            f"#{ch['name']}." if a else
            f"You are Digest, posting the scheduled {span} recap of #{ch['name']}.")
    try:
        summary, _prov, _model = await asyncio.to_thread(
            llm_chat, sysp, history[:-1],
            f"Recap these {len(history)} messages as a {span} digest: 3-6 tight "
            "bullets — decisions, plans, who's doing what, open questions. "
            "Keep names and numbers. No preamble.",
            endpoint=ep)
    except Exception:
        return  # brain offline — skip this run instead of spamming a fallback
    key, name, icon = (bot["username"], bot["display_name"], bot["avatar_emoji"]) \
        if bot else DIGEST_BOT
    await bot_post(cid, key, name, icon,
                   f"📅 **{span} digest — #{ch['name']}**\n{summary[:3000]}")


async def digest_loop():
    """Poll scheduled channel digests — an agent recaps each interval's messages."""
    while True:
        await asyncio.sleep(30)
        try:
            with db() as conn:
                due = conn.execute(
                    "SELECT * FROM digest_jobs WHERE last_run + interval_secs <= ?",
                    (now(),)).fetchall()
                for j in due:
                    conn.execute("UPDATE digest_jobs SET last_run=? WHERE id=?",
                                 (now(), j["id"]))
            for j in due:
                await _run_digest(dict(j))
        except Exception:
            pass


async def event_loop():
    """Flip due scheduled events to 'live' — announce in-channel + buzz interested."""
    while True:
        await asyncio.sleep(20)
        try:
            with db() as conn:
                due = conn.execute(
                    "SELECT * FROM events WHERE status='scheduled' AND starts_at<=?",
                    (now(),)).fetchall()
                for e in due:
                    conn.execute("UPDATE events SET status='live' WHERE id=?",
                                 (e["id"],))
            for e in due:
                cid = e["channel_id"]
                if not cid:
                    with db() as conn:
                        ch = conn.execute(
                            "SELECT id FROM channels WHERE server_id=? "
                            "AND kind IN ('text','forum') ORDER BY position, id LIMIT 1",
                            (e["server_id"],)).fetchone()
                    cid = ch["id"] if ch else None
                interested = json.loads(e["interested"] or "[]")
                if cid:
                    desc = f" — {e['description']}" if e["description"] else ""
                    await bot_post(cid, "bot:events", "Events", "📅",
                                   f"📅 **{e['name']}** is starting!{desc} "
                                   f"({len(interested)} interested)")
                with db() as conn:
                    for uid in interested:
                        u = conn.execute("SELECT id FROM users WHERE id=?",
                                         (uid,)).fetchone()
                        if u:
                            emit_buzz(conn, e["creator_id"], "event",
                                      {"to": uid, "event": e["name"]})
                    members = [r["user_id"] for r in conn.execute(
                        "SELECT user_id FROM server_members WHERE server_id=?",
                        (e["server_id"],)).fetchall()]
                    ev = dict(e); ev["status"] = "live"
                    ev["interested"] = interested
                    ev["me_interested"] = False; ev["interested_count"] = len(interested)
                await hub.send_many(members, {"type": "event",
                                              "server_id": e["server_id"],
                                              "event": ev})
        except Exception:
            pass


async def reminder_loop():
    """Poll for due reminders and deliver them as bot posts that @ping the user."""
    while True:
        await asyncio.sleep(10)
        try:
            with db() as conn:
                due = conn.execute(
                    "SELECT * FROM reminders WHERE fired=0 AND due_at<=?",
                    (now(),)).fetchall()
                for r in due:
                    conn.execute("UPDATE reminders SET fired=1 WHERE id=?", (r["id"],))
            for r in due:
                with db() as conn:
                    u = conn.execute("SELECT * FROM users WHERE id=?",
                                     (r["user_id"],)).fetchone()
                if u:
                    await bot_post(r["channel_id"], *REMIND_BOT,
                                   f"@{u['username']} ⏰ {r['text']}",
                                   ping_uid=r["user_id"])
        except Exception:
            pass


def _strip_echo_prefix(text: str, asker_un: str, asker_dn: str = "", agent_name: str = "") -> str:
    """Strip any leading @asker or AgentName: prefix that the LLM echoed."""
    s = (text or "").lstrip("\r\n ")
    names = [re.escape(x) for x in (asker_un, asker_dn, agent_name) if x]
    if names:
        pat = rf"^(?:(?:@?(?:{'|'.join(names)}))[:\s,]+)+"
        s = re.sub(pat, "", s, flags=re.I).lstrip()
    return s


def _scrub_echoes(text):
    """Model-mimicked artifacts: fake ⚙ receipt lines and back-to-back
    duplicated paragraphs (reasoning models sometimes repeat their preamble)."""
    lines = [l for l in (text or "").splitlines()
             if not l.lstrip().startswith("⚙")]
    paras, prev = [], None
    for p in "\n".join(lines).split("\n\n"):
        if p.strip() and p == prev:
            continue
        prev = p
        paras.append(p)
    return "\n\n".join(paras).strip()


WEB_TOOLS = ("web_search", "web_fetch")


def _ai_web_tool(name, args):
    """Channel-AI web tools for agent replies — live page fetch + DDG-lite
    search. Runs outside workspaces; results shaped like wsx.run_tool."""
    import urllib.request as _u
    import urllib.parse as _up
    args = args or {}
    try:
        if name == "web_fetch":
            url = str(args.get("url") or "")[:500].strip()
            if not url.startswith(("http://", "https://")):
                return {"ok": False, "error": "url must start with http(s)://"}
            req = _u.Request(url, headers={"User-Agent": "SignalTeams-agent/1.0"})
            with _u.urlopen(req, timeout=8) as r:
                raw = r.read(400_000)
                ctype = r.headers.get("Content-Type", "")
            txt = raw.decode("utf-8", "replace")
            if "html" in ctype or "<html" in txt[:400].lower():
                txt = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", txt)
                txt = re.sub(r"(?s)<[^>]+>", " ", txt)
                txt = re.sub(r"[ \t]+", " ", txt)
                txt = re.sub(r"\n\s*\n+", "\n\n", txt).strip()
            return {"ok": True, "url": url, "text": txt[:3500]}
        if name == "web_search":
            q = str(args.get("q") or args.get("query") or "")[:200].strip()
            if not q:
                return {"ok": False, "error": "empty query"}
            req = _u.Request(
                "https://lite.duckduckgo.com/lite/?q=" + _up.quote(q),
                headers={"User-Agent": "Mozilla/5.0 SignalTeams-agent/1.0"})
            with _u.urlopen(req, timeout=8) as r:
                html = r.read(300_000).decode("utf-8", "replace")
            hits = []
            for m_ in re.finditer(
                    r"<a[^>]*class=['\"]result-link['\"][^>]*>(.*?)</a>",
                    html, re.S):
                hm = re.search(r"href=['\"]([^'\"]+)['\"]", m_.group(0))
                title = re.sub(r"<[^>]+>", "", m_.group(1)).strip()
                href = hm.group(1) if hm else ""
                ud = re.search(r"[?&]uddg=([^&]+)", href)   # DDG redirect → real URL
                if ud:
                    href = _up.unquote(ud.group(1))
                if title:
                    hits.append(f"{title} — {href}")
                if len(hits) >= 6:
                    break
            if not hits:  # layout drift fallback: any outbound link
                for m_ in re.finditer(r"href=[\"'](https?://[^\"']+)[\"']", html):
                    if "duckduckgo" not in m_.group(1):
                        hits.append(m_.group(1))
                    if len(hits) >= 6:
                        break
            return {"ok": bool(hits), "results": hits[:6],
                    "error": "" if hits else "no results"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:160]}
    return {"ok": False, "error": f"unknown tool {name}"}


_recap_n = {}   # cid -> messages since last auto-recap


def note_message_for_recap(cid, enabled):
    """AI auto-summarize: every 60 new messages in a flagged channel earns a
    Scribe recap. Returns True once, when the threshold is crossed."""
    if not enabled:
        return False
    n = _recap_n.get(cid, 0) + 1
    _recap_n[cid] = 0 if n >= 60 else n
    return n >= 60


def _workspace_for_channel(conn, ch, uid):
    """The workspace an agent channel is wired to (if any) + the asker's level."""
    if not ch or not ch["server_id"] or not WORKSPACE_AGENT_TOOLS:
        return None, ""
    wid = ch["workspace_id"] if "workspace_id" in ch.keys() else None
    if not wid:
        return None, ""
    ws = conn.execute("SELECT * FROM workspaces WHERE id=?", (wid,)).fetchone()
    if not ws:
        return None, ""
    lvl = wsx.level_of(conn, ws, uid)
    return (ws, lvl) if lvl else (None, "")


def _focus_for(conn, ws, uid):
    """The file the asker last had open in the workspace editor (if any).

    The frontend stamps this into workspace_sessions.path whenever a file tab
    is active, so a chat summon can hand the agent the same context the agent
    desk would."""
    try:
        r = conn.execute(
            "SELECT path FROM workspace_sessions WHERE workspace_id=? AND user_id=? "
            "AND last_seen > ?", (ws["id"], uid, now() - 600)).fetchone()
        return (r["path"] or "") if r else ""
    except Exception:
        return ""


async def agent_reply(cid, aid, asker_id, msg_id, depth=0, ping=True):
    """Generate a reply from an agent @mentioned in chat and post it in-channel.
    Bot replies may themselves @mention other agents — those get summoned too,
    bounded by depth (max 3 hops) + per-agent cooldown so convos can't runaway.
    ping=False makes it ambient (lurking) — no @prefix and no mention buzz."""
    from .llm import chat_stream as llm_stream
    try:
        with db() as conn:
            ch = conn.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
            a = conn.execute("SELECT * FROM agents WHERE id=?", (aid,)).fetchone()
            msg = conn.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
            asker = conn.execute("SELECT * FROM users WHERE id=?", (asker_id,)).fetchone()
            if not ch or not a or not msg or not asker:
                return
            bot = agent_bot_user(conn, a)
            members = channel_member_ids(conn, ch)
            ws, ws_lvl = _workspace_for_channel(conn, ch, asker_id)
            try:
                ai_flags = json.loads(ch["ai_flags"] or "{}") \
                    if "ai_flags" in ch.keys() else {}
            except Exception:
                ai_flags = {}
            ai_web = bool(ai_flags.get("web"))
            # vision: attach the summon's image attachments to the model call
            images = []
            if ai_flags.get("vision"):
                try:
                    for att in json.loads(msg["attachments"] or "[]")[:3]:
                        if not str(att.get("mime") or "").startswith("image/"):
                            continue
                        f = conn.execute(
                            "SELECT data, mime FROM files WHERE id=?",
                            (att.get("id"),)).fetchone()
                        if f and f["data"] and len(f["data"]) < 3_000_000:
                            import base64 as _b64
                            images.append({"mime": f["mime"] or att["mime"],
                                           "b64": _b64.b64encode(f["data"]).decode()})
                except Exception:
                    images = []
            asker_llm = _agent_llm(a) \
                or (_server_llm(conn, ch["server_id"]) if ch["server_id"] else None) \
                or _user_llm(conn, asker_id)   # agent's own API connection wins, then server, then asker
            root = msg["thread_root"]          # summoned inside a thread → stay there
            if root:
                hist = conn.execute(
                    "SELECT m.author_id, m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? AND (m.thread_root=? OR m.id=?) "
                    "ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id, root, root)).fetchall()
            else:
                hist = conn.execute(
                    "SELECT m.author_id, m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id)).fetchall()
            history = []
            for r in reversed(hist):
                c_txt = (r["content"] or "").strip()
                if "my brain's offline" in c_txt:
                    continue
                if r["author_id"] == bot["id"]:
                    clean_bot = re.sub(r"^(?:@\S+\s+)+", "", c_txt).strip()
                    # our own ⚙ tool receipts pollute the transcript — models
                    # mimic them and hallucinate fake steps. Don't feed them back.
                    clean_bot = "\n".join(
                        l for l in clean_bot.splitlines()
                        if not l.lstrip().startswith("⚙")).strip()
                    clean_bot = re.sub(r"\s*\*\(interrupted\)\*\s*$", "",
                                       clean_bot).strip()
                    # a reply that leaked raw {"tool":…} JSON feeds the same
                    # mimicry — strip it from history too
                    clean_bot = wsx.strip_tool_calls(clean_bot)
                    if clean_bot:
                        history.append({"role": "assistant", "content": clean_bot})
                else:
                    history.append({"role": "user", "content": f"{r['dn'] or r['un']}: {c_txt}"})
            if not history:
                history = [{"role": "user", "content": f"{asker['display_name'] or asker['username']}: {msg['content']}"}]
        typing = {"type": "typing", "channel_id": cid,
                  "user": {"id": bot["id"], "display_name": a["name"], "bot": True}}
        await hub.send_many(members, {**typing, "on": True})
        prefix = f"@{asker['username']} " if ping else ""
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO messages(channel_id, author_id, content, reply_to, thread_root, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (cid, bot["id"], prefix + "▌", msg_id, root, now()))
            mid = cur.lastrowid
            m2 = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            seed = {"type": "message", "channel_id": cid,
                    "message": message_json(conn, m2, asker_id)}
        await hub.send_many(members, seed)

        async def _phase(ph, tool=""):
            await hub.send_many(members, {**typing, "on": True,
                "user": {**typing["user"], "phase": ph, "tool": tool}})

        last_txt = None

        async def _paint(content):
            nonlocal last_txt
            if content == last_txt:
                return
            last_txt = content
            with db() as conn:
                conn.execute("UPDATE messages SET content=? WHERE id=?",
                             (content, mid))
                mj = message_json(conn, conn.execute(
                    "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), asker_id)
            await hub.send_many(members, {
                "type": "message_updated", "channel_id": cid, "message": mj})

        def _steps_txt():
            return ", ".join(
                f"{s['tool']}{'✓' if s['result'].get('ok') else '✗'}"
                for s in tool_steps)

        if a["context_url"]:
            await _phase("gathering context")
            ground_ctx = (await asyncio.to_thread(
                _grounding, a["context_url"],
                a["context_method"] if "context_method" in a.keys() else "GET",
                history[-1]["content"] if history else "",
                a["context_headers"] if "context_headers" in a.keys() else None))
        else:
            ground_ctx = ""
        sysp = _sysprompt(a, ground_ctx)
        if ws:
            # Same prompt the agent desk uses, so chat and studio behave alike.
            # The asker's open file travels along as focus context.
            with db() as conn:
                sysp += "\n\n" + wsx.agent_prompt(
                    conn, ws, asker_id, _focus_for(conn, ws, asker_id))
        if ai_web:
            sysp += ("\n\nYou may also use web tools — reply with ONLY JSON like "
                     '{"tool":"web_search","args":{"q":"query"}} to search, or '
                     '{"tool":"web_fetch","args":{"url":"https://…"}} to read a '
                     "live page. Use them when fresh info would help.")
        if images:
            sysp += ("\n\nThe user attached image(s) — look at them and answer "
                     "about what you see.")
        tool_steps = []
        _aprov, _amdl = _split_model(a["model"])

        def _pump(user_msg, q):
            try:
                for kind, data in llm_stream(
                        sysp, history[:-1], user_msg,
                        model=_amdl, provider=_aprov,
                        temperature=a["temperature"],
                        endpoint=asker_llm, images=images):
                    if kind == "token":
                        q.put(("TOK", data))
                    elif kind == "thinking":
                        q.put(("THINK", data))
            except Exception as e:
                q.put(("ERR", str(e)))
            finally:
                q.put(("DONE", ""))

        def _stop_hit():
            k = (cid, bot["id"])
            if k in _reply_cancel:
                _reply_cancel.discard(k)
                return True
            return False

        async def _round(user_msg):
            """One streamed model turn — paints thinking/writing phases and
            honours the stop flag. Returns (reply, errored, stopped)."""
            q = queue.Queue()
            threading.Thread(target=_pump, args=(user_msg, q), daemon=True).start()
            reply, done, errored, think_n = "", False, False, 0
            while not done:
                await asyncio.sleep(0.6)
                if _stop_hit():
                    return reply, errored, True
                buf = []
                while True:
                    try:
                        ev, item = q.get_nowait()
                    except queue.Empty:
                        break
                    if ev == "DONE":
                        done = True
                    elif ev == "ERR":
                        errored, done = True, True
                    elif ev == "TOK":
                        buf.append(item)
                    elif ev == "THINK":
                        think_n = item
                if buf and not errored:
                    reply += "".join(buf)
                    await _phase("writing")
                    cleaned = _strip_echo_prefix(reply, asker["username"],
                                                 asker["display_name"], a["name"])
                    await _paint(prefix + cleaned[:3600] + "▌")
                elif think_n and not reply and not errored:
                    await _phase("thinking")
                    await _paint(prefix + f"💭 thinking… ({think_n})▌")
            return reply, errored, False

        reply, errored, stopped = await _round(history[-1]["content"])
        await hub.send_many(members, {**typing, "on": False})
        reply = _strip_echo_prefix(reply, asker["username"], asker["display_name"], a["name"])
        # tool calls — workspace file tools + channel-AI web tools, same loop.
        # Enter whenever the reply contains ANY {"tool":…} call, even with all
        # tools off — the dispatch returns honest "tool off" results and the
        # model writes a real answer instead of painting raw JSON.
        hit_cap = False
        if not errored and not stopped and reply and \
                (ws or ai_web or wsx.parse_tool_calls(reply)):
            done_calls = set()    # (tool, args-json) — identical repeats don't re-run
            nudged = False        # one "write the summary" nudge per reply
            for _ in range(8):
                if _stop_hit():
                    stopped = True
                    break
                calls = wsx.parse_tool_calls(reply)
                if not calls:
                    break
                fresh = [c for c in calls
                         if (c["name"], json.dumps(c["args"] or {},
                             sort_keys=True)) not in done_calls]
                if not fresh:
                    # the model repeated a call or emitted nothing runnable —
                    # ask it once for a plain-text summary instead of silently
                    # landing on the generic "Done" fallback
                    if nudged or _stop_hit():
                        break
                    nudged = True
                    reply, err2, stopped = await _round(
                        history[-1]["content"]
                        + "\n\nThat exact tool call already ran — its result "
                          "is above. Now reply with a plain-text summary of "
                          "what you did and what the output showed. No tool "
                          "JSON.")
                    if stopped:
                        break
                    if err2:
                        reply = (reply.strip() + "\n\n" if reply.strip()
                                 else "") + \
                            "*(the model went quiet — say \"continue\" to retry)*"
                        break
                    reply = _strip_echo_prefix(reply, asker["username"],
                                               asker["display_name"], a["name"])
                    continue
                results = []
                for c in fresh[:3]:
                    if _stop_hit():
                        stopped = True
                        break
                    done_calls.add((c["name"],
                                    json.dumps(c["args"] or {}, sort_keys=True)))
                    await _phase("tools", c["name"])
                    done_txt = _steps_txt()
                    await _paint(prefix + "⚙ " + (done_txt + " · " if done_txt else "")
                                 + c["name"] + "…▌")
                    t0 = time.time()
                    if c["name"] in WEB_TOOLS:
                        res = _ai_web_tool(c["name"], c["args"]) if ai_web else \
                            {"ok": False, "error": "web tools are off in this channel"}
                    elif ws:
                        with db() as conn:
                            res = wsx.run_tool(conn, ws, asker_id, a["id"],
                                               c["name"], c["args"])
                    else:
                        res = {"ok": False, "error": f"unknown tool {c['name']}"}
                    tool_steps.append({"tool": c["name"], "args": c["args"], "result": res,
                                       "secs": round(time.time() - t0, 1)})
                    results.append(f"TOOL RESULT {c['name']}: {json.dumps(res)[:4000]}")
                if stopped:
                    break
                await _paint(prefix + "⚙ " + _steps_txt() + "…▌")
                await _phase("thinking")
                # streamed too — a long think here used to freeze on the ⚙ line
                # and a timeout silently emptied the whole reply
                reply, err2, stopped = await _round(
                    history[-1]["content"] + "\n\n" + "\n\n".join(results))
                if stopped:
                    break
                if err2:
                    reply = (reply.strip() + "\n\n" if reply.strip() else "") + \
                        "*(the tool steps ran, then the model went quiet — " \
                        "say \"continue\" to retry)*"
                    break
                reply = _strip_echo_prefix(reply, asker["username"],
                                           asker["display_name"], a["name"])
            else:
                hit_cap = bool(tool_steps)   # loop exhausted mid-work
            if tool_steps and not wsx.strip_tool_calls(reply):
                bad = any(not s["result"].get("ok") for s in tool_steps)
                reply = ("Finished, but some steps failed — see the ⚙ lines "
                         "above." if bad else
                         "Done — see the tool steps above.")
        # always scrub tool-call JSON — a model that emits {"tool":…} for an
        # OFF/unavailable tool would otherwise paint raw JSON as the reply
        _pre_strip = reply
        reply = wsx.strip_tool_calls(reply)
        if _pre_strip != reply and not reply.strip() and not tool_steps:
            reply = ('*(I tried to call a tool that\'s off in this channel — '
                     'turn it on in ✨ AI in this channel, then ask again)*')
        if errored or not reply:
            reply = ("⏹ stopped before it could answer." if stopped
                     else "hmm, my brain's offline — no local LLM reachable right now")
        reply = _scrub_echoes(reply)
        text = prefix + reply[:3600]
        if stopped and "⏹" not in text:
            text += "\n\n⏹ *(stopped)*"
        if tool_steps:
            text += "\n\n" + "\n".join(
                f"⚙ `{s['tool']}` {s['args'].get('path') or s['args'].get('query') or s['args'].get('cmd') or ''}"
                + ("" if s["result"].get("ok") else f" — ✗ {s['result'].get('error', 'failed')}")
                + (f" · {s['secs']}s" if s.get("secs") is not None else "")
                for s in tool_steps)
        if hit_cap:
            text += "\n⏸ hit the 8-step tool cap — say \"continue\" to keep going."
        with db() as conn:
            conn.execute("UPDATE messages SET content=? WHERE id=?", (text, mid))
            m2 = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            payload = {"type": "message_updated", "channel_id": cid,
                       "message": message_json(conn, m2, asker_id)}
        with db() as conn:
            if ping:
                emit_buzz(conn, bot["id"], "mentioned", {
                    "to": asker_id, "channel_id": cid, "server_id": ch["server_id"],
                    "channel": ch["name"], "msg_id": m2["id"], "excerpt": text[:100]})
            # feed event so the agent's owner's friends see it working
            emit_buzz(conn, bot["id"], "answered", {
                "name": a["name"], "asker": asker["display_name"] or asker["username"],
                "channel": ch["name"], "channel_id": cid, "server_id": ch["server_id"],
                "owner_id": a["owner_id"]})
            buzz_ids = set(friend_ids(conn, asker_id)) | {asker_id, a["owner_id"]}
        await hub.send_many(members, payload)
        # the phase events re-arm typing during the tool loop — clear it now
        # that the reply is final, or the indicator outlives the answer.
        await hub.send_many(members, {**typing, "on": False})
        await hub.send_many(list(buzz_ids), {"type": "buzz"})
        # agent→agent: a bot reply that @names other agents summons them too
        if depth < 3:
            with db() as conn:
                cand = {re.sub(r"[^a-z0-9]+", "", n)
                        for n in re.findall(r"@(\w+)", text)} - {""}
                nxt = [a2["id"] for a2 in
                       conn.execute("SELECT * FROM agents ORDER BY id").fetchall()
                       if a2["id"] != aid and
                       re.sub(r"[^a-z0-9]+", "", a2["name"].lower()) in cand and
                       can_see_agent(conn, a2, asker_id)]
            for naid in nxt[:2]:
                k = (naid, cid)
                if time.time() - _agent_cool.get(k, 0) >= 8:
                    _agent_cool[k] = time.time()
                    asyncio.create_task(
                        agent_reply(cid, naid, asker_id, m2["id"], depth + 1))
    except Exception:
        # never strand the seeded "▌" cursor / typing indicator on an unexpected crash
        try:
            if "mid" not in locals():
                return
            with db() as conn:
                conn.execute("UPDATE messages SET content=? WHERE id=? AND content LIKE '%▌'",
                             (prefix + "hmm, my brain's offline — no local LLM reachable right now",
                              mid))
                mj = message_json(conn, conn.execute(
                    "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), asker_id)
            await hub.send_many(members, {**typing, "on": False})
            await hub.send_many(members, {
                "type": "message_updated", "channel_id": cid, "message": mj})
        except Exception:
            pass
