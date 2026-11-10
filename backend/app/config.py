"""Central config — every AGENTHIVE_* / SUPABASE_* tunable lives here.

Importing this module also loads backend/.env (sets vars not already present).
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv():
    """Minimal .env loader — sets vars not already present in os.environ."""
    try:
        with open(os.path.join(BASE_DIR, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_dotenv()

DB_PATH = os.environ.get("AGENTHIVE_DB", os.path.join(BASE_DIR, "agenthive.db"))

HOST = os.environ.get("AGENTHIVE_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENTHIVE_PORT", "8075"))
RELOAD = os.environ.get("AGENTHIVE_RELOAD") == "1"

OLLAMA = os.environ.get("AGENTHIVE_OLLAMA", "http://127.0.0.1:11434")
LMSTUDIO = os.environ.get("AGENTHIVE_LMSTUDIO", "http://127.0.0.1:1234")
MODELDIR = os.environ.get("AGENTHIVE_MODELDIR", "D:/AI-Models")
LLM_TIMEOUT = float(os.environ.get("AGENTHIVE_LLM_TIMEOUT", "90"))

ENV_LLM = None
if os.environ.get("AGENTHIVE_LLM_URL"):
    ENV_LLM = {"url": os.environ["AGENTHIVE_LLM_URL"].rstrip("/"),
               "key": os.environ.get("AGENTHIVE_LLM_KEY", ""),
               "model": os.environ.get("AGENTHIVE_LLM_MODEL", ""),
               "kind": os.environ.get("AGENTHIVE_LLM_KIND", "openai")}

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# ---- site admins ----
# Comma-separated usernames that are PERMANENT site admins: re-promoted on
# every boot and honored by require_admin even if users.is_admin were wiped.
ADMINS = [u.strip().lower() for u in
          os.environ.get("AGENTHIVE_ADMINS", "").split(",") if u.strip()]

# OAuth app credentials for Settings → Connections → Plugins. Each plugin can
# also carry per-user saved creds in user_connections.extra — env wins when set.
GOOGLE_CLIENT_ID = os.environ.get("AGENTHIVE_GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("AGENTHIVE_GOOGLE_CLIENT_SECRET", "")
AZURE_CLIENT_ID = os.environ.get("AGENTHIVE_AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.environ.get("AGENTHIVE_AZURE_CLIENT_SECRET", "")
AZURE_TENANT = os.environ.get("AGENTHIVE_AZURE_TENANT", "common")
GITHUB_CLIENT_ID = os.environ.get("AGENTHIVE_GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("AGENTHIVE_GITHUB_CLIENT_SECRET", "")

# ---- workspaces: shared folders agents can read/write ----
# Comma-separated absolute folders a workspace root must live under. Empty =
# any folder the backend process can reach (dev default).
WORKSPACE_ROOTS = [p.strip() for p in
                   os.environ.get("AGENTHIVE_WORKSPACE_ROOTS", "").split(",") if p.strip()]
WORKSPACE_MAX_BYTES = int(os.environ.get("AGENTHIVE_WORKSPACE_MAX_BYTES", str(2 * 1024 * 1024)))
WORKSPACE_MAX_FILES = int(os.environ.get("AGENTHIVE_WORKSPACE_MAX_FILES", "5000"))
WORKSPACE_EXEC = os.environ.get("AGENTHIVE_WORKSPACE_EXEC", "1") == "1"
WORKSPACE_EXEC_TIMEOUT = float(os.environ.get("AGENTHIVE_WORKSPACE_EXEC_TIMEOUT", "20"))
WORKSPACE_AGENT_TOOLS = os.environ.get("AGENTHIVE_WORKSPACE_AGENT_TOOLS", "1") == "1"

# ---- nexus mesh: lemonade-nexus userspace mesh VPN (P2P encrypted) ----
# The backend joins the mesh as one host-level node and publishes :PORT to
# mesh peers — friends reach this hive through encrypted tunnels, no public
# port. "1" = join on boot, "0" = feature off, unset = on-demand via the API.
NEXUS = os.environ.get("AGENTHIVE_NEXUS", "")
NEXUS_SDK = os.environ.get("AGENTHIVE_NEXUS_SDK", "")       # SDK lib override
NEXUS_DOMAIN = os.environ.get("AGENTHIVE_NEXUS_DOMAIN", "")  # default lemonade-nexus.io
NEXUS_REGION = os.environ.get("AGENTHIVE_NEXUS_REGION", "")  # default us-west
NEXUS_SERVER = os.environ.get("AGENTHIVE_NEXUS_SERVER", "")  # host[:port] pin
NEXUS_VPORT = int(os.environ.get("AGENTHIVE_NEXUS_VPORT", "0"))  # mesh port (0 = PORT)
