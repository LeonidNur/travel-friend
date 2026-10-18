from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "production-backup-runner.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location("production_backup_runner", SCRIPT_PATH)
assert SCRIPT_SPEC is not None and SCRIPT_SPEC.loader is not None
runner = importlib.util.module_from_spec(SCRIPT_SPEC)
sys.modules[SCRIPT_SPEC.name] = runner
SCRIPT_SPEC.loader.exec_module(runner)

SECRET = "mock-password-that-must-never-be-printed"
URI = f"postgresql://user:{SECRET}@sensitive.example.test/db"


def _valid_preflight_metadata(server_version: str = "17.6") -> dict[str, object]:
    return {
        "database": "postgres",
        "current_user": runner.EXPECTED_DATABASE_ROLE,
        "session_user": runner.EXPECTED_DATABASE_ROLE,
        "server_version": server_version,
        "bypass_rls": True,
        "tables": [
            {"name": name, "owner": runner.EXPECTED_DATABASE_ROLE, "rls": True, "select": True}
            for name in sorted(runner.EXPECTED_PUBLIC_TABLES)
        ],
        "acl_principals_by_scope": {
            scope: sorted(principals)
            for scope, principals in runner.EXPECTED_ACL_PRINCIPALS_BY_SCOPE.items()
        },
        "extension_inventory": [
            {"name": name, "version": version}
            for name, version in runner.EXPECTED_EXTENSION_INVENTORY.items()
        ],
        "extension_restore_dependencies": [],
        "large_object_count": 0,
        "catalog_non_public_dependencies": [],
        "auth_user_count": 0,
        "storage_object_count": 0,
        "vault_secret_count": 0,
    }


def _valid_preflight_result() -> dict[str, object]:
    return {
        "metadata": _valid_preflight_metadata(),
        "table_counts": {
            f"public.{name}": {"count": 0, "observed_at": "2026-10-18T10:00:00Z"}
            for name in runner.EXPECTED_PUBLIC_TABLES
        },
        "migration_ledger": {"count": runner.EXPECTED_MIGRATION_COUNT, "versions": []},
    }


def _completed(args: list[str], stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr=stderr)


def _patch_local_prerequisites(monkeypatch: pytest.MonkeyPatch, root: Path) -> list[list[str]]:
    monkeypatch.setattr(runner.sys, "platform", "darwin")
    monkeypatch.setattr(runner, "discover_pg_tool_paths", lambda: {
        "pg_dump": "/opt/homebrew/opt/postgresql@17/bin/pg_dump",
        "pg_restore": "/opt/homebrew/opt/postgresql@17/bin/pg_restore",
        "psql": "/opt/homebrew/opt/postgresql@17/bin/psql",
    })
    monkeypatch.setattr(runner, "default_backup_root", lambda: root)
    monkeypatch.setattr(runner.connection_check, "read_keychain_password", lambda: SECRET)
    calls: list[list[str]] = []

    def mock_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args[0].endswith("pg_dump"):
            version = "pg_dump (PostgreSQL) 17.11\n"
        elif args[0].endswith("pg_restore"):
            version = "pg_restore (PostgreSQL) 17.11\n"
        elif args[0].endswith("psql"):
            version = "psql (PostgreSQL) 17.11\n"
        elif args[:3] == ["git", "-C", str(runner.REPOSITORY_ROOT)]:
            version = "0123456789abcdef0123456789abcdef01234567\n"
        else:
            raise AssertionError(f"Unexpected subprocess in local prerequisite check: {args[0]}")
        return _completed(args, stdout=version)

    monkeypatch.setattr(runner.subprocess, "run", mock_run)
    return calls


def test_safe_preview_checks_local_prerequisites_without_network_or_artifacts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    backup_root = tmp_path / "backups"
    calls = _patch_local_prerequisites(monkeypatch, backup_root)

    assert runner.main([]) == 0

    output = capsys.readouterr()
    assert "SAFE PREVIEW" in output.out
    assert "no network connection" in output.out.lower()
    assert SECRET not in output.out + output.err
    assert not backup_root.exists()
    assert all(args[-1] == "--version" for args in calls if args[0].endswith(("pg_dump", "pg_restore", "psql")))
    assert not any("--dbname" in args or "--host" in args for args in calls)


