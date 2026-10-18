from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys

import psycopg
import pytest

from integration_database import require_disposable_test_database_url


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "production-backup-runner.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location("production_backup_runner_catalog_tests", SCRIPT_PATH)
assert SCRIPT_SPEC is not None and SCRIPT_SPEC.loader is not None
runner = importlib.util.module_from_spec(SCRIPT_SPEC)
sys.modules[SCRIPT_SPEC.name] = runner
SCRIPT_SPEC.loader.exec_module(runner)


def test_preflight_catalog_inventory_tracks_acl_scopes_dependencies_and_sequence_acl() -> None:
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to the guarded local disposable PostgreSQL test database.")
    require_disposable_test_database_url(database_url, environment={"TEST_DATABASE_URL": database_url})

    with psycopg.connect(database_url) as connection:
        try:
            connection.execute("CREATE SCHEMA IF NOT EXISTS auth")
            connection.execute("CREATE TABLE IF NOT EXISTS auth.users (id integer)")
            connection.execute("CREATE SCHEMA IF NOT EXISTS storage")
            connection.execute("CREATE TABLE IF NOT EXISTS storage.objects (id integer)")
            connection.execute("CREATE SCHEMA IF NOT EXISTS vault")
            connection.execute("CREATE TABLE IF NOT EXISTS vault.secrets (id integer)")
            connection.execute("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations "
                "(version text, name text)"
            )
            connection.execute("GRANT USAGE ON SCHEMA public TO app_runtime")
            connection.execute("CREATE TABLE public.backup_runner_acl_fixture (id integer)")
            connection.execute("CREATE SEQUENCE public.backup_runner_acl_fixture_seq")
            connection.execute("GRANT SELECT ON public.backup_runner_acl_fixture TO app_runtime")
            connection.execute(
                "CREATE FUNCTION public.backup_runner_acl_fixture_fn() RETURNS integer "
                "LANGUAGE sql IMMUTABLE AS 'SELECT 1'"
            )
            connection.execute("GRANT EXECUTE ON FUNCTION public.backup_runner_acl_fixture_fn() TO app_runtime")
            connection.execute("CREATE TYPE public.backup_runner_acl_fixture_type AS ENUM ('fixture')")
            connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_runtime")

            connection.execute("CREATE SCHEMA backup_runner_private_fixture")
            connection.execute(
                "CREATE FUNCTION backup_runner_private_fixture.hidden_fn() RETURNS integer "
                "LANGUAGE sql IMMUTABLE AS 'SELECT 1'"
            )
            connection.execute(
                "CREATE VIEW public.backup_runner_private_dependency AS "
                "SELECT backup_runner_private_fixture.hidden_fn() AS value"
            )

            extensions = connection.execute(
                "SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto'"
            ).fetchone()
            if extensions is not None:
                connection.execute(
                    "CREATE VIEW public.backup_runner_extension_dependency AS "
                    "SELECT digest('fixture', 'sha256') AS value"
                )

            metadata = json.loads(connection.execute(runner.PREFLIGHT_SQL).fetchone()[0])
            scopes = metadata["acl_principals_by_scope"]
            assert {"relations", "functions", "types", "schema", "default_acl"}.issubset(scopes)
            assert "app_runtime" in scopes["relations"]
            assert "app_runtime" in scopes["functions"]
            assert "app_runtime" in scopes["default_acl"]
            assert "app_runtime" in scopes["schema"]
            assert "travel_friend_test" in scopes["relations"]
            assert connection.execute(
                "SELECT relacl IS NULL FROM pg_class WHERE oid = 'public.backup_runner_acl_fixture_seq'::regclass"
            ).fetchone()[0]
            sequence_acl_principals = connection.execute(
                "SELECT array_agg(DISTINCT role.rolname ORDER BY role.rolname) "
                "FROM pg_class sequence "
                "CROSS JOIN LATERAL aclexplode(COALESCE("
                "sequence.relacl, acldefault('s'::\"char\", sequence.relowner)"
                ")) AS acl "
                "JOIN pg_roles role ON role.oid = acl.grantee "
                "WHERE sequence.oid = 'public.backup_runner_acl_fixture_seq'::regclass"
            ).fetchone()[0]
            assert sequence_acl_principals == ["travel_friend_test"]
            assert "travel_friend_test" in scopes["functions"]
            assert "travel_friend_test" in scopes["types"]
            assert "travel_friend_test" in scopes["schema"]
            assert "travel_friend_test" in scopes["default_acl"]
            assert "backup_runner_private_fixture" in metadata["catalog_non_public_dependencies"]
            if extensions is not None:
                assert any(
                    dependency["name"] == "pgcrypto"
                    for dependency in metadata["extension_restore_dependencies"]
                )
            assert metadata["server_version"].startswith("17.")
            ledger = json.loads(connection.execute(runner.MIGRATION_LEDGER_SQL).fetchone()[0])
            assert ledger == {"observed_at": ledger["observed_at"], "count": 0, "versions": []}
        finally:
            connection.rollback()
