"""Security regression coverage for pre-auth Bearer session resolution."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


FUNCTION_SIGNATURE = "public.resolve_bearer_session(text)"


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


def create_session(
    database_url: str,
    *,
    raw_token: str,
    expires_at: datetime,
    revoked: bool = False,
) -> tuple[UUID, UUID, str]:
    hashed_token = hashlib.sha256(raw_token.encode()).hexdigest()
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        session_id = connection.execute(
            "INSERT INTO public.user_sessions (user_id, token_hash, expires_at, revoked_at) "
            "VALUES (%s, %s, %s, CASE WHEN %s THEN now() ELSE NULL END) RETURNING id",
            (user_id, hashed_token, expires_at, revoked),
        ).fetchone()[0]
    return session_id, user_id, hashed_token


def resolve(runtime_database_url: str, session_hash: str) -> tuple[UUID, UUID] | None:
    with psycopg.connect(runtime_database_url) as connection:
        return connection.execute(
            "SELECT session_id, user_id FROM public.resolve_bearer_session(%s)",
            (session_hash,),
        ).fetchone()


def test_capability_resolves_only_an_active_session_hash(
    database_url: str, runtime_database_url: str
) -> None:
    session_id, user_id, active_hash = create_session(
        database_url,
        raw_token="active-token",
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )

    assert resolve(runtime_database_url, active_hash) == (session_id, user_id)
    assert resolve(runtime_database_url, "unknown-hash") is None
    assert resolve(runtime_database_url, "active-token") is None


@pytest.mark.parametrize("expired,revoked", [(True, False), (False, True)])
def test_capability_rejects_expired_and_revoked_sessions(
    database_url: str, runtime_database_url: str, expired: bool, revoked: bool
) -> None:
    session_id, _, session_hash = create_session(
        database_url,
        raw_token=f"invalid-{expired}-{revoked}",
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
        revoked=revoked,
    )
    if expired:
        with psycopg.connect(database_url) as connection:
            connection.execute(
                "UPDATE public.user_sessions "
                "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' "
                "WHERE id = %s",
                (session_id,),
            )

    assert resolve(runtime_database_url, session_hash) is None


def test_capability_rejects_a_session_for_a_deleted_user(
    database_url: str, runtime_database_url: str
) -> None:
    _, user_id, session_hash = create_session(
        database_url,
        raw_token="deleted-user-token",
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    with psycopg.connect(database_url) as connection:
        connection.execute("UPDATE public.users SET deleted_at = now() WHERE id = %s", (user_id,))

    assert resolve(runtime_database_url, session_hash) is None


def test_capability_has_only_the_audited_return_shape_and_grants(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        result = connection.execute(
            "SELECT * FROM public.resolve_bearer_session(%s)", ("unknown-hash",)
        )
        assert [column.name for column in result.description] == ["session_id", "user_id"]
        assert connection.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')",
            (APP_RUNTIME_ROLE, FUNCTION_SIGNATURE),
        ).fetchone()[0] is True
        assert connection.execute(
            "SELECT NOT EXISTS ("
            "SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode("
            "COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege "
            "WHERE p.oid = %s::regprocedure AND privilege.grantee = 0 "
            "AND privilege.privilege_type = 'EXECUTE'"
            ")",
            (FUNCTION_SIGNATURE,),
        ).fetchone()[0] is True
        function_definition = connection.execute(
            "SELECT pg_get_functiondef(%s::regprocedure)", (FUNCTION_SIGNATURE,)
        ).fetchone()[0]
        assert "SECURITY DEFINER" in function_definition
        assert "SET search_path TO 'pg_catalog'" in function_definition
        assert "public.user_sessions" in function_definition
        assert "public.users" in function_definition
        assert "EXECUTE" not in function_definition
        assert "format(" not in function_definition


def test_runtime_cannot_read_session_table_or_change_capability(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        owner = owner_connection.execute(
            "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure",
            (FUNCTION_SIGNATURE,),
        ).fetchone()[0]
        assert owner != APP_RUNTIME_ROLE

    with psycopg.connect(runtime_database_url) as runtime_connection:
        for statement in (
            "SELECT token_hash FROM public.user_sessions",
            "ALTER FUNCTION public.resolve_bearer_session(text) RENAME TO forbidden_resolution",
            "DROP FUNCTION public.resolve_bearer_session(text)",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime_connection.transaction():
                    runtime_connection.execute(statement)
