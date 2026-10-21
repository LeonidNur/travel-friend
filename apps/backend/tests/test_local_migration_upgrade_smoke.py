from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "local-migration-upgrade-smoke.py"
SPEC = importlib.util.spec_from_file_location("local_migration_upgrade_smoke", SCRIPT_PATH)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def _archive_fixture(tmp_path: Path) -> tuple[Path, Path, dict[str, object]]:
    archive = tmp_path / "public.dump"
    archive.write_bytes(b"synthetic custom archive")
    migration_paths = sorted(smoke.MIGRATIONS_DIR.glob("*.sql"))
    ledger_versions = [
        {
            "version": path.name.split("_", 1)[0],
            "name": path.stem.split("_", 1)[1],
        }
        for path in migration_paths[:19]
    ]
    manifest: dict[str, object] = {
        "archive": {
            "filename": archive.name,
            "format": "custom",
            "scope": "schema=public",
            "size_bytes": archive.stat().st_size,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        },
        "target": {"server_version": "17.6"},
        "client_tools": {"pg_dump": {"version": "pg_dump (PostgreSQL) 17.11"}},
        "observations": {
            "metadata": {"extension_restore_dependencies": []},
            "migration_ledger": {"count": 19, "versions": ledger_versions},
        },
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return archive, manifest_path, manifest


def _verifier_csv_fixture(*, failing_api_pair: bool = False) -> str:
    """Build the ordered multi-result CSV emitted by the current SQL verifier."""
    import csv
    import io

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    def section(header: tuple[str, ...], rows: list[tuple[str, ...]]) -> None:
        writer.writerow(header)
        writer.writerows(rows)

    section(("is_public_usage_granted", "is_public_create_absent"), [("t", "t")])
    section(
        ("table_name", "privilege_type", "table_exists", "expected", "actual_effective", "is_exact"),
        [(table, "SELECT", "t", "t", "t", "t") for table in sorted(smoke.RESTORE_SMOKE.EXPECTED_PUBLIC_TABLES) for _ in range(7)],
    )
    section(
        ("table_name", "column_name", "privilege_type", "column_exists", "actual_granted", "is_exact"),
        [("profiles", "id", "SELECT", "t", "t", "t")],
    )
    section(("sequence_name", "privilege_type", "unexpected_effective_privilege", "is_absent"), [])
    section(
        ("function_signature", "execute_granted", "is_expected"),
        [(f"public.fixture_{index}()", "t", "t") for index in range(19)],
    )
    api_rows = []
    for function_index, function in enumerate(smoke.RESTORE_SMOKE.NEW_BACKEND_FUNCTIONS):
        for role in smoke.RESTORE_SMOKE.SUPABASE_API_ROLE_STUBS:
            failed = failing_api_pair and function_index == 0 and role == "anon"
            api_rows.append((
                function, role, "t", "t", "t", "f", "t" if failed else "f", "f" if failed else "t",
            ))
    section(
        ("function_signature", "role_name", "function_exists", "is_present", "app_runtime_execute", "public_execute", "unexpected_execute", "is_exact"),
        api_rows,
    )
    section(("unexpected_function_signature", "unexpected_execute"), [])
    section(
        ("table_name", "owner_role", "is_not_owned_by_app_runtime"),
        [(table, "postgres", "t") for table in sorted(smoke.RESTORE_SMOKE.EXPECTED_PUBLIC_TABLES)],
    )
    section(
        ("table_name", "rls_enabled", "is_not_owned_by_app_runtime", "actual_policy_count", "expected_policy_count", "is_rls_enabled", "is_not_owned", "is_expected_policy_count"),
        [(table, "t", "t", "1", "1", "t", "t", "t") for table in sorted(smoke.RESTORE_SMOKE.EXPECTED_PUBLIC_TABLES)],
    )
    section(
        ("is_nobypassrls", "is_nosuperuser", "is_nocreaterole", "is_nocreatedb", "is_noreplication"),
        [("t", "t", "t", "t", "t")],
    )
    return output.getvalue()


def test_manifest_migrations_match_repository_baseline_and_pending_suffix(tmp_path: Path) -> None:
    _, _, manifest = _archive_fixture(tmp_path)

    applied, pending = smoke.validate_repository_migration_sequence(manifest)

    assert len(applied) == 19
    assert len(pending) == 5
    assert [path.name for path in pending] == [
        "20260924090000_completed_onboarding_active_travel_intent_invariant.sql",
        "20260924100000_session_lifecycle_baseline.sql",
        "20260924110000_backend_field_domain_limits.sql",
        "20261003090000_chat_participant_public_profile.sql",
        "20261018090000_server_side_tester_admission_session_identity.sql",
    ]


def test_manifest_migration_name_mismatch_fails_closed(tmp_path: Path) -> None:
    _, _, manifest = _archive_fixture(tmp_path)
    ledger = manifest["observations"]["migration_ledger"]["versions"]  # type: ignore[index]
    ledger[0]["name"] = "wrong_name"

    with pytest.raises(smoke.UpgradeSmokeError, match="manifest migration ledger"):
        smoke.validate_repository_migration_sequence(manifest)


def test_manifest_missing_repository_migration_fails_closed(tmp_path: Path) -> None:
    _, _, manifest = _archive_fixture(tmp_path)
    ledger = manifest["observations"]["migration_ledger"]["versions"]  # type: ignore[index]
    ledger.pop()
    manifest["observations"]["migration_ledger"]["count"] = 18  # type: ignore[index]

    with pytest.raises(smoke.UpgradeSmokeError, match="19 manifest migrations"):
        smoke.validate_repository_migration_sequence(manifest)


def test_local_database_url_pins_loopback_and_ddl_timeouts() -> None:
    uri = smoke.local_database_url("postgres", "local-only-secret", 55487, "tf_upgrade_ab12")

    assert uri.startswith("postgresql://postgres@127.0.0.1:55487/tf_upgrade_ab12?")
    assert "local-only-secret" not in uri
    assert "lock_timeout%3D5s" in uri
    assert "statement_timeout%3D120s" in uri


def test_cli_commands_are_pinned_and_explicitly_local() -> None:
    database_url = smoke.local_database_url("postgres", "local-test-password", 55487, "tf_restore_ab12cd34ef56")
    command = smoke.db_push_command(database_url, dry_run=True)

    assert command[:3] == ["npx", "--yes", "supabase@2.114.0"]
    assert command[3:6] == ["db", "push", "--dry-run"]
    assert command[-2:] == ["--db-url", database_url]
    assert "--linked" not in command
    assert "local-test-password" not in " ".join(command)
    apply_command = smoke.db_push_command(database_url, dry_run=False)
    assert apply_command[3:6] == ["--yes", "db", "push"]


def test_local_db_push_is_noninteractive_and_runs_only_after_verified_local_dry_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migrations = list(smoke.EXPECTED_PENDING_NAMES)
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-only-password", 55487, f"tf_restore_{run_id}")
    container_name = f"tf-upgrade-20261021090000-{run_id}"
    calls: list[list[str]] = []
    checks: list[str] = []
    dry_run_output = "\n".join(f"Would push migration {name}..." for name in migrations).encode()

    monkeypatch.setattr(
        smoke, "verify_container",
        lambda name, current_run_id, port: checks.append("container")
        if (name, current_run_id, port) == (container_name, run_id, 55487)
        else pytest.fail("unexpected container identity"),
    )
    monkeypatch.setattr(
        smoke, "verify_migration_connection",
        lambda url, database, password: checks.append("target")
        if (url, database, password) == (database_url, f"tf_restore_{run_id}", "local-only-password")
        else pytest.fail("unexpected database target"),
    )
    def run(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        calls.append(command)
        if "--dry-run" in command:
            return 0, dry_run_output, b""
        return 0, b"", b""

    monkeypatch.setattr(smoke, "_run", run)

    smoke.run_local_db_push(
        database_url, "local-only-password", migrations,
        container_name=container_name, run_id=run_id, port=55487,
    )

    assert checks == ["container", "target", "container", "target"]
    assert len(calls) == 2
    assert "--dry-run" in calls[0]
    assert calls[1][3:6] == ["--yes", "db", "push"]
    assert calls[1][-2:] == ["--db-url", database_url]


def test_db_push_is_not_started_when_exact_local_dry_run_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    migrations = list(smoke.EXPECTED_PENDING_NAMES)
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-only-password", 55487, f"tf_restore_{run_id}")
    commands: list[list[str]] = []
    monkeypatch.setattr(smoke, "verify_container", lambda *args: None)
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: None)

    def run(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        commands.append(command)
        return 0, b"Would push migration 20261018090001_unexpected.sql...", b""

    monkeypatch.setattr(smoke, "_run", run)

    with pytest.raises(smoke.UpgradeSmokeError, match="MIGRATION_MISMATCH"):
        smoke.run_local_db_push(
            database_url, "local-only-password", migrations,
            container_name=f"tf-upgrade-20261021090000-{run_id}", run_id=run_id, port=55487,
        )

    assert len(commands) == 1
    assert "--dry-run" in commands[0]


@pytest.mark.parametrize(
    ("database_url", "container_name", "run_id"),
    [
        (
            "postgresql://postgres@production.example:5432/postgres",
            "tf-upgrade-20261021090000-ab12cd34ef56",
            "ab12cd34ef56",
        ),
        (
            "postgresql://postgres@127.0.0.1:55487/tf_restore_ffffffffffff",
            "tf-upgrade-20261021090000-ab12cd34ef56",
            "ab12cd34ef56",
        ),
    ],
)
def test_db_push_stops_before_cli_for_nonlocal_or_foreign_run_target(
    monkeypatch: pytest.MonkeyPatch, database_url: str, container_name: str, run_id: str,
) -> None:
    monkeypatch.setattr(smoke, "verify_container", lambda *args: pytest.fail("unexpected container check"))
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: pytest.fail("unexpected DB check"))
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: pytest.fail("CLI must not run"))

    with pytest.raises(smoke.UpgradeSmokeError):
        smoke.run_local_db_push(
            database_url, "local-only-password", list(smoke.EXPECTED_PENDING_NAMES),
            container_name=container_name, run_id=run_id, port=55487,
        )


