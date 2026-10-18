from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess

import pytest


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "local-production-backup-restore-smoke.py"
SPEC = importlib.util.spec_from_file_location("local_production_restore_smoke", SCRIPT_PATH)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def _archive_files(tmp_path: Path) -> tuple[Path, Path]:
    archive = tmp_path / "public.dump"
    archive.write_bytes(b"mock custom archive bytes")
    manifest = {
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
            "metadata": {"extension_restore_dependencies": [{"name": "plpgsql", "version": "1.0"}]},
            "migration_ledger": {
                "count": 19,
                "versions": [
                    {"version": f"20260901{index:06d}", "name": f"migration_{index}"}
                    for index in range(19)
                ],
            },
        },
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return archive, manifest_path


def test_validate_archive_checks_manifest_scope_format_major_and_sha(tmp_path: Path) -> None:
    archive, manifest = _archive_files(tmp_path)

    result = smoke.validate_archive(archive, manifest)

    assert result["archive"]["scope"] == "schema=public"


@pytest.mark.parametrize(
    ("field_path", "value"),
    [
        (("archive", "scope"), "schema=all"),
        (("archive", "format"), "plain"),
        (("target", "server_version"), "16.9"),
        (("observations", "migration_ledger", "count"), 18),
    ],
)
def test_validate_archive_rejects_wrong_scope_format_or_metadata(
    tmp_path: Path, field_path: tuple[str, ...], value: object
) -> None:
    archive, manifest_path = _archive_files(tmp_path)
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    node = data
    for field in field_path[:-1]:
        node = node[field]
    node[field_path[-1]] = value
    manifest_path.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(smoke.RestoreSmokeError, match="manifest"):
        smoke.validate_archive(archive, manifest_path)


def test_validate_archive_rejects_checksum_mismatch(tmp_path: Path) -> None:
    archive, manifest_path = _archive_files(tmp_path)
    archive.write_bytes(b"different bytes")

    with pytest.raises(smoke.RestoreSmokeError, match="SHA-256"):
        smoke.validate_archive(archive, manifest_path)


def test_expected_function_inventory_matches_archived_migration_era() -> None:
    assert len(smoke.ARCHIVE_EXPECTED_FUNCTIONS) == 18
    assert len(smoke.CURRENT_APP_EXPECTED_FUNCTIONS) == 21
    assert set(smoke.CURRENT_APP_ADDITIONAL_FUNCTIONS) == {
        "public.bootstrap_telegram_login(bigint,text,text,text,text,text)",
        "public.chat_participant_public_profile(uuid,uuid)",
        "public.resolve_bearer_session_with_identity(text)",
    }


def _valid_structure() -> dict[str, object]:
    return {
        "database": "tf_restore_ab12",
        "server_version": "17.6",
        "tables": sorted(smoke.EXPECTED_PUBLIC_TABLES),
        "constraint_count": 50,
        "index_count": 40,
        "trigger_names": sorted(smoke.EXPECTED_TRIGGERS),
        "function_count": 18,
        "expected_functions_present": True,
        "expected_triggers_present": True,
        "rls_table_count": 17,
        "policy_count": 17,
        "expected_policy_count": 17,
        "all_expected_tables_rls_enabled": True,
    }


def test_validate_structure_accepts_expected_inventory() -> None:
    smoke.validate_structure(_valid_structure(), "tf_restore_ab12")


def test_validate_structure_accepts_post_migration_function_inventory() -> None:
    summary = _valid_structure()
    summary["function_count"] = len(smoke.CURRENT_APP_EXPECTED_FUNCTIONS)
    smoke.validate_structure(
        summary,
        "tf_restore_ab12",
        expected_functions=smoke.CURRENT_APP_EXPECTED_FUNCTIONS,
    )


def test_validate_structure_rejects_missing_table() -> None:
    summary = _valid_structure()
    summary["tables"] = summary["tables"][:-1]  # type: ignore[index]

    with pytest.raises(smoke.RestoreSmokeError, match="TABLES"):
        smoke.validate_structure(summary, "tf_restore_ab12")


def test_schema_dump_normalization_removes_only_pg17_restrict_commands() -> None:
    left = "\\restrict one\nCREATE TABLE public.sample (id integer);\n\\unrestrict one\n"
    right = "\\restrict another\nCREATE TABLE public.sample (id integer);\n\\unrestrict another\n"

    assert smoke.normalize_schema_dump(left) == smoke.normalize_schema_dump(right)
    assert smoke.normalize_schema_dump("CREATE TABLE public.a (id integer);\n") != smoke.normalize_schema_dump(
        "CREATE TABLE public.a (id bigint);\n"
    )
    assert smoke.normalize_schema_dump("-- \\restrict is commentary\n") == "-- \\restrict is commentary\n"
    assert smoke.schema_diff_categories("CREATE TABLE public.a (id integer);", "CREATE TABLE public.a (id bigint);") == ["CREATE"]


