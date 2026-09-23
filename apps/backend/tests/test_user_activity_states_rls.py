"""Real PostgreSQL regressions for the user_activity_states RLS slice."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from uuid import UUID, uuid4

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


def create_activity_state(connection: psycopg.Connection, status: str = "not_started") -> UUID:
    user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
    connection.execute(
        "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, %s)",
        (user_id, status),
    )
    return user_id


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def add_completion_prerequisites(connection: psycopg.Connection, user_id: UUID) -> None:
    connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Ada')", (user_id,))
    connection.execute(
        "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, 'Lisbon', 'active')",
        (user_id,),
    )


def test_runtime_activity_state_read_is_owner_scoped_and_fails_closed(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        own_user_id = create_activity_state(owner_connection, "in_progress")
        foreign_user_id = create_activity_state(owner_connection, "completed")

    with psycopg.connect(runtime_database_url) as runtime_connection:
        assert runtime_connection.execute(
            "SELECT user_id, onboarding_status FROM public.user_activity_states"
        ).fetchall() == []

        for invalid_context in ("", "not-a-uuid"):
            with runtime_connection.transaction():
                set_authenticated_user(runtime_connection, invalid_context)
                assert runtime_connection.execute(
                    "SELECT user_id, onboarding_status FROM public.user_activity_states"
                ).fetchall() == []

        with runtime_connection.transaction():
            set_authenticated_user(runtime_connection, own_user_id)
            assert runtime_connection.execute(
                "SELECT user_id, onboarding_status FROM public.user_activity_states ORDER BY user_id"
            ).fetchall() == [(own_user_id, "in_progress")]
            assert runtime_connection.execute(
                "SELECT user_id FROM public.user_activity_states WHERE user_id=%s", (foreign_user_id,)
            ).fetchall() == []


def test_runtime_activity_state_direct_writes_are_denied(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        user_id = create_activity_state(owner_connection)

    with psycopg.connect(runtime_database_url) as runtime_connection:
        for statement, parameters in (
            (
                "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, 'not_started')",
                (uuid4(),),
            ),
            ("UPDATE public.user_activity_states SET onboarding_status='completed' WHERE user_id=%s", (user_id,)),
            ("DELETE FROM public.user_activity_states WHERE user_id=%s", (user_id,)),
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime_connection.transaction():
                    runtime_connection.execute(statement, parameters)


def test_security_definer_onboarding_paths_continue_to_write_activity_state(
    database_url: str, runtime_database_url: str
) -> None:
    token_hash = hashlib.sha256(str(uuid4()).encode()).hexdigest()
    with psycopg.connect(runtime_database_url) as runtime_connection:
        bootstrapped_user_id = runtime_connection.execute(
            "SELECT user_id FROM public.bootstrap_telegram_login("
            "%s, %s, %s, %s, %s, %s, now(), now() + interval '1 day')",
            (900_102, "activity-rls", "Activity", None, None, token_hash),
        ).fetchone()[0]

    with psycopg.connect(database_url) as owner_connection:
        add_completion_prerequisites(owner_connection, bootstrapped_user_id)

    with psycopg.connect(runtime_database_url) as runtime_connection:
        with runtime_connection.transaction():
            set_authenticated_user(runtime_connection, bootstrapped_user_id)
            assert runtime_connection.execute(
                "SELECT public.complete_current_onboarding()"
            ).fetchone() == ("completed",)
            assert runtime_connection.execute(
                "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s",
                (bootstrapped_user_id,),
            ).fetchone() == ("completed",)


def test_activity_state_rls_catalog_has_only_the_runtime_select_policy(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.user_activity_states'::regclass"
        ).fetchone() == (True,)
        assert connection.execute(
            "SELECT policyname, cmd, qual, with_check FROM pg_policies "
            "WHERE schemaname='public' AND tablename='user_activity_states' ORDER BY policyname"
        ).fetchall() == [
            ("user_activity_states_select_own", "SELECT", "(user_id = current_authenticated_user_id())", None)
        ]
        assert connection.execute(
            "SELECT has_table_privilege(%s, 'public.user_activity_states', 'INSERT'), "
            "has_table_privilege(%s, 'public.user_activity_states', 'UPDATE'), "
            "has_table_privilege(%s, 'public.user_activity_states', 'DELETE')",
            (APP_RUNTIME_ROLE, APP_RUNTIME_ROLE, APP_RUNTIME_ROLE),
        ).fetchone() == (False, False, False)