def test_db_push_stops_before_cli_when_expected_migration_set_is_not_exact(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(smoke, "verify_container", lambda *args: pytest.fail("unexpected container check"))
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: pytest.fail("unexpected DB check"))
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: pytest.fail("CLI must not run"))
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-only-password", 55487, f"tf_restore_{run_id}")

    with pytest.raises(smoke.UpgradeSmokeError, match="exact five approved"):
        smoke.run_local_db_push(
            database_url, "local-only-password", list(smoke.EXPECTED_PENDING_NAMES[:-1]),
            container_name=f"tf-upgrade-20261021090000-{run_id}", run_id=run_id, port=55487,
        )


def test_cli_migration_commands_reject_non_disposable_targets() -> None:
    with pytest.raises(smoke.UpgradeSmokeError, match="disposable loopback"):
        smoke.db_push_command("postgresql://user@production.example/postgres", dry_run=True)
    with pytest.raises(smoke.UpgradeSmokeError, match="disposable loopback"):
        smoke.migration_repair_command("postgresql://user@127.0.0.1:5432/postgres", [])


def test_ledger_seed_uses_only_manifest_versions(tmp_path: Path) -> None:
    _, _, manifest = _archive_fixture(tmp_path)
    applied, _ = smoke.validate_repository_migration_sequence(manifest)

    database_url = smoke.local_database_url("postgres", "local-test-password", 55487, "tf_restore_ab12cd34ef56")
    command = smoke.migration_repair_command(database_url, applied)

    assert command[:5] == ["npx", "--yes", "supabase@2.114.0", "migration", "repair"]
    assert command[5:24] == [item["version"] for item in applied]
    assert command[-4:] == ["--status", "applied", "--db-url", database_url]
    assert len([part for part in command if part.isdigit() and len(part) == 14]) == 19


