"""Mock-only contract tests for the local disposable backup/restore smoke."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "local-db-backup-restore-smoke.sh"


def run_smoke(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    target_exists: str = "f",
    data_match: str = "t",
    schema_match: str = "t",
    fail_command: str = "",
    container_label: str = "true",
    caller_database_url: str = "",
    caller_database_variable: str = "DATABASE_URL",
    restore_database_name: str = "travel_friend_backup_restore_test",
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    stub_dir = tmp_path / "bin"
    stub_dir.mkdir()
    docker_stub = stub_dir / "docker"
    docker_stub.write_text(
        r"""#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_CALL_LOG"
if [ "$1:$2" = 'container:inspect' ]; then
  if [ "$3" = '--format' ]; then
    printf 'NAME:/travel-friend-test-postgres\nLABEL:%s\nENV:POSTGRES_DB=travel_friend_test\nENV:POSTGRES_USER=travel_friend_test\nBIND:5432/tcp|127.0.0.1|55432\n' "$DOCKER_LABEL"
  fi
  exit 0
fi
if [ "$1" = 'exec' ]; then
  case "$*" in
    *'SELECT EXISTS '* ) printf '%s\n' "$TARGET_EXISTS"; exit 0 ;;
    *'SELECT current_database()'* ) printf '%s\n' "$RESTORE_DATABASE_NAME"; exit 0 ;;
    *'SELECT count(*) = 3'* ) printf 't\n'; exit 0 ;;
    *'SELECT count(*) = 1'* ) printf '%s\n' "$DATA_MATCH"; exit 0 ;;
    *'pg_dump'*'--schema-only'* )
      case "$*" in *'--dbname=travel_friend_backup_restore_test'*) side=restore ;; *) side=source ;; esac
      case "$SCHEMA_MATCH" in
        large)
          i=1
          while [ "$i" -le 100 ]; do
            printf 'CREATE TABLE %s_%0250d (id integer);\n' "$side" "$i"
            i=$((i + 1))
          done
          ;;
        sensitive)
          printf "CREATE FUNCTION %s() RETURNS text AS 'postgresql://dbuser:dbpassword@db.example.test/app password=dbsecret' LANGUAGE sql;\n" "$side"
          ;;
        restrict)
          printf '\\restrict %s-key\nCREATE TABLE stable (id integer);\n\\unrestrict %s-key\n' "$side" "$side"
          ;;
        create_table)
          printf 'CREATE TABLE %s_table (id integer);\n' "$side"
          ;;
        create_function)
          printf 'CREATE FUNCTION %s_function() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\n' "$side"
          ;;
        similar)
          printf '\\restrict %s-key\n\\unrestrict %s-key\n\\restricted %s\n\\unrestrictable %s\n  \\restrict %s-indented\nprefix \\restrict %s-inline\n' "$side" "$side" "$side" "$side" "$side" "$side"
          ;;
        different)
          printf '%s-schema\n' "$side"
          ;;
        *) printf 'same-schema\n' ;;
      esac
      exit 0
      ;;
    *'pg_dump'* ) [ "$FAIL_COMMAND" = 'pg_dump' ] && exit 31; printf 'mock-custom-archive\n'; exit 0 ;;
    *'pg_restore'*'--list'* ) [ "$FAIL_COMMAND" = 'pg_restore_list' ] && exit 32; cat >/dev/null; exit 0 ;;
    *'pg_restore'* ) [ "$FAIL_COMMAND" = 'pg_restore' ] && exit 33; cat >/dev/null; exit 0 ;;
    *'createdb'* ) if [ "$FAIL_COMMAND" = 'createdb' ]; then touch "$CREATE_MAY_HAVE_SUCCEEDED_FILE"; exit 34; fi; exit 0 ;;
    *'dropdb'* ) exit 0 ;;
    *'DROP SCHEMA public CASCADE'* ) exit 0 ;;
    *'psql'* ) exit 0 ;;
  esac
