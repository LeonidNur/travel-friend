"""Security regression coverage for atomic Telegram login bootstrap."""

from __future__ import annotations

import hashlib
import inspect
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)
from travel_friend_backend.auth.service import login


FUNCTION_SIGNATURE = (
    "public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)"
)


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture(autouse=True)
def clean_database(database_url: str) -> None:
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )


def bootstrap(
    database_url: str, telegram_user_id: int, token_hash: str, *, username: str | None = "ada"
) -> dict[str, Any]:
    now = datetime.now(UTC)
    with psycopg.connect(database_url, row_factory=psycopg.rows.dict_row) as connection:
        connection.execute("SET statement_timeout = '5s'")
        result = connection.execute(
            "SELECT * FROM public.bootstrap_telegram_login(%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                telegram_user_id,
                username,
                "Ada",
                "Lovelace",
                "en",
                token_hash,
                now,
                now + timedelta(days=30),
            ),
        )
        row = result.fetchone()
    assert row is not None
    return row


def test_capability_returns_minimal_bootstrap_state_and_creates_defaults(
    database_url: str, runtime_database_url: str
) -> None:
    row = bootstrap(runtime_database_url, 700_001, hashlib.sha256(b"opaque").hexdigest())

    assert list(row) == [
        "user_id",
        "onboarding_status",
        "profile_exists",
        "travel_intent_exists",
        "is_deleted",
    ]
    assert row == {
        "user_id": row["user_id"],
        "onboarding_status": "not_started",
        "profile_exists": False,
        "travel_intent_exists": False,
        "is_deleted": False,
    }
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.users").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.telegram_identities").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_settings").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_activity_states").fetchone() == (1,)


def test_repeat_capability_refreshes_metadata_without_duplicate_defaults(
    database_url: str, runtime_database_url: str
) -> None:
    first = bootstrap(runtime_database_url, 700_002, hashlib.sha256(b"first").hexdigest())
    second = bootstrap(
        runtime_database_url,
        700_002,
        hashlib.sha256(b"second").hexdigest(),
        username="ada-updated",
    )

    assert second["user_id"] == first["user_id"]
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT username FROM public.telegram_identities").fetchone() == ("ada-updated",)
        assert connection.execute("SELECT count(*) FROM public.user_settings").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_activity_states").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_sessions").fetchone() == (2,)


def test_bootstrap_profile_exists_transitions_from_false_to_true_without_context(
    database_url: str, runtime_database_url: str
) -> None:
    first = bootstrap(runtime_database_url, 700_020, hashlib.sha256(b"without-profile").hexdigest())
    assert first["profile_exists"] is False
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Ada')",
            (first["user_id"],),
        )

    second = bootstrap(runtime_database_url, 700_020, hashlib.sha256(b"with-profile").hexdigest())
    assert second["user_id"] == first["user_id"]
    assert second["profile_exists"] is True


def test_capability_returns_deleted_state_without_creating_another_session(
    database_url: str, runtime_database_url: str
) -> None:
    first = bootstrap(runtime_database_url, 700_003, hashlib.sha256(b"active").hexdigest())
    with psycopg.connect(database_url) as connection:
        connection.execute("UPDATE public.users SET deleted_at=now() WHERE id=%s", (first["user_id"],))

    deleted = bootstrap(runtime_database_url, 700_003, hashlib.sha256(b"rejected").hexdigest())

    assert deleted == {
        "user_id": None,
        "onboarding_status": None,
        "profile_exists": None,
        "travel_intent_exists": None,
        "is_deleted": True,
    }
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.user_sessions").fetchone() == (1,)


def test_capability_accepts_sha256_hash_not_raw_token(runtime_database_url: str) -> None:
    with psycopg.connect(runtime_database_url) as connection:
        with pytest.raises(psycopg.errors.InvalidParameterValue):
            with connection.transaction():
                connection.execute(
                    "SELECT * FROM public.bootstrap_telegram_login(%s, %s, %s, %s, %s, %s, now(), now() + interval '30 days')",
                    (700_004, "ada", "Ada", "Lovelace", "en", "raw-session-token"),
                )


def test_capability_is_owner_owned_hardened_and_runtime_cannot_alter_it(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        assert owner_connection.execute(
            "SELECT has_function_privilege('public', %s, 'EXECUTE')", (FUNCTION_SIGNATURE,)
        ).fetchone() == (False,)
        assert owner_connection.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')", (APP_RUNTIME_ROLE, FUNCTION_SIGNATURE)
        ).fetchone() == (True,)
        assert owner_connection.execute(
            "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure",
            (FUNCTION_SIGNATURE,),
        ).fetchone() != (APP_RUNTIME_ROLE,)
        definition = owner_connection.execute(
            "SELECT pg_get_functiondef(%s::regprocedure)", (FUNCTION_SIGNATURE,)
        ).fetchone()[0]
        for expected in (
            "SECURITY DEFINER",
            "SET search_path TO 'pg_catalog'",
            "pg_advisory_xact_lock",
            "public.telegram_identities",
            "public.user_sessions",
        ):
            assert expected in definition
        assert "format(" not in definition
        assert "EXECUTE" not in definition

    with psycopg.connect(runtime_database_url) as runtime_connection:
        for statement in (
            "ALTER FUNCTION public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamptz,timestamptz) RENAME TO forbidden",
            "DROP FUNCTION public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamptz,timestamptz)",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime_connection.transaction():
                    runtime_connection.execute(statement)


def test_runtime_cannot_use_revoked_login_bootstrap_table_privileges(runtime_database_url: str) -> None:
    with psycopg.connect(runtime_database_url) as runtime_connection:
        for statement in (
            "SELECT * FROM public.telegram_identities",
            "INSERT INTO public.users DEFAULT VALUES",
            "INSERT INTO public.user_settings (user_id) VALUES (gen_random_uuid())",
            "INSERT INTO public.user_sessions (user_id, token_hash, expires_at) VALUES (gen_random_uuid(), 'a', now() + interval '1 day')",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime_connection.transaction():
                    runtime_connection.execute(statement)


def test_login_service_only_calls_the_bootstrap_capability() -> None:
    source = inspect.getsource(login)

    assert "public.bootstrap_telegram_login" in source
    for direct_table_name in (
        "users",
        "telegram_identities",
        "user_settings",
        "user_activity_states",
        "profiles",
        "travel_intents",
        "user_sessions",
    ):
        assert direct_table_name not in source


def test_concurrent_first_login_is_atomic_and_conflict_safe(
    database_url: str, runtime_database_url: str
) -> None:
    telegram_user_id = 700_005
    barrier = Barrier(3, timeout=5)

    def attempt(token_seed: bytes) -> dict[str, Any]:
        barrier.wait()
        return bootstrap(runtime_database_url, telegram_user_id, hashlib.sha256(token_seed).hexdigest())

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(attempt, b"concurrent-first")
        second = executor.submit(attempt, b"concurrent-second")
        barrier.wait()
        first_result = first.result(timeout=10)
        second_result = second.result(timeout=10)

    assert first_result["is_deleted"] is False
    assert second_result["is_deleted"] is False
    assert first_result["user_id"] == second_result["user_id"]
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.users").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.telegram_identities").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_settings").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_activity_states").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM public.user_sessions").fetchone() == (2,)