def test_dry_run_requires_the_exact_repository_order() -> None:
    migrations = [
        "20260924090000_completed_onboarding_active_travel_intent_invariant.sql",
        "20260924100000_session_lifecycle_baseline.sql",
        "20260924110000_backend_field_domain_limits.sql",
        "20261003090000_chat_participant_public_profile.sql",
        "20261018090000_server_side_tester_admission_session_identity.sql",
    ]

    output = lambda names: "\n".join(f"Would push migration {name}..." for name in names).encode()
    smoke.validate_dry_run_result(0, output(migrations), migrations, [])

    with pytest.raises(smoke.UpgradeSmokeError, match="MIGRATION_MISMATCH"):
        smoke.validate_dry_run_result(0, output(migrations[:-1]), migrations, [])

    with pytest.raises(smoke.UpgradeSmokeError, match="ORDER_MISMATCH"):
        smoke.validate_dry_run_result(0, output(reversed(migrations)), migrations, [])


def test_dry_run_parses_supabase_cli_214_filename_lines_and_reports_exact_mismatch() -> None:
    migrations = [
        "20260924090000_completed_onboarding_active_travel_intent_invariant.sql",
        "20260924100000_session_lifecycle_baseline.sql",
        "20260924110000_backend_field_domain_limits.sql",
        "20261003090000_chat_participant_public_profile.sql",
        "20261018090000_server_side_tester_admission_session_identity.sql",
    ]
    cli_output = """DRY RUN: migrations will *not* be pushed to the database.
Would push migration 20260924090000_completed_onboarding_active_travel_intent_invariant.sql...
Would push migration 20260924100000_session_lifecycle_baseline.sql...
Would push migration 20260924110000_backend_field_domain_limits.sql...
Would push migration 20261003090000_chat_participant_public_profile.sql...
Would push migration 20261018090000_server_side_tester_admission_session_identity.sql...
Finished supabase db push.
"""
    smoke.validate_dry_run_result(0, cli_output.encode(), migrations, [])

    unexpected_output = cli_output.replace(migrations[-1], "20261018090001_unexpected_migration.sql")
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.validate_dry_run_result(0, unexpected_output.encode(), migrations, [])
    assert "expected versions [" in str(error.value)
    assert "actual versions [" in str(error.value)
    assert "20261018090001_unexpected_migration.sql" in str(error.value)


def test_dry_run_classifies_successful_stderr_output(monkeypatch: pytest.MonkeyPatch) -> None:
    migrations = ["20260924090000_example.sql"]
    cli_output = b"Would push migration 20260924090000_example.sql...\n"
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: (0, b"", cli_output))
    url = smoke.local_database_url("postgres", "synthetic-local-only", 55487, "tf_restore_ab12cd34ef56")

    smoke.run_local_dry_run(url, "synthetic-local-only", migrations)


@pytest.mark.parametrize(
    ("exit_code", "output", "category"),
    [
        (2, b"connection failed\n", "CLI_ERROR exit_code=2"),
        (0, b"Remote database is up to date.\n", "EMPTY_PENDING"),
        (0, b"DRY RUN: migrations will *not* be pushed to the database.\nFinished supabase db push.\n", "EMPTY_PENDING"),
        (0, b"Unexpected dry-run response\n", "UNKNOWN_FORMAT"),
        (0, b"Would push migration 20261018090001_other.sql...\n", "MIGRATION_MISMATCH"),
        (0, b"Pending versions: 20261018090001\n", "UNKNOWN_FORMAT"),
    ],
)
def test_dry_run_diagnostics_classify_cli_empty_unknown_and_mismatch(
    exit_code: int, output: bytes, category: str,
) -> None:
    expected = ["20261018090000_server_side_tester_admission_session_identity.sql"]
    with pytest.raises(smoke.UpgradeSmokeError, match=category):
        smoke.validate_dry_run_result(exit_code, output, expected, [])