def test_preview_fails_closed_when_keychain_password_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr(
        runner.connection_check,
        "read_keychain_password",
        lambda: (_ for _ in ()).throw(runner.connection_check.ConfigurationError("sensitive " + SECRET)),
    )

    assert runner.main([]) == 1

    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert not (tmp_path / "backups").exists()


def test_preflight_only_runs_read_only_checks_without_dump_or_artifacts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    backup_root = tmp_path / "backups"
    local_calls = _patch_local_prerequisites(monkeypatch, backup_root)
    preflight_calls: list[tuple[runner.PgTools, str]] = []
    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr("builtins.input", lambda _prompt: runner.PREFLIGHT_CONFIRMATION)
    monkeypatch.setattr(
        runner,
        "run_read_only_preflight",
        lambda tools, password: (preflight_calls.append((tools, password)) or _valid_preflight_result()),
    )
    monkeypatch.setattr(runner, "run_export_dump", lambda *_args: pytest.fail("preflight-only must not dump"))

    assert runner.main(["--preflight-only"]) == 0

    output = capsys.readouterr()
    assert "READ-ONLY PREFLIGHT: PASS" in output.out
    assert "PostgreSQL server version: 17.6" in output.out
    assert "Public tables: 17" in output.out
    assert "RLS/read coverage: PASS (17/17 tables)" in output.out
    assert "ACL inventory: PASS" in output.out
    assert "pgcrypto 1.3" in output.out
    assert "Migration records: 19" in output.out
    assert "STOP conditions: none detected" in output.out
    assert "No export was attempted" in output.out
    assert SECRET not in output.out + output.err
    assert URI not in output.out + output.err
    assert len(preflight_calls) == 1 and preflight_calls[0][1] == SECRET
    assert not backup_root.exists()
    assert not any("--format=custom" in args for args in local_calls)


def test_preflight_only_does_not_connect_without_interactive_confirmation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    local_calls = _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    preflight_called = False

    def forbidden_preflight(*_args: object) -> dict[str, object]:
        nonlocal preflight_called
        preflight_called = True
        pytest.fail("read-only DB checks must not run before confirmation")

    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr("builtins.input", lambda _prompt: "wrong confirmation")
    monkeypatch.setattr(runner, "run_read_only_preflight", forbidden_preflight)

    assert runner.main(["--preflight-only"]) == 1

    output = capsys.readouterr()
    assert "confirmation did not match" in output.err
    assert "no database connection was attempted" in output.err.lower()
    assert not preflight_called
    assert not any("--format=custom" in args for args in local_calls)
    assert not (tmp_path / "backups").exists()


