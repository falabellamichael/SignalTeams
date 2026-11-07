"""One-shot refactor: split app/main.py into schemas/helpers/services/routes/*.

Uses ast to slice top-level definitions verbatim into target modules, then
computes each file's imports from the names it actually loads.
"""
import ast
import builtins
import io
import os
import re
import tokenize

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "app", "main.py")

with open(SRC, encoding="utf-8") as f:
    SRC_TEXT = f.read()
LINES = SRC_TEXT.splitlines(keepends=True)
TREE = ast.parse(SRC_TEXT)

BUILTINS = set(dir(builtins)) | {"self"}

# ---------- target assignment ----------

SCHEMAS = """RegisterIn LoginIn ProfileIn FriendIn ServerIn JoinIn ChannelIn
MessageIn PackIn AgentIn SupabaseIn PasswordIn ServerPatch NickIn TransferIn
RoleIn MemberRoleIn ChannelPatch GroupDmIn AgentDmAddIn DmRenameIn SummarizeIn
KnockIn ReminderIn EditIn ReactIn ReviewIn TryIn LlmConfigIn AgentConnectIn""".split()

HELPERS = """public_user friend_ids can_see_agent agent_json channel_member_ids
reactions_json pack_agent_ids can_see_pack channel_json pack_json message_json
_meta_content unfurl agent_bot_user starboard_bot_user is_blocked _gated_channel
_fmt_due _day_ts _parse_search _split_model _pub_server _grounding _agent_llm
_sysprompt _server_llm _user_llm
AVATAR_COLORS AVATAR_EMOJIS URL_RE STAR_EMOJI _SEARCH_KEYS _ENV_LLM""".split()

SERVICES = """starboard_check bot_post _summarize_task reminder_loop agent_reply
_server_changed _agent_cool SCRIBE_BOT REMIND_BOT""".split()

ROUTES = {
    "auth": """register login auth_config supabase_login _supabase_user
        _slug_username SUPABASE_URL SUPABASE_ANON logout me change_password
        signout_others export_me update_me people profile""".split(),
    "friends": """friends add_friend my_blocks toggle_block accept_friend
        remove_friend""".split(),
    "servers": """my_servers create_server invite_info join_server edit_server
        regen_invite delete_server leave_server kick_member set_nick
        transfer_server get_server server_pulse add_role del_role
        toggle_member_role add_channel edit_channel reorder_channels del_channel
        ROLE_COLORS""".split(),
    "dms": """my_dms group_dm add_to_group_dm add_agent_to_dm rename_group_dm
        leave_group_dm open_dm open_agent_dm""".split(),
    "messages": """get_messages mark_read read_all mark_unread post_message
        delete_message edit_message react pin_message get_pins save_message
        my_saved search_messages get_thread global_search peek_message""".split(),
    "engage": """summarize knock_channel list_knocks resolve_knock add_reminder
        my_reminders del_reminder huddle""".split(),
    "agents": """list_agents trending_agents agent_stats create_agent get_agent
        update_agent delete_agent star_agent install_agent export_agent
        import_agent my_bench fork_agent agent_history list_reviews
        post_review""".split(),
    "playground": """get_llm_config put_llm_config test_llm_config
        test_server_llm llm_providers put_agent_connect test_agent_connect
        try_agent try_agent_stream""".split(),
    "packs": """list_packs create_pack get_pack delete_pack fork_pack
        bench_pack""".split(),
    "misc": """add_emoji del_emoji upload get_file buzz_feed inbox health stats
        EMOJI_MAX EMOJI_PER_SERVER MAX_UPLOAD""".split(),
    "ws": """ws_endpoint""".split(),
}

MAIN_KEEP = {"_start_reminder_loop"}  # function that stays in main.py

TARGET = {}
for n in SCHEMAS:
    TARGET[n] = "schemas.py"
for n in HELPERS:
    TARGET[n] = "helpers.py"
for n in SERVICES:
    TARGET[n] = "services.py"
for mod, names in ROUTES.items():
    for n in names:
        TARGET[n] = f"routes/{mod}.py"
for n in MAIN_KEEP:
    TARGET[n] = "main.py"

# ---------- collect top-level nodes ----------

def node_name(n):
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return n.name
    if isinstance(n, ast.Assign):
        t = n.targets[0]
        return t.id if isinstance(t, ast.Name) else None
    if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
        return n.target.id
    return None


groups = {}          # file -> [(start, end, node)]
unclaimed = []
for n in TREE.body:
    start = n.lineno
    if getattr(n, "decorator_list", None):
        start = min(start, *(d.lineno for d in n.decorator_list))
    name = node_name(n)
    tgt = TARGET.get(name)
    if tgt is None:
        unclaimed.append((start, n.end_lineno, n, name))
    else:
        groups.setdefault(tgt, []).append((start, n.end_lineno, n))

print("UNCLAIMED (goes to main.py):")
for s, e, n, name in unclaimed:
    print(f"  {s}-{e} {type(n).__name__} {name or ast.dump(n)[:80]}")

# ---------- name->module map ----------

DEFINER = {}  # name -> file that defines it
for f, items in groups.items():
    for _, _, n in items:
        nm = node_name(n)
        if nm:
            DEFINER[nm] = f

FASTAPI = {"Depends", "FastAPI", "File", "Form", "HTTPException", "Query",
           "Request", "UploadFile", "WebSocket", "WebSocketDisconnect",
           "APIRouter", "Body"}