def test_dry_run_diagnostic_redacts_uri_password_token_and_reports_versions() -> None:
    uri = "postgresql://postgres:db-password@127.0.0.1:55487/tf_restore_ab12cd34ef56"
    output = (
        f"error connecting to {uri}\npassword=super-secret\nSUPABASE_ACCESS_TOKEN=token-value\n"
        "Would push migration 20261018090001_other.sql...\n"
    ).encode()
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.validate_dry_run_result(
            0, output, ["20261018090000_server_side_tester_admission_session_identity.sql"],
            [uri, "db-password", "super-secret", "token-value"],
        )
    message = str(error.value)
    assert "exit_code=0" in message
    assert "expected versions [20261018090000]" in message
    assert "actual versions [20261018090001]" in message
    assert "CLI:" in message
    assert uri not in message and "db-password" not in message
    assert "super-secret" not in message and "token-value" not in message


def test_dry_run_cli_error_reports_status_and_redacts_connection_material() -> None:
    uri = "postgresql://postgres:local-secret@127.0.0.1:55487/tf_restore_ab12cd34ef56"
    output = f"CLI failed for {uri}\nSUPABASE_ACCESS_TOKEN=token-secret\n".encode()
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.validate_dry_run_result(
            17, output, ["20261018090000_server_side_tester_admission_session_identity.sql"],
            [uri, "local-secret", "token-secret"],
        )
    message = str(error.value)
    assert "CLI_ERROR exit_code=17" in message
    assert "expected versions [20261018090000]" in message
    assert uri not in message and "local-secret" not in message and "token-secret" not in message


def test_db_push_failure_reports_safe_diagnostics_without_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-db-secret", 55487, f"tf_restore_{run_id}")
    migrations = list(smoke.EXPECTED_PENDING_NAMES)
    cli_output = (
        f"Pushing migration {migrations[0]}...\n"
        f"Pushing migration {migrations[1]}...\n"
        "ERROR: column does not exist (SQLSTATE 42703)\n"
        f"connection={database_url} password=secret-from-cli SUPABASE_ACCESS_TOKEN=token-from-cli\n"
    ).encode()
    calls: list[tuple[list[str], int | None]] = []
    monkeypatch.setattr(smoke, "verify_container", lambda *args: None)
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: None)

    def run(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        calls.append((command, kwargs.get("timeout")))  # type: ignore[arg-type]
        if "--dry-run" in command:
            output = "\n".join(f"Would push migration {name}..." for name in migrations).encode()
            return 0, output, b""
        return 1, b"", cli_output

    monkeypatch.setattr(smoke, "_run", run)
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.run_local_db_push(
            database_url, "local-db-secret", migrations,
            container_name=f"tf-upgrade-20261021090000-{run_id}", run_id=run_id, port=55487,
        )

    message = str(error.value)
    assert len(calls) == 2
    assert calls[0][1] == 600 and "--dry-run" in calls[0][0]
    assert calls[1][1] == smoke.CLI_DB_PUSH_TIMEOUT_SECONDS
    assert "CLI_ERROR exit_code=1" in message
    assert "SQLSTATE=42703" in message
    assert f"migration={migrations[1]}" in message
    assert "local-db-secret" not in message and "secret-from-cli" not in message
    assert "token-from-cli" not in message and database_url not in message
    assert "ERROR: column does not exist" in message


def test_db_push_start_failure_is_redacted_and_has_unavailable_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-db-secret", 55487, f"tf_restore_{run_id}")
    migrations = list(smoke.EXPECTED_PENDING_NAMES)
    monkeypatch.setattr(smoke, "verify_container", lambda *args: None)
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: None)
    calls = 0

    def fail(*args: object, **kwargs: object) -> tuple[int, bytes, bytes]:
        nonlocal calls
        calls += 1
        if "--dry-run" in args[0]:
            output = "\n".join(f"Would push migration {name}..." for name in migrations).encode()
            return 0, output, b""
        raise smoke.UpgradeSmokeError("DB_PUSH", "suppressed launch error")

    monkeypatch.setattr(smoke, "_run", fail)
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.run_local_db_push(
            database_url, "local-db-secret", migrations,
            container_name=f"tf-upgrade-20261021090000-{run_id}", run_id=run_id, port=55487,
        )
    assert "exit_code=<unavailable>" in str(error.value)
    assert "suppressed launch error" not in str(error.value)
    assert "local-db-secret" not in str(error.value)
    assert calls == 2