fi
exit 0
""",
        encoding="utf-8",
    )
    docker_stub.chmod(0o755)
    log_path = tmp_path / "docker.log"
    monkeypatch.setenv("CREATE_MAY_HAVE_SUCCEEDED_FILE", str(tmp_path / "createdb-may-have-succeeded"))
    monkeypatch.setenv("DOCKER_CALL_LOG", str(log_path))
    monkeypatch.setenv("DOCKER_LABEL", container_label)
    monkeypatch.setenv("TARGET_EXISTS", target_exists)
    monkeypatch.setenv("RESTORE_DATABASE_NAME", restore_database_name)
    monkeypatch.setenv("DATA_MATCH", data_match)
    monkeypatch.setenv("SCHEMA_MATCH", schema_match)
    monkeypatch.setenv("FAIL_COMMAND", fail_command)
    monkeypatch.setenv("PATH", f"{stub_dir}{os.pathsep}{os.environ['PATH']}")
    for variable in (
        "DATABASE_URL",
        "TEST_DATABASE_URL",
        "SUPABASE_DB_URL",
        "PRODUCTION_RUNTIME_DATABASE_URL",
    ):
        monkeypatch.delenv(variable, raising=False)
    if caller_database_url:
        monkeypatch.setenv(caller_database_variable, caller_database_url)
    result = subprocess.run(
        ["/bin/sh", str(SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
        env=os.environ.copy(),
    )
    calls = log_path.read_text(encoding="utf-8").splitlines() if log_path.exists() else []
    return result, calls


def test_local_backup_restore_smoke_verifies_and_cleans_disposable_targets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, calls = run_smoke(tmp_path, monkeypatch)

    assert result.returncode == 0, result.stderr
    assert "Starting guarded local disposable PostgreSQL" in result.stdout
    assert "pg_dump" in "\n".join(calls)
    assert "pg_restore" in "\n".join(calls)
    restore_calls = [call.split() for call in calls if "pg_restore" in call.split()]
    assert len(restore_calls) == 2
    assert all(call[1] == "-i" for call in restore_calls)
    assert all("-" not in call[call.index("pg_restore") + 1 :] for call in restore_calls)
    assert any("createdb" in call for call in calls)
    createdb_index = next(index for index, call in enumerate(calls) if "createdb" in call)
    identity_index = next(index for index, call in enumerate(calls) if "SELECT current_database()" in call)
    prepare_index = next(index for index, call in enumerate(calls) if "DROP SCHEMA public CASCADE" in call)
    restore_index = next(
        index
        for index, call in enumerate(calls)
        if "pg_restore" in call and "--dbname=travel_friend_backup_restore_test" in call
    )
    assert createdb_index < identity_index < prepare_index < restore_index
    for call in (calls[identity_index], calls[prepare_index]):
        assert "--dbname=travel_friend_backup_restore_test" in call
        assert "--dbname=travel_friend_test" not in call
    assert any("dropdb" in call for call in calls)
    assert any("exec -i" in call for call in calls)
    assert all("production.invalid" not in call and "remote.invalid" not in call for call in calls)


def test_source_and_restore_database_names_are_distinct_fixed_local_targets() -> None:
    script = SCRIPT.read_text(encoding="utf-8")

    assert 'SOURCE_DATABASE="travel_friend_test"' in script
    assert 'RESTORE_DATABASE="travel_friend_backup_restore_test"' in script
    assert 'CONTAINER_NAME="travel-friend-test-postgres"' in script
    assert 'SOURCE_DATABASE" = "$RESTORE_DATABASE' in script


def test_existing_restore_database_is_not_overwritten(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, calls = run_smoke(tmp_path, monkeypatch, target_exists="t")

    assert result.returncode != 0
    assert "already exists" in result.stderr
    assert not any("exec -i" in call for call in calls)
    assert not any("createdb" in call or "dropdb" in call or "pg_dump" in call for call in calls)


def test_restore_schema_preparation_fails_closed_on_database_identity_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, calls = run_smoke(
        tmp_path,
        monkeypatch,
        restore_database_name="unexpected_database",
    )

    assert result.returncode != 0
    assert "connected database is not the owned restore target" in result.stderr.lower()
    assert not any("DROP SCHEMA public CASCADE" in call for call in calls)
    assert not any("pg_restore" in call and "--dbname=travel_friend_backup_restore_test" in call for call in calls)
    assert any("dropdb" in call for call in calls)


@pytest.mark.parametrize(
    ("override", "expected"),
    [({"data_match": "f"}, "control data"), ({"schema_match": "different"}, "schema")],
)
def test_restore_mismatch_fails_and_removes_only_created_target(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    override: dict[str, str],
    expected: str,
) -> None:
    result, calls = run_smoke(tmp_path, monkeypatch, **override)

    assert result.returncode != 0
    assert expected in result.stderr.lower()
    assert any("dropdb" in call for call in calls)


def test_schema_mismatch_emits_bounded_unified_diff_without_database_urls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match="large")

    assert result.returncode == 1
    assert "--- source-public-schema" in result.stderr
    assert "+++ restored-public-schema" in result.stderr
    assert "-CREATE TABLE source_" in result.stderr
    assert len(result.stderr.splitlines()) <= 84
    assert all(len(line) <= 240 for line in result.stderr.splitlines() if line.startswith(("+", "-")))
    assert "postgresql://" not in result.stderr
    assert "production.invalid" not in result.stderr


def test_schema_mismatch_diff_shows_source_and_restore_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match="different")

    assert result.returncode == 1
    assert "-source-schema" in result.stderr
    assert "+restore-schema" in result.stderr


def test_schema_diff_redacts_database_urls_and_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match="sensitive")

    assert result.returncode == 1
    assert "postgresql://dbuser:dbpassword@db.example.test/app" not in result.stderr
    assert "dbsecret" not in result.stderr


def test_different_postgresql_17_restrict_keys_do_not_cause_schema_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match="restrict")

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("schema_match", "expected_diff"),
    [
        ("create_table", "CREATE TABLE source_table"),
        ("create_function", "CREATE FUNCTION source_function"),
    ],
)
def test_real_schema_ddl_differences_still_fail_comparison(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    schema_match: str,
    expected_diff: str,
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match=schema_match)

    assert result.returncode == 1
    assert expected_diff in result.stderr


def test_similar_non_service_lines_are_not_normalized_away(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, schema_match="similar")

    assert result.returncode == 1
    assert r"\restricted source" in result.stderr
    assert r"\unrestrictable source" in result.stderr
    assert r"  \restrict source-indented" in result.stderr
    assert r"prefix \restrict source-inline" in result.stderr


@pytest.mark.parametrize("fail_command", ["pg_dump", "pg_restore_list", "pg_restore", "createdb"])
def test_postgresql_command_failure_propagates_nonzero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fail_command: str
) -> None:
    result, _ = run_smoke(tmp_path, monkeypatch, fail_command=fail_command)

    assert result.returncode != 0


def test_uncertain_createdb_failure_stops_without_dropping_or_restoring_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, calls = run_smoke(tmp_path, monkeypatch, fail_command="createdb")

    assert result.returncode != 0
    assert (tmp_path / "createdb-may-have-succeeded").exists()
    assert "manually verify whether" in result.stderr.lower()
    assert "exists before retrying" in result.stderr.lower()
    assert not any("dropdb" in call for call in calls)
    assert not any("pg_restore" in call and "--dbname=travel_friend_backup_restore_test" in call for call in calls)


def test_container_guard_failure_stops_before_database_commands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result, calls = run_smoke(tmp_path, monkeypatch, container_label="false")

    assert result.returncode != 0
    assert not any("exec" in call for call in calls)


@pytest.mark.parametrize(
    "variable",
    ["DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_DB_URL", "PRODUCTION_RUNTIME_DATABASE_URL"],
)
def test_caller_database_url_fails_closed_before_docker_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, variable: str
) -> None:
    result, calls = run_smoke(
        tmp_path,
        monkeypatch,
        caller_database_url="postgresql://production.invalid/production",
        caller_database_variable=variable,
    )

    assert result.returncode != 0
    assert "caller-supplied database URLs must be unset" in result.stderr
    assert calls == []

