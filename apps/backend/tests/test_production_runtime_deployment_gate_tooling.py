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
        "current_authenticated_user_id",
        "set_config('app.user_id', %s, true)",
        "public.profiles",
        "public.travel_intents",
        "public.user_sessions",
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
        "user_sessions_select_own",
        "user_sessions_update_own",
    ):
        assert policy_name in script


def test_deployment_gate_uses_rollback_only_for_the_negative_write_probe() -> None:
    script = GATE_PATH.read_text()

    assert "class RollbackProbe" in script
    assert "raise RollbackProbe" in script
    assert "except RollbackProbe:" in script
    assert "INSERT INTO" not in script
    assert "UPDATE public." not in script
