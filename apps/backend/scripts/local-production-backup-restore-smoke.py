#!/usr/bin/env python3
"""Restore a verified production archive into a network-isolated local Docker DB."""

from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import io
import json
import re
import secrets
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO


SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[3]
BACKUP_DIRECTORY = Path.home() / ".local" / "share" / "travel-friend" / "backups" / "20261018T142642Z-0b41eb45"
DEFAULT_ARCHIVE = BACKUP_DIRECTORY / "public.dump"
DEFAULT_MANIFEST = BACKUP_DIRECTORY / "manifest.json"
POSTGRES_IMAGE = "postgres:17-alpine"
CONTAINER_LABEL_KEY = "com.travel-friend.disposable-backup-restore"
EXPECTED_DATABASE_PREFIX = "tf_restore_"
EXPECTED_POSTGRES_MAJOR = 17
EXPECTED_MIGRATION_COUNT = 19

EXPECTED_PUBLIC_TABLES = frozenset({
    "users",
    "telegram_identities",
    "profiles",
    "profile_photos",
    "user_settings",
    "user_activity_states",
    "travel_intents",
    "user_sessions",
    "discover_interest_decisions",
    "matches",
    "chats",
    "chat_participants",
    "messages",
    "chat_summaries",
    "trips",
    "trip_participants",
    "trip_stops",
})
EXPECTED_TRIGGERS = frozenset({
    "chats_direct_participant_count",
    "chat_participants_direct_participant_count",
    "chat_participants_read_sequences_only_move_forward",
})
# These are the function signatures for the 19 migrations recorded by the
# supplied archive. The restore phase checks this inventory before replaying
# repository migrations that are absent from the archive ledger.
ARCHIVE_EXPECTED_FUNCTIONS = (
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
    "public.enforce_direct_chat_participant_count()",
    "public.enforce_chat_participant_read_sequences()",
)
CURRENT_APP_ADDITIONAL_FUNCTIONS = (
    "public.bootstrap_telegram_login(bigint,text,text,text,text,text)",
    "public.chat_participant_public_profile(uuid,uuid)",
    "public.resolve_bearer_session_with_identity(text)",
)
CURRENT_APP_EXPECTED_FUNCTIONS = (*ARCHIVE_EXPECTED_FUNCTIONS, *CURRENT_APP_ADDITIONAL_FUNCTIONS)
PUBLIC_FUNCTION_REVOKE_PATTERN = re.compile(
    r"(?is)\brevoke\s+(?:all|execute)\s+on\s+function\s+[^;]+?\s+from\s+public\s*;"
)


class RestoreSmokeError(Exception):
    """A safe failure message that never contains database command output."""

    def __init__(self, stage: str, reason: str) -> None:
        self.stage = stage
        self.reason = reason
        super().__init__(reason)


def _default_paths() -> tuple[Path, Path]:
    return DEFAULT_ARCHIVE, DEFAULT_MANIFEST


