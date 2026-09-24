"""Integration regressions for the narrow onboarding completion capability."""

from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
)


CAPABILITY = "public.complete_current_onboarding()"


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


def create_bootstrapped_user(connection: psycopg.Connection) -> object:
    user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
    connection.execute(
        "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, 'not_started')",
        (user_id,),
    )
    return user_id


def set_authenticated_user(connection: psycopg.Connection, user_id: object) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def onboarding_status(connection: psycopg.Connection, user_id: object) -> str:
    return connection.execute(
        "SELECT onboarding_status FROM public.user_activity_states WHERE user_id=%s", (user_id,)
    ).fetchone()[0]


def add_completion_prerequisites(connection: psycopg.Connection, user_id: object) -> None:
    connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Ada')", (user_id,))
    connection.execute(
        "INSERT INTO public.travel_intents (user_id, destination_label, status) "
        "VALUES (%s, 'Lisbon', 'active')",
        (user_id,),
    )


@pytest.mark.parametrize("initial_status", ["not_started", "in_progress"])
def test_capability_completes_only_the_authenticated_users_ready_onboarding(
    database_url: str, initial_status: str
) -> None:
    with psycopg.connect(database_url) as connection:
        user_id = create_bootstrapped_user(connection)
        connection.execute(
            "UPDATE public.user_activity_states SET onboarding_status=%s WHERE user_id=%s",
            (initial_status, user_id),
        )
        add_completion_prerequisites(connection, user_id)

        with connection.transaction():
            set_authenticated_user(connection, user_id)
            assert connection.execute(f"SELECT {CAPABILITY}").fetchone()[0] == "completed"

        assert onboarding_status(connection, user_id) == "completed"


@pytest.mark.parametrize("missing_prerequisite", ["profile", "active_intent"])
def test_capability_denies_completion_without_required_prerequisite(
    database_url: str, missing_prerequisite: str
) -> None:
    with psycopg.connect(database_url) as connection:
        user_id = create_bootstrapped_user(connection)
        if missing_prerequisite != "profile":
            connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'Ada')", (user_id,))
        if missing_prerequisite != "active_intent":
            connection.execute(
                "INSERT INTO public.travel_intents (user_id, destination_label, status) "
                "VALUES (%s, 'Lisbon', 'active')",
                (user_id,),
            )

        with connection.transaction():
            set_authenticated_user(connection, user_id)
            assert connection.execute(f"SELECT {CAPABILITY}").fetchone()[0] is None

        assert onboarding_status(connection, user_id) == "not_started"


@pytest.mark.parametrize("context", [None, "", "not-a-uuid"])
def test_capability_fails_closed_without_a_valid_authenticated_context(
    database_url: str, context: str | None
) -> None:
    with psycopg.connect(database_url) as connection:
        user_id = create_bootstrapped_user(connection)
        add_completion_prerequisites(connection, user_id)

        with connection.transaction():
            if context is not None:
                connection.execute("SELECT set_config('app.user_id', %s, true)", (context,))
            assert connection.execute(f"SELECT {CAPABILITY}").fetchone()[0] is None

        assert onboarding_status(connection, user_id) == "not_started"


