"""Static contracts for production app_runtime grants tooling."""

from __future__ import annotations

from pathlib import Path

import psycopg
import pytest

from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
)

SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
GRANTS_SCRIPT_PATH = SCRIPTS_DIRECTORY / "grant-production-app-runtime-privileges.sql"
VERIFY_SCRIPT_PATH = SCRIPTS_DIRECTORY / "verify-production-app-runtime-privileges.sql"


REQUIRED_CAPABILITIES = {
    "public.current_authenticated_user_id()",
    "public.resolve_bearer_session(text)",
    "public.bootstrap_telegram_login(\n  bigint, text, text, text, text, text, timestamptz, timestamptz\n)",
    "public.discover_eligible_travel_intents()",
    "public.archive_current_active_travel_intent()",
    "public.complete_current_onboarding()",
    "public.discover_candidate_profile_projection()",
    "public.discover_target_is_eligible(uuid)",
    "public.chat_participant_profile_projection(uuid)",
    "public.trip_participant_profile_projection(uuid)",
}

EXPECTED_TRIGGER_FUNCTION_FINDINGS = [
    "public.enforce_chat_participant_read_sequences()",
    "public.enforce_direct_chat_participant_count()",
]


def test_production_grants_script_is_scoped_and_idempotent() -> None:
    script = GRANTS_SCRIPT_PATH.read_text()

    assert "\\set ON_ERROR_STOP on" in script
    assert "ALTER ROLE app_runtime" not in script
    assert "CREATE ROLE app_runtime" not in script
    assert "GRANT " not in "\n".join(
        line for line in script.splitlines() if "PUBLIC" in line
    )
    assert "FROM PUBLIC;" not in script
    assert "ON ALL TABLES IN SCHEMA" not in script
    assert "ON ALL FUNCTIONS IN SCHEMA" not in script
    assert "ON ALL SEQUENCES IN SCHEMA" not in script
    assert "RENDER" not in script.upper()
    assert "GRANT USAGE ON SCHEMA public TO app_runtime;" in script
    assert "GRANT USAGE ON SEQUENCE" not in script
    assert "GRANT SELECT ON SEQUENCE" not in script
    assert "GRANT UPDATE ON SEQUENCE" not in script


def test_production_grants_cover_the_audited_runtime_matrix() -> None:
    script = GRANTS_SCRIPT_PATH.read_text()

    for table_name in (
        "profiles",
        "user_activity_states",
        "travel_intents",
        "user_sessions",
        "discover_interest_decisions",
        "matches",
        "chats",
        "chat_participants",
        "messages",
        "trips",
        "trip_participants",
        "trip_stops",
    ):
        assert f"REVOKE ALL PRIVILEGES ON TABLE public.{table_name} FROM app_runtime;" in script

    assert "GRANT SELECT (id) ON TABLE public.user_sessions TO app_runtime;" in script
    assert "GRANT UPDATE (revoked_at) ON TABLE public.user_sessions TO app_runtime;" in script
    assert (
        "GRANT SELECT (user_id, onboarding_status) ON TABLE public.user_activity_states "
        "TO app_runtime;"
    ) in script
    assert "GRANT UPDATE (onboarding_status, updated_at) ON TABLE public.user_activity_states" not in script
    assert "GRANT UPDATE (id) ON TABLE public.chat_participants TO app_runtime;" in script
    assert "GRANT SELECT ON TABLE public.user_sessions TO app_runtime;" not in script
    assert "GRANT UPDATE ON TABLE public.user_sessions TO app_runtime;" not in script


def test_production_grants_allow_only_the_required_capabilities() -> None:
    script = GRANTS_SCRIPT_PATH.read_text()

    for capability in REQUIRED_CAPABILITIES:
        assert f"GRANT EXECUTE ON FUNCTION {capability} TO app_runtime;" in script


def test_read_only_verification_checks_effective_privileges_and_role_boundary() -> None:
    script = VERIFY_SCRIPT_PATH.read_text()
    normalized = script.upper()

    assert "\\SET ON_ERROR_STOP ON" in normalized
    assert "HAS_TABLE_PRIVILEGE" in normalized
    assert "HAS_COLUMN_PRIVILEGE" in normalized
    assert "PG_CLASS" in normalized
    assert "PG_NAMESPACE" in normalized
    assert "PG_ATTRIBUTE" in normalized
    assert "INFORMATION_SCHEMA.COLUMNS" not in normalized
    assert "HAS_FUNCTION_PRIVILEGE" in normalized
    assert "DELETE" in normalized
    assert "TRUNCATE" in normalized
    assert "REFERENCES" in normalized
    assert "TRIGGER" in normalized
    assert "USER_SESSIONS" in normalized
    assert "ROLBYPASSRLS" in normalized
    assert "RELOWNER" in normalized
    for capability in REQUIRED_CAPABILITIES:
        assert capability.split("(", maxsplit=1)[0].upper() in normalized

    for forbidden in ("\nGRANT ", "\nREVOKE ", "\nALTER ", "\nCREATE ", "\nDROP ", "\nINSERT ", "\nUPDATE ", "\nDELETE FROM "):
        assert forbidden not in normalized


