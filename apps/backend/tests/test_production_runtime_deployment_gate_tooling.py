"""Static contracts for the production app_runtime deployment gate."""

from __future__ import annotations

import runpy
from pathlib import Path

import pytest


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
        "BACKEND_ONLY_FUNCTIONS",
        "public.bootstrap_telegram_login(bigint,text,text,text,text,text)",
        "public.chat_participant_public_profile(uuid,uuid)",
        "public.resolve_bearer_session_with_identity(text)",
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
        "resolve_bearer_session_with_identity",
        "anon",
        "authenticated",
        "service_role",
        "api_roles_present",
        "api_execute_roles",
        "complete_current_onboarding",
        "record_current_discover_decision",
        "is_current_active_chat_participant",
        "create_current_group_chat",
        "send_current_chat_message",
        "mark_current_chat_read",
        "chat_list_projection",
        "is_current_active_trip_participant",
        "create_current_trip_from_chat",
        "save_current_trip_draft",
        "save_current_trip_draft_alternative",
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
        "trip_itinerary_days",
        "trip_itinerary_events",
        "trip_drafts",
        "trip_draft_versions",
        "trip_draft_alternatives",
        "INTERNAL_DORMANT_TABLES",
        "APPLICATION_TABLES",
        '"users"',
        '"telegram_identities"',
        '"user_settings"',
        '"profile_photos"',
        '"chat_summaries"',
        "internal tables must not have RLS policies",
        "internal tables have direct runtime privileges",
        "DELETE FROM public.profiles WHERE false",
        "InsufficientPrivilege",
    ):
        assert required_fragment in script

    gate = runpy.run_path(str(GATE_PATH))
    assert gate["BACKEND_ONLY_FUNCTIONS"] == (
        "public.bootstrap_telegram_login(bigint,text,text,text,text,text)",
        "public.chat_participant_public_profile(uuid,uuid)",
        "public.resolve_bearer_session_with_identity(text)",
        "public.send_current_chat_message(uuid,text,uuid)",
        "public.mark_current_chat_read(uuid,bigint)",
        "public.chat_list_projection()",
        "public.create_current_group_chat(uuid[],text)",
        "public.rename_current_group_chat(uuid,text)",
        "public.save_current_trip_draft(uuid,integer,jsonb)",
        "public.save_current_trip_draft_alternative(uuid,text,jsonb)",
        "public.create_current_trip_proposal(uuid,integer,text,uuid,text[],uuid[],timestamp with time zone)",
        "public.cast_current_trip_proposal_vote(uuid,text)",
        "public.cancel_current_trip_proposal(uuid)",
        "public.refresh_current_trip_proposals(uuid)",
    )

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
        "trip_itinerary_days_select_active_participant",
        "trip_itinerary_events_select_active_participant",
        "trip_drafts_select_active_participant",
        "trip_draft_versions_select_active_participant",
        "trip_draft_alternatives_select_active_participant",
        "trip_confirmed_accommodations_select_member",
        "trip_confirmed_transport_select_member",
        "trip_proposals_select_member",
        "trip_proposal_operations_select_member",
        "trip_proposal_voters_select_member",
        "trip_proposal_prerequisites_select_member",
        "trip_proposal_scope_versions_select_member",
    ):
        assert policy_name in script

    assert "chats_lock_active_participant" not in script
    assert "chat_participants_lock_active_chat" not in script

    for table_name in (
        "users",
        "telegram_identities",
        "user_settings",
        "profile_photos",
        "chat_summaries",
    ):
        assert table_name in script


def test_deployment_gate_uses_rollback_only_for_the_negative_write_probe() -> None:
    script = GATE_PATH.read_text()

    assert "class RollbackProbe" in script
    assert "raise RollbackProbe" in script
    assert "except RollbackProbe:" in script
    assert "WHERE false" in script


def test_deployment_gate_failure_output_excludes_exception_text(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    gate = runpy.run_path(str(GATE_PATH))
    sensitive_exception_text = "credential-sentinel-must-not-reach-stderr"

    def fail_gate(_: str) -> None:
        raise RuntimeError(sensitive_exception_text)

    monkeypatch.setenv("PRODUCTION_RUNTIME_DATABASE_URL", "postgresql://runtime@example.test/app")
    monkeypatch.setitem(gate["main"].__globals__, "run_gate", fail_gate)

    with pytest.raises(SystemExit) as exit_info:
        gate["main"]()

    assert exit_info.value.code == 1
    error_output = capsys.readouterr().err
    assert "Production runtime deployment gate failed" in error_output
    assert "RuntimeError" in error_output
    assert sensitive_exception_text not in error_output