def test_capability_cannot_complete_another_users_onboarding(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        authenticated_user_id = create_bootstrapped_user(connection)
        other_user_id = create_bootstrapped_user(connection)
        add_completion_prerequisites(connection, other_user_id)

        with connection.transaction():
            set_authenticated_user(connection, authenticated_user_id)
            assert connection.execute(f"SELECT {CAPABILITY}").fetchone()[0] is None

        assert onboarding_status(connection, authenticated_user_id) == "not_started"
        assert onboarding_status(connection, other_user_id) == "not_started"


def test_capability_is_security_definer_with_exact_runtime_execute_grant(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        function = connection.execute(
            "SELECT prosecdef, pg_get_functiondef(oid) FROM pg_proc "
            "WHERE oid = %s::regprocedure",
            (CAPABILITY,),
        ).fetchone()
        assert function[0] is True
        assert "SET search_path TO 'pg_catalog'" in function[1]
        assert connection.execute(
            "SELECT has_function_privilege('public', %s::regprocedure, 'EXECUTE')", (CAPABILITY,)
        ).fetchone()[0] is False
        assert connection.execute(
            "SELECT has_function_privilege(%s, %s::regprocedure, 'EXECUTE')",
            (APP_RUNTIME_ROLE, CAPABILITY),
        ).fetchone()[0] is True


def test_runtime_role_cannot_directly_update_onboarding_status(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        user_id = create_bootstrapped_user(owner_connection)
        owner_connection.execute(
            "UPDATE public.user_activity_states SET onboarding_status='completed' WHERE user_id=%s",
            (user_id,),
        )

    with psycopg.connect(runtime_database_url) as runtime_connection:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with runtime_connection.transaction():
                runtime_connection.execute(
                    "UPDATE public.user_activity_states SET onboarding_status='not_started' WHERE user_id=%s",
                    (user_id,),
                )

    with psycopg.connect(database_url) as owner_connection:
        assert onboarding_status(owner_connection, user_id) == "completed"


def test_bootstrap_still_default_initializes_not_started(
    database_url: str, runtime_database_url: str
) -> None:
    telegram_user_id = uuid4().int % 2_000_000_000
    token_hash = hashlib.sha256(str(uuid4()).encode()).hexdigest()
    with psycopg.connect(runtime_database_url) as runtime_connection:
        user_id = runtime_connection.execute(
            "SELECT user_id FROM public.bootstrap_telegram_login("
            "%s, %s, %s, %s, %s, %s, now(), now() + interval '1 day'"
            ")",
            (telegram_user_id, None, "Ada", None, None, token_hash),
        ).fetchone()[0]

    with psycopg.connect(database_url) as connection:
        assert onboarding_status(connection, user_id) == "not_started"


def test_concurrent_completion_and_archive_cannot_complete_without_an_active_intent(
    database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(database_url) as owner_connection:
        user_id = create_bootstrapped_user(owner_connection)
        owner_connection.execute(
            "UPDATE public.user_activity_states SET onboarding_status='in_progress' WHERE user_id=%s",
            (user_id,),
        )
        add_completion_prerequisites(owner_connection, user_id)
        owner_connection.commit()

        ready_to_contend = Barrier(3)

        def call_capability(capability: str) -> str | None:
            with psycopg.connect(runtime_database_url) as connection:
                with connection.transaction():
                    set_authenticated_user(connection, user_id)
                    ready_to_contend.wait()
                    try:
                        result = connection.execute(f"SELECT {capability}").fetchone()[0]
                    except psycopg.Error as error:
                        return error.diag.message_primary
                    return str(result) if result is not None else None

        executor = ThreadPoolExecutor(max_workers=2)
        with owner_connection.transaction():
            owner_connection.execute(
                "SELECT 1 FROM public.user_activity_states WHERE user_id=%s FOR UPDATE", (user_id,)
            )
            completion = executor.submit(call_capability, CAPABILITY)
            archive = executor.submit(call_capability, "public.archive_current_active_travel_intent()")
            ready_to_contend.wait()

        completion_result = completion.result()
        archive_result = archive.result()
        executor.shutdown()

        active_intent = owner_connection.execute(
            "SELECT EXISTS (SELECT 1 FROM public.travel_intents WHERE user_id=%s AND status='active')",
            (user_id,),
        ).fetchone()[0]
        final_status = onboarding_status(owner_connection, user_id)

    assert (final_status, active_intent) in {("completed", True), ("in_progress", False)}
    assert {completion_result, archive_result} in [
        {"completed", "completed onboarding requires an active travel intent"},
        {None, "True"},
    ]
