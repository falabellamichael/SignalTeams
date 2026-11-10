"""E2E for the agent plugin tool loop.

In-process: seeds a temp DB, patches connections._pget with canned Gmail
data, runs services.agent_reply against qa/stub_llm_plugin.py, asserts:
  1. the system prompt told the agent about the connected gmail plugin
  2. the {"tool":"plugin"} call was dispatched
  3. the token used was the ASKER's — never anybody else's row
  4. the final chat message contains the canned Gmail result

Run from repo root:  backend/.venv/Scripts/python.exe qa/agent_plugin.py
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(BASE, "backend", ".venv", "Scripts", "python.exe")

os.environ["AGENTHIVE_DB"] = tempfile.mktemp(prefix="st-plugqa-", suffix=".db")
sys.path.insert(0, os.path.join(BASE, "backend"))

from app.db import db, init, now          # noqa: E402
from app import connections as cx         # noqa: E402
from app import services                  # noqa: E402

ASKER_TOK = "ASKER-SECRET-TOKEN"
OTHER_TOK = "SOMEBODY-ELSE-TOKEN"
CALLS = []


def fake_pget(tok, url, extra_headers=None):
    CALLS.append({"tok": tok, "url": url})
    if "format=metadata" in url:
        return {"payload": {"headers": [
            {"name": "Subject", "value": "INV-42"},
            {"name": "From", "value": "billing@acme.example"},
            {"name": "Date", "value": "Tue, 3 Jun"}]},
            "snippet": "your acme invoice is attached"}
    return {"messages": [{"id": "m1"}], "resultSizeEstimate": 1}


def seed():
    init()
    t = now()
    with db() as conn:
        def user(name, disp):
            conn.execute(
                "INSERT INTO users(username, display_name, avatar_color, "
                "avatar_emoji, bio, status, password_hash, created_at, "
                "seen_buzz, status_text, llm_url, llm_key, llm_model, llm_kind, "
                "keywords, banner_color, pronouns) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (name, disp, "#888", "🙂", "", "online", "!", t, 0, "",
                 "", "", "", "openai", "[]", "", ""))
            return conn.execute("SELECT id FROM users WHERE username=?",
                                (name,)).fetchone()["id"]

        asker = user("asker", "Asker")
        other = user("other", "Other User")
        conn.execute(
            "INSERT INTO agents(owner_id, name, icon, tagline, description, "
            "system_prompt, model, tags, version, visibility, use_who, "
            "use_when, forked_from, downloads, created_at, updated_at, "
            "context_method, api_kind, api_url, api_key) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (asker, "PlugBot", "🔌", "stub", "", "You are helpful.",
             "stub-agent", "[]", "1", "public", "same", "anytime", 0, 0,
             t, t, "GET", "openai", "http://127.0.0.1:8098/v1", ""))
        aid = conn.execute("SELECT id FROM agents WHERE name='PlugBot'"
                           ).fetchone()["id"]
        conn.execute(
            "INSERT INTO servers(name, icon, invite_code, owner_id, "
            "created_at, star_threshold, llm_kind, automod) "
            "VALUES (?,?,?,?,?,?,?,?)",
            ("QA", "🧪", "qax", asker, t, 3, "openai", 0))
        sid = conn.execute("SELECT id FROM servers WHERE invite_code='qax'"
                           ).fetchone()["id"]
        for u, role in ((asker, "owner"), (other, "member")):
            conn.execute(
                "INSERT INTO server_members(server_id, user_id, role, "
                "joined_at, nickname) VALUES (?,?,?,?,?)",
                (sid, u, role, t, ""))
        conn.execute(
            "INSERT INTO channels(server_id, kind, name, topic, position, "
            "created_at, roster, category, slowmode_secs, voice_cap, lurkers, "
            "forum_tags, ai_flags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, "text", "general", "", 0, t, "[]", "", 0, 0, "[]", "[]",
             "{}"))
        cid = conn.execute("SELECT id FROM channels WHERE name='general'"
                           ).fetchone()["id"]
        conn.execute(
            "INSERT INTO messages(channel_id, author_id, content, attachments, "
            "pinned, created_at, system, tags) VALUES (?,?,?,?,?,?,?,?)",
            (cid, asker, "@PlugBot any invoices in my mail?", "[]", 0, t,
             0, "[]"))
        mid = conn.execute("SELECT id FROM messages WHERE content LIKE '%invoices%'"
                           ).fetchone()["id"]
        # the asker's own grant + ANOTHER user's grant with a different token
        future = json.dumps({"expires_at": time.time() + 3600})
        for u, tok in ((asker, ASKER_TOK), (other, OTHER_TOK)):
            conn.execute(
                "INSERT INTO user_connections(user_id, provider, via, kind, "
                "api_key, refresher, meta, label, usable, extra, created_at, "
                "updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)",
                (u, "gmail", "oauth", "plugin", tok, None, future,
                 f"u{u}@x", "{}", t, t))
    return cid, aid, asker, mid


def main():
    stub = subprocess.Popen(
        [PY, os.path.join(BASE, "qa", "stub_llm_plugin.py")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        cid, aid, asker, mid = seed()
        cx._pget = fake_pget
        asyncio.run(services.agent_reply(cid, aid, asker, mid))
        with db() as conn:
            reply = conn.execute(
                "SELECT content FROM messages WHERE channel_id=? "
                "AND author_id<>? ORDER BY id DESC LIMIT 1",
                (cid, asker)).fetchone()["content"]
        sys.stdout.reconfigure(encoding="utf-8")
        print("agent reply:", reply[:300])
        with open(os.path.join(BASE, "qa", "plugin-sysprompt.json"),
                  encoding="utf-8") as f:
            sysp = json.load(f)["system"]
        assert "gmail" in sysp.lower(), "agent never told about the plugin"
        print("sysprompt mentions plugin:", "gmail" in sysp.lower())
        assert CALLS, "plugin tool never hit the API layer"
        assert all(c["tok"] == ASKER_TOK for c in CALLS), \
            f"WRONG TOKEN — used {[c['tok'] for c in CALLS]}"
        print(f"plugin API calls: {len(CALLS)}, all as asker:", True)
        assert "billing@acme.example" in reply or "INV-42" in reply, \
            "canned Gmail data missing from the reply"
        print("OK — agent saw the plugin, called it AS THE ASKER, and "
              "summarized the result.")
    finally:
        stub.terminate()


if __name__ == "__main__":
    main()
