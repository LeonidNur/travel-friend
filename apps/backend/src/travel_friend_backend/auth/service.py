from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Header, HTTPException, Request

from travel_friend_backend.db import database_connection

@dataclass(frozen=True, slots=True)
class AuthenticatedPrincipal:
    """Trusted identity resolved from an active backend session."""

    user_id: UUID
    session_id: UUID


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def login(database_url: str, identity: object) -> dict[str, object]:
    raw_token = secrets.token_urlsafe(48)
    with database_connection(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.bootstrap_telegram_login(%s,%s,%s,%s,%s,%s)",
                (
                    identity.telegram_user_id,
                    identity.username,
                    identity.first_name,
                    identity.last_name,
                    identity.language_code,
                    token_hash(raw_token),
                ),
            )
            row = cur.fetchone()
            if row["is_deleted"]:
                raise HTTPException(403, "User is deleted")
    return {
        "access_token": raw_token,
        "token_type": "bearer",
        "expires_at": row["expires_at"],
        "user": {"id": str(row["user_id"])},
        "onboarding": {"status": row["onboarding_status"]},
        "profile_exists": row["profile_exists"],
        "travel_intent_exists": row["travel_intent_exists"],
    }

def current_user(
    database_url: str, authorization: str | None
) -> AuthenticatedPrincipal:
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(401, "Authentication required")
    with database_connection(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT session_id, user_id FROM public.resolve_bearer_session(%s)",
            (token_hash(authorization[7:].strip()),),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(401, "Invalid authentication")
    return AuthenticatedPrincipal(user_id=row["user_id"], session_id=row["session_id"])


def auth_dependency(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedPrincipal:
    settings = request.app.state.backend_settings
    if not settings.database_url:
        raise HTTPException(503, "Database is not configured")
    return current_user(settings.database_url, authorization)