def test_db_push_timeout_reports_process_group_cleanup_and_does_not_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = "ab12cd34ef56"
    database_url = smoke.local_database_url("postgres", "local-db-secret", 55487, f"tf_restore_{run_id}")
    migrations = list(smoke.EXPECTED_PENDING_NAMES)
    calls: list[int | None] = []
    monkeypatch.setattr(smoke, "verify_container", lambda *args: None)
    monkeypatch.setattr(smoke, "verify_migration_connection", lambda *args: None)

    def timeout(*args: object, **kwargs: object) -> tuple[int, bytes, bytes]:
        calls.append(kwargs.get("timeout"))  # type: ignore[arg-type]
        if "--dry-run" in args[0]:
            output = "\n".join(f"Would push migration {name}..." for name in migrations).encode()
            return 0, output, b""
        raise smoke.ProcessTimeoutError(
            "DB_PUSH", smoke.CLI_DB_PUSH_TIMEOUT_SECONDS, True,
            f"Pushing migration {migrations[-1]}...\n".encode(),
            b"ERROR (SQLSTATE 57014)\n",
        )

    monkeypatch.setattr(smoke, "_run", timeout)
    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke.run_local_db_push(
            database_url, "local-db-secret", migrations,
            container_name=f"tf-upgrade-20261021090000-{run_id}", run_id=run_id, port=55487,
        )
    assert calls == [600, smoke.CLI_DB_PUSH_TIMEOUT_SECONDS]
    assert "CLI_TIMEOUT" in str(error.value)
    assert f"timeout={smoke.CLI_DB_PUSH_TIMEOUT_SECONDS}s" in str(error.value)
    assert "SQLSTATE=57014" in str(error.value)
    assert "migration=20261018090000_server_side_tester_admission_session_identity.sql" in str(error.value)
    assert "process_group_cleanup=PASS" in str(error.value)
    assert "local-db-secret" not in str(error.value)


@pytest.mark.parametrize("kill_after_term", [False, True])
def test_run_timeout_terminates_only_its_new_process_group(
    monkeypatch: pytest.MonkeyPatch, kill_after_term: bool,
) -> None:
    signals: list[int] = []
    group_states = iter([False] if not kill_after_term else [True, False])

    class FakeProcess:
        pid = 45678
        returncode = -15
        calls = 0

        def communicate(self, input: bytes | None = None, timeout: int | None = None) -> tuple[bytes, bytes]:
            self.calls += 1
            if self.calls == 1 or (kill_after_term and self.calls == 2):
                raise subprocess.TimeoutExpired("synthetic-child", timeout or 1, output=b"partial out", stderr=b"partial err")
            return b"final out", b"final err"

    process = FakeProcess()
    popen_kwargs: dict[str, object] = {}

    def popen(command: list[str], **kwargs: object) -> FakeProcess:
        popen_kwargs.update(kwargs)
        return process

    monkeypatch.setattr(smoke.subprocess, "Popen", popen)
    monkeypatch.setattr(smoke.os, "killpg", lambda process_id, sig: signals.append(sig))
    monkeypatch.setattr(smoke, "_process_group_exists", lambda _: next(group_states))

    with pytest.raises(smoke.ProcessTimeoutError) as error:
        smoke._run(["npx", "supabase"], stage="DB_PUSH", reason="safe launch failure", timeout=1)

    assert popen_kwargs["start_new_session"] is True
    assert signals == ([smoke.signal.SIGTERM] if not kill_after_term else [smoke.signal.SIGTERM, smoke.signal.SIGKILL])
    assert error.value.process_group_cleanup is True
    assert error.value.stdout == b"final out"
    assert error.value.stderr == b"final err"


def test_stop_summary_includes_cleanup_status() -> None:
    failure = smoke.UpgradeSmokeError("DB_PUSH", "CLI_ERROR exit_code=1")

    assert "cleanup=PASS" in smoke.format_stop(failure, "PASS")
    assert "cleanup=FAILED (container identity check failed)" in smoke.format_stop(
        failure, "FAILED", "container identity check failed",
    )


def test_verifier_csv_failure_names_check_and_expected_actual_privileges() -> None:
    output = (
        "table_name,privilege_type,table_exists,expected,actual_effective,is_exact\n"
        "profiles,SELECT,t,t,f,f\n"
    )

    detail = smoke._privilege_verifier_failure_details(output)

    assert "check=table_privilege" in detail
    assert "table=profiles" in detail
    assert "privilege=SELECT" in detail
    assert "expected=true" in detail
    assert "actual=false" in detail


def test_current_sql_verifier_api_header_is_adapted_without_hiding_privilege_values() -> None:
    signature = "public.resolve_bearer_session_with_identity(text)"
    output = (
        "function_signature,execute_granted,is_expected\n"
        "public.resolve_bearer_session_with_identity(text),t,t\n"
        "function_signature,role_name,function_exists,is_present,app_runtime_execute,public_execute,unexpected_execute,is_exact\n"
        f"{signature},anon,t,t,t,f,t,f\n"
    )

    with pytest.raises(smoke.RESTORE_SMOKE.RestoreSmokeError, match="could not be validated safely"):
        smoke.RESTORE_SMOKE.validate_grants_verifier_csv(output)

    canonical = smoke._canonicalize_privilege_verifier_csv(output)
    detail = smoke._privilege_verifier_failure_details(output)

    assert "role_name,is_present,unexpected_execute,is_exact" in canonical
    assert f"anon,t,t,f" in canonical
    assert signature in detail
    assert "expected_api_execute=false actual_api_execute=t" in detail
    assert "expected_public_execute=false actual_public_execute=f" in detail