def test_preflight_only_requires_tty_before_any_database_check(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr("builtins.input", lambda _prompt: pytest.fail("must not prompt without TTY"))
    monkeypatch.setattr(runner, "run_read_only_preflight", lambda *_args: pytest.fail("must not connect"))

    assert runner.main(["--preflight-only"]) == 1
    assert "interactive terminal" in capsys.readouterr().err


def test_preflight_only_local_prerequisite_error_stops_safely(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    backup_root = tmp_path / "backups"
    monkeypatch.setattr(
        runner,
        "check_local_prerequisites",
        lambda: (_ for _ in ()).throw(runner.RunnerError(f"local failure {SECRET} {URI}")),
    )
    monkeypatch.setattr(
        runner,
        "run_read_only_preflight",
        lambda *_args: pytest.fail("database connection must not follow local prerequisite failure"),
    )

    assert runner.main(["--preflight-only"]) == 1

    output = capsys.readouterr()
    assert "STOP:" in output.err
    assert "no database connection or export was attempted" in output.err
    assert SECRET not in output.out + output.err
    assert URI not in output.out + output.err
    assert not backup_root.exists()


def test_preflight_only_failure_stops_without_export_or_secret_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr("builtins.input", lambda _prompt: runner.PREFLIGHT_CONFIRMATION)
    monkeypatch.setattr(
        runner,
        "run_read_only_preflight",
        lambda *_args: (_ for _ in ()).throw(runner.RunnerError(f"failed {SECRET} {URI}")),
    )
    monkeypatch.setattr(runner, "run_export_dump", lambda *_args: pytest.fail("failed preflight must not export"))

    assert runner.main(["--preflight-only"]) == 1

    output = capsys.readouterr()
    assert "STOP [PREFLIGHT]:" in output.err
    assert "no export was attempted" in output.err.lower()
    assert SECRET not in output.out + output.err
    assert URI not in output.out + output.err
    assert not (tmp_path / "backups").exists()


@pytest.mark.parametrize(
    "stage",
    [
        "PREFLIGHT",
        "CONNECTION_SQL",
        "METADATA",
        "ACL",
        "EXTENSIONS",
        "DEPENDENCIES",
        "TABLE_COUNTS",
        "MIGRATION_LEDGER",
    ],
)
def test_preflight_only_reports_safe_stage_diagnostics(
    stage: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr("builtins.input", lambda _prompt: runner.PREFLIGHT_CONFIRMATION)
    monkeypatch.setattr(
        runner,
        "run_read_only_preflight",
        lambda *_args: (_ for _ in ()).throw(runner.PreflightStop(stage)),
    )
    monkeypatch.setattr(runner, "run_export_dump", lambda *_args: pytest.fail("STOP must not export"))

    assert runner.main(["--preflight-only"]) == 1

    output = capsys.readouterr()
    assert f"STOP [{stage}]" in output.err
    assert runner.PREFLIGHT_STOP_REASONS[stage] in output.err
    assert SECRET not in output.out + output.err
    assert URI not in output.out + output.err
    assert not (tmp_path / "backups").exists()


def test_preview_rejects_wrong_postgresql_client_version(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    calls = _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    original_run = runner.subprocess.run

    def wrong_version(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        if args[0].endswith("pg_dump"):
            calls.append(args)
            return _completed(args, stdout="pg_dump (PostgreSQL) 16.4\n")
        return original_run(args, **kwargs)

    monkeypatch.setattr(runner.subprocess, "run", wrong_version)

    assert runner.main([]) == 1
    assert "PostgreSQL 17 client tools" in capsys.readouterr().err


def test_helper_rejects_wrong_database_target() -> None:
    target = runner.connection_check.Target(
        "wrong.example.test", 5432, "postgres",
        "postgres.tlgprfsecdasloqnuyjo", "require",
    )

    with pytest.raises(runner.connection_check.ConfigurationError):
        runner.connection_check.validate_target(target)


def test_export_is_refused_without_exact_interactive_confirmation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    calls = _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr("builtins.input", lambda _prompt: "wrong confirmation")
    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())

    assert runner.main(["--export"]) == 1

    output = capsys.readouterr()
    assert "cancel" in output.err.lower()
    assert not (tmp_path / "backups").exists()
    assert all(args[-1] == "--version" for args in calls if args[0].endswith(("pg_dump", "pg_restore", "psql")))


def test_export_is_refused_without_an_interactive_terminal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr("builtins.input", lambda _prompt: pytest.fail("must not prompt without a terminal"))

    assert runner.main(["--export"]) == 1

    output = capsys.readouterr()
    assert "interactive terminal" in output.err
    assert "no production connection" in output.err
    assert not (tmp_path / "backups").exists()


def test_manifest_metadata_is_a_timestamped_observation(tmp_path: Path) -> None:
    metadata = {"observed_at": "2026-10-18T10:00:00.000000Z", "server_version": "17.6", "tables": [], "extension_inventory": []}
    manifest = runner.build_manifest(
        target=runner.connection_check.EXPECTED_TARGET,
        tools=runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql"),
        git_revision="a" * 40,
        archive_size=12,
        archive_sha256="b" * 64,
        preflight={
            "metadata": metadata,
            "table_counts": {},
            "migration_ledger": {"count": 19, "observed_at": "2026-10-18T10:01:00Z", "versions": []},
        },
        started_at="2026-10-18T09:59:00Z",
        completed_at="2026-10-18T10:02:00Z",
        client_versions={"pg_dump": "17.11", "pg_restore": "17.11", "psql": "17.11"},
    )

    assert manifest["observations"]["metadata"]["observed_at"] == metadata["observed_at"]
    assert manifest["observations"]["snapshot_equivalent_to_archive"] is False
    assert "status" not in manifest
    assert manifest["target"]["server_version"] == "17.6"
    assert manifest["client_tools"]["pg_dump"]["version"] == "17.11"


def test_export_stops_on_preflight_failure_and_preserves_incomplete_marker(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _patch_local_prerequisites(monkeypatch, tmp_path / "backups")
    monkeypatch.setattr("builtins.input", lambda _prompt: runner.EXPORT_CONFIRMATION)
    monkeypatch.setattr(runner.sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr(runner, "run_read_only_preflight", lambda *_args: (_ for _ in ()).throw(runner.RunnerError("preflight failed " + SECRET)))
    monkeypatch.setattr(runner, "run_export_dump", lambda *_args: pytest.fail("dump must not run after failed preflight"))

    assert runner.main(["--export"]) == 1

    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    incomplete = list((tmp_path / "backups").glob("*/INCOMPLETE.txt"))
    assert len(incomplete) == 1
    assert "INCOMPLETE" in incomplete[0].read_text()


def test_existing_unique_output_directory_is_never_overwritten(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = tmp_path / "backups"
    root.mkdir(mode=0o700)
    monkeypatch.setattr(runner.secrets, "token_hex", lambda _size: "deadbeef")
    existing = root / f"{runner.utc_stamp()}-deadbeef"
    existing.mkdir(mode=0o700)
    marker = existing / "preserve.txt"
    marker.write_text("untouched")

    with pytest.raises(runner.RunnerError):
        runner.create_backup_directory(root)

    assert marker.read_text() == "untouched"


def test_failed_pg_dump_leaves_incomplete_artifacts_and_suppresses_raw_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    tools = runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql")
    output_dir = tmp_path / "run"
    output_dir.mkdir(mode=0o700)
    runner.write_incomplete_marker(output_dir, "export started")

    def fail_dump(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        (output_dir / "backup.dump").write_bytes(b"partial backup bytes")
        return _completed(["pg_dump"], stderr=f"failed {SECRET} {URI}", returncode=2)

    monkeypatch.setattr(runner.subprocess, "run", fail_dump)
    with pytest.raises(runner.RunnerError):
        runner.run_export_dump(tools, SECRET, output_dir)

    output = capsys.readouterr()
    assert SECRET not in output.out + output.err
    assert URI not in output.out + output.err
    assert "pg_dump" not in output.out
    assert (output_dir / "INCOMPLETE.txt").exists()
    assert (output_dir / "backup.dump").read_bytes() == b"partial backup bytes"


def test_empty_or_invalid_archive_fails_closed_and_keeps_incomplete_marker(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tools = runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql")
    for invalid_output in (b"", b"not-a-postgres-archive"):
        output_dir = tmp_path / f"run-{len(invalid_output)}"
        output_dir.mkdir(mode=0o700)
        runner.write_incomplete_marker(output_dir, "export started")

        def mock_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
            if args[0] == tools.pg_dump:
                (output_dir / "backup.dump").write_bytes(invalid_output)
                return subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")
            if args[0] == tools.pg_restore:
                return subprocess.CompletedProcess(args, 1, stdout=b"", stderr=SECRET.encode())
            raise AssertionError("unexpected subprocess")

        monkeypatch.setattr(runner.subprocess, "run", mock_run)
        with pytest.raises(runner.RunnerError):
            runner.run_export_dump(tools, SECRET, output_dir)
        assert (output_dir / "INCOMPLETE.txt").exists()


def test_read_only_preflight_rejects_unknown_acl_principals_without_leaking_output(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    metadata = _valid_preflight_metadata()
    metadata["acl_principals_by_scope"]["functions"].append("unexpected_role")
    monkeypatch.setattr(runner, "run_psql_json", lambda *_args, **_kwargs: metadata)

    with pytest.raises(runner.RunnerError, match="ACL"):
        runner.validate_preflight_metadata(metadata)

    output = capsys.readouterr()
    assert "unexpected_role" not in output.out + output.err
    assert SECRET not in output.out + output.err


def test_read_only_preflight_accepts_operator_confirmed_acl_inventory() -> None:
    metadata = _valid_preflight_metadata()

    runner.validate_preflight_metadata(metadata)


@pytest.mark.parametrize(
    ("scope", "principal"),
    [
        ("relations", "app_runtime"),
        ("functions", "anon"),
        ("types", "authenticated"),
        ("schema", "supabase_admin"),
        ("default_acl", "pg_database_owner"),
    ],
)
def test_read_only_preflight_rejects_principal_outside_its_confirmed_scope(
    scope: str, principal: str
) -> None:
    metadata = _valid_preflight_metadata()
    metadata["acl_principals_by_scope"][scope].append(principal)

    with pytest.raises(runner.PreflightStop) as error:
        runner.validate_preflight_metadata(metadata)

    assert error.value.stage == "ACL"


@pytest.mark.parametrize(
    ("stage", "change"),
    [
        ("METADATA", lambda metadata: metadata.update(database="unexpected")),
        ("ACL", lambda metadata: metadata["acl_principals_by_scope"]["functions"].append("unexpected_role")),
        ("EXTENSIONS", lambda metadata: metadata["extension_inventory"].pop()),
        ("DEPENDENCIES", lambda metadata: metadata.update(large_object_count=1)),
    ],
)
def test_metadata_validation_assigns_safe_preflight_stage(
    stage: str, change: object
) -> None:
    metadata = _valid_preflight_metadata()
    change(metadata)

    with pytest.raises(runner.PreflightStop) as error:
        runner.validate_preflight_metadata(metadata)

    assert error.value.stage == stage


def test_read_only_preflight_classifies_table_count_and_migration_ledger_stops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql")
    metadata = _valid_preflight_metadata()
    monkeypatch.setattr(runner, "run_psql_json", lambda *_args, **_kwargs: metadata)
    monkeypatch.setattr(
        runner,
        "run_table_count",
        lambda *_args: (_ for _ in ()).throw(runner.RunnerError("unsafe table count detail")),
    )

    with pytest.raises(runner.PreflightStop) as error:
        runner.run_read_only_preflight(tools, SECRET)
    assert error.value.stage == "TABLE_COUNTS"

    monkeypatch.setattr(
        runner,
        "run_table_count",
        lambda *_args: {"count": 0, "observed_at": "2026-10-18T10:00:00Z"},
    )
    monkeypatch.setattr(runner, "run_migration_ledger", lambda *_args: {"count": 18, "versions": []})

    with pytest.raises(runner.PreflightStop) as error:
        runner.run_read_only_preflight(tools, SECRET)
    assert error.value.stage == "MIGRATION_LEDGER"


def test_read_only_sql_failure_is_classified_as_connection_sql(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql")
    monkeypatch.setattr(runner, "connection_environment", lambda *_args: {})
    monkeypatch.setattr(
        runner.subprocess,
        "run",
        lambda *_args, **_kwargs: _completed([tools.psql], stderr=f"unsafe {SECRET}", returncode=1),
    )

    with pytest.raises(runner.PreflightStop) as error:
        runner.run_psql_json(tools, SECRET, runner.PREFLIGHT_SQL)

    assert error.value.stage == "CONNECTION_SQL"
    assert SECRET not in str(error.value)


def test_preflight_rejects_a_different_17_table_inventory() -> None:
    metadata = _valid_preflight_metadata()
    metadata["tables"] = [
        {"name": name, "owner": runner.EXPECTED_DATABASE_ROLE, "rls": True, "select": True}
        for name in sorted(runner.EXPECTED_PUBLIC_TABLES - {"trip_stops"} | {"unexpected_table"})
    ]

    with pytest.raises(runner.PreflightStop) as error:
        runner.validate_preflight_metadata(metadata)
    assert error.value.stage == "METADATA"


def test_preflight_accepts_postgresql_17_minor_versions_and_rejects_other_major() -> None:
    runner.validate_preflight_metadata(_valid_preflight_metadata("17.11"))
    with pytest.raises(runner.PreflightStop) as error:
        runner.validate_preflight_metadata(_valid_preflight_metadata("18.0"))
    assert error.value.stage == "METADATA"


@pytest.mark.parametrize(
    ("extension_name", "version"),
    [("unknown_ext", "1.0"), ("pgcrypto", "9.9")],
)
def test_preflight_stops_for_unknown_or_changed_extensions(extension_name: str, version: str) -> None:
    metadata = _valid_preflight_metadata()
    metadata["extension_inventory"] = [
        {"name": name, "version": observed}
        for name, observed in runner.EXPECTED_EXTENSION_INVENTORY.items()
        if name != extension_name
    ] + [{"name": extension_name, "version": version}]

    with pytest.raises(runner.PreflightStop) as error:
        runner.validate_preflight_metadata(metadata)
    assert error.value.stage == "EXTENSIONS"


def test_preflight_observations_do_not_claim_shared_archive_snapshot() -> None:
    assert "auth.users" in runner.PREFLIGHT_SQL
    assert "storage.objects" in runner.PREFLIGHT_SQL
    assert "vault.secrets" in runner.PREFLIGHT_SQL
    assert "acl.grantor" in runner.PREFLIGHT_SQL
    assert "c.relowner" in runner.PREFLIGHT_SQL
    assert "p.proowner" in runner.PREFLIGHT_SQL
    assert "observed_at" in runner.MIGRATION_LEDGER_SQL
    assert "clock_timestamp" in runner.TABLE_COUNT_SQL_TEMPLATE


def test_manifest_contains_no_credentials_and_marks_separate_observations(tmp_path: Path) -> None:
    manifest = runner.build_manifest(
        target=runner.connection_check.EXPECTED_TARGET,
        tools=runner.PgTools("/pg17/pg_dump", "/pg17/pg_restore", "/pg17/psql"),
        git_revision="a" * 40,
        archive_size=12,
        archive_sha256="b" * 64,
        preflight={
            "metadata": {"server_version": "17.6", "tables": [], "extension_inventory": []},
            "table_counts": {"public.example": {"count": 3, "observed_at": "2026-10-18T10:00:00Z"}},
            "migration_ledger": {"count": 19, "observed_at": "2026-10-18T10:01:00Z", "versions": []},
        },
        started_at="2026-10-18T09:59:00Z",
        completed_at="2026-10-18T10:02:00Z",
        client_versions={"pg_dump": "17.10", "pg_restore": "17.10", "psql": "17.10"},
    )
    serialized = json.dumps(manifest)

    assert "postgres.tlgprfsecdasloqnuyjo" in serialized
    assert SECRET not in serialized
    assert URI not in serialized
    assert manifest["observations"]["table_counts"]["public.example"]["observed_at"] != manifest["archive"]["started_at"]
    assert manifest["target"]["server_version"] == "17.6"
    assert manifest["client_tools"]["psql"]["version"] == "17.10"


def test_archive_success_message_does_not_claim_a_verified_restore() -> None:
    assert "restore has not been verified" in runner.ARCHIVE_SUCCESS_MESSAGE


def test_database_credentials_are_passed_only_through_expected_environment() -> None:
    environment = runner.connection_environment(SECRET, "test-backup")

    assert environment["PGHOST"] == runner.connection_check.EXPECTED_TARGET.host
    assert environment["PGPORT"] == "5432"
    assert environment["PGUSER"] == runner.connection_check.EXPECTED_TARGET.username
    assert environment["PGDATABASE"] == "postgres"
    assert environment["PGPASSWORD"] == SECRET
    assert environment["PGSSLMODE"] == "require"
    assert environment["PGOPTIONS"] == "-c default_transaction_read_only=on"
    assert URI not in " ".join(environment.values())


def test_external_postgresql_environment_cannot_override_fixed_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    external = {
        "PGHOST": "attacker.invalid",
        "PGHOSTADDR": "192.0.2.1",
        "PGPORT": "6432",
        "PGUSER": "attacker",
        "PGDATABASE": "other",
        "PGPASSWORD": "attacker-password",
        "PGSSLMODE": "disable",
        "PGSERVICE": "attacker-service",
        "PGSERVICEFILE": "/tmp/attacker-service.conf",
        "PGPASSFILE": "/tmp/attacker-pass",
        "PGOPTIONS": "-c default_transaction_read_only=off",
    }
    for name, value in external.items():
        monkeypatch.setenv(name, value)

    environment = runner.connection_environment(SECRET, "test-backup")

    assert {name for name in environment if name.startswith("PG")} == {
        "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGSSLMODE",
        "PGCONNECT_TIMEOUT", "PGAPPNAME", "PGOPTIONS",
    }
    assert environment["PGHOST"] == runner.connection_check.EXPECTED_TARGET.host
    assert "PGHOSTADDR" not in environment
    assert environment["PGPORT"] == "5432"
    assert environment["PGSSLMODE"] == "require"
    assert environment["PGPASSWORD"] == SECRET
