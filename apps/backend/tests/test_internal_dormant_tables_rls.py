"""Integration coverage for the deny-by-default internal table RLS slice."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


INTERNAL_TABLES = (
    "users",
    "telegram_identities",
    "user_settings",
    "profile_photos",
    "chat_summaries",
)
UPDATE_COLUMNS = {
    "users": "id",
    "telegram_identities": "id",
    "user_settings": "user_id",
    "profile_photos": "id",
    "chat_summaries": "id",
}


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


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def test_internal_tables_have_rls_and_no_runtime_policies_or_privileges(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relname, relrowsecurity FROM pg_class "
            "WHERE oid = ANY(%s::regclass[]) ORDER BY relname",
            ([f"public.{table_name}" for table_name in INTERNAL_TABLES],),
        ).fetchall() == [(table_name, True) for table_name in sorted(INTERNAL_TABLES)]
        assert connection.execute(
            "SELECT tablename, policyname FROM pg_policies "
            "WHERE schemaname = 'public' AND tablename = ANY(%s::text[])",
            (list(INTERNAL_TABLES),),
        ).fetchall() == []
        for table_name in INTERNAL_TABLES:
            for operation in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert connection.execute(
                    "SELECT NOT has_table_privilege(%s, %s, %s) "
                    "AND CASE WHEN %s IN ('SELECT', 'INSERT', 'UPDATE') "
                    "THEN NOT has_any_column_privilege(%s, %s, %s) ELSE true END",
                    (
                        APP_RUNTIME_ROLE,
                        f"public.{table_name}",
                        operation,
                        operation,
                        APP_RUNTIME_ROLE,
                        f"public.{table_name}",
                        operation,
                    ),
                ).fetchone()[0] is True


def test_runtime_cannot_directly_access_internal_tables_with_or_without_context(
    runtime_database_url: str,
) -> None:
    with psycopg.connect(runtime_database_url) as connection:
        for table_name in INTERNAL_TABLES:
            for statement in (
                f"SELECT * FROM public.{table_name} WHERE false",
                f"INSERT INTO public.{table_name} SELECT * FROM public.{table_name} WHERE false",
                f"UPDATE public.{table_name} SET {UPDATE_COLUMNS[table_name]} = {UPDATE_COLUMNS[table_name]} WHERE false",
                f"DELETE FROM public.{table_name} WHERE false",
            ):
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(statement)
        with connection.transaction():
            set_authenticated_user(connection, "00000000-0000-0000-0000-000000000001")
            for table_name in INTERNAL_TABLES:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with connection.transaction():
                        connection.execute(f"SELECT * FROM public.{table_name} WHERE false")


def test_capability_only_paths_continue_to_work_after_internal_rls(
    database_url: str, runtime_database_url: str
) -> None:
    token_hash = hashlib.sha256(b"internal-rls-token").hexdigest()
    with psycopg.connect(runtime_database_url) as runtime:
        user_id, onboarding_status, profile_exists, intent_exists, is_deleted = runtime.execute(
            "SELECT * FROM public.bootstrap_telegram_login(%s, %s, %s, %s, %s, %s, now(), now() + interval '1 day')",
            (987_654_321, "internal-rls", "Internal", None, "en", token_hash),
        ).fetchone()
        assert onboarding_status == "not_started"
        assert profile_exists is False and intent_exists is False and is_deleted is False
        assert runtime.execute(
            "SELECT user_id FROM public.resolve_bearer_session(%s)", (token_hash,)
        ).fetchone() == (user_id,)

    with psycopg.connect(database_url) as owner:
        candidate_id = owner.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        owner.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Candidate')", (candidate_id,))
        owner.execute(
            "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, 'completed')",
            (candidate_id,),
        )
        owner.execute(
            "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, 'Moscow', 'active')",
            (candidate_id,),
        )
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, user_id)
            assert runtime.execute(
                "SELECT user_id FROM public.discover_candidate_profile_projection()"
            ).fetchall() == [(candidate_id,)]
