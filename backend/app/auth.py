"""Auth: pbkdf2 password hashing + bearer-token sessions. Stdlib only."""
import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request

from .config import ADMINS
from .db import db

_ITER = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITER)
    return f"pbkdf2${_ITER}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, hexdk = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), hexdk)
    except Exception:
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(conn, user_id: int) -> str:
    token = new_token()
    conn.execute(
        "INSERT INTO sessions(token, user_id, created_at) VALUES (?,?,?)",
        (token, user_id, __import__("time").time()),
    )
    return token


def user_by_token(conn, token: str):
    if not token:
        return None
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        (token,),
    ).fetchone()
    return row


def get_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.query_params.get("token", "")


async def current_user(request: Request):
    token = get_token(request)
    with db() as conn:
        row = user_by_token(conn, token)
        if not row:
            raise HTTPException(401, "Not authenticated")
        return dict(row)


async def require_admin(request: Request):
    """Site-admin gate. Env-listed names (AGENTHIVE_ADMINS) always pass —
    they're permanent — otherwise the users.is_admin flag decides."""
    user = await current_user(request)
    if user.get("is_admin") or user["username"].lower() in ADMINS:
        return user
    raise HTTPException(403, "Site admins only")


async def require_mod(request: Request):
    """Mod tier: admins pass; users.role='mod' passes; plain users don't."""
    user = await current_user(request)
    if (user.get("is_admin") or user["username"].lower() in ADMINS
            or user.get("role") == "mod"):
        return user
    raise HTTPException(403, "Mods only")


async def optional_user(request: Request):
    token = get_token(request)
    with db() as conn:
        row = user_by_token(conn, token)
        return dict(row) if row else None