def test_current_sql_verifier_contract_uses_exact_eight_column_api_result() -> None:
    sql = (smoke.BACKEND_ROOT / "scripts" / "verify-production-app-runtime-privileges.sql").read_text()
    actual_api_header = (
        "function_signature", "role_name", "function_exists", "is_present",
        "app_runtime_execute", "public_execute", "unexpected_execute", "is_exact",
    )
    output = _verifier_csv_fixture()
    parsed, seen = smoke._parse_privilege_verifier_sections(output)

    assert "\\set ON_ERROR_STOP on" in sql
    assert "RAISE EXCEPTION 'SQL privilege verification failed" in sql
    assert "USING ERRCODE = '42501'" in sql
    assert actual_api_header in tuple(tuple(row.split(",")) for row in output.splitlines())
    assert len(parsed["api_roles"]) == 9
    assert seen == set(smoke.RESTORE_SMOKE.VERIFIER_SECTIONS.values())
    assert smoke._psql.__kwdefaults__["diagnostics"] is False


def test_local_adapter_accepts_machine_contract_and_names_exact_api_privilege_failure() -> None:
    smoke._validate_local_runtime_grants_csv(_verifier_csv_fixture())

    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke._validate_local_runtime_grants_csv(_verifier_csv_fixture(failing_api_pair=True))

    assert error.value.stage == "PRIVILEGE_VERIFIER"
    assert "check=api_role_backend_only_execute" in error.value.reason
    assert "role=anon" in error.value.reason
    assert "expected_api_execute=false actual_api_execute=t" in error.value.reason


def test_current_sql_verifier_csv_adapter_preserves_failing_api_execute_value() -> None:
    signature = "public.resolve_bearer_session_with_identity(text)"
    output = (
        "function_signature,role_name,function_exists,is_present,app_runtime_execute,public_execute,unexpected_execute,is_exact\n"
        f"{signature},anon,t,t,t,f,t,f\n"
    )

    canonical = smoke._canonicalize_privilege_verifier_csv(output)
    rows = canonical.splitlines()
    api_row = next(line for line in rows if line.startswith("anon,"))
    assert api_row == "anon,t,t,f"


def test_api_role_denial_failure_identifies_role_function_and_actual_execute() -> None:
    signature = "public.resolve_bearer_session_with_identity(text)"
    output = f"anon\t{signature}\tt\tt\tt\n"

    detail = smoke._api_role_function_denial_failure_details(output)

    assert "check=api_role_execute_denial" in detail
    assert "role=anon" in detail
    assert signature in detail
    assert "expected_execute=false" in detail
    assert "actual_execute=true" in detail


def test_psql_failure_diagnostic_reports_sqlstate_without_sql_or_secrets() -> None:
    output = (
        "ERROR: permission denied for function resolve_bearer_session_with_identity\n"
        "SQLSTATE: 42501\n"
        "STATEMENT: SELECT 'private-message' -- password=hidden-secret\n"
    ).encode()

    detail = smoke._format_psql_failure("PRIVILEGE_VERIFIER", 3, b"", output)

    assert "check=PRIVILEGE_VERIFIER" in detail
    assert "exit_code=3" in detail
    assert "SQLSTATE=42501" in detail
    assert "permission denied for function resolve_bearer_session_with_identity" in detail
    assert "private-message" not in detail and "hidden-secret" not in detail


def test_sql_verifier_exception_reports_effective_privilege_mismatch_safely() -> None:
    output = (
        "ERROR: P0001: runtime privilege verification failed: "
        "unexpected effective EXECUTE for anon on public.resolve_bearer_session_with_identity(text)\n"
        "STATEMENT: DO $verify_privileges$ ... password=not-for-output\n"
    ).encode()

    detail = smoke._format_psql_failure("PRIVILEGE_VERIFIER", 3, b"", output)

    assert "SQLSTATE=P0001" in detail
    assert "expected_execute=false actual_execute=true role=anon" in detail
    assert "public.resolve_bearer_session_with_identity(text)" in detail
    assert "not-for-output" not in detail and "DO $verify_privileges$" not in detail