def test_schema_dump_normalization_ignores_only_pg_dump_metadata_comments() -> None:
    left = "-- PostgreSQL database dump\n-- Name: a; Type: TABLE; Schema: public; Owner: postgres\n-- custom comment\n"
    right = "-- PostgreSQL database dump from different tool\n-- Name: b; Type: TABLE; Schema: public; Owner: other\n-- custom comment\n"

    assert smoke.normalize_schema_dump(left) == smoke.normalize_schema_dump(right)
    assert "-- custom comment" in smoke.normalize_schema_dump(left)


def _valid_grants_csv() -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    for header in smoke.VERIFIER_SECTIONS:
        section = smoke.VERIFIER_SECTIONS[header]
        writer.writerow(header)
        if section == "schema":
            writer.writerow(["t", "t"])
        elif section == "table_rights":
            writer.writerows([["table", "SELECT", "t", "t", "t", "t"] for _ in range(17 * 7)])
        elif section == "column_rights":
            writer.writerow(["profiles", "id", "SELECT", "t", "t", "t"])
        elif section == "sequences":
            pass
        elif section == "capabilities":
            writer.writerows([[signature, "t", "t"] for signature in range(18)])
        elif section == "unexpected_functions":
            pass
        elif section == "owners":
            writer.writerows([["table", "postgres", "t"] for _ in range(17)])
        elif section == "policies":
            writer.writerows([["table", "t", "t", "1", "1", "t", "t", "t"] for _ in range(17)])
        elif section == "role_attributes":
            writer.writerow(["t", "t", "t", "t", "t"])
    return output.getvalue()


def test_grants_verifier_accepts_existing_production_grant_script_result_shape() -> None:
    smoke.validate_grants_verifier_csv(_valid_grants_csv())


def test_grants_verifier_fails_closed_on_missing_table_coverage() -> None:
    output = _valid_grants_csv().replace(
        'table,SELECT,t,t,t,t\n', '', 1
    )

    with pytest.raises(smoke.RestoreSmokeError, match="cover all application tables"):
        smoke.validate_grants_verifier_csv(output)


def test_docker_and_restore_commands_are_isolated_and_never_clean_or_create_target() -> None:
    container = "tf-backup-restore-20261018-abcdef123456"
    run_command = smoke._container_create_command(container, "abcdef123456")
    restore_command = smoke._restore_command(container, "tf_restore_abcdef123456")

    assert "--network=none" in run_command
    assert "--rm" in run_command
    assert "--label" in run_command
    assert f"{smoke.CONTAINER_LABEL_KEY}=abcdef123456" in run_command
    assert "POSTGRES_HOST_AUTH_METHOD=trust" in run_command
    assert "-p" not in run_command
    assert "--no-owner" in restore_command
    assert "--no-acl" in restore_command
    assert "--exit-on-error" in restore_command
    assert "--single-transaction" in restore_command
    assert "--username=postgres" in restore_command
    assert "--clean" not in restore_command
    assert "--create" not in restore_command


def test_cleanup_only_stops_exact_container_after_per_run_identity_check(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_docker(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        output = b"tf-backup-restore-20261018-abcdef123456\n" if len(calls) == 1 else b""
        return subprocess.CompletedProcess(args, 0, output, b"")

    monkeypatch.setattr(
        smoke,
        "_docker",
        fake_docker,
    )
    verified: list[tuple[str, str]] = []
    monkeypatch.setattr(smoke, "_verify_container", lambda name, run_id: verified.append((name, run_id)))

    smoke._cleanup_task_container("tf-backup-restore-20261018-abcdef123456", "abcdef123456")

    assert calls[0][0] == "ps"
    assert calls[1] == ["stop", "tf-backup-restore-20261018-abcdef123456"]
    assert calls[2][0] == "ps"
    assert verified == [("tf-backup-restore-20261018-abcdef123456", "abcdef123456")]


def test_cleanup_does_not_stop_container_if_run_identity_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_docker(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, b"tf-backup-restore-20261018-abcdef123456\n", b"")

    monkeypatch.setattr(smoke, "_docker", fake_docker)

    def reject_identity(name: str, run_id: str) -> None:
        raise smoke.RestoreSmokeError("ISOLATION", "identity failed")

    monkeypatch.setattr(smoke, "_verify_container", reject_identity)
    with pytest.raises(smoke.RestoreSmokeError, match="identity failed"):
        smoke._cleanup_task_container("tf-backup-restore-20261018-abcdef123456", "abcdef123456")

    assert len(calls) == 1
    assert calls[0][0] == "ps"


def test_cleanup_after_ambiguous_docker_run_creation_is_attempted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive, manifest = _archive_files(tmp_path)
    monkeypatch.setattr(smoke, "_container_name", lambda: ("task-container", "unique-run"))
    calls: list[list[str]] = []

    def fail_create(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        raise smoke.RestoreSmokeError("DOCKER", "create failed")

    monkeypatch.setattr(smoke, "_docker", fail_create)
    cleanup: list[tuple[str, str]] = []
    monkeypatch.setattr(smoke, "_cleanup_task_container", lambda name, run_id: cleanup.append((name, run_id)))

    assert smoke.run_smoke(archive, manifest) == 1
    assert calls[0][0] == "run"
    assert cleanup == [("task-container", "unique-run")]


def test_invalid_archive_stops_before_any_docker_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    archive, manifest = _archive_files(tmp_path)
    archive.write_bytes(b"tampered archive")
    calls: list[list[str]] = []
    monkeypatch.setattr(smoke, "_docker", lambda args, **kwargs: calls.append(args))

    with pytest.raises(smoke.RestoreSmokeError):
        smoke.run_smoke(archive, manifest)

    assert calls == []


def test_restore_failure_reports_only_safe_missing_role_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        smoke.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, b"", b'pg_restore: ERROR: role "app_runtime" does not exist\\nPII and SQL suppressed'),
    )

    with pytest.raises(smoke.RestoreSmokeError) as error:
        smoke._docker(
            ["exec", "container", "pg_restore"],
            stage="RESTORE",
            reason="generic restore failure",
        )

    assert "role absent" in error.value.reason
    assert "app_runtime" not in error.value.reason
    assert "PII" not in error.value.reason
    assert "SQL" not in error.value.reason


def test_grants_failure_reports_script_schema_mismatch_without_raw_sql(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        smoke.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, b"", b"ERROR: function public.example() does not exist; PII suppressed"),
    )

    with pytest.raises(smoke.RestoreSmokeError) as error:
        smoke._docker(
            ["exec", "container", "psql"],
            stage="GRANTS",
            reason="grant script failed",
        )

    assert "references a function absent" in error.value.reason
    assert "PII" not in error.value.reason
    assert "example" not in error.value.reason


