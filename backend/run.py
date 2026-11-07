"""Dev runner: uvicorn on :8075. AGENTHIVE_HOST=0.0.0.0 exposes it to your LAN."""
import os
import uvicorn


def _load_dotenv():
    """Minimal .env loader — sets vars not already present in os.environ."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_dotenv()

if __name__ == "__main__":
    # reload=True orphans worker processes on Windows (they inherit the socket and
    # serve stale code) — opt in explicitly with AGENTHIVE_RELOAD=1.
    uvicorn.run("app.main:app",
                host=os.environ.get("AGENTHIVE_HOST", "127.0.0.1"),
                port=int(os.environ.get("AGENTHIVE_PORT", "8075")),
                reload=os.environ.get("AGENTHIVE_RELOAD") == "1")
