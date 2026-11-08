"""SignalTeams API — Discord-smooth chat + Buzz feed + shared agent library.

Thin app factory: routers live in app/routes/, shared serializers in
helpers.py, background tasks in services.py, request models in schemas.py.
"""
import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init
from .routes import agents, auth, dms, engage, friends, hooks, messages, misc, packs, playground, servers, ws
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
            agents, playground, packs, hooks, misc, ws):
    app.include_router(mod.router)


@app.on_event("startup")
async def _start_reminder_loop():
    asyncio.create_task(reminder_loop())
    asyncio.create_task(digest_loop())
    asyncio.create_task(event_loop())


# LAN / single-port mode: serve the built frontend if dist exists
_dist = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_dist, html=True), name="dist")
