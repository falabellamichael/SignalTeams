"""Async background services: bot posts, starboard, agent replies, reminders."""
import asyncio
import queue
import re
import threading
import time

from .db import db, emit_buzz, now
from .hub import hub

from .helpers import STAR_EMOJI, _agent_llm, _grounding, _server_llm, _split_model, _sysprompt, _user_llm, agent_bot_user, can_see_agent, channel_member_ids, friend_ids, message_json, starboard_bot_user

async def _server_changed(conn, sid):
    members = [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM server_members WHERE server_id=?", (sid,)).fetchall()]
    await hub.send_many(members, {"type": "server_changed", "server_id": sid})


_agent_cool = {}


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
              "user": {"id": bot_u["id"], "display_name": SCRIBE_BOT[1]}}
    await hub.send_many(members, {**typing, "on": True})
    try:
        summary, _prov, _model = await asyncio.to_thread(
            llm_chat,
            "You are Scribe, a chat recapper. Summarize the conversation into "
            "3-6 tight bullets: decisions, plans, who's doing what, open "
            "questions. Be terse, specific, and keep names.",
            history[:-1],
            f"Summarize these {len(history)} messages from #{ch['name']}.")
    except Exception:
        summary = "my brain's offline — no local LLM reachable right now"
    finally:
        await hub.send_many(members, {**typing, "on": False})
    await bot_post(
        cid, *SCRIBE_BOT,
        f"@{asker['username']} 📝 **recap — last {len(history)} messages**\n{summary[:3000]}",
        ping_uid=asker_id)


REMIND_BOT = ("bot:reminders", "Reminders", "⏰")


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


async def agent_reply(cid, aid, asker_id, msg_id, depth=0):
    """Generate a reply from an agent @mentioned in chat and post it in-channel.
    Bot replies may themselves @mention other agents — those get summoned too,
    bounded by depth (max 3 hops) + per-agent cooldown so convos can't runaway."""
    import asyncio, queue, threading
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
            asker_llm = _agent_llm(a) \
                or (_server_llm(conn, ch["server_id"]) if ch["server_id"] else None) \
                or _user_llm(conn, asker_id)   # agent's own API connection wins, then server, then asker
            root = msg["thread_root"]          # summoned inside a thread → stay there
            if root:
                hist = conn.execute(
                    "SELECT m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? AND (m.thread_root=? OR m.id=?) "
                    "ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id, root, root)).fetchall()
            else:
                hist = conn.execute(
                    "SELECT m.content, u.display_name dn, u.username un FROM messages m "
                    "JOIN users u ON u.id=m.author_id "
                    "WHERE m.channel_id=? AND m.id<=? ORDER BY m.id DESC LIMIT 12",
                    (cid, msg_id)).fetchall()
            history = [{"role": "user",
                        "content": f"{r['dn'] or r['un']}: {r['content']}"}
                       for r in reversed(hist)]
        typing = {"type": "typing", "channel_id": cid,
                  "user": {"id": bot["id"], "display_name": a["name"]}}
        await hub.send_many(members, {**typing, "on": True})
        prefix = f"@{asker['username']} "
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

        ground_ctx = (await asyncio.to_thread(
            _grounding, a["context_url"],
            a["context_method"] if "context_method" in a.keys() else "GET",
            history[-1]["content"] if history else "",
            a["context_headers"] if "context_headers" in a.keys() else None)) \
            if a["context_url"] else ""
        q = queue.Queue()
        def _pump():
            try:
                for kind, data in llm_stream(
                        _sysprompt(a, ground_ctx),
                        history[:-1],
                        history[-1]["content"],
                        model=_split_model(a["model"])[1],
                        provider=_split_model(a["model"])[0],
                        temperature=a["temperature"],
                        endpoint=asker_llm):
                    if kind == "token":
                        q.put(data)
            except Exception:
                q.put("")
            finally:
                q.put("")
        threading.Thread(target=_pump, daemon=True).start()

        reply, done, errored = "", False, False
        while not done:
            await asyncio.sleep(0.6)
            buf = []
            while True:
                try:
                    item = q.get_nowait()
                except queue.Empty:
                    break
                if item == "":
                    done = True
                elif item == "":
                    errored, done = True, True
                else:
                    buf.append(item)
            if buf and not errored:
                reply += "".join(buf)
                with db() as conn:
                    conn.execute("UPDATE messages SET content=? WHERE id=?",
                                 (prefix + reply[:3600] + "▌", mid))
                    mj = message_json(conn, conn.execute(
                        "SELECT * FROM messages WHERE id=?", (mid,)).fetchone(), asker_id)
                await hub.send_many(members, {
                    "type": "message_updated", "channel_id": cid, "message": mj})
        await hub.send_many(members, {**typing, "on": False})
        if errored or not reply:
            reply = "hmm, my brain's offline — no local LLM reachable right now"
        text = prefix + reply[:3600]
        with db() as conn:
            conn.execute("UPDATE messages SET content=? WHERE id=?", (text, mid))
            m2 = conn.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
            payload = {"type": "message_updated", "channel_id": cid,
                       "message": message_json(conn, m2, asker_id)}
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
        pass