EXT = {
    "Response": ("fastapi.responses", ["Response"]),
    "StreamingResponse": ("fastapi.responses", ["StreamingResponse"]),
    "CORSMiddleware": ("fastapi.middleware.cors", ["CORSMiddleware"]),
    "BaseModel": ("pydantic", ["BaseModel"]),
    "Field": ("pydantic", ["Field"]),
    "db": ("{rel}db", ["db"]),
    "emit_buzz": ("{rel}db", ["emit_buzz"]),
    "init": ("{rel}db", ["init"]),
    "now": ("{rel}db", ["now"]),
    "row_to_dict": ("{rel}db", ["row_to_dict"]),
    "create_session": ("{rel}auth", ["create_session"]),
    "current_user": ("{rel}auth", ["current_user"]),
    "get_token": ("{rel}auth", ["get_token"]),
    "hash_password": ("{rel}auth", ["hash_password"]),
    "optional_user": ("{rel}auth", ["optional_user"]),
    "user_by_token": ("{rel}auth", ["user_by_token"]),
    "verify_password": ("{rel}auth", ["verify_password"]),
    "hub": ("{rel}hub", ["hub"]),
}
STDLIB = {"asyncio", "json", "os", "re", "secrets", "time", "queue",
          "threading", "urllib", "math", "html"}


def used_names(nodes):
    out = set()
    for _, _, n in nodes:
        for w in ast.walk(n):
            if isinstance(w, ast.Name) and isinstance(w.ctx, ast.Load):
                out.add(w.id)
    return out


def emit(fname, items, doc, rel):
    """rel = '.' for app/ modules, '..' for app/routes/ modules."""
    body_names = used_names(items)
    local_defs = {node_name(n) for _, _, n in items} - {None}

    is_route = fname.startswith("routes/")
    std, fast, ext = set(), set(), {}
    if is_route:
        fast.add("APIRouter")
    cross = {}  # module file -> set(names)
    for name in sorted(body_names):
        if name in BUILTINS or name in local_defs or name == "router":
            continue
        if name in STDLIB:
            std.add(name)
        elif name in FASTAPI:
            fast.add(name)
        elif name in EXT:
            mod, _ = EXT[name]
            ext.setdefault(mod, set()).add(name)
        elif name in DEFINER:
            src = DEFINER[name]
            if src != fname:
                cross.setdefault(src, set()).add(name)
        else:
            print(f"  !! {fname}: unresolved name {name}")

    out = [f'"""{doc}"""\n']
    for m in sorted(std):
        if m == "urllib":
            out.append("import urllib.error\nimport urllib.request\n")
        else:
            out.append(f"import {m}\n")
    if std:
        out.append("\n")
    if fast:
        out.append(f"from fastapi import {', '.join(sorted(fast))}\n")
    for mod in sorted(ext):
        out.append(f"from {mod.format(rel=rel)} import {', '.join(sorted(ext[mod]))}\n")
    if fast or ext:
        out.append("\n")
    for src in sorted(cross):
        out.append(f"from {rel}{src[:-3].replace('/', '.')} import "
                   f"{', '.join(sorted(cross[src]))}\n")
    if cross:
        out.append("\n")

    if is_route:
        out.append("router = APIRouter()\n\n\n")
    for s, e, _ in sorted(items):
        seg = "".join(LINES[s - 1:e])
        if is_route:
            seg = re.sub(r"@app\.", "@router.", seg)
        out.append(seg.rstrip() + "\n\n\n")
    return "".join(out).rstrip() + "\n"


# ---------- write files ----------

DOCS = {
    "schemas.py": "Pydantic request models for the SignalTeams API.",
    "helpers.py": "Shared serializers, lookups, and pure helpers.",
    "services.py": "Async background services: bot posts, starboard, agent replies, reminders.",
    "routes/auth.py": "Auth + account endpoints.",
    "routes/friends.py": "Friends and blocks.",
    "routes/servers.py": "Servers, members, roles, and channels.",
    "routes/dms.py": "Direct messages and group DMs.",
    "routes/messages.py": "Channel messages: CRUD, reactions, pins, saved, search.",
    "routes/engage.py": "Engagement extras: scribe recaps, knocks, reminders, huddle.",
    "routes/agents.py": "Agent library: CRUD, stars, installs, forks, reviews.",
    "routes/playground.py": "LLM endpoints + agent playground (try/stream/connect).",
    "routes/packs.py": "Agent packs: shareable bundles.",
    "routes/misc.py": "Misc: emoji, uploads, buzz feed, inbox, health.",
    "routes/ws.py": "Realtime websocket endpoint.",
}

os.makedirs(os.path.join(ROOT, "app", "routes"), exist_ok=True)
with open(os.path.join(ROOT, "app", "routes", "__init__.py"), "w",
          encoding="utf-8") as f:
    f.write('"""SignalTeams route modules."""\n')

for fname, items in sorted(groups.items()):
    if fname == "main.py":
        continue
    rel = ".." if fname.startswith("routes/") else "."
    txt = emit(fname, items, DOCS.get(fname, fname), rel)
    path = os.path.join(ROOT, "app", fname.replace("/", os.sep))
    with open(path, "w", encoding="utf-8") as f:
        f.write(txt)
    print(f"WROTE {fname}: {len(items)} nodes, {txt.count(chr(10))} lines")
