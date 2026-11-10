"""SQLite layer for SignalTeams. WAL mode, foreign keys on, stdlib sqlite3."""
import json
import sqlite3
import time
from contextlib import contextmanager

from .config import ADMINS, DB_PATH

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    avatar_color  TEXT NOT NULL DEFAULT '#4da3ff',
    avatar_emoji  TEXT NOT NULL DEFAULT '🐝',
    bio           TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'online',      -- online | idle | dnd | offline
    password_hash TEXT NOT NULL,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending',        -- pending | accepted
    created_at REAL NOT NULL,
    UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS servers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '🍯',
    invite_code TEXT NOT NULL UNIQUE,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS server_members (
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member',          -- owner | member
    joined_at  REAL NOT NULL,
    timeout_until REAL,                                 -- posts blocked until this epoch
    PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS server_bans (
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     TEXT NOT NULL DEFAULT '',
    banned_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS channels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER REFERENCES servers(id) ON DELETE CASCADE,   -- NULL => DM channel
    kind       TEXT NOT NULL DEFAULT 'text',            -- text | forum | agents | dm
    name       TEXT NOT NULL,
    topic      TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_members (            -- DM membership
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    agent_id   INTEGER REFERENCES agents(id) ON DELETE SET NULL,    -- shared agent card
    attachments TEXT NOT NULL DEFAULT '[]',                          -- JSON [{id,name,mime,size}]
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);

CREATE TABLE IF NOT EXISTS agents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🤖',
    tagline       TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    model         TEXT NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '[]',           -- JSON array
    version       TEXT NOT NULL DEFAULT '1.0.0',
    visibility    TEXT NOT NULL DEFAULT 'friends',      -- public | friends | private
    use_who       TEXT NOT NULL DEFAULT '',             -- '' = follow visibility | public | friends | people | private
    use_when      TEXT NOT NULL DEFAULT 'always',       -- always | online (owner present) | off
    forked_from   TEXT NOT NULL DEFAULT '',             -- "BugHunter by nova" attribution
    downloads     INTEGER NOT NULL DEFAULT 0,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);

CREATE TABLE IF NOT EXISTS agent_stars (
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (agent_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_installs (              -- friends who added it to their bench
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (agent_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_allowed_users (         -- use_who='people' allowlist
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating     INTEGER NOT NULL DEFAULT 0,                -- 1-5
    body       TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    UNIQUE(agent_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    uploader   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
    data       BLOB NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS emojis (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    uploader   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    UNIQUE(server_id, name)
);

CREATE TABLE IF NOT EXISTS server_roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#e8b339',
    created_at REAL NOT NULL,
    UNIQUE(server_id, name)
);

CREATE TABLE IF NOT EXISTS member_roles (
    server_id  INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    role_id    INTEGER NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS starboard_posts (             -- src msg -> board repost
    src_msg_id   INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    board_msg_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    stars        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    due_at     REAL NOT NULL,
    fired      INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fired, due_at);

CREATE TABLE IF NOT EXISTS channel_knocks (                -- knock-to-join on role-gated channels
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version    TEXT NOT NULL,
    snapshot   TEXT NOT NULL,                             -- JSON of agent fields pre-edit
    edited_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_packs (                 -- shareable agent bundles
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '📦',
    description TEXT NOT NULL DEFAULT '',
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_items (
    pack_id   INTEGER NOT NULL REFERENCES agent_packs(id) ON DELETE CASCADE,
    agent_id  INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (pack_id, agent_id)
);

CREATE TABLE IF NOT EXISTS buzz (                        -- activity feed
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,                            -- published | starred | installed | joined | shared | friended
    payload    TEXT NOT NULL DEFAULT '{}',               -- JSON
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buzz_time ON buzz(id DESC);
CREATE TABLE IF NOT EXISTS saved (                       -- per-user message bookmarks
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    UNIQUE(user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved(user_id, id DESC);
CREATE TABLE IF NOT EXISTS blocks (                      -- user_id blocked blocked_id
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    UNIQUE(user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS user_connections (            -- AI provider connections (Settings → Connections)
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,                            -- openai, anthropic, xai, mistral, …
    via        TEXT NOT NULL DEFAULT 'key',              -- key | cli
    kind       TEXT NOT NULL DEFAULT 'openai',           -- endpoint protocol for llm.py
    url        TEXT NOT NULL DEFAULT '',
    api_key    TEXT,
    headers    TEXT,                                     -- JSON extra headers (e.g. OAuth bearer)
    model      TEXT NOT NULL DEFAULT '',
    label      TEXT NOT NULL DEFAULT '',                 -- account hint: email / plan / CLI login
    usable     INTEGER NOT NULL DEFAULT 1,               -- 0 = credential stored, not chat-routable
    refresher  TEXT,                                     -- refresh material (OAuth refresh_token / Copilot oauth) — never exposed
    extra      TEXT,                                     -- OAuth app creds {client_id, client_secret} — never exposed
    meta       TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS kv (                          -- misc persisted singletons (oauth state secret…)
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_hooks (               -- incoming webhooks per channel
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '🪝',
    token      TEXT NOT NULL UNIQUE,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uses       INTEGER NOT NULL DEFAULT 0,
    last_used  REAL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hooks_channel ON channel_hooks(channel_id);

CREATE TABLE IF NOT EXISTS audit_log (                   -- who did what, per server
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT NOT NULL,                           -- channel.create, member.kick, …
    target     TEXT NOT NULL DEFAULT '',                -- "#general", "@nova", role name
    detail     TEXT NOT NULL DEFAULT '',                -- short human-readable extras
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_log(server_id, id DESC);

CREATE TABLE IF NOT EXISTS digest_jobs (                 -- scheduled agent channel recaps
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id    INTEGER NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
    agent_id      INTEGER REFERENCES agents(id) ON DELETE SET NULL,  -- NULL => plain digest bot
    interval_secs INTEGER NOT NULL,
    last_run      REAL NOT NULL,
    created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS server_templates (            -- shareable server structure
    code       TEXT PRIMARY KEY,
    server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    snapshot   TEXT NOT NULL,                            -- JSON {name,channels,roles,automod,...}
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (                      -- scheduled server events
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  INTEGER REFERENCES channels(id) ON DELETE SET NULL,  -- announce spot
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at   REAL NOT NULL,                          -- epoch seconds
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'scheduled',      -- scheduled | live | cancelled
    interested  TEXT NOT NULL DEFAULT '[]',             -- JSON [user_id]
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_server ON events(server_id, starts_at);

-- ---------- workspaces: shared folders agents can read/write ----------
CREATE TABLE IF NOT EXISTS workspaces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT '🗂',
    root        TEXT NOT NULL,                          -- absolute folder on the host
    description TEXT NOT NULL DEFAULT '',
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_server ON workspaces(server_id);

CREATE TABLE IF NOT EXISTS workspace_files (            -- one row per tracked path
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,                         -- posix, relative to root
    size         INTEGER NOT NULL DEFAULT 0,
    mtime        REAL NOT NULL DEFAULT 0,
    updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at   REAL NOT NULL DEFAULT 0,
    UNIQUE(workspace_id, path)
);

CREATE TABLE IF NOT EXISTS workspace_revisions (        -- every write keeps the old bytes
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    size         INTEGER NOT NULL DEFAULT 0,
    author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    agent_id     INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    source       TEXT NOT NULL DEFAULT 'human',         -- human | agent | restore
    note         TEXT NOT NULL DEFAULT '',
    created_at   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wrev_path ON workspace_revisions(workspace_id, path, id DESC);

CREATE TABLE IF NOT EXISTS workspace_grants (           -- who may do what, per workspace
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level        TEXT NOT NULL DEFAULT 'read',          -- read | write | admin
    granted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   REAL NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_sessions (         -- live editor presence
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path         TEXT NOT NULL DEFAULT '',
    last_seen    REAL NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_audit (            -- every agent/human file action
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    agent_id     INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,                         -- read | write | create | delete | move | exec | grant
    path         TEXT NOT NULL DEFAULT '',
    detail       TEXT NOT NULL DEFAULT '',
    ok           INTEGER NOT NULL DEFAULT 1,
    created_at   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waudit_ws ON workspace_audit(workspace_id, id DESC);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init():
    with db() as conn:
        conn.executescript(SCHEMA)
        # forward-migrate existing DBs
        for col, ddl in [
            ("agents.icon", "ALTER TABLE agents ADD COLUMN icon TEXT NOT NULL DEFAULT '🤖'"),
            ("agents.forked_from", "ALTER TABLE agents ADD COLUMN forked_from TEXT NOT NULL DEFAULT ''"),
            ("messages.pinned", "ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"),
            ("messages.attachments", "ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'"),
            ("messages.pack_id", "ALTER TABLE messages ADD COLUMN pack_id INTEGER REFERENCES agent_packs(id) ON DELETE SET NULL"),
            ("messages.edited_at", "ALTER TABLE messages ADD COLUMN edited_at REAL"),
            ("messages.reply_to", "ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL"),
            ("messages.thread_root", "ALTER TABLE messages ADD COLUMN thread_root INTEGER REFERENCES messages(id) ON DELETE CASCADE"),
            ("messages.embed", "ALTER TABLE messages ADD COLUMN embed TEXT"),
            ("messages.fwd_of", "ALTER TABLE messages ADD COLUMN fwd_of INTEGER REFERENCES messages(id) ON DELETE SET NULL"),
            ("users.seen_buzz", "ALTER TABLE users ADD COLUMN seen_buzz REAL NOT NULL DEFAULT 0"),
            ("users.muted", "ALTER TABLE users ADD COLUMN muted TEXT"),
            ("users.notify_mentions", "ALTER TABLE users ADD COLUMN notify_mentions TEXT"),
            ("users.status_text", "ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT ''"),
            ("agent_packs.forked_from", "ALTER TABLE agent_packs ADD COLUMN forked_from TEXT NOT NULL DEFAULT ''"),
            ("channels.roster", "ALTER TABLE channels ADD COLUMN roster TEXT NOT NULL DEFAULT '[]'"),
            ("channels.category", "ALTER TABLE channels ADD COLUMN category TEXT NOT NULL DEFAULT ''"),
            ("channels.slowmode_secs", "ALTER TABLE channels ADD COLUMN slowmode_secs INTEGER NOT NULL DEFAULT 0"),
            ("channels.role_id", "ALTER TABLE channels ADD COLUMN role_id INTEGER"),
            ("messages.poll", "ALTER TABLE messages ADD COLUMN poll TEXT"),
            ("channel_members.last_read", "ALTER TABLE channel_members ADD COLUMN last_read REAL NOT NULL DEFAULT 0"),
            ("server_members.nickname", "ALTER TABLE server_members ADD COLUMN nickname TEXT NOT NULL DEFAULT ''"),
            ("servers.starboard_cid", "ALTER TABLE servers ADD COLUMN starboard_cid INTEGER"),
            ("servers.star_threshold", "ALTER TABLE servers ADD COLUMN star_threshold INTEGER NOT NULL DEFAULT 3"),
            ("users.supabase_uid", "ALTER TABLE users ADD COLUMN supabase_uid TEXT"),
            ("users.email", "ALTER TABLE users ADD COLUMN email TEXT"),
            ("servers.icon_file", "ALTER TABLE servers ADD COLUMN icon_file TEXT REFERENCES files(id)"),
            ("agents.temperature", "ALTER TABLE agents ADD COLUMN temperature REAL"),
            ("users.llm_url", "ALTER TABLE users ADD COLUMN llm_url TEXT NOT NULL DEFAULT ''"),
            ("users.llm_key", "ALTER TABLE users ADD COLUMN llm_key TEXT NOT NULL DEFAULT ''"),
            ("users.llm_model", "ALTER TABLE users ADD COLUMN llm_model TEXT NOT NULL DEFAULT ''"),
            ("users.llm_kind", "ALTER TABLE users ADD COLUMN llm_kind TEXT NOT NULL DEFAULT 'openai'"),
            ("users.server_muted", "ALTER TABLE users ADD COLUMN server_muted TEXT"),
            ("channels.voice_cap", "ALTER TABLE channels ADD COLUMN voice_cap INTEGER NOT NULL DEFAULT 0"),
            ("users.server_order", "ALTER TABLE users ADD COLUMN server_order TEXT"),
            ("servers.llm_url", "ALTER TABLE servers ADD COLUMN llm_url TEXT"),
            ("servers.llm_key", "ALTER TABLE servers ADD COLUMN llm_key TEXT"),
            ("servers.llm_model", "ALTER TABLE servers ADD COLUMN llm_model TEXT"),
            ("servers.llm_kind", "ALTER TABLE servers ADD COLUMN llm_kind TEXT NOT NULL DEFAULT 'openai'"),
            ("agents.context_url", "ALTER TABLE agents ADD COLUMN context_url TEXT"),
            ("agents.context_method", "ALTER TABLE agents ADD COLUMN context_method TEXT NOT NULL DEFAULT 'GET'"),
            ("users.llm_headers", "ALTER TABLE users ADD COLUMN llm_headers TEXT"),
            ("agents.api_kind", "ALTER TABLE agents ADD COLUMN api_kind TEXT NOT NULL DEFAULT ''"),
            ("agents.api_url", "ALTER TABLE agents ADD COLUMN api_url TEXT NOT NULL DEFAULT ''"),
            ("agents.api_key", "ALTER TABLE agents ADD COLUMN api_key TEXT NOT NULL DEFAULT ''"),
            ("agents.api_headers", "ALTER TABLE agents ADD COLUMN api_headers TEXT"),
            ("agents.context_headers", "ALTER TABLE agents ADD COLUMN context_headers TEXT"),
            ("messages.webhook_id", "ALTER TABLE messages ADD COLUMN webhook_id INTEGER"),
            ("messages.author_name", "ALTER TABLE messages ADD COLUMN author_name TEXT"),
            ("messages.title", "ALTER TABLE messages ADD COLUMN title TEXT"),
            ("channels.lurkers", "ALTER TABLE channels ADD COLUMN lurkers TEXT NOT NULL DEFAULT '[]'"),
            ("servers.automod", "ALTER TABLE servers ADD COLUMN automod TEXT NOT NULL DEFAULT '{}'"),
            ("messages.system", "ALTER TABLE messages ADD COLUMN system TEXT NOT NULL DEFAULT ''"),
            ("server_members.timeout_until", "ALTER TABLE server_members ADD COLUMN timeout_until REAL"),
            ("users.keywords", "ALTER TABLE users ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'"),
            ("channels.forum_tags", "ALTER TABLE channels ADD COLUMN forum_tags TEXT NOT NULL DEFAULT '[]'"),
            ("messages.tags", "ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"),
            ("users.banner_color", "ALTER TABLE users ADD COLUMN banner_color TEXT NOT NULL DEFAULT ''"),
            ("channels.ai_flags", "ALTER TABLE channels ADD COLUMN ai_flags TEXT NOT NULL DEFAULT '{}'"),
            ("users.pronouns", "ALTER TABLE users ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''"),
            ("channels.workspace_id", "ALTER TABLE channels ADD COLUMN workspace_id INTEGER"),
            ("workspaces.chat_channel_id", "ALTER TABLE workspaces ADD COLUMN chat_channel_id INTEGER"),
            ("user_connections.refresher", "ALTER TABLE user_connections ADD COLUMN refresher TEXT"),
            ("user_connections.extra", "ALTER TABLE user_connections ADD COLUMN extra TEXT"),
            ("agents.use_who", "ALTER TABLE agents ADD COLUMN use_who TEXT NOT NULL DEFAULT ''"),
            ("agents.use_when", "ALTER TABLE agents ADD COLUMN use_when TEXT NOT NULL DEFAULT 'always'"),
            ("agents.ai_flags", "ALTER TABLE agents ADD COLUMN ai_flags TEXT NOT NULL DEFAULT '{}'"),
            ("users.is_admin", "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"),
            ("users.role", "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"),
        ]:
            table, c = col.split(".")
            try:
                conn.execute(f"SELECT {c} FROM {table} LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute(ddl)
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_users_sub ON users(supabase_uid)")
        except sqlite3.OperationalError:
            pass
        # orphaned streaming cursors: replies in-flight when the backend last
        # stopped end in ▌ forever — mark them interrupted on boot.
        conn.execute(
            "UPDATE messages SET content = RTRIM(RTRIM(content,'▌')) "
            "|| ' *(interrupted)*' WHERE content LIKE '%▌'")
        # keep role ↔ is_admin coherent both directions
        conn.execute("UPDATE users SET role='admin' WHERE is_admin=1 AND role='user'")
        conn.execute("UPDATE users SET is_admin=1 WHERE role='admin' AND is_admin=0")
        # permanent site admins — env-listed usernames are re-promoted every boot
        if ADMINS:
            conn.execute(
                "UPDATE users SET is_admin=1, role='admin' WHERE lower(username) IN (%s)"
                % ",".join("?" * len(ADMINS)), ADMINS)


def now():
    return time.time()


def row_to_dict(row):
    d = dict(row)
    for k in ("tags", "attachments"):
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                d[k] = []
    return d


def emit_buzz(conn, user_id, kind, payload):
    conn.execute(
        "INSERT INTO buzz(user_id, kind, payload, created_at) VALUES (?,?,?,?)",
        (user_id, kind, json.dumps(payload), now()),
    )
