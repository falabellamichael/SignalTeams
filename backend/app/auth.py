"""Auth: pbkdf2 password hashing + bearer-token sessions. Stdlib only."""
import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request

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


async def optional_user(request: Request):
    token = get_token(request)
    with db() as conn:
        row = user_by_token(conn, token)
        return dict(row) if row else None
