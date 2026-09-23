"""Real PostgreSQL coverage for the Discover decision capability and RLS slice."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


CAPABILITY = "public.record_current_discover_decision(uuid,text)"


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture(autouse=True)
def clean_database(database_url: str):
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )
    yield


def create_user(database_url: str, name: str, *, eligible: bool = True) -> UUID:
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, %s)", (user_id, name))
        connection.execute(
            "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, %s)",
            (user_id, "completed" if eligible else "in_progress"),
        )
        connection.execute(
            "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, %s, 'active')",
            (user_id, name),
        )
    return user_id


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def call_capability(connection: psycopg.Connection, target_user_id: UUID, decision: str):
    return connection.execute(
        "SELECT * FROM public.record_current_discover_decision(%s, %s)", (target_user_id, decision)
    ).fetchone()


def test_discover_and_match_rls_catalog_and_private_capability(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid='public.discover_interest_decisions'::regclass"
        ).fetchone() == (True, False)
        assert connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid='public.matches'::regclass"
        ).fetchone() == (True, False)
        assert connection.execute(
            "SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies "
            "WHERE schemaname='public' AND tablename IN ('discover_interest_decisions', 'matches') "
            "ORDER BY tablename, policyname"
        ).fetchall() == [
            ("discover_interest_decisions_select_own", "SELECT", "{app_runtime}",
             "(actor_user_id = current_authenticated_user_id())", None),
            ("matches_select_participant", "SELECT", "{app_runtime}",
             "((user_a_id = current_authenticated_user_id()) OR (user_b_id = current_authenticated_user_id()))", None),
        ]
        assert connection.execute("SELECT has_function_privilege('public', %s, 'EXECUTE')", (CAPABILITY,)).fetchone() == (False,)
        assert connection.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (APP_RUNTIME_ROLE, CAPABILITY)).fetchone() == (True,)


def test_direct_reads_are_scoped_and_direct_mutations_are_denied(
    database_url: str, runtime_database_url: str
) -> None:
    first = create_user(database_url, "first")
    second = create_user(database_url, "second")
    outsider = create_user(database_url, "outsider")
    with psycopg.connect(database_url) as owner:
        owner.execute("INSERT INTO public.discover_interest_decisions (actor_user_id, target_user_id, decision) VALUES (%s, %s, 'interested')", (first, second))
        owner.execute("INSERT INTO public.matches (user_a_id, user_b_id) VALUES (%s, %s)", tuple(sorted((first, second))))
    with psycopg.connect(runtime_database_url) as runtime:
        assert runtime.execute("SELECT actor_user_id, target_user_id, decision FROM public.discover_interest_decisions").fetchall() == []
        with runtime.transaction():
            set_authenticated_user(runtime, first)
            assert runtime.execute("SELECT actor_user_id, target_user_id FROM public.discover_interest_decisions").fetchall() == [(first, second)]
            assert len(runtime.execute("SELECT id FROM public.matches").fetchall()) == 1
        with runtime.transaction():
            set_authenticated_user(runtime, outsider)
            assert runtime.execute("SELECT actor_user_id, target_user_id, decision FROM public.discover_interest_decisions").fetchall() == []
            assert runtime.execute("SELECT id, user_a_id, user_b_id, chat_id FROM public.matches").fetchall() == []
        for statement in (
            "INSERT INTO public.discover_interest_decisions (actor_user_id, target_user_id, decision) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'interested')",
            "UPDATE public.discover_interest_decisions SET decision='rejected' WHERE false",
            "DELETE FROM public.discover_interest_decisions WHERE false",
            "INSERT INTO public.matches (user_a_id, user_b_id) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001')",
            "UPDATE public.matches SET chat_id=NULL WHERE false",
            "DELETE FROM public.matches WHERE false",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime.transaction():
                    runtime.execute(statement)


def test_capability_fails_closed_and_cannot_impersonate(database_url: str, runtime_database_url: str) -> None:
    first = create_user(database_url, "first")
    second = create_user(database_url, "second")
    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.Error):
            call_capability(runtime, second, "interested")
        runtime.rollback()
        with runtime.transaction():
            set_authenticated_user(runtime, "malformed")
            with pytest.raises(psycopg.Error):
                call_capability(runtime, second, "interested")
        with runtime.transaction():
            set_authenticated_user(runtime, first)
            row = call_capability(runtime, second, "interested")
            assert row[0] == "interested"
    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT actor_user_id, target_user_id FROM public.discover_interest_decisions").fetchall() == [(first, second)]


def test_capability_retries_conflicts_repairs_and_concurrent_accepts(
    database_url: str, runtime_database_url: str
) -> None:
    first = create_user(database_url, "first")
    second = create_user(database_url, "second")
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, first)
            assert call_capability(runtime, second, "interested") == ("interested", False, None)
        with runtime.transaction():
            set_authenticated_user(runtime, first)
            assert call_capability(runtime, second, "interested") == ("interested", False, None)
            with pytest.raises(psycopg.Error):
                call_capability(runtime, second, "rejected")

    barrier = Barrier(3)

    def accept(actor: UUID, target: UUID):
        with psycopg.connect(runtime_database_url) as runtime:
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                barrier.wait()
                return call_capability(runtime, target, "interested")

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(accept, first, second)
        second_future = executor.submit(accept, second, first)
        barrier.wait()
        first_future.result()
        second_future.result()

    with psycopg.connect(database_url) as owner:
        match_id, chat_id = owner.execute("SELECT id, chat_id FROM public.matches").fetchone()
        assert match_id is not None and chat_id is not None
        assert owner.execute("SELECT count(*) FROM public.matches").fetchone() == (1,)
        assert owner.execute("SELECT count(*) FROM public.chats WHERE type='direct'").fetchone() == (1,)
        assert owner.execute("SELECT count(*) FROM public.chat_participants WHERE chat_id=%s", (chat_id,)).fetchone() == (2,)
