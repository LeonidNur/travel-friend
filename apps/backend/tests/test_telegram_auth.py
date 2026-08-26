"""Integration tests for Telegram login and opaque sessions."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from collections.abc import Iterator
from urllib.parse import urlencode

import psycopg
import pytest
from fastapi.testclient import TestClient

from travel_friend_backend.config import BackendSettings


TEST_BOT_TOKEN = "test-bot-token-for-telegram-auth"
# The module-level FastAPI application is initialized during this import. This
# test-only value keeps integration tests independent of production secrets.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-test-import")
from travel_friend_backend.main import create_app


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def sign_init_data(user: dict[str, object], *, auth_date: int | None = None) -> str:
    fields = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", TEST_BOT_TOKEN.encode(), hashlib.sha256).digest()
    return urlencode({**fields, "hash": hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()})


@pytest.fixture
def database_url() -> str:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return TEST_DATABASE_URL


@pytest.fixture(autouse=True)
def clean_database(database_url: str) -> Iterator[None]:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "TRUNCATE public.user_sessions, public.travel_intents, "
                "public.profile_photos, public.profiles, "
                "public.user_activity_states, public.user_settings, "
                "public.telegram_identities, public.users RESTART IDENTITY"
            )
    yield


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    app = create_app(BackendSettings(telegram_bot_token=TEST_BOT_TOKEN, database_url=database_url))
    with TestClient(app) as test_client:
        yield test_client


def telegram_user(**overrides: object) -> dict[str, object]:
    return {"id": 123456789, "first_name": "Ada", "last_name": "Lovelace", "username": "ada", "language_code": "en", **overrides}


def login(client: TestClient, user: dict[str, object] | None = None):
    return client.post("/auth/telegram", json={"init_data": sign_init_data(user or telegram_user())})


def test_first_login_creates_identity_defaults_and_bootstrap(client: TestClient, database_url: str) -> None:
    response = login(client)
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["onboarding"] == {"status": "not_started"}
    assert payload["profile_exists"] is False
    assert payload["travel_intent_exists"] is False
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM public.users")
            user_id = cursor.fetchone()["id"]
            cursor.execute("SELECT user_id FROM public.telegram_identities")
            assert cursor.fetchone()["user_id"] == user_id
            cursor.execute("SELECT onboarding_status FROM public.user_activity_states")
            assert cursor.fetchone()["onboarding_status"] == "not_started"
            cursor.execute("SELECT user_id FROM public.user_settings")
            assert cursor.fetchone()["user_id"] == user_id


def test_repeat_login_updates_metadata_without_second_user_or_profile(client: TestClient, database_url: str) -> None:
    first = login(client)
    second = login(client, telegram_user(username="ada-updated", first_name="Augusta"))
    assert first.status_code == second.status_code == 200
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) AS count FROM public.users")
            assert cursor.fetchone()["count"] == 1
            cursor.execute("SELECT username, first_name FROM public.telegram_identities")
            assert cursor.fetchone() == {"username": "ada-updated", "first_name": "Augusta"}
            cursor.execute("SELECT count(*) AS count FROM public.profiles")
            assert cursor.fetchone()["count"] == 0


def test_deleted_user_cannot_authenticate(client: TestClient, database_url: str) -> None:
    assert login(client).status_code == 200
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE public.users SET deleted_at = now()")
    assert login(client).status_code == 403


@pytest.mark.parametrize("init_data", ["invalid", None])
def test_invalid_init_data_is_rejected(client: TestClient, init_data: str | None) -> None:
    assert client.post("/auth/telegram", json={"init_data": init_data}).status_code == 401


def test_stale_init_data_is_rejected(client: TestClient) -> None:
    response = client.post("/auth/telegram", json={"init_data": sign_init_data(telegram_user(), auth_date=int(time.time()) - 601)})
    assert response.status_code == 401


def test_session_stores_only_hash_and_bearer_authenticates(client: TestClient, database_url: str) -> None:
    token = login(client).json()["access_token"]
    assert client.get("/auth/test-current", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT token_hash FROM public.user_sessions")
            assert cursor.fetchone()["token_hash"] == hashlib.sha256(token.encode()).hexdigest()


@pytest.mark.parametrize("authorization", [None, "Bearer unknown-token", "Basic ignored"])
def test_invalid_or_unknown_bearer_token_is_rejected(client: TestClient, authorization: str | None) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    assert client.get("/auth/test-current", headers=headers).status_code == 401


def test_expired_and_revoked_sessions_are_rejected(client: TestClient, database_url: str) -> None:
    token = login(client).json()["access_token"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.user_sessions "
                "SET created_at = now() - interval '2 days', "
                "expires_at = now() - interval '1 second'"
            )
    assert client.get("/auth/test-current", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    active_token = login(client).json()["access_token"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE public.user_sessions SET revoked_at = now() WHERE token_hash = %s", (hashlib.sha256(active_token.encode()).hexdigest(),))
    assert client.get("/auth/test-current", headers={"Authorization": f"Bearer {active_token}"}).status_code == 401


def test_logout_revokes_only_current_session_and_user_can_have_many_sessions(client: TestClient, database_url: str) -> None:
    first_token = login(client).json()["access_token"]
    second_token = login(client).json()["access_token"]
    assert client.post("/auth/logout", headers={"Authorization": f"Bearer {first_token}"}).status_code == 204
    assert client.get("/auth/test-current", headers={"Authorization": f"Bearer {first_token}"}).status_code == 401
    assert client.get("/auth/test-current", headers={"Authorization": f"Bearer {second_token}"}).status_code == 200
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM public.user_sessions")
            assert cursor.fetchone()[0] == 2


def test_bootstrap_reflects_profile_and_active_travel_intent(client: TestClient, database_url: str) -> None:
    user_id = login(client).json()["user"]["id"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Ada')", (user_id,))
            cursor.execute("INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, 'London', 'active')", (user_id,))
    second = login(client).json()
    assert second["profile_exists"] is True
    assert second["travel_intent_exists"] is True
