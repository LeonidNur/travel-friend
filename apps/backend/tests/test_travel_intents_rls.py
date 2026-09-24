"""Real PostgreSQL regression coverage for the travel_intents RLS slice."""

from __future__ import annotations

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


DISCOVER_CAPABILITY_SIGNATURE = "public.discover_eligible_travel_intents()"
ARCHIVE_CAPABILITY_SIGNATURE = "public.archive_current_active_travel_intent()"
CURRENT_USER_FUNCTION_SIGNATURE = "public.current_authenticated_user_id()"


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


def create_user(database_url: str, *, destination: str, eligible: bool = True) -> UUID:
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        connection.execute(
            "INSERT INTO public.profiles (user_id, display_name) VALUES (%s, %s)",
            (user_id, destination),
        )
        connection.execute(
            "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, %s)",
            (user_id, "completed" if eligible else "in_progress"),
        )
        connection.execute(
            "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, %s, 'active')",
            (user_id, destination),
        )
    return user_id


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def test_owner_only_rls_fails_closed_and_denies_cross_user_writes(
    database_url: str, runtime_database_url: str
) -> None:
    user_a_id = create_user(database_url, destination="A")
    user_b_id = create_user(database_url, destination="B")

    with psycopg.connect(runtime_database_url) as connection:
        with connection.transaction():
            set_authenticated_user(connection, user_a_id)
            assert connection.execute(
                "SELECT destination_label FROM public.travel_intents ORDER BY destination_label"
            ).fetchall() == [("A",)]
            assert connection.execute(
                "UPDATE public.travel_intents SET destination_label='forbidden' WHERE user_id=%s RETURNING id",
                (user_b_id,),
            ).fetchall() == []
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute(
                        "INSERT INTO public.travel_intents (user_id, destination_label, status) "
                        "VALUES (%s, 'forbidden', 'active')",
                        (user_b_id,),
                    )
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute("DELETE FROM public.travel_intents WHERE user_id=%s", (user_a_id,))

    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute("SELECT * FROM public.travel_intents").fetchall() == []
        with connection.transaction():
            set_authenticated_user(connection, "not-a-uuid")
            assert connection.execute("SELECT * FROM public.travel_intents").fetchall() == []

    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT destination_label FROM public.travel_intents WHERE user_id=%s", (user_b_id,)
        ).fetchone() == ("B",)


@pytest.mark.parametrize("destination", ("", "   "))
def test_travel_intents_durable_constraint_rejects_blank_destination(
    database_url: str, destination: str
) -> None:
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        with pytest.raises(psycopg.errors.CheckViolation):
            with connection.transaction():
                connection.execute(
                    "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, %s, 'active')",
                    (user_id, destination),
                )


def test_archive_capability_is_owner_scoped_fail_closed_and_idempotent(
    database_url: str, runtime_database_url: str
) -> None:
    user_a_id = create_user(database_url, destination="A", eligible=False)
    user_b_id = create_user(database_url, destination="B")

    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute("SELECT public.archive_current_active_travel_intent()").fetchone() == (False,)
        with connection.transaction():
            set_authenticated_user(connection, "not-a-uuid")
            assert connection.execute("SELECT public.archive_current_active_travel_intent()").fetchone() == (False,)
        with connection.transaction():
            set_authenticated_user(connection, user_a_id)
            assert connection.execute("SELECT public.archive_current_active_travel_intent()").fetchone() == (True,)
            assert connection.execute("SELECT * FROM public.travel_intents").fetchall() == []
            assert connection.execute("SELECT public.archive_current_active_travel_intent()").fetchone() == (False,)

    with psycopg.connect(database_url) as connection:
        archived_a = connection.execute(
            "SELECT status, archived_at IS NOT NULL FROM public.travel_intents WHERE user_id=%s", (user_a_id,)
        ).fetchone()
        assert archived_a == ("archived", True)
        assert connection.execute(
            "SELECT status FROM public.travel_intents WHERE user_id=%s", (user_b_id,)
        ).fetchone() == ("active",)


def test_archive_capability_allows_incomplete_user_but_rejects_completed_user(
    database_url: str, runtime_database_url: str
) -> None:
    completed_user_id = create_user(database_url, destination="completed")
    incomplete_user_id = create_user(database_url, destination="incomplete", eligible=False)

    with psycopg.connect(runtime_database_url) as connection:
        with connection.transaction():
            set_authenticated_user(connection, completed_user_id)
            with pytest.raises(
                psycopg.errors.RaiseException,
                match="completed onboarding requires an active travel intent",
            ):
                connection.execute("SELECT public.archive_current_active_travel_intent()")

        with connection.transaction():
            set_authenticated_user(connection, incomplete_user_id)
            assert connection.execute("SELECT public.archive_current_active_travel_intent()").fetchone() == (True,)

    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s", (completed_user_id,)
        ).fetchone() == ("completed",)
        assert connection.execute(
            "SELECT status FROM public.travel_intents WHERE user_id=%s", (completed_user_id,)
        ).fetchone() == ("active",)
        assert connection.execute(
            "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s", (incomplete_user_id,)
        ).fetchone() == ("in_progress",)
        assert connection.execute(
            "SELECT status FROM public.travel_intents WHERE user_id=%s", (incomplete_user_id,)
        ).fetchone() == ("archived",)