def test_grants_failure_classifies_archive_missing_current_app_function(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        smoke.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], 1, b"", b"ERROR: function public.bootstrap_telegram_login(bigint, text) does not exist; PII suppressed"
        ),
    )

    with pytest.raises(smoke.RestoreSmokeError) as error:
        smoke._docker(
            ["exec", "container", "psql"],
            stage="GRANTS",
            reason="grant failure",
        )

    assert "six-argument bootstrap function" in error.value.reason
    assert "PII" not in error.value.reason


def test_repository_migrations_are_only_replayed_after_archive_tip(tmp_path: Path) -> None:
    migration_directory = tmp_path / "migrations"
    migration_directory.mkdir()
    (migration_directory / "20260101000000_base.sql").write_text("SELECT 1;", encoding="utf-8")
    (migration_directory / "20260102000000_second.sql").write_text("SELECT 2;", encoding="utf-8")
    (migration_directory / "20260103000000_third.sql").write_text("SELECT 3;", encoding="utf-8")
    manifest = {
        "observations": {
            "migration_ledger": {
                "versions": [
                    {"version": "20260101000000", "name": "base"},
                    {"version": "20260102000000", "name": "second"},
                ]
            }
        }
    }

    assert smoke._repository_migrations_not_in_archive(manifest, migration_directory) == [
        migration_directory / "20260103000000_third.sql"
    ]


def test_repository_migration_ledger_name_mismatch_stops(tmp_path: Path) -> None:
    migration_directory = tmp_path / "migrations"
    migration_directory.mkdir()
    (migration_directory / "20260101000000_base.sql").write_text("SELECT 1;", encoding="utf-8")
    manifest = {
        "observations": {
            "migration_ledger": {
                "versions": [{"version": "20260101000000", "name": "unexpected"}]
            }
        }
    }

    with pytest.raises(smoke.RestoreSmokeError, match="ledger does not match"):
        smoke._repository_migrations_not_in_archive(manifest, migration_directory)


def test_repository_migration_gap_before_archive_tip_stops(tmp_path: Path) -> None:
    migration_directory = tmp_path / "migrations"
    migration_directory.mkdir()
    (migration_directory / "20260101000000_base.sql").write_text("SELECT 1;", encoding="utf-8")
    (migration_directory / "20260102000000_middle.sql").write_text("SELECT 2;", encoding="utf-8")
    (migration_directory / "20260103000000_latest.sql").write_text("SELECT 3;", encoding="utf-8")
    manifest = {
        "observations": {
            "migration_ledger": {
                "versions": [{"version": "20260103000000", "name": "latest"}]
            }
        }
    }

    with pytest.raises(smoke.RestoreSmokeError, match="migration gap"):
        smoke._repository_migrations_not_in_archive(manifest, migration_directory)


def test_repository_public_revoke_extraction_excludes_other_privilege_rules(tmp_path: Path) -> None:
    migration_directory = tmp_path / "migrations"
    migration_directory.mkdir()
    (migration_directory / "20260101000000_acl.sql").write_text(
        "REVOKE ALL ON FUNCTION public.first() FROM PUBLIC;\n"
        "GRANT EXECUTE ON FUNCTION public.first() TO app_runtime;\n"
        "REVOKE EXECUTE ON FUNCTION public.second(uuid) FROM PUBLIC;\n",
        encoding="utf-8",
    )

    statements = smoke._repository_public_function_revokes(migration_directory)

    assert len(statements) == 2
    assert all("FROM PUBLIC" in statement.upper() for statement in statements)
    assert all("GRANT" not in statement.upper() for statement in statements)
