#!/usr/bin/env python3
"""Fail-closed production cutover gate for the app_runtime database role."""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from uuid import uuid4

import psycopg


RUNTIME_ROLE = "app_runtime"
REQUIRED_FUNCTIONS = (
    "public.current_authenticated_user_id()",
    "public.resolve_bearer_session(text)",
    "public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)",
    "public.discover_eligible_travel_intents()",
    "public.archive_current_active_travel_intent()",
    "public.complete_current_onboarding()",
    "public.discover_candidate_profile_projection()",
    "public.discover_target_is_eligible(uuid)",
    "public.chat_participant_profile_projection(uuid)",
    "public.trip_participant_profile_projection(uuid)",
    "public.record_current_discover_decision(uuid,text)",
    "public.is_current_active_chat_participant(uuid)",
    "public.create_current_group_chat(uuid[])",
    "public.send_current_chat_message(uuid,text)",
    "public.is_current_active_trip_participant(uuid)",
    "public.create_current_trip_from_chat(uuid)",
)

RUNTIME_TABLE_OPERATION_SURFACE = {
    "chats": {"SELECT"},
    "chat_participants": {"SELECT"},
    "messages": {"SELECT"},
    "trips": {"SELECT"},
    "trip_participants": {"SELECT"},
    "trip_stops": {"SELECT"},
}

RUNTIME_COLUMN_PRIVILEGES = {
    ("chats", "SELECT"): {"id", "type", "created_at"},
    ("chat_participants", "SELECT"): {"chat_id", "user_id", "left_at"},
    ("messages", "SELECT"): {
        "id",
        "chat_id",
        "sequence_number",
        "type",
        "sender_user_id",
        "recipient_user_id",
        "content_text",
        "created_at",
    },
    ("trips", "SELECT"): {
        "id", "chat_id", "created_by_user_id", "status", "membership_version",
        "state_version", "destination_version", "dates_version", "budget_version",
        "transport_version", "destination_status", "dates_status", "budget_status",
        "transport_status", "date_from", "date_to", "budget_min", "budget_max",
        "budget_currency", "budget_scope", "started_at", "completed_at", "cancelled_at",
        "created_at", "updated_at",
    },
    ("trip_participants", "SELECT"): {"trip_id", "user_id", "left_at"},
    ("trip_stops", "SELECT"): {
        "id", "trip_id", "position", "place_label", "country_code", "place_ref",
        "stay_from", "stay_to", "notes", "created_at", "updated_at",
    },
}


class GateFailure(RuntimeError):
    """A required production security boundary was not proved."""


