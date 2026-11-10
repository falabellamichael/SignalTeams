"""SignalTeams API — Discord-smooth chat + Buzz feed + shared agent library.

Thin app factory: routers live in app/routes/, shared serializers in
helpers.py, background tasks in services.py, request models in schemas.py.
"""
import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init
from .routes import agents, auth, connections, dms, engage, friends, hooks, messages, misc, nexus, packs, playground, servers, workspaces, ws
from .services import digest_loop, event_loop, reminder_loop

init()
app = FastAPI(title="SignalTeams", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for mod in (auth, friends, servers, dms, messages, engage,
            agents, playground, packs, hooks, workspaces, connections, misc, nexus, ws):
    app.include_router(mod.router)


@app.on_event("startup")
async def _start_reminder_loop():
    asyncio.create_task(reminder_loop())
    asyncio.create_task(digest_loop())
    asyncio.create_task(event_loop())
    # nexus mesh node: rejoin on boot when it was connected (or forced on)
    from . import nexus as _nexus_mod
    if _nexus_mod.autostart_enabled() and _nexus_mod.sdk_available():
        asyncio.create_task(asyncio.to_thread(_nexus_mod.NODE.start))


# LAN / single-port mode: serve the built frontend if dist exists
_dist = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles

    class _DistFiles(StaticFiles):
        """index.html must revalidate (a stale copy 404s hashed chunks after a
        rebuild); content-hashed /assets can be cached forever."""
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            if resp.status_code == 200:
                # path arrives OS-native here: "." for the mount root,
                # "assets\x.js" (backslash) on Windows — normalize both
                p = path.replace("\\", "/").lstrip("/")
                base = os.path.basename(p)
                if p in ("", ".") or base == "index.html" or "." not in base:
                    resp.headers["Cache-Control"] = "no-cache"
                elif p.startswith("assets/"):
                    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/", _DistFiles(directory=_dist, html=True), name="dist")
