"""Integration tests for Telegram login and opaque sessions."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from collections.abc import Iterator
from urllib.parse import urlencode
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from travel_friend_backend.config import BackendSettings
from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


TEST_BOT_TOKEN = "test-bot-token-for-telegram-auth"
# The module-level FastAPI application is initialized during this import. This
# test-only value keeps integration tests independent of production secrets.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-test-import")
from travel_friend_backend.main import create_app


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
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture(autouse=True)
def clean_database(database_url: str) -> Iterator[None]:
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
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


def test_profile_write_is_committed_before_a_separate_connection_reads_it(
    client: TestClient, database_url: str
) -> None:
    session = login(client).json()

    response = client.patch(
        "/me/profile",
        headers={"Authorization": f"Bearer {session['access_token']}"},
        json={"display_name": "Committed Ada", "city": "Moscow"},
    )

    assert response.status_code == 200
    with psycopg.connect(database_url) as connection:
        profile = connection.execute(
            "SELECT display_name, city FROM public.profiles WHERE user_id=%s",
            (session["user"]["id"],),
        ).fetchone()
    assert profile == ("Committed Ada", "Moscow")


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


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_onboarding_completion_prerequisites(client: TestClient, token: str) -> None:
    assert client.patch(
        "/me/profile", headers=auth_headers(token), json={"display_name": "Ada"}
    ).status_code == 200
    assert client.put(
        "/me/travel-intent", headers=auth_headers(token), json={"destination": "Lisbon"}
    ).status_code == 200


def test_get_current_user_profile_returns_existing_profile(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    user_id = login_response.json()["user"]["id"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.profiles "
                "(user_id, display_name, city, travel_style, interests) "
                "VALUES (%s, %s, %s, %s, %s)",
                (user_id, "Ada", "London", ["city-break"], ["math"]),
            )

    response = client.get(
        "/me/profile", headers=auth_headers(login_response.json()["access_token"])
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": response.json()["id"],
        "user_id": user_id,
        "display_name": "Ada",
        "birth_date": None,
        "gender": None,
        "city": "London",
        "bio": None,
        "travel_style": ["city-break"],
        "interests": ["math"],
        "budget_level": None,
        "comfort_level": None,
        "created_at": response.json()["created_at"],
        "updated_at": response.json()["updated_at"],
    }


def test_get_current_user_profile_returns_null_when_absent(client: TestClient) -> None:
    token = login(client).json()["access_token"]

    response = client.get("/me/profile", headers=auth_headers(token))

    assert response.status_code == 200
    assert response.json() is None


def test_current_user_profile_requires_authentication(client: TestClient) -> None:
    assert client.get("/me/profile").status_code == 401
    assert client.patch("/me/profile", json={"display_name": "Ada"}).status_code == 401


def test_current_user_travel_intent_requires_authentication(client: TestClient) -> None:
    assert client.get("/me/travel-intent").status_code == 401
    assert client.put("/me/travel-intent", json={"destination": "Lisbon"}).status_code == 401
    assert client.delete("/me/travel-intent").status_code == 401


def test_onboarding_can_transition_from_not_started_to_in_progress(client: TestClient) -> None:
    token = login(client).json()["access_token"]

    response = client.patch(
        "/me/onboarding",
        headers=auth_headers(token),
        json={"status": "in_progress"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "in_progress"}


def test_onboarding_completion_requires_a_profile_and_preserves_persisted_status(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client).json()
    user_id = login_response["user"]["id"]
    token = login_response["access_token"]
    assert client.put(
        "/me/travel-intent", headers=auth_headers(token), json={"destination": "Lisbon"}
    ).status_code == 200

    response = client.patch("/me/onboarding", headers=auth_headers(token), json={"status": "completed"})

    assert response.status_code == 409
    with psycopg.connect(database_url) as connection:
        status = connection.execute(
            "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s", (user_id,)
        ).fetchone()[0]
    assert status == "not_started"


def test_onboarding_completion_requires_an_active_travel_intent_and_preserves_persisted_status(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client).json()
    user_id = login_response["user"]["id"]
    token = login_response["access_token"]
    assert client.patch(
        "/me/profile", headers=auth_headers(token), json={"display_name": "Ada"}
    ).status_code == 200
    assert client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "in_progress"}
    ).status_code == 200

    response = client.patch("/me/onboarding", headers=auth_headers(token), json={"status": "completed"})

    assert response.status_code == 409
    with psycopg.connect(database_url) as connection:
        status = connection.execute(
            "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s", (user_id,)
        ).fetchone()[0]
    assert status == "in_progress"


def test_onboarding_completion_succeeds_with_a_profile_and_active_travel_intent(client: TestClient) -> None:
    login_response = login(client).json()
    token = login_response["access_token"]
    assert client.patch(
        "/me/profile", headers=auth_headers(token), json={"display_name": "Ada"}
    ).status_code == 200
    assert client.put(
        "/me/travel-intent", headers=auth_headers(token), json={"destination": "Lisbon"}
    ).status_code == 200

    response = client.patch("/me/onboarding", headers=auth_headers(token), json={"status": "completed"})

    assert response.status_code == 200
    assert response.json() == {"status": "completed"}


def test_onboarding_can_transition_from_in_progress_to_completed(client: TestClient) -> None:
    token = login(client).json()["access_token"]
    create_onboarding_completion_prerequisites(client, token)
    assert client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "in_progress"}
    ).status_code == 200

    response = client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "completed"}
    )

    assert response.status_code == 200
    assert response.json() == {"status": "completed"}


def test_onboarding_same_status_is_idempotent_without_touching_updated_at(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    user_id = login_response.json()["user"]["id"]
    token = login_response.json()["access_token"]
    first = client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "in_progress"}
    )
    assert first.status_code == 200
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT updated_at FROM public.user_activity_states WHERE user_id=%s", (user_id,)
            )
            updated_at = cursor.fetchone()["updated_at"]

    repeated = client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "in_progress"}
    )

    assert repeated.status_code == 200
    assert repeated.json() == {"status": "in_progress"}
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT updated_at FROM public.user_activity_states WHERE user_id=%s", (user_id,)
            )
            assert cursor.fetchone()["updated_at"] == updated_at


def test_onboarding_cannot_regress_from_completed(client: TestClient) -> None:
    token = login(client).json()["access_token"]
    create_onboarding_completion_prerequisites(client, token)
    assert client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "completed"}
    ).status_code == 200

    response = client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "in_progress"}
    )

    assert response.status_code == 409


def test_onboarding_requires_authentication(client: TestClient) -> None:
    assert client.patch("/me/onboarding", json={"status": "in_progress"}).status_code == 401


def test_onboarding_only_changes_the_authenticated_users_state(
    client: TestClient, database_url: str
) -> None:
    first = login(client, telegram_user(id=1))
    second = login(client, telegram_user(id=2))
    create_onboarding_completion_prerequisites(client, first.json()["access_token"])

    response = client.patch(
        "/me/onboarding",
        headers=auth_headers(first.json()["access_token"]),
        json={"status": "completed"},
    )

    assert response.status_code == 200
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s",
                (second.json()["user"]["id"],),
            )
            assert cursor.fetchone()["onboarding_status"] == "not_started"


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "not_started"},
        {"status": "in_progress", "user_id": "00000000-0000-0000-0000-000000000000"},
        {"status": "in_progress", "updated_at": "2026-01-01T00:00:00Z"},
        {"status": "in_progress", "unknown": "field"},
    ],
)
def test_onboarding_rejects_invalid_or_server_owned_fields(
    client: TestClient, payload: dict[str, object]
) -> None:
    token = login(client).json()["access_token"]

    assert client.patch("/me/onboarding", headers=auth_headers(token), json=payload).status_code == 422


def test_login_bootstrap_reflects_onboarding_transition(client: TestClient) -> None:
    token = login(client).json()["access_token"]
    create_onboarding_completion_prerequisites(client, token)
    assert client.patch(
        "/me/onboarding", headers=auth_headers(token), json={"status": "completed"}
    ).status_code == 200

    assert login(client).json()["onboarding"] == {"status": "completed"}


def test_get_current_user_travel_intent_returns_active_intent_only(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    user_id = login_response.json()["user"]["id"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.travel_intents "
                "(user_id, destination_label, date_from, date_to, status) "
                "VALUES (%s, %s, %s, %s, 'active')",
                (user_id, "Lisbon", "2026-10-01", "2026-10-14"),
            )

    response = client.get("/me/travel-intent", headers=auth_headers(login_response.json()["access_token"]))

    assert response.status_code == 200
    assert response.json()["user_id"] == user_id
    assert response.json()["destination"] == "Lisbon"
    assert response.json()["date_from"] == "2026-10-01"
    assert response.json()["date_to"] == "2026-10-14"
    assert response.json()["status"] == "active"


def test_get_current_user_travel_intent_returns_null_when_absent_or_only_archived(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    token = login_response.json()["access_token"]
    assert client.get("/me/travel-intent", headers=auth_headers(token)).json() is None

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.travel_intents "
                "(user_id, destination_label, status, archived_at) VALUES (%s, 'Rome', 'archived', now())",
                (login_response.json()["user"]["id"],),
            )

    response = client.get("/me/travel-intent", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json() is None


def test_put_current_user_travel_intent_creates_then_updates_one_active_intent(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    token = login_response.json()["access_token"]
    first = client.put(
        "/me/travel-intent",
        headers=auth_headers(token),
        json={"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14"},
    )
    second = client.put(
        "/me/travel-intent",
        headers=auth_headers(token),
        json={"destination": "Rome", "date_from": "2026-11-01", "date_to": None},
    )

    assert first.status_code == second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["destination"] == "Rome"
    assert second.json()["date_from"] == "2026-11-01"
    assert second.json()["date_to"] is None
    assert second.json()["updated_at"] >= first.json()["updated_at"]
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM public.travel_intents WHERE status='active'")
            assert cursor.fetchone()[0] == 1


def test_current_user_travel_intent_cannot_access_another_users_intent(
    client: TestClient, database_url: str
) -> None:
    first = login(client, telegram_user(id=1))
    second = login(client, telegram_user(id=2))
    client.put("/me/travel-intent", headers=auth_headers(first.json()["access_token"]), json={"destination": "Paris"})

    assert client.get("/me/travel-intent", headers=auth_headers(second.json()["access_token"])).json() is None
    second_update = client.put(
        "/me/travel-intent", headers=auth_headers(second.json()["access_token"]), json={"destination": "Berlin"}
    )
    assert second_update.status_code == 200
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT destination_label FROM public.travel_intents ORDER BY destination_label")
            assert cursor.fetchall() == [("Berlin",), ("Paris",)]


@pytest.mark.parametrize(
    "payload",
    [
        {"destination": "Lisbon", "date_from": "2026-10-14", "date_to": "2026-10-01"},
        {"destination": "Lisbon", "user_id": "00000000-0000-0000-0000-000000000000"},
        {"destination": "Lisbon", "status": "active"},
        {"destination": "Lisbon", "archived_at": None},
        {"destination": "Lisbon", "id": "00000000-0000-0000-0000-000000000000"},
        {"destination": "Lisbon", "unknown": "field"},
    ],
)
def test_put_current_user_travel_intent_rejects_invalid_or_server_owned_fields(
    client: TestClient, payload: dict[str, object]
) -> None:
    token = login(client).json()["access_token"]
    assert client.put("/me/travel-intent", headers=auth_headers(token), json=payload).status_code == 422


def test_delete_current_user_travel_intent_archives_and_is_idempotent(
    client: TestClient, database_url: str
) -> None:
    login_response = login(client)
    token = login_response.json()["access_token"]
    client.put("/me/travel-intent", headers=auth_headers(token), json={"destination": "Lisbon"})

    deleted = client.delete("/me/travel-intent", headers=auth_headers(token))
    repeated = client.delete("/me/travel-intent", headers=auth_headers(token))

    assert deleted.status_code == repeated.status_code == 204
    assert deleted.content == repeated.content == b""
    assert client.get("/me/travel-intent", headers=auth_headers(token)).json() is None
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT status, archived_at, updated_at FROM public.travel_intents")
            archived = cursor.fetchone()
            assert archived["status"] == "archived"
            assert archived["archived_at"] is not None
            assert archived["updated_at"] >= archived["archived_at"]


def test_patch_current_user_profile_creates_profile(client: TestClient, database_url: str) -> None:
    login_response = login(client)
    user_id = login_response.json()["user"]["id"]
    payload = {
        "display_name": "Ada",
        "birth_date": "1815-12-10",
        "gender": "female",
        "city": "London",
        "bio": "Mathematician",
        "travel_style": ["culture", "slow"],
        "interests": ["history", "science"],
        "budget_level": "medium",
        "comfort_level": "high",
    }

    response = client.patch(
        "/me/profile",
        headers=auth_headers(login_response.json()["access_token"]),
        json=payload,
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == user_id
    assert {key: response.json()[key] for key in payload} == payload
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT user_id, display_name, updated_at FROM public.profiles")
            assert cursor.fetchone()["user_id"] == UUID(user_id)


def test_patch_current_user_profile_updates_only_supplied_fields(client: TestClient) -> None:
    token = login(client).json()["access_token"]
    created = client.patch(
        "/me/profile",
        headers=auth_headers(token),
        json={"display_name": "Ada", "city": "London", "bio": "Original"},
    ).json()

    response = client.patch(
        "/me/profile",
        headers=auth_headers(token),
        json={"city": "Paris", "bio": None},
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Ada"
    assert response.json()["city"] == "Paris"
    assert response.json()["bio"] is None
    assert response.json()["updated_at"] >= created["updated_at"]

    empty_response = client.patch("/me/profile", headers=auth_headers(token), json={})

    assert empty_response.status_code == 200
    assert empty_response.json() == response.json()


def test_current_user_profile_cannot_read_or_change_another_users_profile(
    client: TestClient, database_url: str
) -> None:
    first_login = login(client, telegram_user(id=1))
    second_login = login(client, telegram_user(id=2))
    first_token = first_login.json()["access_token"]
    second_token = second_login.json()["access_token"]
    client.patch(
        "/me/profile", headers=auth_headers(first_token), json={"display_name": "First"}
    )

    second_profile_response = client.get("/me/profile", headers=auth_headers(second_token))

    assert second_profile_response.status_code == 200
    assert second_profile_response.json() is None
    second_response = client.patch(
        "/me/profile", headers=auth_headers(second_token), json={"display_name": "Second"}
    )

    assert second_response.status_code == 200
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT display_name FROM public.profiles ORDER BY display_name")
            assert cursor.fetchall() == [{"display_name": "First"}, {"display_name": "Second"}]


@pytest.mark.parametrize(
    "payload",
    [
        {"display_name": "Ada", "user_id": "00000000-0000-0000-0000-000000000000"},
        {"display_name": "Ada", "unknown": "field"},
        {"display_name": "Ada", "travel_style": "not-an-array"},
        {"city": "London"},
    ],
)
def test_patch_current_user_profile_rejects_unknown_or_invalid_payloads(
    client: TestClient, payload: dict[str, object]
) -> None:
    token = login(client).json()["access_token"]

    response = client.patch("/me/profile", headers=auth_headers(token), json=payload)

    assert response.status_code == 422
