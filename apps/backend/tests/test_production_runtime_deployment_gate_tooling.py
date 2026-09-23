"""Static contracts for the production app_runtime deployment gate."""

from __future__ import annotations

from pathlib import Path


GATE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "production-runtime-deployment-gate.py"


def test_deployment_gate_requires_only_the_runtime_dsn_and_fails_closed() -> None:
    script = GATE_PATH.read_text()

    assert "PRODUCTION_RUNTIME_DATABASE_URL" in script
    assert "DATABASE_URL" not in script.replace("PRODUCTION_RUNTIME_DATABASE_URL", "")
    assert "os.environ[\"PRODUCTION_RUNTIME_DATABASE_URL\"]" in script
    assert "sys.exit(1)" in script
    assert "autocommit=True" in script
    assert "uuid4()" in script
    assert "password" not in script.lower()
    assert "render" not in script.lower()


def test_deployment_gate_checks_runtime_identity_catalog_and_transactional_rls_behavior() -> None:
    script = GATE_PATH.read_text()

    for required_fragment in (
        "current_user",
        "session_user",
        "rolsuper",
        "rolbypassrls",
        "rolcreaterole",
        "rolcreatedb",
        "rolcanlogin",
        "rolinherit",
        "rolreplication",
        "relrowsecurity",
        "relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)",
        "pg_policy",
        "pg_get_expr(policy.polqual, policy.polrelid)",
        "pg_get_expr(policy.polwithcheck, policy.polrelid)",
        "has_function_privilege",
        "aclexplode",
        "current_authenticated_user_id",
        "complete_current_onboarding",
        "record_current_discover_decision",
        "is_current_active_chat_participant",
        "create_current_group_chat",
        "send_current_chat_message",
        "is_current_active_trip_participant",
        "create_current_trip_from_chat",
        "enforce_direct_chat_participant_count",
        "set_config('app.user_id', %s, true)",
        "public.profiles",
        "public.travel_intents",
        "public.user_activity_states",
        "public.user_sessions",
        "public.chats",
        "public.chat_participants",
        "public.messages",
        "public.trips",
        "public.trip_participants",
        "public.trip_stops",
        "DELETE FROM public.profiles WHERE false",
        "InsufficientPrivilege",
    ):
        assert required_fragment in script

    for policy_name in (
        "profiles_select_own",
        "profiles_insert_own",
        "profiles_update_own",
        "travel_intents_select_own_active",
        "travel_intents_insert_own_active",
        "travel_intents_update_own_active",
        "user_activity_states_select_own",
        "user_sessions_select_own",
        "user_sessions_update_own",
        "discover_interest_decisions_select_own",
        "matches_select_participant",
        "chats_select_active_participant",
        "chat_participants_select_active_chat",
        "messages_select_active_participant",
        "trips_select_active_participant",
        "trip_participants_select_active_trip",
        "trip_stops_select_active_participant",
    ):
        assert policy_name in script

    assert "chats_lock_active_participant" not in script
    assert "chat_participants_lock_active_chat" not in script


def test_deployment_gate_uses_rollback_only_for_the_negative_write_probe() -> None:
    script = GATE_PATH.read_text()

    assert "class RollbackProbe" in script
    assert "raise RollbackProbe" in script
    assert "except RollbackProbe:" in script
    assert "WHERE false" in script
