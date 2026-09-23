"""Real PostgreSQL regression coverage for the user_sessions RLS slice."""

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


def create_session(database_url: str, *, token_seed: str) -> tuple[UUID, UUID, str]:
    token_hash = hashlib.sha256(token_seed.encode()).hexdigest()
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        session_id = connection.execute(
            "INSERT INTO public.user_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, %s) RETURNING id",
            (user_id, token_hash, datetime.now(UTC) + timedelta(days=1)),
        ).fetchone()[0]
    return session_id, user_id, token_hash


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def test_runtime_session_access_is_owner_scoped_fail_closed_and_revocation_is_effective(
    database_url: str, runtime_database_url: str
) -> None:
    session_a_id, user_a_id, token_a_hash = create_session(database_url, token_seed="session-a")
    session_b_id, _, _ = create_session(database_url, token_seed="session-b")

    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute("SELECT id FROM public.user_sessions").fetchall() == []
        with connection.transaction():
            set_authenticated_user(connection, "not-a-uuid")
            assert connection.execute("SELECT id FROM public.user_sessions").fetchall() == []

        assert connection.execute(
            "SELECT session_id, user_id FROM public.resolve_bearer_session(%s)", (token_a_hash,)
        ).fetchone() == (session_a_id, user_a_id)

        with connection.transaction():
            set_authenticated_user(connection, user_a_id)
            assert connection.execute("SELECT id FROM public.user_sessions ORDER BY id").fetchall() == [
                (session_a_id,)
            ]
            assert connection.execute(
                "UPDATE public.user_sessions SET revoked_at=now() WHERE id=%s RETURNING id", (session_b_id,)
            ).fetchall() == []
            assert connection.execute(
                "UPDATE public.user_sessions SET revoked_at=now() WHERE id=%s RETURNING id", (session_a_id,)
            ).fetchall() == [(session_a_id,)]

        for statement in (
            "INSERT INTO public.user_sessions (user_id, token_hash, expires_at) "
            "VALUES ('00000000-0000-0000-0000-000000000000', 'forbidden', now() + interval '1 day')",
            "DELETE FROM public.user_sessions WHERE false",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute(statement)

    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT revoked_at IS NOT NULL FROM public.user_sessions WHERE id=%s", (session_a_id,)
        ).fetchone() == (True,)
        assert connection.execute(
            "SELECT revoked_at IS NULL FROM public.user_sessions WHERE id=%s", (session_b_id,)
        ).fetchone() == (True,)

    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute(
            "SELECT session_id, user_id FROM public.resolve_bearer_session(%s)", (token_a_hash,)
        ).fetchone() is None


def test_session_rls_catalog_and_pre_auth_bootstrap_capability(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid='public.user_sessions'::regclass"
        ).fetchone() == (True, False)
        assert connection.execute(
            "SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' "
            "AND tablename='user_sessions' ORDER BY policyname"
        ).fetchall() == [
            ("user_sessions_select_own", "SELECT"),
            ("user_sessions_update_own", "UPDATE"),
        ]
        assert connection.execute(
            "SELECT count(*) FROM pg_policies WHERE schemaname='public' "
            "AND tablename='user_sessions' AND cmd IN ('INSERT', 'DELETE')"
        ).fetchone() == (0,)

    with psycopg.connect(runtime_database_url) as connection:
        token_hash = "a" * 64
        bootstrap_row = connection.execute(
            "SELECT * FROM public.bootstrap_telegram_login(%s, %s, %s, %s, %s, %s, now(), now() + interval '1 day')",
            (900_101, "session-rls", "Session", None, None, token_hash),
        ).fetchone()
        assert bootstrap_row is not None
        resolved_session = connection.execute(
            "SELECT session_id, user_id FROM public.resolve_bearer_session(%s)", (token_hash,)
        ).fetchone()
        assert resolved_session is not None
        assert resolved_session[1] == bootstrap_row[0]

    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.user_sessions").fetchone() == (1,)
        assert connection.execute(
            "SELECT has_table_privilege(%s, 'public.user_sessions', 'INSERT')",
            (APP_RUNTIME_ROLE,),
        ).fetchone() == (False,)