def test_psql_diagnostic_mode_keeps_exit_and_sqlstate_but_suppresses_statement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands: list[list[str]] = []

    def fail(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        commands.append(command)
        return (
            3, b"", b"ERROR: 42501: permission denied for function protected_fn\nSTATEMENT: SELECT 'private'\n",
        )

    monkeypatch.setattr(
        smoke, "_run", fail,
    )

    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke._psql(
            "container", "local-secret", "tf_restore_ab12cd34ef56", "SELECT 1",
            stage="PRIVILEGE_VERIFIER", reason="safe fallback", diagnostics=True,
        )

    assert error.value.stage == "PRIVILEGE_VERIFIER"
    assert "exit_code=3" in error.value.reason and "SQLSTATE=42501" in error.value.reason
    assert "protected_fn" in error.value.reason
    assert "private" not in error.value.reason and "local-secret" not in error.value.reason
    assert "VERBOSITY=verbose" in commands[0]


def test_apply_runtime_grants_preserves_named_verifier_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    verifier_output = (
        "table_name,privilege_type,table_exists,expected,actual_effective,is_exact\n"
        "profiles,SELECT,t,t,f,f\n"
    )

    def psql(*args: object, **kwargs: object) -> str:
        return verifier_output if kwargs.get("csv") else ""

    monkeypatch.setattr(smoke, "_psql", psql)
    monkeypatch.setattr(
        smoke.RESTORE_SMOKE,
        "validate_grants_verifier_csv",
        lambda _: (_ for _ in ()).throw(smoke.RESTORE_SMOKE.RestoreSmokeError("GRANTS", "generic failure")),
    )

    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke._apply_runtime_grants_and_checks("container", "pg-secret", "tf_restore_ab12cd34ef56", "runtime-secret", 55487)

    assert error.value.stage == "PRIVILEGE_VERIFIER"
    assert "table=profiles" in error.value.reason
    assert "expected=true" in error.value.reason and "actual=false" in error.value.reason


def test_apply_runtime_grants_expands_api_role_failure_to_exact_role_and_function(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signature = smoke.RESTORE_SMOKE.NEW_BACKEND_FUNCTIONS[0]
    calls: list[tuple[str, bool]] = []

    def psql(*args: object, **kwargs: object) -> str:
        sql = str(args[3])
        calls.append((sql, bool(kwargs.get("csv"))))
        if kwargs.get("csv"):
            return "synthetic verifier result"
        if sql == smoke.RESTORE_SMOKE._api_role_function_denials_sql():
            return "f"
        if sql == smoke._api_role_function_denial_diagnostics_sql():
            return f"anon\t{signature}\tt\tt\tt"
        return ""

    monkeypatch.setattr(smoke, "_psql", psql)
    monkeypatch.setattr(smoke.RESTORE_SMOKE, "validate_grants_verifier_csv", lambda _: None)

    with pytest.raises(smoke.UpgradeSmokeError) as error:
        smoke._apply_runtime_grants_and_checks("container", "pg-secret", "tf_restore_ab12cd34ef56", "runtime-secret", 55487)

    assert "role=anon" in error.value.reason
    assert signature in error.value.reason
    assert "expected_execute=false" in error.value.reason
    assert "actual_execute=true" in error.value.reason
    assert any(sql == smoke._api_role_function_denial_diagnostics_sql() for sql, _ in calls)


def test_docker_command_binds_only_loopback_and_uses_unique_label_without_password_argv() -> None:
    command = smoke.docker_create_command("tf-upgrade-20261019-ab12", "ab12cd34", 55487)

    assert "--publish" in command
    assert "127.0.0.1:55487:5432" in command
    assert "--network=none" not in command
    assert "--label" in command
    assert "--rm" in command
    assert "local-only" not in " ".join(command)


def test_container_identity_rejects_non_loopback_or_wrong_label() -> None:
    valid = {
        "Name": "/tf-upgrade-20261019-ab12",
        "Config": {
            "Image": "postgres:17-alpine",
            "Labels": {smoke.CONTAINER_LABEL_KEY: "ab12cd34"},
            "Env": ["POSTGRES_USER=postgres", "POSTGRES_DB=postgres", "POSTGRES_PASSWORD=redacted"],
        },
        "HostConfig": {
            "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55487"}]},
            "Binds": [],
            "NetworkMode": "bridge",
            "AutoRemove": True,
        },
    }
    smoke.validate_container_identity(valid, "tf-upgrade-20261019-ab12", "ab12cd34", 55487)

    public_bind = json.loads(json.dumps(valid))
    public_bind["HostConfig"]["PortBindings"]["5432/tcp"][0]["HostIp"] = "0.0.0.0"
    with pytest.raises(smoke.UpgradeSmokeError, match="loopback"):
        smoke.validate_container_identity(public_bind, "tf-upgrade-20261019-ab12", "ab12cd34", 55487)

    wrong_label = json.loads(json.dumps(valid))
    wrong_label["Config"]["Labels"][smoke.CONTAINER_LABEL_KEY] = "other"
    with pytest.raises(smoke.UpgradeSmokeError, match="identity"):
        smoke.validate_container_identity(wrong_label, "tf-upgrade-20261019-ab12", "ab12cd34", 55487)

    persistent_container = json.loads(json.dumps(valid))
    persistent_container["HostConfig"]["AutoRemove"] = False
    with pytest.raises(smoke.UpgradeSmokeError, match="identity"):
        smoke.validate_container_identity(persistent_container, "tf-upgrade-20261019-ab12", "ab12cd34", 55487)


def test_disposable_roles_receive_password_only_via_sql_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[list[str], bytes | None]] = []

    def psql(*args: object, **kwargs: object) -> str:
        if args[3] == "SELECT current_database()":
            return "tf_restore_ab12cd34ef56"
        if args[3] == "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')":
            return "f"
        if kwargs.get("input_data") is not None:
            calls.append(([], kwargs.get("input_data")))  # type: ignore[arg-type]
        return ""

    monkeypatch.setattr(smoke, "_psql", psql)
    smoke._create_database_and_roles("tf-upgrade-run", "postgres-secret", "tf_restore_ab12cd34ef56", "local'password")

    assert len(calls) == 1
    sql = calls[0][1]
    assert sql is not None
    assert b"'local''password'" in sql