def execute_psql_script(connection: psycopg.Connection, script_path: Path) -> list[tuple[list[str], list[tuple[object, ...]]]]:
    """Run a checked-in psql script through psycopg, omitting its psql-only setting."""
    sql = "\n".join(
        line for line in script_path.read_text().splitlines() if not line.startswith("\\set ")
    )
    cursor = connection.execute(sql)
    result_sets: list[tuple[list[str], list[tuple[object, ...]]]] = []

    while True:
        if cursor.description is not None:
            result_sets.append(([column.name for column in cursor.description], cursor.fetchall()))
        if not cursor.nextset():
            return result_sets


def table_operation_rows(
    verification_results: list[tuple[list[str], list[tuple[object, ...]]]],
) -> list[tuple[object, ...]]:
    """Return the exact table-operation result set from the verifier output."""
    return next(
        rows
        for column_names, rows in verification_results
        if {"table_name", "privilege_type", "expected", "actual_effective", "is_exact"}
        <= set(column_names)
    )


def test_production_runtime_grants_and_verifier_execute_against_migrated_schema() -> None:
    """PostgreSQL resolves every tooling object name; this is not a text-only audit."""
    try:
        database_url = get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))

    with psycopg.connect(database_url) as connection:
        # This mirrors Supabase's auth.users.instance_id without using a hosted
        # project. The verifier must never pair that column with public.users.
        connection.execute("CREATE SCHEMA IF NOT EXISTS auth")
        connection.execute("CREATE TABLE IF NOT EXISTS auth.users (instance_id uuid)")
        connection.execute("ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid")
        # Mirror the accepted pre-hardening production finding. The grants
        # script must not REVOKE privileges FROM PUBLIC, and the verifier must
        # continue to expose the resulting effective EXECUTE capabilities.
        for function_signature in EXPECTED_TRIGGER_FUNCTION_FINDINGS:
            connection.execute(f"GRANT EXECUTE ON FUNCTION {function_signature} TO PUBLIC")
        execute_psql_script(connection, GRANTS_SCRIPT_PATH)
        execute_psql_script(connection, GRANTS_SCRIPT_PATH)
        verification_results = execute_psql_script(connection, VERIFY_SCRIPT_PATH)

        baseline_table_operations = table_operation_rows(verification_results)
        assert len(baseline_table_operations) == 17 * 7
        assert all(row[3] == row[4] and row[5] is True for row in baseline_table_operations)

        connection.execute("GRANT SELECT (id) ON TABLE public.users TO app_runtime")
        unexpected_column_results = execute_psql_script(connection, VERIFY_SCRIPT_PATH)
        assert ("users", "SELECT", True, False) in [
            (row[0], row[1], row[4], row[5])
            for row in table_operation_rows(unexpected_column_results)
        ]

        connection.execute("REVOKE SELECT (id) ON TABLE public.user_sessions FROM app_runtime")
        missing_column_results = execute_psql_script(connection, VERIFY_SCRIPT_PATH)
        assert ("user_sessions", "SELECT", False, False) in [
            (row[0], row[1], row[4], row[5])
            for row in table_operation_rows(missing_column_results)
        ]

        # The tooling check deliberately mutates ACLs; do not leak that surface
        # into runtime-role tests that share the disposable database.
        connection.rollback()

    assert verification_results
    boolean_results = [
        value
        for column_names, rows in verification_results
        for row in rows
        for column_name, value in zip(column_names, row, strict=True)
        if column_name.startswith("is_") or column_name in {"column_exists", "function_exists"}
    ]
    assert boolean_results
    assert all(value is True for value in boolean_results)

    unexpected_function_rows = next(
        rows
        for column_names, rows in verification_results
        if "unexpected_function_signature" in column_names
    )
    # Trigger-function PUBLIC EXECUTE hardening is intentionally a separate
    # work item. The grants script must neither mask nor remediate these
    # effective privileges; the verifier must keep reporting them.
    assert unexpected_function_rows == [
        (function_signature, True)
        for function_signature in EXPECTED_TRIGGER_FUNCTION_FINDINGS
    ]