class RollbackProbe(Exception):
    """End a probe transaction without ever committing it."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateFailure(message)


def scalar(connection: psycopg.Connection, query: str, parameters: Sequence[object] = ()) -> object:
    return connection.execute(query, parameters).fetchone()[0]


def check_runtime_identity(connection: psycopg.Connection) -> None:
    current_user, session_user = connection.execute(
        "SELECT current_user, session_user"
    ).fetchone()
    require(
        current_user == RUNTIME_ROLE and session_user == RUNTIME_ROLE,
        "current_user and session_user must both be app_runtime",
    )

    role = connection.execute(
        """
        SELECT
          rolcanlogin,
          rolsuper,
          rolbypassrls,
          rolcreaterole,
          rolcreatedb,
          rolinherit,
          rolreplication
        FROM pg_roles
        WHERE rolname = current_user
        """
    ).fetchone()
    require(role is not None, "current role is missing from pg_roles")
    require(
        role == (True, False, False, False, False, False, False),
        "app_runtime does not match the required least-privilege role contract",
    )


def check_required_functions(connection: psycopg.Connection) -> None:
    rows = connection.execute(
        """
        SELECT
          function_signature,
          to_regprocedure(function_signature) IS NOT NULL AS exists,
          COALESCE(
            has_function_privilege(
              current_user,
              to_regprocedure(function_signature),
              'EXECUTE'
            ),
            false
          ) AS executable
        FROM unnest(%s::text[]) AS required(function_signature)
        ORDER BY function_signature
        """,
        (list(REQUIRED_FUNCTIONS),),
    ).fetchall()
    require(len(rows) == len(REQUIRED_FUNCTIONS), "required function catalog lookup was incomplete")
    missing = [signature for signature, exists, executable in rows if not exists or not executable]
    require(not missing, f"required runtime function is absent or not executable: {', '.join(missing)}")


def check_capability_metadata(connection: psycopg.Connection) -> None:
    """Require hardened definer functions and no accidental PUBLIC execution."""
    expected = {
        "public.is_current_active_chat_participant(uuid)": True,
        "public.create_current_group_chat(uuid[])": True,
        "public.send_current_chat_message(uuid,text)": True,
        "public.is_current_active_trip_participant(uuid)": True,
        "public.create_current_trip_from_chat(uuid)": True,
        "public.enforce_direct_chat_participant_count()": False,
    }
    rows = connection.execute(
        """
        SELECT
          signature,
          procedure.oid IS NOT NULL AS exists,
          COALESCE(procedure.prosecdef, false) AS security_definer,
          COALESCE(procedure.proconfig @> ARRAY['search_path=pg_catalog'], false) AS fixed_search_path,
          EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          ) AS public_execute,
          COALESCE(has_function_privilege(current_user, procedure.oid, 'EXECUTE'), false) AS runtime_execute
        FROM unnest(%s::text[]) AS expected(signature)
        LEFT JOIN pg_proc AS procedure ON procedure.oid = to_regprocedure(expected.signature)
        ORDER BY signature
        """,
        (list(expected),),
    ).fetchall()
    require(len(rows) == len(expected), "capability catalog lookup was incomplete")
    invalid = [
        signature
        for signature, exists, security_definer, fixed_search_path, public_execute, runtime_execute in rows
        if not exists
        or not security_definer
        or not fixed_search_path
        or public_execute
        or runtime_execute is not expected[signature]
    ]
    require(not invalid, f"capability security metadata is invalid: {', '.join(invalid)}")


def check_runtime_table_privileges(connection: psycopg.Connection) -> None:
    """Prove Chat and Trip writes are capability-only."""
    operation_rows = connection.execute(
        """
        WITH expected(table_name, privilege_type) AS (
          VALUES
            ('chats', 'SELECT'), ('chat_participants', 'SELECT'), ('messages', 'SELECT'),
            ('trips', 'SELECT'), ('trip_participants', 'SELECT'), ('trip_stops', 'SELECT')
        ), operations(privilege_type) AS (
          VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
        )
        SELECT
          expected.table_name,
          operations.privilege_type,
          EXISTS (
            SELECT 1 FROM expected AS allowed
            WHERE allowed.table_name = expected.table_name
              AND allowed.privilege_type = operations.privilege_type
          ) AS expected_granted,
          has_table_privilege(current_user, format('public.%I', expected.table_name), operations.privilege_type)
            OR CASE WHEN operations.privilege_type IN ('SELECT', 'INSERT', 'UPDATE') THEN
              has_any_column_privilege(current_user, format('public.%I', expected.table_name), operations.privilege_type)
            ELSE false END AS actual_granted
        FROM (SELECT DISTINCT table_name FROM expected) AS expected
        CROSS JOIN operations
        ORDER BY expected.table_name, operations.privilege_type
        """
    ).fetchall()
    expected_operation_rows = {
        (table_name, operation, operation in allowed_operations)
        for table_name, allowed_operations in RUNTIME_TABLE_OPERATION_SURFACE.items()
        for operation in ("SELECT", "INSERT", "UPDATE", "DELETE")
    }
    actual_operation_rows = {(table_name, operation, expected) for table_name, operation, expected, _ in operation_rows}
    require(actual_operation_rows == expected_operation_rows, "runtime table privilege catalog lookup was incomplete")
    mismatch = [
        f"{table_name} {operation}"
        for table_name, operation, expected, actual in operation_rows
        if expected != actual
    ]
    require(not mismatch, f"runtime table privilege surface is not capability-only: {', '.join(mismatch)}")

    column_rows = connection.execute(
        """
        WITH tables(table_name) AS (
          VALUES ('chats'), ('chat_participants'), ('messages'), ('trips'),
            ('trip_participants'), ('trip_stops')
        ), operations(privilege_type) AS (
          VALUES ('SELECT'), ('INSERT'), ('UPDATE')
        )
        SELECT relation.relname, attribute.attname, operations.privilege_type,
          has_column_privilege(current_user, relation.oid, attribute.attnum, operations.privilege_type)
        FROM tables
        JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
        JOIN pg_class AS relation ON relation.relnamespace = namespace.oid
          AND relation.relname = tables.table_name
        JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        CROSS JOIN operations
        ORDER BY relation.relname, attribute.attname, operations.privilege_type
        """
    ).fetchall()
    mismatch = [
        f"{table_name}.{column_name} {operation}"
        for table_name, column_name, operation, actual in column_rows
        if actual != (column_name in RUNTIME_COLUMN_PRIVILEGES.get((table_name, operation), set()))
    ]
    require(not mismatch, f"runtime column privilege surface is not exact: {', '.join(mismatch)}")


def check_rls_catalog(connection: psycopg.Connection) -> None:
    rls_rows = connection.execute(
        """
        SELECT
          relation.relname,
          relation.relrowsecurity,
          relation.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
            AS runtime_is_not_owner
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY(%s::text[])
        """,
        (["profiles", "travel_intents", "user_activity_states", "user_sessions", "discover_interest_decisions", "matches", "chats", "chat_participants", "messages", "trips", "trip_participants", "trip_stops"],),
    ).fetchall()
    require(
        {name: (enabled, runtime_is_not_owner) for name, enabled, runtime_is_not_owner in rls_rows}
        == {
            "profiles": (True, True),
            "travel_intents": (True, True),
            "user_activity_states": (True, True),
            "user_sessions": (True, True),
            "discover_interest_decisions": (True, True),
            "matches": (True, True),
            "chats": (True, True),
            "chat_participants": (True, True),
            "messages": (True, True),
            "trips": (True, True),
            "trip_participants": (True, True),
            "trip_stops": (True, True),
        },
        "RLS must be enabled and app_runtime must not own protected runtime tables",
    )

    policy_rows = connection.execute(
        """
        WITH expected(
          policy_name,
          table_name,
          policy_command,
          using_expression,
          with_check_expression
        ) AS (
          VALUES
            ('profiles_select_own', 'profiles', 'r',
              '(user_id = current_authenticated_user_id())', NULL::text),
            ('profiles_insert_own', 'profiles', 'a',
              NULL::text, '(user_id = current_authenticated_user_id())'),
            ('profiles_update_own', 'profiles', 'w',
              '(user_id = current_authenticated_user_id())',
              '(user_id = current_authenticated_user_id())'),
            ('travel_intents_select_own_active', 'travel_intents', 'r',
              '((user_id = current_authenticated_user_id()) AND (status = ''active''::text))', NULL::text),
            ('travel_intents_insert_own_active', 'travel_intents', 'a',
              NULL::text, '((user_id = current_authenticated_user_id()) AND (status = ''active''::text))'),
            ('travel_intents_update_own_active', 'travel_intents', 'w',
              '((user_id = current_authenticated_user_id()) AND (status = ''active''::text))',
              '((user_id = current_authenticated_user_id()) AND (status = ANY (ARRAY[''active''::text, ''archived''::text])))'),
            ('user_activity_states_select_own', 'user_activity_states', 'r',
              '(user_id = current_authenticated_user_id())', NULL::text),
            ('user_sessions_select_own', 'user_sessions', 'r',
              '(user_id = current_authenticated_user_id())', NULL::text),
            ('user_sessions_update_own', 'user_sessions', 'w',
              '(user_id = current_authenticated_user_id())',
              '(user_id = current_authenticated_user_id())'),
            ('discover_interest_decisions_select_own', 'discover_interest_decisions', 'r',
              '(actor_user_id = current_authenticated_user_id())', NULL::text),
            ('matches_select_participant', 'matches', 'r',
              '((user_a_id = current_authenticated_user_id()) OR (user_b_id = current_authenticated_user_id()))', NULL::text),
            ('chats_select_active_participant', 'chats', 'r',
              'is_current_active_chat_participant(id)', NULL::text),
            ('chat_participants_select_active_chat', 'chat_participants', 'r',
              '((left_at IS NULL) AND is_current_active_chat_participant(chat_id))', NULL::text),
            ('messages_select_active_participant', 'messages', 'r',
              '(is_current_active_chat_participant(chat_id) AND ((recipient_user_id IS NULL) OR (recipient_user_id = current_authenticated_user_id())))', NULL::text),
            ('trips_select_active_participant', 'trips', 'r',
              'is_current_active_trip_participant(id)', NULL::text),
            ('trip_participants_select_active_trip', 'trip_participants', 'r',
              '((left_at IS NULL) AND is_current_active_trip_participant(trip_id))', NULL::text),
            ('trip_stops_select_active_participant', 'trip_stops', 'r',
              'is_current_active_trip_participant(trip_id)', NULL::text)
        )
        SELECT expected.policy_name,
          policy.oid IS NOT NULL AS exists_for_runtime
        FROM expected
        LEFT JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
        LEFT JOIN pg_class AS relation ON relation.relnamespace = namespace.oid
          AND relation.relname = expected.table_name
        LEFT JOIN pg_policy AS policy ON policy.polrelid = relation.oid
          AND policy.polname = expected.policy_name
          AND policy.polcmd = expected.policy_command
          AND (SELECT oid FROM pg_roles WHERE rolname = current_user) = ANY(policy.polroles)
          AND pg_get_expr(policy.polqual, policy.polrelid)
            IS NOT DISTINCT FROM expected.using_expression
          AND pg_get_expr(policy.polwithcheck, policy.polrelid)
            IS NOT DISTINCT FROM expected.with_check_expression
        ORDER BY expected.policy_name
        """
    ).fetchall()
    missing = [name for name, exists in policy_rows if not exists]
    require(not missing, f"required RLS policy is missing for app_runtime: {', '.join(missing)}")
    session_policy_surface = connection.execute(
        """
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_sessions'
        ORDER BY policyname
        """
    ).fetchall()
    require(
        session_policy_surface == [
            ("user_sessions_select_own", "SELECT"),
            ("user_sessions_update_own", "UPDATE"),
        ],
        "user_sessions has an unexpected RLS policy surface",
    )
    for table_name, expected_surface in (
        ("discover_interest_decisions", [("discover_interest_decisions_select_own", "SELECT")]),
        ("matches", [("matches_select_participant", "SELECT")]),
        ("chats", [("chats_select_active_participant", "SELECT")]),
        ("chat_participants", [("chat_participants_select_active_chat", "SELECT")]),
        ("messages", [("messages_select_active_participant", "SELECT")]),
        ("trips", [("trips_select_active_participant", "SELECT")]),
        ("trip_participants", [("trip_participants_select_active_trip", "SELECT")]),
        ("trip_stops", [("trip_stops_select_active_participant", "SELECT")]),
    ):
        surface = connection.execute(
            "SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' "
            "AND tablename=%s ORDER BY policyname",
            (table_name,),
        ).fetchall()
        require(surface == expected_surface, f"{table_name} has an unexpected RLS policy surface")
    activity_state_policy_surface = connection.execute(
        """
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_activity_states'
        ORDER BY policyname
        """
    ).fetchall()
    require(
        activity_state_policy_surface == [("user_activity_states_select_own", "SELECT")],
        "user_activity_states has an unexpected RLS policy surface",
    )


def check_transaction_context_and_rls(connection: psycopg.Connection) -> None:
    probe_user_id = uuid4()
    with connection.transaction():
        connection.execute(
            "SELECT set_config('app.user_id', %s, true)", (str(probe_user_id),)
        )
        require(
            scalar(connection, "SELECT public.current_authenticated_user_id()") == probe_user_id,
            "authenticated transaction context did not resolve to its UUID",
        )
        permitted_read = scalar(
            connection,
            "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = %s)",
            (probe_user_id,),
        )
        require(isinstance(permitted_read, bool), "runtime profile read did not execute")
        permitted_activity_state_read = scalar(
            connection,
            "SELECT EXISTS (SELECT 1 FROM public.user_activity_states WHERE user_id = %s)",
            (probe_user_id,),
        )
        require(
            isinstance(permitted_activity_state_read, bool),
            "runtime activity-state read did not execute",
        )
        permitted_session_read = scalar(
            connection,
            "SELECT EXISTS (SELECT 1 FROM public.user_sessions)",
        )
        require(isinstance(permitted_session_read, bool), "runtime session read did not execute")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.discover_interest_decisions)") is False, "decision RLS exposed an unrelated row")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.matches)") is False, "match RLS exposed an unrelated row")

    with connection.transaction():
        require(
            scalar(connection, "SELECT public.current_authenticated_user_id()") is None,
            "app.user_id leaked into the next transaction",
        )
        require(
            scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.profiles)") is False,
            "profiles RLS did not fail closed without authenticated context",
        )
        require(
            scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.travel_intents)") is False,
            "travel_intents RLS did not fail closed without authenticated context",
        )
        require(
            scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.user_activity_states)") is False,
            "user_activity_states RLS did not fail closed without authenticated context",
        )
        require(
            scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.user_sessions)") is False,
            "user_sessions RLS did not fail closed without authenticated context",
        )
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.discover_interest_decisions)") is False, "decisions RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.matches)") is False, "matches RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.chats)") is False, "chats RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.chat_participants)") is False, "chat participants RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.messages)") is False, "messages RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.trips)") is False, "trips RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.trip_participants)") is False, "trip participants RLS did not fail closed without authenticated context")
        require(scalar(connection, "SELECT EXISTS (SELECT 1 FROM public.trip_stops)") is False, "trip stops RLS did not fail closed without authenticated context")


def check_mutations_are_denied_and_rolled_back(connection: psycopg.Connection) -> None:
    for statement in (
        "DELETE FROM public.profiles WHERE false",
        "INSERT INTO public.trips (chat_id, created_by_user_id, status) SELECT NULL, NULL, 'forming' WHERE false",
        "UPDATE public.trips SET status='forming' WHERE false",
        "DELETE FROM public.trips WHERE false",
        "INSERT INTO public.trip_participants (trip_id, user_id) SELECT NULL, NULL WHERE false",
        "UPDATE public.trip_participants SET left_at=now() WHERE false",
        "DELETE FROM public.trip_participants WHERE false",
        "INSERT INTO public.trip_stops (trip_id, position, place_label) SELECT NULL, 1, 'blocked' WHERE false",
        "UPDATE public.trip_stops SET place_label='blocked' WHERE false",
        "DELETE FROM public.trip_stops WHERE false",
    ):
        try:
            with connection.transaction():
                try:
                    connection.execute(statement)
                except psycopg.errors.InsufficientPrivilege:
                    raise RollbackProbe from None
                raise GateFailure(f"app_runtime unexpectedly ran: {statement}")
        except RollbackProbe:
            continue


def run_gate(database_url: str) -> None:
    with psycopg.connect(database_url, autocommit=True) as connection:
        check_runtime_identity(connection)
        check_required_functions(connection)
        check_capability_metadata(connection)
        check_runtime_table_privileges(connection)
        check_rls_catalog(connection)
        check_transaction_context_and_rls(connection)
        check_mutations_are_denied_and_rolled_back(connection)


def main() -> None:
    try:
        database_url = os.environ["PRODUCTION_RUNTIME_DATABASE_URL"]
        require(bool(database_url), "PRODUCTION_RUNTIME_DATABASE_URL is required")
        run_gate(database_url)
    except Exception as error:
        print(f"Production runtime deployment gate failed: {error}", file=sys.stderr)
        sys.exit(1)

    print("Production runtime deployment gate passed.")


if __name__ == "__main__":
    main()
