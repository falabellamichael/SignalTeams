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