def test_archive_table_of_contents_uses_stdin_without_dash_filename(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = tmp_path / "public.dump"
    archive.write_bytes(b"synthetic archive")
    calls: list[tuple[list[str], bytes | None]] = []

    def run(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        calls.append((command, kwargs.get("input_data")))  # type: ignore[arg-type]
        return 0, b"TOC entry\n", b""

    monkeypatch.setattr(smoke, "_run", run)
    smoke._validate_archive_toc("tf-upgrade-run", "synthetic-password", archive)

    command, archive_bytes = calls[0]
    assert command[-2:] == ["pg_restore", "--list"]
    assert "-" not in command
    assert archive_bytes == b"synthetic archive"


def test_cli_version_mismatch_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: (0, b"2.115.0\n", b""))

    with pytest.raises(smoke.UpgradeSmokeError, match="exact Supabase CLI 2.114.0"):
        smoke.verify_cli_version()


def test_cli_version_accepts_only_pinned_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: (0, b"2.114.0\n", b""))

    assert smoke.verify_cli_version() == "2.114.0"


def test_cli_call_strips_remote_credentials_and_keeps_password_out_of_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "must-not-propagate")
    monkeypatch.setenv("PRODUCTION_RUNTIME_DATABASE_URL", "must-not-propagate")
    captured: dict[str, object] = {}

    def run(command: list[str], **kwargs: object) -> tuple[int, bytes, bytes]:
        captured["command"] = command
        captured["env"] = kwargs["env"]
        return 0, b"ok", b""

    monkeypatch.setattr(smoke, "_run", run)
    database_url = smoke.local_database_url("postgres", "synthetic-local-only", 55487, "tf_restore_ab12cd34ef56")
    smoke._cli(
        smoke.db_push_command(database_url, dry_run=True),
        stage="DRY_RUN",
        password="synthetic-local-only",
    )

    command = captured["command"]
    child_env = captured["env"]
    assert "synthetic-local-only" not in " ".join(command)  # type: ignore[arg-type]
    assert child_env["PGPASSWORD"] == "synthetic-local-only"  # type: ignore[index]
    assert "SUPABASE_ACCESS_TOKEN" not in child_env  # type: ignore[operator]
    assert "PRODUCTION_RUNTIME_DATABASE_URL" not in child_env  # type: ignore[operator]


def test_docker_refuses_explicit_endpoint_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DOCKER_HOST", "tcp://remote.invalid:2376")
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: pytest.fail("must reject override before Docker call"))

    with pytest.raises(smoke.UpgradeSmokeError, match="endpoint overrides"):
        smoke.verify_docker_and_image()


def test_migration_connection_requires_local_identity_and_both_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    class Cursor:
        def fetchone(self) -> tuple[str, str, str, str, str]:
            return "tf_restore_ab12cd34ef56", "postgres", "postgres", "5s", "2min"

    class Connection:
        def __enter__(self) -> "Connection":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def execute(self, query: str) -> Cursor:
            assert "current_setting('lock_timeout')" in query
            assert "current_setting('statement_timeout')" in query
            return Cursor()

    monkeypatch.setattr(smoke.psycopg, "connect", lambda *args, **kwargs: Connection())
    smoke.verify_migration_connection("postgresql://local", "tf_restore_ab12cd34ef56", "synthetic-secret")

    class WrongConnection(Connection):
        def execute(self, query: str) -> Cursor:
            class WrongCursor:
                def fetchone(self) -> tuple[str, str, str, str, str]:
                    return "postgres", "postgres", "postgres", "0", "0"
            return WrongCursor()

    monkeypatch.setattr(smoke.psycopg, "connect", lambda *args, **kwargs: WrongConnection())
    with pytest.raises(smoke.UpgradeSmokeError, match="timeout settings"):
        smoke.verify_migration_connection("postgresql://local", "tf_restore_ab12cd34ef56", "synthetic-secret")


def test_rls_policy_inventory_must_remain_identical() -> None:
    before = {"tables": [{"name": "profiles", "rls": True}], "policies": [{"name": "own"}]}
    smoke.validate_rls_policy_inventory(before, json.loads(json.dumps(before)))

    with pytest.raises(smoke.UpgradeSmokeError, match="policy definitions changed"):
        smoke.validate_rls_policy_inventory(before, {"tables": before["tables"], "policies": []})


def test_cleanup_refuses_container_with_unexpected_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    verified: list[bool] = []
    monkeypatch.setattr(smoke, "container_exists", lambda _: True)

    def reject(*args: object, **kwargs: object) -> None:
        verified.append(True)
        raise smoke.UpgradeSmokeError("CLEANUP", "container identity mismatch")

    monkeypatch.setattr(smoke, "verify_container", reject)
    monkeypatch.setattr(smoke, "_run", lambda *args, **kwargs: pytest.fail("must not stop unverified container"))

    with pytest.raises(smoke.UpgradeSmokeError, match="identity mismatch"):
        smoke.cleanup_container("tf-upgrade-20261019-ab12", "ab12cd34", 55487)
    assert verified == [True]
