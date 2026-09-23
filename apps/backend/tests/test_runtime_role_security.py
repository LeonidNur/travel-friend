"""PostgreSQL least-privilege regression checks for the disposable runtime role."""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
)


EXPECTED_PRIVILEGES = {
    "users": {"select"},
    "telegram_identities": set(),
    "profiles": {"select", "insert", "update"},
    "profile_photos": set(),
    "user_settings": set(),
    "user_activity_states": {"select"},
    "travel_intents": {"select", "insert", "update"},
    "user_sessions": {"select", "update"},
    "discover_interest_decisions": {"select"},
    "matches": {"select"},
    "chats": {"select", "update"},
    "chat_participants": {"select", "update"},
    "messages": {"select"},
    "chat_summaries": set(),
    "trips": {"select", "insert"},
    "trip_participants": {"select", "insert"},
    "trip_stops": {"select"},
}
CRUD_PRIVILEGES = ("select", "insert", "update", "delete")


@pytest.fixture
def test_owner_database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture
def cleanup_owner_created_table(test_owner_database_url: str) -> Iterator[None]:
    yield
    with psycopg.connect(test_owner_database_url) as connection:
        connection.execute("DROP TABLE IF EXISTS public.runtime_role_future_object")


def test_runtime_role_identity_attributes_and_non_ownership(
    test_owner_database_url: str, runtime_database_url: str
) -> None:
    with psycopg.connect(runtime_database_url) as runtime_connection:
        assert runtime_connection.execute("SELECT current_user").fetchone() == (APP_RUNTIME_ROLE,)

    with psycopg.connect(test_owner_database_url) as owner_connection:
        role = owner_connection.execute(
            "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication "
            "FROM pg_roles WHERE rolname=%s",
            (APP_RUNTIME_ROLE,),
        ).fetchone()
        assert role == (False, False, False, False, False)
        assert owner_connection.execute(
            "SELECT count(*) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relkind='r' AND c.relowner="
            "(SELECT oid FROM pg_roles WHERE rolname=%s)",
            (APP_RUNTIME_ROLE,),
        ).fetchone() == (0,)


def test_runtime_role_has_exactly_the_audited_effective_table_privileges(
    test_owner_database_url: str,
) -> None:
    with psycopg.connect(test_owner_database_url) as owner_connection:
        for table_name, expected_privileges in EXPECTED_PRIVILEGES.items():
            actual_privileges = {
                privilege
                for privilege in CRUD_PRIVILEGES
                if owner_connection.execute(
                    "SELECT has_table_privilege(%s, %s, %s) "
                    "OR CASE WHEN %s IN ('select', 'insert', 'update') "
                    "THEN has_any_column_privilege(%s, %s, %s) ELSE false END",
                    (
                        APP_RUNTIME_ROLE,
                        f"public.{table_name}",
                        privilege,
                        privilege,
                        APP_RUNTIME_ROLE,
                        f"public.{table_name}",
                        privilege,
                    ),
                ).fetchone()[0]
            }
            assert actual_privileges == expected_privileges


def test_runtime_role_has_only_the_logout_identifier_column_select_on_sessions(
    test_owner_database_url: str,
) -> None:
    with psycopg.connect(test_owner_database_url) as owner_connection:
        for column_name, expected_select in {
            "id": True,
            "user_id": False,
            "token_hash": False,
            "created_at": False,
            "expires_at": False,
            "last_used_at": False,
            "revoked_at": False,
        }.items():
            assert owner_connection.execute(
                "SELECT has_column_privilege(%s, %s, %s, 'SELECT')",
                (APP_RUNTIME_ROLE, "public.user_sessions", column_name),
            ).fetchone()[0] is expected_select


def test_runtime_role_cannot_run_ddl_or_access_ungranted_tables(
    runtime_database_url: str,
) -> None:
    with psycopg.connect(runtime_database_url) as runtime_connection:
        for statement in (
            "CREATE TABLE public.app_runtime_must_not_create (id integer)",
            "ALTER TABLE public.users ADD COLUMN forbidden integer",
            "DROP TABLE public.users",
            "SELECT * FROM public.profile_photos",
            "SELECT * FROM public.chat_summaries",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with runtime_connection.transaction():
                    runtime_connection.execute(statement)


def test_owner_future_tables_do_not_become_available_to_runtime_role(
    test_owner_database_url: str,
    cleanup_owner_created_table: None,
) -> None:
    with psycopg.connect(test_owner_database_url) as owner_connection:
        owner_connection.execute("CREATE TABLE public.runtime_role_future_object (id integer)")
        for privilege in CRUD_PRIVILEGES:
            assert owner_connection.execute(
                "SELECT has_table_privilege(%s, %s, %s)",
                (APP_RUNTIME_ROLE, "public.runtime_role_future_object", privilege),
            ).fetchone() == (False,)
