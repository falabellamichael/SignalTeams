"""Dev runner: uvicorn on :8075. AGENTHIVE_HOST=0.0.0.0 exposes it to your LAN."""
import uvicorn

from app.config import HOST, PORT, RELOAD

if __name__ == "__main__":
    # reload=True orphans worker processes on Windows (they inherit the socket and
    # serve stale code) — opt in explicitly with AGENTHIVE_RELOAD=1.
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=RELOAD)