def validate_archive(archive_path: Path, manifest_path: Path) -> dict[str, Any]:
    try:
        if not archive_path.is_file() or not manifest_path.is_file():
            raise RestoreSmokeError("ARCHIVE", "archive or manifest is missing.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except RestoreSmokeError:
        raise
    except Exception:
        raise RestoreSmokeError("ARCHIVE", "archive manifest could not be read safely.") from None

    archive = manifest.get("archive") if isinstance(manifest, dict) else None
    target = manifest.get("target") if isinstance(manifest, dict) else None
    tools = manifest.get("client_tools") if isinstance(manifest, dict) else None
    observations = manifest.get("observations") if isinstance(manifest, dict) else None
    if (
        not isinstance(archive, dict)
        or archive.get("format") != "custom"
        or archive.get("scope") != "schema=public"
        or archive.get("filename") != archive_path.name
        or not isinstance(target, dict)
        or not isinstance(target.get("server_version"), str)
        or not isinstance(tools, dict)
        or not isinstance(tools.get("pg_dump"), dict)
        or not isinstance(tools["pg_dump"].get("version"), str)
    ):
        raise RestoreSmokeError("ARCHIVE", "manifest format, scope, or PostgreSQL metadata is invalid.")

    server_major = re.match(r"^(\d+)(?:\.|$)", target["server_version"])
    client_major = re.search(r"\b(\d+)(?:\.|$)", tools["pg_dump"]["version"])
    checksum = archive.get("sha256")
    if (
        server_major is None
        or int(server_major.group(1)) != EXPECTED_POSTGRES_MAJOR
        or client_major is None
        or int(client_major.group(1)) != EXPECTED_POSTGRES_MAJOR
        or not isinstance(archive.get("size_bytes"), int)
        or archive["size_bytes"] <= 0
        or not isinstance(checksum, str)
        or re.fullmatch(r"[0-9a-f]{64}", checksum) is None
    ):
        raise RestoreSmokeError("ARCHIVE", "manifest size, checksum, or PostgreSQL major version is invalid.")

    digest = hashlib.sha256()
    try:
        with archive_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if archive_path.stat().st_size != archive["size_bytes"] or digest.hexdigest() != checksum:
            raise RestoreSmokeError("ARCHIVE", "archive size or SHA-256 does not match the manifest.")
    except RestoreSmokeError:
        raise
    except Exception:
        raise RestoreSmokeError("ARCHIVE", "archive integrity could not be checked.") from None

    metadata = observations.get("metadata") if isinstance(observations, dict) else None
    dependencies = metadata.get("extension_restore_dependencies") if isinstance(metadata, dict) else None
    ledger = observations.get("migration_ledger") if isinstance(observations, dict) else None
    versions = ledger.get("versions") if isinstance(ledger, dict) else None
    if (
        not isinstance(dependencies, list)
        or any(
            not isinstance(item, dict)
            or not isinstance(item.get("name"), str)
            or not isinstance(item.get("version"), str)
            for item in dependencies
        )
        or not isinstance(ledger, dict)
        or ledger.get("count") != EXPECTED_MIGRATION_COUNT
        or not isinstance(versions, list)
        or len(versions) != EXPECTED_MIGRATION_COUNT
        or any(
            not isinstance(item, dict)
            or not isinstance(item.get("version"), str)
            or re.fullmatch(r"\d{14}", item["version"]) is None
            or not isinstance(item.get("name"), str)
            or re.fullmatch(r"[A-Za-z0-9_]+", item["name"]) is None
            for item in versions
        )
    ):
        raise RestoreSmokeError("ARCHIVE", "manifest restore-dependency or migration metadata is incomplete.")
    return manifest


def _docker(
    arguments: list[str],
    *,
    stage: str,
    reason: str,
    stdin_file: BinaryIO | None = None,
    input_data: bytes | None = None,
    timeout: int = 120,
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            ["docker", *arguments],
            stdin=stdin_file,
            input=input_data,
            capture_output=True,
            check=False,
            timeout=timeout,
        )
    except Exception:
        raise RestoreSmokeError(stage, reason) from None
    if result.returncode != 0:
        if stage == "RESTORE":
            diagnostic = result.stderr.decode("utf-8", errors="ignore").lower()
            if "role " in diagnostic and "does not exist" in diagnostic:
                reason = "archive references an unrecognized role absent from the isolated target; restore stopped without creating placeholder roles."
            elif "schema \"public\" already exists" in diagnostic:
                reason = "restore target public schema was not empty; restore stopped."
            elif "extension" in diagnostic and ("does not exist" in diagnostic or "not available" in diagnostic):
                reason = "archive requires a PostgreSQL extension unavailable in the isolated image."
            elif "does not exist" in diagnostic:
                reason = "archive references a schema object unavailable in ordinary PostgreSQL; restore stopped."
            elif "permission denied" in diagnostic:
                reason = "the isolated PostgreSQL role cannot create an archive object required for restore."
            else:
                reason = "PostgreSQL rejected an archive object; detailed SQL diagnostics were suppressed."
        elif stage == "GRANTS":
            diagnostic = result.stderr.decode("utf-8", errors="ignore").lower()
            if "does not exist" in diagnostic and "bootstrap_telegram_login" in diagnostic:
                reason = "the six-argument bootstrap function required by runtime grants remains absent after local migration replay."
            elif "does not exist" in diagnostic and "chat_participant_public_profile" in diagnostic:
                reason = "the chat participant profile function required by runtime grants remains absent after local migration replay."
            elif "function" in diagnostic and "does not exist" in diagnostic:
                reason = "the runtime grants script references a function absent from the restored target; runtime grants remain unverified."
        raise RestoreSmokeError(stage, reason)
    return result


def _verify_container(container_name: str, run_id: str) -> None:
    result = _docker(
        ["inspect", "--format", "{{json .}}", container_name],
        stage="ISOLATION",
        reason="could not verify the new disposable container identity.",
    )
    try:
        inspected = json.loads(result.stdout)
        host = inspected["HostConfig"]
        config = inspected["Config"]
        valid = (
            inspected["Name"] == f"/{container_name}"
            and config["Image"] == POSTGRES_IMAGE
            and config["Labels"][CONTAINER_LABEL_KEY] == run_id
            and host["NetworkMode"] == "none"
            and not host.get("PortBindings")
            and not host.get("Binds")
        )
    except Exception:
        valid = False
    if not valid:
        raise RestoreSmokeError("ISOLATION", "container is not the isolated disposable target created by this run.")


def _wait_for_postgres(container_name: str) -> None:
    for _attempt in range(45):
        try:
            result = subprocess.run(
                ["docker", "exec", container_name, "pg_isready", "--username=postgres", "--dbname=postgres"],
                capture_output=True,
                check=False,
                timeout=5,
            )
        except Exception:
            raise RestoreSmokeError("DOCKER", "the isolated PostgreSQL service could not be checked.") from None
        if result.returncode == 0:
            return
        time.sleep(1)
    raise RestoreSmokeError("DOCKER", "the isolated PostgreSQL service did not become ready.")


def _psql(container_name: str, database: str, sql: str, *, stage: str, reason: str) -> str:
    result = _docker(
        [
            "exec", "-i", container_name, "psql", "-X", "-A", "-t",
            "-v", "ON_ERROR_STOP=1", "--username=postgres", f"--dbname={database}",
            f"--command={sql}",
        ],
        stage=stage,
        reason=reason,
        timeout=120,
    )
    try:
        return result.stdout.decode("utf-8", errors="strict").strip()
    except UnicodeError:
        raise RestoreSmokeError(stage, reason) from None


def _read_only_inventory_sql(expected_functions: tuple[str, ...] = ARCHIVE_EXPECTED_FUNCTIONS) -> str:
    sql_literal = lambda value: "'" + value.replace("'", "''") + "'"
    table_values = ", ".join("(" + sql_literal(name) + ")" for name in sorted(EXPECTED_PUBLIC_TABLES))
    function_values = ", ".join("(" + sql_literal(signature) + ")" for signature in expected_functions)
    trigger_values = ", ".join("(" + sql_literal(name) + ")" for name in sorted(EXPECTED_TRIGGERS))
    return f"""
WITH expected_tables(table_name) AS (VALUES {table_values}),
expected_functions(signature) AS (VALUES {function_values}),
expected_triggers(trigger_name) AS (VALUES {trigger_values})
SELECT json_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'tables', (SELECT COALESCE(json_agg(c.relname ORDER BY c.relname), '[]'::json)
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')),
  'constraint_count', (SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relnamespace = 'public'::regnamespace),
  'index_count', (SELECT count(*) FROM pg_index idx JOIN pg_class c ON c.oid = idx.indrelid
    WHERE c.relnamespace = 'public'::regnamespace),
  'trigger_names', (SELECT COALESCE(json_agg(t.tgname ORDER BY t.tgname), '[]'::json)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal),
  'function_count', (SELECT count(*) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'),
  'expected_functions_present', (SELECT COALESCE(bool_and(to_regprocedure(signature) IS NOT NULL), false)
    FROM expected_functions),
  'missing_functions', (SELECT COALESCE(json_agg(signature ORDER BY signature), '[]'::json)
    FROM expected_functions WHERE to_regprocedure(signature) IS NULL),
  'expected_triggers_present', (SELECT COALESCE(bool_and(EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgname = trigger_name
  )), false) FROM expected_triggers),
  'rls_table_count', (SELECT count(*) FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity),
  'policy_count', (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace),
  'expected_policy_count', (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace AND p.polname IN (
      'profiles_select_own','profiles_insert_own','profiles_update_own',
      'user_activity_states_select_own','travel_intents_select_own_active',
      'travel_intents_insert_own_active','travel_intents_update_own_active',
      'user_sessions_select_own','user_sessions_update_own',
      'discover_interest_decisions_select_own','matches_select_participant',
      'chats_select_active_participant','chat_participants_select_active_chat',
      'messages_select_active_participant','trips_select_active_participant',
      'trip_participants_select_active_trip','trip_stops_select_active_participant'
    )),
  'all_expected_tables_rls_enabled', (SELECT count(*) = 17 AND bool_and(c.relrowsecurity)
    FROM expected_tables e LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace
      AND c.relname = e.table_name AND c.relkind IN ('r','p'))
)::text;
""".strip()


def _row_count_sql() -> str:
    table_counts = " UNION ALL ".join(
        f'SELECT count(*)::bigint AS row_count FROM public."{name}"'
        for name in sorted(EXPECTED_PUBLIC_TABLES)
    )
    return f"SELECT COALESCE(sum(row_count), 0)::bigint FROM ({table_counts}) counts"


def normalize_schema_dump(dump: str) -> str:
    lines = dump.splitlines()
    normalized = [
        line for line in lines
        if re.match(r"^\\(?:restrict|unrestrict)(?:[ \t]|$)", line) is None
        and not line.startswith((
            "-- PostgreSQL database dump",
            "-- Dumped from database version",
            "-- Dumped by pg_dump version",
            "-- Name:",
            "-- Type:",
            "-- Schema:",
            "-- Owner:",
        ))
    ]
    return "\n".join(normalized) + ("\n" if dump.endswith("\n") else "")


def schema_diff_categories(source: str, restored: str) -> list[str]:
    categories: set[str] = set()
    for line in difflib.unified_diff(source.splitlines(), restored.splitlines()):
        if not line.startswith(("+", "-")) or line.startswith(("+++", "---")):
            continue
        statement = line[1:].lstrip()
        if statement.startswith("--"):
            if statement.startswith((
                "-- PostgreSQL database dump",
                "-- Dumped from database version",
                "-- Dumped by pg_dump version",
                "-- Name:",
                "-- Type:",
                "-- Schema:",
                "-- Owner:",
            )):
                categories.add("DUMP_METADATA_COMMENT")
            elif statement == "--":
                categories.add("DUMP_SEPARATOR_COMMENT")
            else:
                categories.add("COMMENT")
        elif statement.startswith("COMMENT ON"):
            object_type = re.match(r"COMMENT ON ([A-Za-z]+)", statement)
            categories.add("COMMENT_ON:" + object_type.group(1) if object_type else "COMMENT_ON:OTHER")
        elif match := re.match(r"([A-Za-z]+)", statement):
            categories.add(match.group(1).upper())
        elif statement.startswith("\\"):
            command = re.match(r"\\([A-Za-z]+)", statement)
            categories.add("PSQL:" + command.group(1).lower() if command else "PSQL:OTHER")
        elif not statement:
            categories.add("BLANK")
        else:
            categories.add("OTHER")
    return sorted(categories)


def validate_structure(
    summary: dict[str, Any],
    expected_database: str,
    aggregate_rows: int | None = None,
    expected_functions: tuple[str, ...] = ARCHIVE_EXPECTED_FUNCTIONS,
) -> None:
    tables = summary.get("tables")
    triggers = summary.get("trigger_names")
    version = summary.get("server_version")
    major = re.match(r"^(\d+)(?:\.|$)", version) if isinstance(version, str) else None
    failures: list[str] = []
    if summary.get("database") != expected_database:
        failures.append("TARGET")
    if major is None or int(major.group(1)) != EXPECTED_POSTGRES_MAJOR:
        failures.append("VERSION")
    if not isinstance(tables, list) or set(tables) != EXPECTED_PUBLIC_TABLES:
        failures.append("TABLES")
    if not isinstance(summary.get("constraint_count"), int) or summary["constraint_count"] <= 0:
        failures.append("CONSTRAINTS")
    if not isinstance(summary.get("index_count"), int) or summary["index_count"] <= 0:
        failures.append("INDEXES")
    if not isinstance(triggers, list) or set(triggers) != EXPECTED_TRIGGERS or summary.get("expected_triggers_present") is not True:
        failures.append("TRIGGERS")
    missing_functions = summary.get("missing_functions", [])
    if summary.get("expected_functions_present") is not True:
        if isinstance(missing_functions, list) and missing_functions:
            failures.append("FUNCTIONS: missing " + ", ".join(missing_functions))
        else:
            failures.append("FUNCTIONS")
    if summary.get("function_count") != len(expected_functions):
        failures.append("FUNCTION_COUNT")
    if summary.get("rls_table_count") != len(EXPECTED_PUBLIC_TABLES) or summary.get("all_expected_tables_rls_enabled") is not True:
        failures.append("RLS")
    if summary.get("policy_count") != 17 or summary.get("expected_policy_count") != 17:
        failures.append("POLICIES")
    if failures:
        table_count = len(tables) if isinstance(tables, list) else 0
        trigger_count = len(triggers) if isinstance(triggers, list) else 0
        counts = (
            f"aggregates tables={table_count}/17 constraints={summary.get('constraint_count', 0)} "
            f"indexes={summary.get('index_count', 0)} triggers={trigger_count}/3 "
            f"functions={summary.get('function_count', 0)} RLS={summary.get('rls_table_count', 0)}/17 "
            f"policies={summary.get('policy_count', 0)}"
        )
        if aggregate_rows is not None:
            counts += f" aggregate_rows={aggregate_rows}"
        raise RestoreSmokeError("STRUCTURE", "restored inventory failed checks: " + "; ".join(failures) + f". {counts}.")


VERIFIER_SECTIONS = {
    ("is_public_usage_granted", "is_public_create_absent"): "schema",
    ("table_name", "privilege_type", "table_exists", "expected", "actual_effective", "is_exact"): "table_rights",
    ("table_name", "column_name", "privilege_type", "column_exists", "actual_granted", "is_exact"): "column_rights",
    ("sequence_name", "privilege_type", "unexpected_effective_privilege", "is_absent"): "sequences",
    ("function_signature", "execute_granted", "is_expected"): "capabilities",
    ("unexpected_function_signature", "unexpected_execute"): "unexpected_functions",
    ("table_name", "owner_role", "is_not_owned_by_app_runtime"): "owners",
    ("table_name", "rls_enabled", "is_not_owned_by_app_runtime", "actual_policy_count", "expected_policy_count", "is_rls_enabled", "is_not_owned", "is_expected_policy_count"): "policies",
    ("is_nobypassrls", "is_nosuperuser", "is_nocreaterole", "is_nocreatedb", "is_noreplication"): "role_attributes",
}


def validate_grants_verifier_csv(output: str) -> None:
    sections: dict[str, list[dict[str, str]]] = {section: [] for section in VERIFIER_SECTIONS.values()}
    seen_sections: set[str] = set()
    current_section: str | None = None
    current_header: list[str] = []
    try:
        rows = csv.reader(io.StringIO(output))
        for row in rows:
            header_section = VERIFIER_SECTIONS.get(tuple(row))
            if header_section is not None:
                current_section = header_section
                current_header = row
                seen_sections.add(header_section)
                continue
            if not row:
                continue
            if current_section is None or len(row) != len(current_header):
                raise ValueError
            sections[current_section].append(dict(zip(current_header, row, strict=True)))
    except Exception:
        raise RestoreSmokeError("GRANTS", "the runtime grants verifier output could not be validated safely.") from None

    if seen_sections != set(sections):
        raise RestoreSmokeError("GRANTS", "the runtime grants verifier returned an incomplete result set.")
    if sections["unexpected_functions"]:
        raise RestoreSmokeError("GRANTS", "the runtime role has unexpected function execution privileges.")
    if len(sections["table_rights"]) != len(EXPECTED_PUBLIC_TABLES) * 7:
        raise RestoreSmokeError("GRANTS", "the runtime grants verifier did not cover all application tables.")
    if len(sections["owners"]) != len(EXPECTED_PUBLIC_TABLES) or len(sections["policies"]) != len(EXPECTED_PUBLIC_TABLES):
        raise RestoreSmokeError("GRANTS", "the runtime grants verifier did not cover all application tables.")
    if len(sections["capabilities"]) != 18:
        raise RestoreSmokeError("GRANTS", "the runtime capability grant inventory was incomplete.")

    for section, rows in sections.items():
        if section == "unexpected_functions":
            continue
        for row in rows:
            if any(value != "t" for column, value in row.items() if column.startswith("is_")):
                raise RestoreSmokeError("GRANTS", "the runtime grant or role security checks did not pass.")
    if any(row.get("execute_granted") != "t" for row in sections["capabilities"]):
        raise RestoreSmokeError("GRANTS", "one or more required runtime capabilities are not executable.")
    if any(
        row.get("unexpected_effective_privilege") != "f" or row.get("is_absent") != "t"
        for row in sections["sequences"]
    ):
        raise RestoreSmokeError("GRANTS", "unexpected sequence privileges were found for the runtime role.")
    if any(
        row.get("actual_policy_count") != row.get("expected_policy_count")
        for row in sections["policies"]
    ):
        raise RestoreSmokeError("GRANTS", "the runtime grant verifier found an unexpected policy inventory.")


def _container_name() -> tuple[str, str]:
    suffix = secrets.token_hex(6)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"tf-backup-restore-{timestamp}-{suffix}", suffix


def _container_create_command(container_name: str, run_id: str) -> list[str]:
    return [
        "run", "--detach", "--rm", "--network=none", "--name", container_name,
        "--label", f"{CONTAINER_LABEL_KEY}={run_id}",
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust", POSTGRES_IMAGE,
    ]


def _cleanup_task_container(container_name: str, run_id: str) -> None:
    names = _container_names(container_name)
    if not names:
        return
    if names != [container_name]:
        raise RestoreSmokeError("CLEANUP", "container name lookup was ambiguous; no container was removed.")

    # Revalidate the per-run label and isolation before any cleanup action.
    _verify_container(container_name, run_id)
    try:
        _docker(
            ["stop", container_name],
            stage="CLEANUP",
            reason="the task-created disposable container could not be stopped.",
            timeout=60,
        )
    except RestoreSmokeError:
        remaining_names = _container_names(container_name)
        if not remaining_names:
            return
        if remaining_names != [container_name]:
            raise RestoreSmokeError("CLEANUP", "container name lookup was ambiguous; no container was removed.")
        # The target was just revalidated, so force-removal remains scoped to
        # this unique, per-run labeled container only.
        _verify_container(container_name, run_id)
        _docker(
            ["rm", "--force", container_name],
            stage="CLEANUP",
            reason="the verified task-created disposable container could not be removed.",
            timeout=60,
        )
    remaining_names = _container_names(container_name)
    if remaining_names:
        if remaining_names != [container_name]:
            raise RestoreSmokeError("CLEANUP", "container name lookup was ambiguous; no further cleanup was attempted.")
        _verify_container(container_name, run_id)
        _docker(
            ["rm", "--force", container_name],
            stage="CLEANUP",
            reason="the verified task-created disposable container remained after stop.",
            timeout=60,
        )
        if _container_names(container_name):
            raise RestoreSmokeError("CLEANUP", "the task-created disposable container remains after cleanup.")


def _container_names(container_name: str) -> list[str]:
    listed = _docker(
        ["ps", "--all", "--filter", f"name=^/{container_name}$", "--format", "{{.Names}}"],
        stage="CLEANUP",
        reason="could not determine whether the task-created disposable container remains.",
    )
    return [line for line in listed.stdout.decode("utf-8", errors="strict").splitlines() if line]


def _repository_migrations_not_in_archive(
    manifest: dict[str, Any], migration_directory: Path | None = None
) -> list[Path]:
    directory = migration_directory or REPOSITORY_ROOT / "supabase" / "migrations"
    ledger = manifest["observations"]["migration_ledger"]["versions"]
    archived_versions = {item["version"] for item in ledger}
    repository_files = sorted(directory.glob("*.sql"))
    by_version = {path.name.split("_", 1)[0]: path for path in repository_files}
    if len(by_version) != len(repository_files):
        raise RestoreSmokeError("MIGRATIONS", "repository migration versions are ambiguous.")

    for item in ledger:
        path = by_version.get(item["version"])
        if path is None or path.stem.split("_", 1)[1] != item["name"]:
            raise RestoreSmokeError("MIGRATIONS", "archive migration ledger does not match repository migration files.")

    missing = [path for version, path in sorted(by_version.items()) if version not in archived_versions]
    if archived_versions:
        latest_archived = max(archived_versions)
        if any(path.name.split("_", 1)[0] < latest_archived for path in missing):
            raise RestoreSmokeError("MIGRATIONS", "repository has a migration gap before the archive ledger tip.")
    return missing


def _replay_repository_migrations(
    container_name: str, database: str, manifest: dict[str, Any]
) -> list[Path]:
    migration_paths = _repository_migrations_not_in_archive(manifest)
    if not migration_paths:
        return []
    try:
        migration_sql = b"\n".join(path.read_bytes() for path in migration_paths)
    except Exception:
        raise RestoreSmokeError("MIGRATIONS", "repository migrations could not be read safely.") from None
    _docker(
        [
            "exec", "-i", container_name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "--single-transaction", "--username=postgres", f"--dbname={database}",
        ],
        stage="MIGRATIONS",
        reason="repository migrations could not be replayed in the disposable restore.",
        input_data=migration_sql,
        timeout=120,
    )
    return migration_paths


def _repository_public_function_revokes(migration_directory: Path | None = None) -> list[str]:
    directory = migration_directory or REPOSITORY_ROOT / "supabase" / "migrations"
    statements: list[str] = []
    try:
        for path in sorted(directory.glob("*.sql")):
            statements.extend(PUBLIC_FUNCTION_REVOKE_PATTERN.findall(path.read_text(encoding="utf-8")))
    except Exception:
        raise RestoreSmokeError("GRANTS", "repository migration privilege rules could not be read safely.") from None
    if not statements:
        raise RestoreSmokeError("GRANTS", "repository has no explicit public function hardening rules.")
    return statements


def _apply_repository_public_function_revokes(container_name: str, database: str) -> int:
    statements = _repository_public_function_revokes()
    _docker(
        [
            "exec", "-i", container_name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "--single-transaction", "--username=postgres", f"--dbname={database}",
        ],
        stage="GRANTS",
        reason="migration-declared public function hardening could not be applied to the disposable restore.",
        input_data="\n".join(statements).encode("utf-8"),
        timeout=120,
    )
    return len(statements)


def _restore_command(container_name: str, database: str) -> list[str]:
    return [
        "exec", "-i", container_name, "pg_restore", "--no-owner", "--no-acl",
        "--exit-on-error", "--single-transaction", "--username=postgres", f"--dbname={database}",
    ]


def run_smoke(archive_path: Path, manifest_path: Path) -> int:
    manifest = validate_archive(archive_path, manifest_path)
    container_name, suffix = _container_name()
    database = f"{EXPECTED_DATABASE_PREFIX}{suffix}"
    container_creation_attempted = False
    outcome: RestoreSmokeError | None = None
    partial_summary: list[str] = []
    success_summary: list[str] | None = None

    try:
        container_creation_attempted = True
        _docker(
            _container_create_command(container_name, suffix),
            stage="DOCKER",
            reason="could not create the isolated disposable PostgreSQL container.",
        )
        _verify_container(container_name, suffix)
        _wait_for_postgres(container_name)

        pg_restore_version = _docker(
            ["exec", container_name, "pg_restore", "--version"],
            stage="POSTGRESQL",
            reason="could not verify local PostgreSQL restore tools.",
        ).stdout.decode("utf-8", errors="replace")
        client_major = re.search(r"\b(\d+)(?:\.|$)", pg_restore_version)
        server_version = _psql(
            container_name,
            "postgres",
            "SELECT current_setting('server_version')",
            stage="POSTGRESQL",
            reason="could not verify the isolated PostgreSQL server version.",
        )
        server_major = re.match(r"^(\d+)(?:\.|$)", server_version)
        if (
            client_major is None
            or int(client_major.group(1)) != EXPECTED_POSTGRES_MAJOR
            or server_major is None
            or int(server_major.group(1)) != EXPECTED_POSTGRES_MAJOR
        ):
            raise RestoreSmokeError("POSTGRESQL", "local restore client and server must both use PostgreSQL 17.")

        with archive_path.open("rb") as source_archive:
            pg_restore_list = _docker(
                ["exec", "-i", container_name, "pg_restore", "--list"],
                stage="ARCHIVE",
                reason="the custom archive could not be read by PostgreSQL 17 tools.",
                stdin_file=source_archive,
            )
        if not pg_restore_list.stdout.strip():
            raise RestoreSmokeError("ARCHIVE", "the custom archive has no readable table of contents.")

        dependency_metadata = manifest["observations"]["metadata"]["extension_restore_dependencies"]
        installed_extensions = json.loads(_psql(
            container_name,
            "postgres",
            "SELECT COALESCE(json_agg(extname ORDER BY extname), '[]'::json)::text FROM pg_extension",
            stage="DEPENDENCY",
            reason="local PostgreSQL extension dependencies could not be checked.",
        ))
        for dependency in dependency_metadata:
            name = dependency["name"]
            if name not in installed_extensions:
                safe_name = name if re.fullmatch(r"[A-Za-z0-9_-]{1,63}", name) else "unrecognized"
                raise RestoreSmokeError("DEPENDENCY", f"required extension dependency {safe_name} is unavailable in the isolated PostgreSQL 17 image.")

        exists = _psql(
            container_name,
            "postgres",
            f"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '{database}')",
            stage="TARGET",
            reason="the new restore database target could not be verified.",
        )
        if exists != "f":
            raise RestoreSmokeError("TARGET", "the unique restore database already exists; refusing to overwrite it.")
        _docker(
            ["exec", container_name, "createdb", "--template=template0", "--username=postgres", database],
            stage="TARGET",
            reason="could not create the unique empty restore database.",
        )
        if _psql(
            container_name,
            database,
            "SELECT current_database()",
            stage="TARGET",
            reason="could not confirm the newly created restore database.",
        ) != database:
            raise RestoreSmokeError("TARGET", "the active database is not the unique target created by this run.")

        public_exists = _psql(
            container_name,
            database,
            "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')",
            stage="TARGET",
            reason="the empty restore target schema could not be checked.",
        )
        if public_exists == "t":
            _psql(
                container_name,
                database,
                "DROP SCHEMA public CASCADE",
                stage="TARGET",
                reason="could not prepare public schema in the newly created restore database.",
            )
        elif public_exists != "f":
            raise RestoreSmokeError("TARGET", "the restore target public schema state was ambiguous.")

        role_exists = _psql(
            container_name,
            "postgres",
            "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime')",
            stage="GRANTS",
            reason="the isolated runtime role state could not be checked.",
        )
        if role_exists != "f":
            raise RestoreSmokeError("GRANTS", "app_runtime already exists in the new container; refusing implicit role replacement.")
        _psql(
            container_name,
            "postgres",
            "CREATE ROLE app_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION",
            stage="GRANTS",
            reason="the known app_runtime role could not be prepared in the disposable cluster.",
        )

        with archive_path.open("rb") as source_archive:
            _docker(
                _restore_command(container_name, database),
                stage="RESTORE",
                reason="schema/data restore failed in isolated PostgreSQL; subprocess diagnostics were suppressed.",
                stdin_file=source_archive,
                timeout=1800,
            )

        with archive_path.open("rb") as source_archive:
            # The archive itself is read from stdin; --file=- directs the
            # generated schema SQL to stdout and is not an input filename.
            archive_schema = _docker(
                [
                    "exec", "-i", container_name, "pg_restore", "--schema-only", "--no-owner",
                    "--no-acl", "--file=-",
                ],
                stage="STRUCTURE",
                reason="schema-only archive inventory could not be read safely.",
                stdin_file=source_archive,
                timeout=300,
            ).stdout.decode("utf-8", errors="strict")
        restored_schema = _docker(
            [
                "exec", container_name, "pg_dump", "--schema-only", "--schema=public",
                "--no-owner", "--no-privileges", "--username=postgres", f"--dbname={database}",
            ],
            stage="STRUCTURE",
            reason="restored schema-only inventory could not be read safely.",
            timeout=300,
        ).stdout.decode("utf-8", errors="strict")
        normalized_archive_schema = normalize_schema_dump(archive_schema)
        normalized_restored_schema = normalize_schema_dump(restored_schema)
        if normalized_archive_schema != normalized_restored_schema:
            categories = ", ".join(schema_diff_categories(normalized_archive_schema, normalized_restored_schema))
            raise RestoreSmokeError("STRUCTURE", f"schema-only archive and restored database differ ({categories}); SQL diff suppressed.")

        try:
            summary = json.loads(_psql(
                container_name,
                database,
                _read_only_inventory_sql(),
                stage="STRUCTURE",
                reason="restored structural inventory could not be read safely.",
            ))
        except RestoreSmokeError:
            raise
        except Exception:
            raise RestoreSmokeError("STRUCTURE", "restored structural inventory could not be parsed safely.") from None
        try:
            aggregate_rows = int(_psql(
                container_name,
                database,
                _row_count_sql(),
                stage="DATA",
                reason="aggregate restored row count could not be checked.",
            ))
        except RestoreSmokeError:
            raise
        except Exception:
            raise RestoreSmokeError("DATA", "aggregate restored row count was invalid.") from None
        if aggregate_rows < 0:
            raise RestoreSmokeError("DATA", "aggregate restored row count was invalid.")
        validate_structure(summary, database, aggregate_rows)
        partial_summary = [
            "Archive integrity: PASS (manifest size and SHA-256).",
            f"Local PostgreSQL: {server_version} (isolated Docker network; client major {EXPECTED_POSTGRES_MAJOR}).",
            "Schema/data restore: PASS (--no-owner --no-acl; --exit-on-error; separate empty database).",
            f"Public tables: {len(summary['tables'])}/{len(EXPECTED_PUBLIC_TABLES)}.",
            f"Aggregate restored public rows: {aggregate_rows} (restored database only; no source-count comparison).",
            f"Structure: PASS (schema-only equality; constraints {summary['constraint_count']}, indexes {summary['index_count']}, triggers {len(summary['trigger_names'])}, functions {summary['function_count']}).",
            f"RLS/policies: PASS ({summary['rls_table_count']}/{len(EXPECTED_PUBLIC_TABLES)} tables, {summary['policy_count']} policies).",
            "Archive-era expected objects: PASS; manifest records 19 migrations.",
        ]

        repository_migrations = _replay_repository_migrations(container_name, database, manifest)
        current_summary = json.loads(_psql(
            container_name,
            database,
            _read_only_inventory_sql(CURRENT_APP_EXPECTED_FUNCTIONS),
            stage="MIGRATIONS",
            reason="the post-migration application inventory could not be checked safely.",
        ))
        validate_structure(
            current_summary,
            database,
            aggregate_rows,
            expected_functions=CURRENT_APP_EXPECTED_FUNCTIONS,
        )
        migration_summary = (
            f"Current application migrations: PASS ({len(repository_migrations)} repository migrations "
            f"absent from the archive replayed only in disposable DB; functions {current_summary['function_count']})."
        )
        partial_summary.append(migration_summary)
        revoke_count = _apply_repository_public_function_revokes(container_name, database)
        partial_summary.append(
            f"Migration-declared PUBLIC function revokes: PASS ({revoke_count} statements applied only in disposable DB)."
        )

        grants_path = REPOSITORY_ROOT / "apps" / "backend" / "scripts" / "grant-production-app-runtime-privileges.sql"
        verifier_path = REPOSITORY_ROOT / "apps" / "backend" / "scripts" / "verify-production-app-runtime-privileges.sql"
        try:
            grants_sql = grants_path.read_bytes()
            verifier_sql = verifier_path.read_bytes()
        except Exception:
            raise RestoreSmokeError("GRANTS", "the existing runtime grants scripts could not be read.") from None
        _docker(
            ["exec", "-i", container_name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "--username=postgres", f"--dbname={database}"],
            stage="GRANTS",
            reason="the existing app_runtime grants script failed on the disposable restore.",
            input_data=grants_sql,
            timeout=120,
        )
        verifier = _docker(
            ["exec", "-i", container_name, "psql", "--csv", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--username=postgres", f"--dbname={database}"],
            stage="GRANTS",
            reason="the existing app_runtime grants verifier failed on the disposable restore.",
            input_data=verifier_sql,
            timeout=120,
        )
        try:
            validate_grants_verifier_csv(verifier.stdout.decode("utf-8", errors="strict"))
        except UnicodeError:
            raise RestoreSmokeError("GRANTS", "the runtime grants verifier output could not be validated safely.") from None

        success_summary = [
            *partial_summary,
            "app_runtime grants: PASS (existing grants script and read-only verifier).",
            "Production Supabase ACL restoration: NOT VERIFIED; --no-acl excluded source ACLs.",
        ]
    except RestoreSmokeError as error:
        outcome = error
    except Exception:
        outcome = RestoreSmokeError("SMOKE", "unexpected local restore smoke failure; diagnostics were suppressed.")
    finally:
        if container_creation_attempted:
            try:
                _cleanup_task_container(container_name, suffix)
            except RestoreSmokeError as cleanup_error:
                if outcome is None:
                    outcome = cleanup_error
                else:
                    print(f"Cleanup STOP [{cleanup_error.stage}]: {cleanup_error.reason}", file=sys.stderr)
    if outcome is not None:
        for line in partial_summary:
            print(line)
        print(f"STOP [{outcome.stage}]: {outcome.reason}", file=sys.stderr)
        return 1
    if success_summary is None:
        print("STOP [SMOKE]: restore smoke did not complete.", file=sys.stderr)
        return 1
    for line in success_summary:
        print(line)
    return 0


def main(argv: list[str] | None = None) -> int:
    default_archive, default_manifest = _default_paths()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=default_archive)
    parser.add_argument("--manifest", type=Path, default=default_manifest)
    args = parser.parse_args(argv)
    signal.signal(signal.SIGINT, _handle_termination)
    signal.signal(signal.SIGTERM, _handle_termination)
    try:
        return run_smoke(args.archive, args.manifest)
    except KeyboardInterrupt:
        print("STOP [CLEANUP]: interrupted; task container cleanup was attempted.", file=sys.stderr)
        return 130


def _handle_termination(_signum: int, _frame: Any) -> None:
    raise KeyboardInterrupt


if __name__ == "__main__":
    raise SystemExit(main())
