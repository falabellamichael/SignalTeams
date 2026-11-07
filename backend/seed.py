"""Seed demo data: friends, a server, messages, and agents. Idempotent-ish."""
import json
import sys
import time

sys.path.insert(0, ".")
from app.auth import hash_password
from app.db import db, emit_buzz, init, now

init()


def uid(conn, username):
    r = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    return r["id"] if r else None


def main():
    with db() as conn:
        demo_users = [
            ("mike", "Mike", "#4da3ff", "📡", "SignalTeams founder. Ships agents."),
            ("nova", "Nova", "#a371f7", "🤖", "Prompt goblin."),
            ("juno", "Juno", "#3fb950", "🦉", "Evals everything twice."),
        ]
        for username, dn, color, emoji, bio in demo_users:
            if not uid(conn, username):
                conn.execute(
                    "INSERT INTO users(username, display_name, avatar_color, avatar_emoji, bio, "
                    "password_hash, created_at) VALUES (?,?,?,?,?,?,?)",
                    (username, dn, color, emoji, bio, hash_password("password"), now()))

        mike, nova, juno = uid(conn, "mike"), uid(conn, "nova"), uid(conn, "juno")
        for a, b in [(mike, nova), (mike, juno), (nova, juno)]:
            if not conn.execute(
                    "SELECT 1 FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
                    (a, b, b, a)).fetchone():
                conn.execute(
                    "INSERT INTO friendships(user_id, friend_id, status, created_at) VALUES (?,?,?,?)",
                    (a, b, "accepted", now()))

        srv = conn.execute("SELECT * FROM servers WHERE name='Signal HQ'").fetchone()
        if not srv:
            import secrets
            cur = conn.execute(
                "INSERT INTO servers(name, icon, invite_code, owner_id, created_at) VALUES (?,?,?,?,?)",
                ("Signal HQ", "📡", "signal-demo", mike, now()))
            sid = cur.lastrowid
            for u in (mike, nova, juno):
                conn.execute(
                    "INSERT INTO server_members(server_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                    (sid, u, "owner" if u == mike else "member", now()))
            conn.execute(
                "INSERT INTO channels(server_id, kind, name, topic, position, created_at) VALUES "
                "(?,?,?,?,?,?), (?,?,?,?,?,?), (?,?,?,?,?,?)",
                (sid, "text", "general", "Whatever's on your mind", 0, now(),
                 sid, "agents", "agent-drops", "Fresh agent shares land here", 1, now(),
                 sid, "text", "show-and-tell", "Screenshots, demos, wins", 2, now()))
        else:
            sid = srv["id"]

        gen = conn.execute("SELECT id FROM channels WHERE server_id=? AND name='general'", (sid,)).fetchone()["id"]
        drops = conn.execute("SELECT id FROM channels WHERE server_id=? AND name='agent-drops'", (sid,)).fetchone()["id"]

        icons = {"BugHunter": "🐛", "SousChef": "🍳", "RAGWrangler": "📚",
                 "StandupBot": "📋", "LoreKeeper": "🎲", "ToastMaster": "🍞"}
        for name, icon in icons.items():
            conn.execute("UPDATE agents SET icon=? WHERE name=? AND icon='🤖'", (icon, name))

        agents = [
            (nova, "BugHunter", "Relentless code reviewer that smells off-by-one errors",
             "Feed it a diff, get back a prioritized list of bugs with severity tags.",
             "You are BugHunter, a meticulous code reviewer. Read the diff carefully. "
             "Report real bugs only — no style nitpicks unless asked. Severity: crit/major/minor. "
             "Cite line numbers. Suggest minimal fixes.", "local-llm", ["code", "review", "bugs"], "2.1.0"),
            (juno, "SousChef", "Turns whatever's in your fridge into an actual dinner",
             "Pantry-aware recipe agent. Knows substitutions, scales portions, roasts your knife skills gently.",
             "You are SousChef, a warm but honest cooking agent. Ask what's in the fridge before "
             "suggesting anything. Prefer 30-minute recipes. Offer substitution when an ingredient is missing. "
             "Keep tone encouraging, never pretentious.", "gpt-4o-mini", ["food", "recipes", "fun"], "1.3.0"),
            (mike, "RAGWrangler", "Plumbs docs into a retrieval pipeline without tears",
             "Chunks, embeds, indexes. Answers with citations or says it doesn't know.",
             "You are RAGWrangler. Given retrieved passages, answer strictly from them and cite "
             "[passage n]. If the passages don't cover it, say so plainly — never hallucinate.",
             "local-embeddings", ["rag", "docs", "search"], "3.0.2"),
            (nova, "StandupBot", "Collects async standups and writes the summary nobody reads anyway",
             "Ping, summarize, post. Three questions, zero meetings.",
             "You are StandupBot. Ask: yesterday, today, blockers. Summarize replies into one "
             "tight digest with a blockers section on top. Be brief.", "any", ["productivity", "teams"], "1.0.0"),
            (juno, "LoreKeeper", "Worldbuilding memory for your D&D campaign",
             "Remembers every NPC you invented at 2am. Recalls them accurately at session time.",
             "You are LoreKeeper, the campaign's memory. Answer lore questions from the supplied notes. "
             "Track NPCs, places, and plot threads. Flag contradictions politely.", "claude-sonnet", ["games", "dnd", "writing"], "0.9.0"),
        ]
        for owner, name, tag, desc, prompt, model, tags, ver in agents:
            if conn.execute("SELECT 1 FROM agents WHERE name=?", (name,)).fetchone():
                continue
            conn.execute(
                "INSERT INTO agents(owner_id, name, tagline, description, system_prompt, model, tags, "
                "version, visibility, downloads, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (owner, name, tag, desc, prompt, model, json.dumps(tags), ver,
                 "public", 0, now() - 86400, now() - 3600))

        def aid(name):
            return conn.execute("SELECT id FROM agents WHERE name=?", (name,)).fetchone()["id"]

        for u, a in [(mike, aid("BugHunter")), (nova, aid("RAGWrangler")), (juno, aid("BugHunter"))]:
            conn.execute("INSERT OR IGNORE INTO agent_stars(agent_id, user_id, created_at) VALUES (?,?,?)",
                         (a, u, now()))
        for u, a in [(mike, aid("BugHunter")), (mike, aid("SousChef")), (nova, aid("SousChef"))]:
            conn.execute("INSERT OR IGNORE INTO agent_installs(agent_id, user_id, created_at) VALUES (?,?,?)",
                         (a, u, now()))

        if not conn.execute("SELECT 1 FROM messages WHERE channel_id=?", (gen,)).fetchone():
            msgs = [
                (mike, gen, "welcome to signal hq 📡 drop your agents in #agent-drops", None),
                (nova, gen, "just shipped BugHunter v2.1 — it caught a race condition in my own code. rude but fair", None),
                (juno, gen, "eval'd it on 40 diffs. precision is honestly scary", None),
                (nova, drops, "fresh drop:", aid("BugHunter")),
                (mike, drops, "installed. my PRs are about to get humbled", None),
                (juno, drops, "SousChef saved dinner last night. sharing for the people", aid("SousChef")),
            ]
            t = now() - 7200
            for author, ch, content, agent in msgs:
                conn.execute(
                    "INSERT INTO messages(channel_id, author_id, content, agent_id, created_at) "
                    "VALUES (?,?,?,?,?)", (ch, author, content, agent, t))
                t += 300

        if not conn.execute("SELECT 1 FROM buzz LIMIT 1").fetchone():
            emit_buzz(conn, nova, "published", {"agent_id": aid("BugHunter"), "name": "BugHunter"})
            emit_buzz(conn, mike, "installed", {"agent_id": aid("BugHunter"), "name": "BugHunter"})
            emit_buzz(conn, juno, "starred", {"agent_id": aid("BugHunter"), "name": "BugHunter"})
            emit_buzz(conn, juno, "published", {"agent_id": aid("SousChef"), "name": "SousChef"})
            emit_buzz(conn, mike, "joined", {"server": "Signal HQ"})
            emit_buzz(conn, nova, "friended", {"with": "juno"})

        print("Seeded: users mike/nova/juno (password 'password'), server 'Signal HQ' (invite: signal-demo), "
              "5 agents, messages.")


if __name__ == "__main__":
    main()
