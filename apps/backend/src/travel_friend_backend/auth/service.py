from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import psycopg
from fastapi import Depends, Header, HTTPException
from psycopg.rows import dict_row

SESSION_TTL = timedelta(days=30)

def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _db(url: str) -> psycopg.Connection:
    return psycopg.connect(url, row_factory=dict_row)

def login(database_url: str, identity: object) -> dict[str, object]:
    now = datetime.now(UTC)
    raw_token = secrets.token_urlsafe(48)
    with _db(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT u.id, u.deleted_at, ti.user_id FROM users u JOIN telegram_identities ti ON ti.user_id=u.id WHERE ti.telegram_user_id=%s", (identity.telegram_user_id,))
            row = cur.fetchone()
            if row and row["deleted_at"] is not None:
                raise HTTPException(403, "User is deleted")
            if row:
                user_id = row["id"]
                cur.execute("UPDATE telegram_identities SET username=%s, first_name=%s, last_name=%s, language_code=%s, updated_at=now() WHERE user_id=%s", (identity.username, identity.first_name, identity.last_name, identity.language_code, user_id))
            else:
                cur.execute("INSERT INTO users DEFAULT VALUES RETURNING id")
                user_id = cur.fetchone()["id"]
                cur.execute("INSERT INTO telegram_identities (user_id, telegram_user_id, username, first_name, last_name, language_code) VALUES (%s,%s,%s,%s,%s,%s)", (user_id, identity.telegram_user_id, identity.username, identity.first_name, identity.last_name, identity.language_code))
                cur.execute("INSERT INTO user_settings (user_id) VALUES (%s)", (user_id,))
                cur.execute("INSERT INTO user_activity_states (user_id, onboarding_status) VALUES (%s,'not_started')", (user_id,))
            cur.execute("SELECT onboarding_status FROM user_activity_states WHERE user_id=%s", (user_id,))
            onboarding = cur.fetchone()["onboarding_status"]
            cur.execute(
                "SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=%s) AS profile_exists, "
                "EXISTS(SELECT 1 FROM travel_intents WHERE user_id=%s AND status='active') "
                "AS travel_intent_exists",
                (user_id, user_id),
            )
            bootstrap_flags = cur.fetchone()
            profile_exists = bootstrap_flags["profile_exists"]
            travel_exists = bootstrap_flags["travel_intent_exists"]
            expires = now + SESSION_TTL
            cur.execute("INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at) VALUES (%s,%s,%s,%s)", (user_id, token_hash(raw_token), now, expires))
    return {"access_token": raw_token, "token_type": "bearer", "expires_at": expires, "user": {"id": str(user_id)}, "onboarding": {"status": onboarding}, "profile_exists": profile_exists, "travel_intent_exists": travel_exists}

def current_user(database_url: str, authorization: str | None) -> tuple[dict[str, object], str]:
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(401, "Authentication required")
    with _db(database_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT u.id, s.id AS session_id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL", (token_hash(authorization[7:].strip()),))
        row = cur.fetchone()
    if not row: raise HTTPException(401, "Invalid authentication")
    return row, str(row["session_id"])

def auth_dependency(database_url: str | None, authorization: Annotated[str | None, Header()] = None):
    if not database_url:
        raise HTTPException(503, "Database is not configured")
    return current_user(database_url, authorization)