def test_discover_capability_returns_all_active_other_intents_without_discover_eligibility(
    database_url: str, runtime_database_url: str
) -> None:
    user_a_id = create_user(database_url, destination="A")
    user_b_id = create_user(database_url, destination="B")
    ineligible_user_id = create_user(database_url, destination="ineligible", eligible=False)
    archived_user_id = create_user(database_url, destination="archived")
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.travel_intents SET status='archived' WHERE user_id=%s",
            (archived_user_id,),
        )

    with psycopg.connect(runtime_database_url) as connection:
        with connection.transaction():
            set_authenticated_user(connection, user_a_id)
            rows = connection.execute(
                "SELECT user_id, destination_label, date_from, date_to "
                "FROM public.discover_eligible_travel_intents()"
            ).fetchall()
        assert set(rows) == {
            (user_b_id, "B", None, None),
            (ineligible_user_id, "ineligible", None, None),
        }


def test_rls_and_capability_catalog_security_and_bootstrap_without_context(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        assert owner_connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.travel_intents'::regclass"
        ).fetchone() == (True, False)
        assert owner_connection.execute(
            "SELECT count(*) FROM pg_policies WHERE schemaname='public' "
            "AND tablename='travel_intents' AND cmd='DELETE'"
        ).fetchone() == (0,)
        assert owner_connection.execute(
            "SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' "
            "AND tablename='travel_intents' ORDER BY policyname"
        ).fetchall() == [
            ("travel_intents_insert_own_active", "INSERT"),
            ("travel_intents_select_own_active", "SELECT"),
            ("travel_intents_update_own_active", "UPDATE"),
        ]
        assert owner_connection.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')",
            (APP_RUNTIME_ROLE, CURRENT_USER_FUNCTION_SIGNATURE),
        ).fetchone() == (True,)
        assert owner_connection.execute(
            "SELECT has_function_privilege('public', %s, 'EXECUTE')",
            (DISCOVER_CAPABILITY_SIGNATURE,),
        ).fetchone() == (False,)
        assert owner_connection.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')",
            (APP_RUNTIME_ROLE, DISCOVER_CAPABILITY_SIGNATURE),
        ).fetchone() == (True,)
        assert owner_connection.execute(
            "SELECT has_function_privilege('public', %s, 'EXECUTE')",
            (ARCHIVE_CAPABILITY_SIGNATURE,),
        ).fetchone() == (False,)
        assert owner_connection.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')",
            (APP_RUNTIME_ROLE, ARCHIVE_CAPABILITY_SIGNATURE),
        ).fetchone() == (True,)
        assert owner_connection.execute(
            "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure",
            (DISCOVER_CAPABILITY_SIGNATURE,),
        ).fetchone() != (APP_RUNTIME_ROLE,)
        assert owner_connection.execute(
            "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure",
            (ARCHIVE_CAPABILITY_SIGNATURE,),
        ).fetchone() != (APP_RUNTIME_ROLE,)
        definition = owner_connection.execute(
            "SELECT pg_get_functiondef(%s::regprocedure)", (DISCOVER_CAPABILITY_SIGNATURE,)
        ).fetchone()[0]
        for expected in (
            "SECURITY DEFINER",
            "SET search_path TO 'pg_catalog'",
            "public.current_authenticated_user_id()",
            "public.travel_intents",
        ):
            assert expected in definition
        assert "format(" not in definition
        assert "EXECUTE" not in definition
        archive_definition = owner_connection.execute(
            "SELECT pg_get_functiondef(%s::regprocedure)", (ARCHIVE_CAPABILITY_SIGNATURE,)
        ).fetchone()[0]
        for expected in (
            "SECURITY DEFINER",
            "SET search_path TO 'pg_catalog'",
            "public.current_authenticated_user_id()",
            "public.user_activity_states",
            "public.travel_intents",
            "FOR UPDATE",
        ):
            assert expected in archive_definition
        assert "format(" not in archive_definition
        assert "EXECUTE" not in archive_definition

    with psycopg.connect(runtime_database_url) as runtime_connection:
        assert runtime_connection.execute(
            "SELECT * FROM public.bootstrap_telegram_login(%s, %s, %s, %s, %s, %s, now(), now() + interval '1 day')",
            (900_001, "rls", "Rls", None, None, "a" * 64),
        ).fetchone() is not None
        role = runtime_connection.execute(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=%s", (APP_RUNTIME_ROLE,)
        ).fetchone()
        assert role == (False, False)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with runtime_connection.transaction():
                runtime_connection.execute(
                    "ALTER FUNCTION public.discover_eligible_travel_intents() RENAME TO forbidden"
                )
