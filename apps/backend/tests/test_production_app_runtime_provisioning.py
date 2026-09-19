"""Regression checks for hosted Supabase app_runtime provisioning."""

from __future__ import annotations

from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "provision-production-app-runtime-role.sql"
)


def test_provisioning_creates_the_runtime_role_with_all_required_attributes() -> None:
    script = SCRIPT_PATH.read_text()

    assert "CREATE ROLE app_runtime\n      LOGIN\n      NOSUPERUSER\n      NOBYPASSRLS\n      NOCREATEDB\n      NOCREATEROLE\n      NOINHERIT\n      NOREPLICATION;" in script


def test_provisioning_never_alters_an_existing_runtime_role() -> None:
    script = SCRIPT_PATH.read_text()

    assert "ALTER ROLE app_runtime" not in script
    assert "refusing to alter" in script
    assert "rolcanlogin" in script
    assert "rolsuper" in script
    assert "rolbypassrls" in script
    assert "rolcreatedb" in script
    assert "rolcreaterole" in script
    assert "rolinherit" in script
    assert "rolreplication" in script


def test_provisioning_uses_psql_password_prompt_without_a_password_literal() -> None:
    script = SCRIPT_PATH.read_text()

    assert "\\password app_runtime" in script
    assert "PASSWORD '" not in script
