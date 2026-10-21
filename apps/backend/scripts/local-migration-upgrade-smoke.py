#!/usr/bin/env python3
"""Replay the verified 19-to-24 migration path on a task-owned local database."""

from __future__ import annotations

import importlib.util
import csv
import io
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

import psycopg


SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[3]
BACKEND_ROOT = SCRIPT_PATH.parents[1]
MIGRATIONS_DIR = REPOSITORY_ROOT / "supabase" / "migrations"
BACKUP_DIRECTORY = Path.home() / ".local" / "share" / "travel-friend" / "backups" / "20261018T142642Z-0b41eb45"
ARCHIVE_PATH = BACKUP_DIRECTORY / "public.dump"
MANIFEST_PATH = BACKUP_DIRECTORY / "manifest.json"
POSTGRES_IMAGE = "postgres:17-alpine"
CLI_PACKAGE = "supabase@2.114.0"
CONTAINER_LABEL_KEY = "com.travel-friend.disposable-migration-upgrade"
EXPECTED_APPLIED_COUNT = 19
EXPECTED_PENDING_NAMES = (
    "20260924090000_completed_onboarding_active_travel_intent_invariant.sql",
    "20260924100000_session_lifecycle_baseline.sql",
    "20260924110000_backend_field_domain_limits.sql",
    "20261003090000_chat_participant_public_profile.sql",
    "20261018090000_server_side_tester_admission_session_identity.sql",
)
EXPECTED_DATABASE_PREFIX = "tf_restore_"
DDL_OPTIONS = "-c lock_timeout=5s -c statement_timeout=120s"
CLI_DB_PUSH_TIMEOUT_SECONDS = 600
PROCESS_TERMINATION_GRACE_SECONDS = 2
DOCKER_CONTEXT_NAME: str | None = None


class UpgradeSmokeError(RuntimeError):
    """A stage-specific, redacted local smoke failure."""

    def __init__(self, stage: str, reason: str) -> None:
        self.stage = stage
        self.reason = reason
        super().__init__(reason)


class ProcessTimeoutError(UpgradeSmokeError):
    """A subprocess exceeded its bounded runtime; output is retained only for redacted diagnostics."""

    def __init__(
        self, stage: str, timeout: int, process_group_cleanup: bool,
        stdout: bytes = b"", stderr: bytes = b"",
    ) -> None:
        self.timeout = timeout
        self.process_group_cleanup = process_group_cleanup
        self.stdout = stdout
        self.stderr = stderr
        cleanup = "PASS" if process_group_cleanup else "FAILED"
        super().__init__(stage, f"subprocess timeout after {timeout}s; process_group_cleanup={cleanup}.")


def _load_restore_smoke() -> Any:
    helper_path = BACKEND_ROOT / "scripts" / "local-production-backup-restore-smoke.py"
    spec = importlib.util.spec_from_file_location("local_production_backup_restore_smoke", helper_path)
    if spec is None or spec.loader is None:
        raise UpgradeSmokeError("PREFLIGHT", "the existing archive validator could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RESTORE_SMOKE = _load_restore_smoke()


def _process_group_exists(process_id: int) -> bool:
    if os.name != "posix":
        return process_id is not None
    try:
        os.killpg(process_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _signal_process_group(process: Any, sig: int) -> bool:
    try:
        if os.name == "posix":
            os.killpg(process.pid, sig)
        elif sig == signal.SIGTERM:
            process.terminate()
        else:
            process.kill()
        return True
    except ProcessLookupError:
        return True
    except Exception:
        return False


def _terminate_process_group(process: Any, input_data: bytes | None) -> tuple[bool, bytes, bytes]:
    """Stop only the new-session process group created for this subprocess call."""
    term_sent = _signal_process_group(process, signal.SIGTERM)
    try:
        stdout, stderr = process.communicate(input=input_data, timeout=PROCESS_TERMINATION_GRACE_SECONDS)
    except subprocess.TimeoutExpired as error:
        stdout = error.output or b""
        stderr = error.stderr or b""
    except Exception:
        stdout, stderr = b"", b""

    if _process_group_exists(process.pid):
        kill_sent = _signal_process_group(process, signal.SIGKILL)
        try:
            final_stdout, final_stderr = process.communicate(timeout=5)
            stdout = final_stdout or stdout
            stderr = final_stderr or stderr
        except Exception:
            kill_sent = False
        group_gone = not _process_group_exists(process.pid)
    else:
        kill_sent = True
        group_gone = True
    return term_sent and kill_sent and group_gone, stdout, stderr


def _run(
    command: list[str],
    *,
    stage: str,
    reason: str,
    input_data: bytes | None = None,
    timeout: int = 120,
    env: dict[str, str] | None = None,
    cwd: Path = REPOSITORY_ROOT,
) -> tuple[int, bytes, bytes]:
    process_env = env
    if command and command[0] == "docker":
        process_env = dict(env if env is not None else os.environ)
        process_env.pop("DOCKER_HOST", None)
        process_env.pop("DOCKER_CONTEXT", None)
        if DOCKER_CONTEXT_NAME is not None:
            process_env["DOCKER_CONTEXT"] = DOCKER_CONTEXT_NAME
    process = None
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE if input_data is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=process_env,
            cwd=cwd,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(input=input_data, timeout=timeout)
        except subprocess.TimeoutExpired:
            group_cleaned, stdout, stderr = _terminate_process_group(process, input_data=None)
            raise ProcessTimeoutError(stage, timeout, group_cleaned, stdout, stderr) from None
    except ProcessTimeoutError:
        raise
    except Exception:
        if process is not None and process.poll() is None:
            _terminate_process_group(process, input_data=None)
        raise UpgradeSmokeError(stage, reason) from None
    return process.returncode, stdout, stderr


def verify_cli_version() -> str:
    code, stdout, _ = _run(
        ["npx", "--yes", CLI_PACKAGE, "--version"],
        stage="CLI",
        reason="Supabase CLI 2.114.0 could not be started; no database actions were run.",
        timeout=180,
    )
    version = stdout.decode("utf-8", errors="replace").strip()
    if code != 0 or re.fullmatch(r"(?:supabase\s+)?2\.114\.0", version) is None:
        raise UpgradeSmokeError("CLI", "the workflow requires an exact Supabase CLI 2.114.0 version match.")
    return "2.114.0"


def verify_docker_and_image() -> str:
    global DOCKER_CONTEXT_NAME
    if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
        raise UpgradeSmokeError("DOCKER", "explicit Docker endpoint overrides are set; the local engine could not be established safely.")
    context_code, context_stdout, _ = _run(
        ["docker", "context", "show"],
        stage="DOCKER",
        reason="the active Docker context could not be identified.",
        timeout=20,
    )
    context_name = context_stdout.decode("utf-8", errors="replace").strip()
    if context_code != 0 or not context_name:
        raise UpgradeSmokeError("DOCKER", "the active Docker context could not be identified.")
    endpoint_code, endpoint_stdout, _ = _run(
        ["docker", "context", "inspect", context_name, "--format", '{{(index .Endpoints "docker").Host}}'],
        stage="DOCKER",
        reason="the active Docker endpoint could not be verified as local.",
        timeout=20,
    )
    endpoint = endpoint_stdout.decode("utf-8", errors="replace").strip()
    if endpoint_code != 0 or not endpoint.startswith("unix://"):
        raise UpgradeSmokeError("DOCKER", "the active Docker endpoint is not a local Unix socket.")
    DOCKER_CONTEXT_NAME = context_name
    code, stdout, _ = _run(
        ["docker", "info", "--format", "{{.ServerVersion}}"],
        stage="DOCKER",
        reason="Docker Engine is unavailable to this process; no container was created.",
        timeout=20,
    )
    version = stdout.decode("utf-8", errors="replace").strip()
    if code != 0 or not version:
        raise UpgradeSmokeError("DOCKER", "Docker Engine is unavailable; no container was created.")
    image_code, _, _ = _run(
        ["docker", "image", "inspect", POSTGRES_IMAGE],
        stage="IMAGE",
        reason="the local PostgreSQL 17 image is unavailable; the workflow will not pull images.",
        timeout=30,
    )
    if image_code != 0:
        raise UpgradeSmokeError("IMAGE", "postgres:17-alpine is not present locally; automatic image pulls are disabled.")
    return version


def validate_repository_migration_sequence(manifest: dict[str, Any]) -> tuple[list[dict[str, str]], list[Path]]:
    """Match the checked manifest baseline to repository files and the exact approved suffix."""
    try:
        ledger = manifest["observations"]["migration_ledger"]
        versions = ledger["versions"]
        repository_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    except Exception:
        raise UpgradeSmokeError("MIGRATIONS", "the manifest or repository migration inventory is incomplete.") from None
    if (
        ledger.get("count") != EXPECTED_APPLIED_COUNT
        or not isinstance(versions, list)
        or len(versions) != EXPECTED_APPLIED_COUNT
        or len(repository_files) != 24
    ):
        raise UpgradeSmokeError("MIGRATIONS", "expected 19 manifest migrations and 24 repository migration files.")

    by_version: dict[str, Path] = {}
    for path in repository_files:
        version, separator, name = path.stem.partition("_")
        if not separator or re.fullmatch(r"\d{14}", version) is None or version in by_version:
            raise UpgradeSmokeError("MIGRATIONS", "repository migration filenames are invalid or ambiguous.")
        by_version[version] = path
        if not name:
            raise UpgradeSmokeError("MIGRATIONS", "repository migration filename has no migration name.")

    applied: list[dict[str, str]] = []
    for index, item in enumerate(versions):
        if not isinstance(item, dict):
            raise UpgradeSmokeError("MIGRATIONS", "manifest migration ledger contains an invalid entry.")
        version = item.get("version")
        name = item.get("name")
        path = by_version.get(version) if isinstance(version, str) else None
        if path is None or path.stem.partition("_")[2] != name:
            raise UpgradeSmokeError("MIGRATIONS", "manifest migration ledger does not match repository history.")
        if index and version <= applied[-1]["version"]:
            raise UpgradeSmokeError("MIGRATIONS", "manifest migration versions are not strictly ordered.")
        applied.append({"version": version, "name": name})

    if [path.name for path in repository_files[:EXPECTED_APPLIED_COUNT]] != [
        f"{item['version']}_{item['name']}.sql" for item in applied
    ]:
        raise UpgradeSmokeError("MIGRATIONS", "the manifest is not the ordered 19-migration repository prefix.")
    pending = repository_files[EXPECTED_APPLIED_COUNT:]
    if tuple(path.name for path in pending) != EXPECTED_PENDING_NAMES:
        raise UpgradeSmokeError("MIGRATIONS", "the repository pending suffix differs from the five approved migrations.")
    return applied, pending


def local_database_url(username: str, password: str, port: int, database: str) -> str:
    """Build a loopback-only URI; libpq reads its password from child-process env."""
    if not password:
        raise UpgradeSmokeError("TARGET", "a local disposable database password is required.")
    encoded_options = quote(DDL_OPTIONS, safe="")
    return (
        f"postgresql://{quote(username, safe='')}@127.0.0.1:{port}/"
        f"{quote(database, safe='')}?sslmode=disable&options={encoded_options}"
    )


def validate_disposable_database_url(database_url: str) -> None:
    """Fail closed unless a CLI migration command is pinned to this run's local DB."""
    try:
        parsed = urlsplit(database_url)
        query = parse_qs(parsed.query, strict_parsing=True)
        safe = (
            parsed.scheme == "postgresql"
            and parsed.hostname == "127.0.0.1"
            and parsed.username == "postgres"
            and parsed.password is None
            and parsed.port is not None and 1 <= parsed.port <= 65535
            and re.fullmatch(r"/tf_restore_[a-f0-9]{12}", parsed.path) is not None
            and query.get("sslmode") == ["disable"]
            and query.get("options") == [DDL_OPTIONS]
            and len(query) == 2
        )
    except Exception:
        safe = False
    if not safe:
        raise UpgradeSmokeError("TARGET", "Supabase CLI database target was not the expected disposable loopback database.")


def db_push_command(database_url: str, *, dry_run: bool) -> list[str]:
    validate_disposable_database_url(database_url)
    command = ["npx", "--yes", CLI_PACKAGE]
    if not dry_run:
        # Supabase CLI's root-level --yes answers command prompts noninteractively.
        command.append("--yes")
    command.extend(["db", "push"])
    if dry_run:
        command.append("--dry-run")
    return [*command, "--db-url", database_url]


def migration_repair_command(database_url: str, versions: list[dict[str, str]]) -> list[str]:
    validate_disposable_database_url(database_url)
    return [
        "npx", "--yes", CLI_PACKAGE, "migration", "repair",
        *(item["version"] for item in versions),
        "--status", "applied", "--db-url", database_url,
    ]


def _redacted_cli_lines(output: bytes, sensitive_values: list[str]) -> list[str]:
    text = output.decode("utf-8", errors="replace")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line
        for secret in sorted((value for value in sensitive_values if value), key=len, reverse=True):
            line = line.replace(secret, "[REDACTED]")
        line = re.sub(r"(?i)\b(?:postgres(?:ql)?|https?)://[^\s\"'<>]+", "[URI REDACTED]", line)
        line = re.sub(
            r"(?i)\b([A-Z0-9_-]*(?:PASSWORD|PASSWD|TOKEN|SECRET|AUTHORIZATION|API[_-]?KEY)[A-Z0-9_-]*)(\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)",
            r"\1\2[REDACTED]", line,
        )
        line = line.strip()
        if line:
            lines.append(line[:300])
    if len(lines) > 20:
        return [*lines[:20], f"[truncated {len(lines) - 20} additional CLI lines]"]
    return lines


def _dry_run_versions(lines: list[str]) -> tuple[list[str], list[str]]:
    filenames: list[str] = []
    versions: list[str] = []
    # CLI prints an ellipsis immediately after the .sql suffix, so '.' cannot
    # be treated as part of the filename boundary here.
    filename_pattern = re.compile(r"(?<!\d)(\d{14}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql)(?![A-Za-z0-9_-])")
    version_pattern = re.compile(r"(?<!\d)(\d{14})(?!\d)")
    for line in lines:
        filenames.extend(filename_pattern.findall(line))
        versions.extend(version_pattern.findall(line))
    return filenames, versions


def _cli_sensitive_values(database_url: str, password: str) -> list[str]:
    values = [database_url, password]
    values.extend(
        value for key, value in os.environ.items()
        if any(marker in key.lower() for marker in ("password", "token", "secret", "credential", "database_url", "db_url"))
    )
    return values


def validate_dry_run_result(
    exit_code: int, output: bytes, pending_names: list[str] | tuple[str, ...], sensitive_values: list[str]
) -> None:
    lines = _redacted_cli_lines(output, sensitive_values)
    actual_names, actual_versions = _dry_run_versions(lines)
    expected_names = list(pending_names)
    expected_versions = [name.split("_", 1)[0] for name in expected_names]
    expected_text = ", ".join(expected_versions) if expected_versions else "<none>"
    actual_text = ", ".join(actual_versions) if actual_versions else "<none>"
    cli_text = " | ".join(lines) if lines else "<no output>"

    if exit_code != 0:
        raise UpgradeSmokeError(
            "DRY_RUN", f"CLI_ERROR exit_code={exit_code}; expected versions [{expected_text}], "
            f"actual versions [{actual_text}]; CLI: {cli_text}.",
        )
    if actual_names == expected_names:
        return

    lower_output = " ".join(lines).lower()
    completed_empty_dry_run = "dry run:" in lower_output and "finished supabase db push" in lower_output
    if not actual_names and (completed_empty_dry_run or any(marker in lower_output for marker in (
        "up to date", "no pending migrations", "no migrations to push", "no migrations found",
    ))):
        category = "EMPTY_PENDING"
    elif not actual_names and not lines:
        category = "UNKNOWN_FORMAT"
    elif not actual_names:
        category = "UNKNOWN_FORMAT"
    elif sorted(actual_names) == sorted(expected_names):
        category = "ORDER_MISMATCH"
    else:
        category = "MIGRATION_MISMATCH"
    names_text = ", ".join(actual_names) if actual_names else "<none parsed>"
    raise UpgradeSmokeError(
        "DRY_RUN", f"{category}; exit_code=0; expected versions [{expected_text}], "
        f"actual versions [{actual_text}]; expected files [{', '.join(expected_names)}], "
        f"actual files [{names_text}]; CLI: {cli_text}.",
    )


def docker_create_command(container_name: str, run_id: str, port: int) -> list[str]:
    return [
        "docker", "run", "--detach", "--rm", "--pull=never", "--name", container_name,
        "--label", f"{CONTAINER_LABEL_KEY}={run_id}", "--network=bridge",
        "--publish", f"127.0.0.1:{port}:5432",
        "--env", "POSTGRES_USER=postgres", "--env", "POSTGRES_DB=postgres",
        "--env", "POSTGRES_PASSWORD", POSTGRES_IMAGE,
    ]


def choose_free_loopback_port() -> int:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])
    except Exception:
        raise UpgradeSmokeError("PORT", "a free loopback port could not be reserved.") from None


def validate_container_identity(
    inspected: dict[str, Any], container_name: str, run_id: str, port: int
) -> None:
    try:
        config = inspected["Config"]
        host = inspected["HostConfig"]
        env = set(config["Env"])
        bindings = host["PortBindings"]
        binding_list = bindings["5432/tcp"]
        mounts = inspected.get("Mounts", [])
        valid = (
            inspected["Name"] == f"/{container_name}"
            and config["Image"] == POSTGRES_IMAGE
            and config["Labels"][CONTAINER_LABEL_KEY] == run_id
            and "POSTGRES_USER=postgres" in env
            and "POSTGRES_DB=postgres" in env
            and any(item.startswith("POSTGRES_PASSWORD=") for item in env)
            and any(item.get("HostIp") == "127.0.0.1" and item.get("HostPort") == str(port) for item in binding_list)
            and len(binding_list) == 1
            and len(bindings) == 1
            and not host.get("Binds")
            and not host.get("Mounts")
            and isinstance(mounts, list)
            and len(mounts) <= 1
            and all(
                mount.get("Type") == "volume"
                and mount.get("Destination") == "/var/lib/postgresql/data"
                for mount in mounts
            )
            and host.get("NetworkMode") == "bridge"
            and host.get("AutoRemove") is True
        )
    except Exception:
        valid = False
    if not valid:
        raise UpgradeSmokeError("ISOLATION", "container identity or loopback-only port binding did not match this run.")


def container_exists(container_name: str) -> bool:
    code, stdout, _ = _run(
        ["docker", "ps", "--all", "--filter", f"name=^/{container_name}$", "--format", "{{.Names}}"],
        stage="CONTAINER",
        reason="Docker could not verify the per-run container name.",
    )
    names = [line.strip() for line in stdout.decode("utf-8", errors="replace").splitlines() if line.strip()]
    if code != 0 or len(names) > 1 or any(name != container_name for name in names):
        raise UpgradeSmokeError("CONTAINER", "container name lookup was ambiguous; no destructive action was taken.")
    return bool(names)


def verify_container(container_name: str, run_id: str, port: int) -> None:
    code, stdout, _ = _run(
        ["docker", "inspect", "--format", "{{json .}}", container_name],
        stage="ISOLATION",
        reason="the task-owned container configuration could not be verified.",
    )
    if code != 0:
        raise UpgradeSmokeError("ISOLATION", "the task-owned container could not be inspected.")
    try:
        validate_container_identity(json.loads(stdout), container_name, run_id, port)
    except Exception as error:
        if isinstance(error, UpgradeSmokeError):
            raise
        raise UpgradeSmokeError("ISOLATION", "the task-owned container configuration was invalid.") from None


def cleanup_container(container_name: str, run_id: str, port: int) -> None:
    if not container_exists(container_name):
        return
    verify_container(container_name, run_id, port)
    code, _, _ = _run(
        ["docker", "stop", container_name],
        stage="CLEANUP",
        reason="the verified task-owned container could not be stopped.",
        timeout=60,
    )
    if code != 0:
        raise UpgradeSmokeError("CLEANUP", "the verified task-owned container could not be stopped.")


def _wait_for_database(container_name: str, password: str) -> None:
    for _ in range(60):
        code, _, _ = _run(
            ["docker", "exec", "--env", "PGPASSWORD", container_name,
             "pg_isready", "--username=postgres", "--dbname=postgres"],
            stage="POSTGRESQL",
            reason="the new disposable PostgreSQL container did not become ready.",
            timeout=5,
            env={**os.environ, "PGPASSWORD": password},
        )
        if code == 0:
            return
        time.sleep(1)
    raise UpgradeSmokeError("POSTGRESQL", "the new disposable PostgreSQL container did not become ready in time.")


def _psql(
    container_name: str,
    password: str,
    database: str,
    sql: str,
    *,
    stage: str,
    reason: str,
    csv: bool = False,
    input_data: bytes | None = None,
    diagnostics: bool = False,
) -> str:
    output_format = ["--csv", "-q"] if csv else ["-A", "-t", "-F", "\t"]
    diagnostics_options = ["-v", "VERBOSITY=verbose"] if diagnostics else []
    code, stdout, stderr = _run(
        ["docker", "exec", "--env", "PGPASSWORD", "-i", container_name,
         "psql", "-X", *output_format, "-v", "ON_ERROR_STOP=1", *diagnostics_options, "--username=postgres",
         f"--dbname={database}", *( ["--command", sql] if input_data is None else [] )],
        stage=stage,
        reason=reason,
        input_data=input_data,
        env={**os.environ, "PGPASSWORD": password},
    )
    if code != 0:
        if diagnostics:
            raise UpgradeSmokeError(stage, _format_psql_failure(stage, code, stdout, stderr))
        raise UpgradeSmokeError(stage, reason)
    try:
        return stdout.decode("utf-8", errors="strict").strip()
    except UnicodeError:
        raise UpgradeSmokeError(stage, reason) from None


def _format_psql_failure(stage: str, exit_code: int, stdout: bytes, stderr: bytes) -> str:
    output = (stdout + b"\n" + stderr).decode("utf-8", errors="replace")
    sqlstate_match = re.search(
        r"(?i)\bSQLSTATE\s*[:=]?\s*([A-Z0-9]{5})\b|(?:^|\n)ERROR:\s*([A-Z0-9]{5}):",
        output,
    )
    sqlstate = next((group.upper() for group in sqlstate_match.groups() if group), "<not reported>") if sqlstate_match else "<not reported>"
    safe_message = "database command failed; statement details suppressed"
    patterns = (
        (r'(?i)permission denied for (schema|table|function|sequence|relation|column)\s+(?:"([\w.]+)"|([\w.]+))', "permission denied for {kind} {object}"),
        (r'(?i)(?:role|user)\s+"([\w-]+)" does not exist', "role {object} does not exist"),
        (r'(?i)(?:relation|table|function|schema)\s+"([\w.]+)" does not exist', "required database object does not exist"),
    )
    for pattern, template in patterns:
        match = re.search(pattern, output)
        if match:
            if "{kind}" in template:
                safe_message = template.format(kind=match.group(1).lower(), object=match.group(2) or match.group(3))
            else:
                safe_message = template.format(object=match.group(1))
            break
    protected_function = r"public\.[a-z_][a-z0-9_]*\([^\r\n)]*\)"
    privilege_failures = (
        (rf"unexpected effective EXECUTE for ([a-z_][a-z0-9_]*) on ({protected_function})", "function_execute_denied", "expected_execute=false actual_execute=true role={role} function={function}"),
        (rf"PUBLIC has EXECUTE on ({protected_function})", "public_execute_denied", "expected_execute=false actual_execute=true grantee=PUBLIC function={function}"),
        (rf"app_runtime lacks EXECUTE on ({protected_function})", "runtime_function_execute", "expected_execute=true actual_execute=false role=app_runtime function={function}"),
        (rf"missing exact function ({protected_function})", "protected_function_exists", "expected_exists=true actual_exists=false function={function}"),
        (r"required API role ([a-z_][a-z0-9_]*) is missing", "api_role_exists", "expected_present=true actual_present=false role={role}"),
        (r"app_runtime has effective SELECT on (public\.[a-z_][a-z0-9_]*)", "internal_table_select_denied", "expected_select=false actual_select=true role=app_runtime table={table}"),
    )
    for pattern, _, template in privilege_failures:
        match = re.search(pattern, output)
        if match:
            if "{role}" in template and "{function}" in template:
                safe_message = template.format(role=match.group(1), function=match.group(2))
            elif "{function}" in template:
                safe_message = template.format(function=match.group(1))
            elif "{table}" in template:
                safe_message = template.format(table=match.group(1))
            else:
                safe_message = template.format(role=match.group(1))
            break
    return f"check={stage} exit_code={exit_code} SQLSTATE={sqlstate} message={safe_message}"


def _parse_privilege_verifier_sections(output: str) -> tuple[dict[str, list[dict[str, str]]], set[str]]:
    section_names = set(RESTORE_SMOKE.VERIFIER_SECTIONS.values())
    section_headers = {
        **RESTORE_SMOKE.VERIFIER_SECTIONS,
        (
            "function_signature", "role_name", "function_exists", "is_present",
            "app_runtime_execute", "public_execute", "unexpected_execute", "is_exact",
        ): "api_roles",
    }
    sections: dict[str, list[dict[str, str]]] = {name: [] for name in section_names}
    seen: set[str] = set()
    current: str | None = None
    header: list[str] = []
    try:
        for row in csv.reader(io.StringIO(output)):
            section = section_headers.get(tuple(row))
            if section is not None:
                current, header = section, row
                seen.add(section)
            elif row:
                if current is None or len(row) != len(header):
                    raise ValueError
                sections[current].append(dict(zip(header, row, strict=True)))
    except Exception:
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER", "check=verifier_output expected=sectioned CSV actual=unparseable"
        ) from None
    return sections, seen


def _canonicalize_privilege_verifier_csv(output: str) -> str:
    """Adapt the current API-role result header to the existing validator shape."""
    actual_api_header = (
        "function_signature", "role_name", "function_exists", "is_present",
        "app_runtime_execute", "public_execute", "unexpected_execute", "is_exact",
    )
    validator_api_header = ("role_name", "is_present", "unexpected_execute", "is_exact")
    source = csv.reader(io.StringIO(output))
    destination = io.StringIO()
    writer = csv.writer(destination, lineterminator="\n")
    current_section: str | None = None
    for row in source:
        if tuple(row) == actual_api_header:
            current_section = "api_roles"
            writer.writerow(validator_api_header)
        else:
            section = RESTORE_SMOKE.VERIFIER_SECTIONS.get(tuple(row))
            if section is not None:
                current_section = section
                writer.writerow(row)
            elif current_section == "api_roles" and row and len(row) == len(actual_api_header):
                writer.writerow((row[1], row[3], row[6], row[7]))
            else:
                writer.writerow(row)
    return destination.getvalue()


def _privilege_verifier_failure_details(output: str, validation_reason: str = "verification failed") -> str:
    sections, seen = _parse_privilege_verifier_sections(output)
    failures: list[str] = []
    expected_sections = set(RESTORE_SMOKE.VERIFIER_SECTIONS.values())
    missing = sorted(expected_sections - seen)
    if missing:
        failures.append(f"check=verifier_inventory expected=all_sections actual=missing:{','.join(missing)}")

    for row in sections["schema"]:
        for field, label in (("is_public_usage_granted", "public_schema_usage"), ("is_public_create_absent", "public_schema_create_denied")):
            if row.get(field) != "t":
                failures.append(f"check={label} expected=true actual={row.get(field, '<missing>')}")
    expected_counts = {"table_rights": 17 * 7, "capabilities": 19, "api_roles": 3 * 3, "owners": 17, "policies": 17}
    for section, expected_count in expected_counts.items():
        if len(sections[section]) != expected_count:
            failures.append(f"check={section}_coverage expected={expected_count} actual={len(sections[section])}")

    for row in sections["table_rights"]:
        if row.get("is_exact") != "t":
            expected = {"t": "true", "f": "false"}.get(row.get("expected", ""), "<missing>")
            actual = {"t": "true", "f": "false"}.get(row.get("actual_effective", ""), "<missing>")
            failures.append(
                f"check=table_privilege table={row.get('table_name', '<unknown>')} "
                f"privilege={row.get('privilege_type', '<unknown>')} "
                f"expected={expected} actual={actual}"
            )
    for row in sections["column_rights"]:
        if row.get("is_exact") != "t":
            failures.append(
                f"check=column_privilege table={row.get('table_name', '<unknown>')} "
                f"column={row.get('column_name', '<unknown>')} privilege={row.get('privilege_type', '<unknown>')} "
                f"expected=exact_allowlist actual=exists:{row.get('column_exists', '<missing>')} "
                f"granted:{row.get('actual_granted', '<missing>')}"
            )
    for row in sections["sequences"]:
        if row.get("unexpected_effective_privilege") != "f" or row.get("is_absent") != "t":
            failures.append(
                f"check=sequence_privilege sequence={row.get('sequence_name', '<unknown>')} "
                f"privilege={row.get('privilege_type', '<unknown>')} expected=false "
                f"actual={row.get('unexpected_effective_privilege', '<missing>')}"
            )
    for row in sections["capabilities"]:
        if row.get("execute_granted") != "t":
            failures.append(
                f"check=runtime_function_execute function={row.get('function_signature', '<unknown>')} "
                f"expected=true actual={row.get('execute_granted', '<missing>')}"
            )
    for row in sections["api_roles"]:
        if row.get("is_exact") != "t":
            failures.append(
                f"check=api_role_backend_only_execute role={row.get('role_name', '<unknown>')} "
                f"function={row.get('function_signature', '<backend-only capability set>')} "
                f"expected_runtime_execute=true actual_runtime_execute={row.get('app_runtime_execute', '<missing>')} "
                f"expected_public_execute=false actual_public_execute={row.get('public_execute', '<missing>')} "
                f"expected_api_execute=false actual_api_execute={row.get('unexpected_execute', '<missing>')} "
                f"role_present={row.get('is_present', '<missing>')} function_exists={row.get('function_exists', '<not reported>')}"
            )
    for row in sections["unexpected_functions"]:
        failures.append(
            f"check=unexpected_runtime_function_execute function={row.get('unexpected_function_signature', '<unknown>')} "
            f"expected=false actual={row.get('unexpected_execute', '<missing>')}"
        )
    for row in sections["owners"]:
        if row.get("is_not_owned_by_app_runtime") != "t":
            failures.append(
                f"check=table_owner table={row.get('table_name', '<unknown>')} "
                f"expected=not_app_runtime actual={row.get('owner_role', '<missing>')}"
            )
    for row in sections["policies"]:
        if row.get("is_rls_enabled") != "t" or row.get("is_not_owned") != "t" or row.get("is_expected_policy_count") != "t":
            failures.append(
                f"check=table_rls_policy table={row.get('table_name', '<unknown>')} "
                f"expected_policy_count={row.get('expected_policy_count', '<missing>')} "
                f"actual_policy_count={row.get('actual_policy_count', '<missing>')} "
                f"rls_enabled={row.get('rls_enabled', '<missing>')} "
                f"owner_is_not_app_runtime={row.get('is_not_owned_by_app_runtime', '<missing>')}"
            )
    for row in sections["role_attributes"]:
        failed_fields = [name for name, value in row.items() if name.startswith("is_") and value != "t"]
        if failed_fields:
            failures.append(f"check=app_runtime_role_attributes expected=true actual_failed={','.join(failed_fields)}")

    if not failures:
        failures.append(f"check=verifier_validation expected=all_exact_privileges actual=failed; category={validation_reason}")
    return "; ".join(failures[:10])


def _api_role_function_denial_diagnostics_sql() -> str:
    roles = ", ".join(f"({name!r})" for name in RESTORE_SMOKE.SUPABASE_API_ROLE_STUBS)
    functions = ", ".join(f"({signature!r})" for signature in RESTORE_SMOKE.NEW_BACKEND_FUNCTIONS)
    return f"""\
WITH requested_roles(role_name) AS (VALUES {roles}),
requested_functions(function_signature) AS (VALUES {functions}),
resolved_roles AS (
  SELECT requested_roles.role_name, existing_role.oid AS role_oid
  FROM requested_roles
  LEFT JOIN pg_catalog.pg_roles AS existing_role ON existing_role.rolname = requested_roles.role_name
),
resolved_functions AS (
  SELECT function_signature, to_regprocedure(function_signature) AS function_oid
  FROM requested_functions
)
SELECT role_name, function_signature, role_oid IS NOT NULL AS role_present,
  function_oid IS NOT NULL AS function_exists,
  COALESCE(has_function_privilege(role_oid, function_oid, 'EXECUTE'), false) AS actual_execute
FROM resolved_roles CROSS JOIN resolved_functions
ORDER BY function_signature, role_name
""".strip()


def _api_role_function_denial_failure_details(output: str) -> str:
    expected_pairs = len(RESTORE_SMOKE.SUPABASE_API_ROLE_STUBS) * len(RESTORE_SMOKE.NEW_BACKEND_FUNCTIONS)
    rows: list[list[str]] = []
    for line in output.splitlines():
        if line.strip():
            values = line.split("\t")
            if values == ["role_name", "function_signature", "role_present", "function_exists", "actual_execute"]:
                continue
            if len(values) == 5:
                rows.append(values)
    failures = [
        f"role={role} function={signature} expected_execute=false "
        f"actual_execute={ {'t': 'true', 'f': 'false'}.get(actual_execute, actual_execute) } "
        f"role_present={ {'t': 'true', 'f': 'false'}.get(role_present, role_present) } "
        f"function_exists={ {'t': 'true', 'f': 'false'}.get(function_exists, function_exists) }"
        for role, signature, role_present, function_exists, actual_execute in rows
        if role_present != "t" or function_exists != "t" or actual_execute != "f"
    ]
    if len(rows) != expected_pairs:
        failures.insert(0, f"expected_pairs={expected_pairs} actual_pairs={len(rows)}")
    if not failures:
        failures.append("no failing role/function pair was returned; diagnostic result was incomplete")
    return "check=api_role_execute_denial expected=all_pairs_present_and_execute_false actual=" + "; ".join(failures[:10])


def _validate_local_runtime_grants_csv(output: str) -> None:
    try:
        RESTORE_SMOKE.validate_grants_verifier_csv(_canonicalize_privilege_verifier_csv(output))
    except RESTORE_SMOKE.RestoreSmokeError as error:
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER", _privilege_verifier_failure_details(output, error.reason)
        ) from None


def _create_database_and_roles(container_name: str, postgres_password: str, database: str, runtime_password: str) -> None:
    if not re.fullmatch(r"tf_restore_[a-f0-9]{12}", database):
        raise UpgradeSmokeError("TARGET", "generated database name did not match the disposable naming rule.")
    _psql(
        container_name, postgres_password, "postgres",
        f"CREATE DATABASE {database} TEMPLATE template0",
        stage="TARGET", reason="the unique empty restore database could not be created.",
    )
    active_database = _psql(
        container_name, postgres_password, database, "SELECT current_database()",
        stage="TARGET", reason="the restore database identity could not be confirmed.",
    )
    if active_database != database:
        raise UpgradeSmokeError("TARGET", "the active database did not match the unique restore target.")
    has_public_schema = _psql(
        container_name, postgres_password, database,
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')",
        stage="TARGET", reason="the empty restore database schema state could not be checked.",
    )
    if has_public_schema == "t":
        _psql(
            container_name, postgres_password, database, "DROP SCHEMA public CASCADE",
            stage="TARGET", reason="the default public schema could not be removed from the new restore database.",
        )
    elif has_public_schema != "f":
        raise UpgradeSmokeError("TARGET", "the restore database public schema state was ambiguous.")
    password_literal = "'" + runtime_password.replace("'", "''") + "'"
    setup_sql = f"""\
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','app_runtime')) THEN
    RAISE EXCEPTION 'unexpected role already exists in disposable cluster';
  END IF;
  EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', 'anon');
  EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', 'authenticated');
  EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', 'service_role');
  EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', 'app_runtime', {password_literal});
END
$do$;
"""
    _psql(
        container_name, postgres_password, "postgres", "",
        stage="ROLES", reason="known disposable role stubs could not be created safely.",
        input_data=setup_sql.encode("utf-8"),
    )


def _restore_archive(container_name: str, password: str, database: str, archive_path: Path) -> None:
    try:
        with archive_path.open("rb") as archive:
            code, _, _ = _run(
                ["docker", "exec", "--env", "PGPASSWORD", "-i", container_name,
                 "pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
                 "--username=postgres", f"--dbname={database}"],
                stage="RESTORE",
                reason="the verified archive could not be restored into the disposable database.",
                input_data=archive.read(),
                timeout=1800,
                env={**os.environ, "PGPASSWORD": password},
            )
    except UpgradeSmokeError:
        raise
    except Exception:
        raise UpgradeSmokeError("RESTORE", "the verified archive could not be read for local restore.") from None
    if code != 0:
        raise UpgradeSmokeError("RESTORE", "the verified archive restore failed; no raw database diagnostics were emitted.")


def _validate_archive_toc(container_name: str, password: str, archive_path: Path) -> None:
    try:
        with archive_path.open("rb") as archive:
            code, stdout, _ = _run(
                ["docker", "exec", "--env", "PGPASSWORD", "-i", container_name, "pg_restore", "--list"],
                stage="ARCHIVE", reason="PostgreSQL 17 could not read the verified archive table of contents.",
                input_data=archive.read(), timeout=300, env={**os.environ, "PGPASSWORD": password},
            )
    except UpgradeSmokeError:
        raise
    except Exception:
        raise UpgradeSmokeError("ARCHIVE", "the verified archive could not be read for its table of contents.") from None
    if code != 0 or not stdout.strip():
        raise UpgradeSmokeError("ARCHIVE", "PostgreSQL 17 did not recognize a readable custom archive.")


def _ledger(container_name: str, password: str, database: str) -> list[dict[str, str]]:
    raw = _psql(
        container_name, password, database,
        "SELECT COALESCE(json_agg(json_build_object('version', version, 'name', name) ORDER BY version), '[]'::json)::text FROM supabase_migrations.schema_migrations",
        stage="LEDGER", reason="the local Supabase migration ledger could not be read.",
    )
    try:
        rows = json.loads(raw)
    except Exception:
        raise UpgradeSmokeError("LEDGER", "the local Supabase migration ledger result was invalid.") from None
    if not isinstance(rows, list):
        raise UpgradeSmokeError("LEDGER", "the local Supabase migration ledger result was invalid.")
    return rows


def _verify_ledger(actual: list[dict[str, str]], expected: list[dict[str, str]], stage: str) -> None:
    if actual != expected:
        raise UpgradeSmokeError(stage, f"migration ledger did not contain the expected {len(expected)} ordered versions.")


def verify_migration_connection(database_url: str, database: str, password: str) -> None:
    try:
        with psycopg.connect(database_url, password=password, connect_timeout=5) as connection:
            actual = connection.execute(
                "SELECT current_database(), current_user, session_user, "
                "current_setting('lock_timeout'), current_setting('statement_timeout')"
            ).fetchone()
    except Exception:
        raise UpgradeSmokeError("TARGET", "the pinned local migration connection or timeout settings could not be verified.") from None
    if actual != (database, "postgres", "postgres", "5s", "2min"):
        raise UpgradeSmokeError("TARGET", "local target identity or DDL timeout settings did not match the required values.")


def _cli_environment(password: str | None) -> dict[str, str]:
    env = os.environ.copy()
    for name in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_URL", "DATABASE_URL", "TEST_DATABASE_URL", "PRODUCTION_RUNTIME_DATABASE_URL"):
        env.pop(name, None)
    if password is not None:
        env["PGPASSWORD"] = password
    else:
        env.pop("PGPASSWORD", None)
    return env


def _cli(command: list[str], *, stage: str, password: str | None = None, timeout: int = 600) -> bytes:
    code, stdout, stderr = _run(
        command, stage=stage, reason=f"Supabase CLI local {stage.lower()} failed; raw output was suppressed.",
        timeout=timeout, env=_cli_environment(password),
    )
    if code != 0:
        raise UpgradeSmokeError(stage, f"Supabase CLI local {stage.lower()} failed; stop without retrying automatically.")
    return stdout


def run_local_dry_run(database_url: str, password: str, pending_names: list[str]) -> None:
    command = db_push_command(database_url, dry_run=True)
    try:
        code, stdout, stderr = _run(
            command, stage="DRY_RUN", reason="pinned local Supabase CLI dry-run could not be started.",
            timeout=600, env=_cli_environment(password),
        )
    except ProcessTimeoutError as error:
        lines = _redacted_cli_lines(error.stdout + b"\n" + error.stderr, _cli_sensitive_values(database_url, password))
        expected_versions = ", ".join(name.split("_", 1)[0] for name in pending_names)
        cli_text = " | ".join(lines) if lines else "<no CLI output>"
        raise UpgradeSmokeError(
            "DRY_RUN", f"CLI_TIMEOUT timeout={error.timeout}s; process_group_cleanup="
            f"{'PASS' if error.process_group_cleanup else 'FAILED'}; exit_code=<timeout>; "
            f"expected versions [{expected_versions}]; CLI: {cli_text}.",
        ) from None
    except UpgradeSmokeError:
        raise UpgradeSmokeError(
            "DRY_RUN", "CLI_START_ERROR exit_code=<unavailable>; expected five pending migrations; "
            "actual versions [<unavailable>]; CLI: <process did not return output>.",
        ) from None
    output = stdout + b"\n" + stderr
    validate_dry_run_result(code, output, pending_names, _cli_sensitive_values(database_url, password))


def _failed_migration_name(lines: list[str]) -> str | None:
    current: str | None = None
    observed: list[str] = []
    filename = re.compile(r"(?<!\d)(\d{14}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql)(?![A-Za-z0-9_-])")
    for line in lines:
        match = re.search(r"(?i)\b(?:pushing|applying|running)\s+migration\s+" + filename.pattern, line)
        if match:
            current = match.group(1)
            observed.append(current)
        if current is not None and re.search(r"(?i)\b(error|failed|sqlstate|could not|unable)\b", line):
            return current
    return current if len(set(observed)) == 1 else None


def _db_push_failure_reason(
    exit_code: int | str, output: bytes, database_url: str, password: str, expected_names: list[str]
) -> str:
    lines = _redacted_cli_lines(output, _cli_sensitive_values(database_url, password))
    text = output.decode("utf-8", errors="replace")
    sqlstate_match = re.search(r"(?i)\bSQLSTATE\s*[:=]?\s*([A-Z0-9]{5})\b", text)
    sqlstate = sqlstate_match.group(1).upper() if sqlstate_match else "<not reported>"
    migration = _failed_migration_name(lines) or "<not identified>"
    expected_versions = ", ".join(name.split("_", 1)[0] for name in expected_names) or "<none>"
    cleaned_text = " | ".join(lines) if lines else "<no CLI output>"
    outcome = f"CLI_ERROR exit_code={exit_code}" if isinstance(exit_code, int) else f"timeout={exit_code}"
    return (
        f"{outcome}; SQLSTATE={sqlstate}; migration={migration}; "
        f"expected pending versions=[{expected_versions}]; cleaned CLI: {cleaned_text}"
    )


def run_local_db_push(
    database_url: str,
    password: str,
    pending_names: list[str],
    *,
    container_name: str,
    run_id: str,
    port: int,
) -> None:
    if tuple(pending_names) != EXPECTED_PENDING_NAMES or len(pending_names) != 5:
        raise UpgradeSmokeError("DRY_RUN", "db push requires the exact five approved pending migrations.")
    if re.fullmatch(r"[a-f0-9]{12}", run_id) is None or re.fullmatch(
        rf"tf-upgrade-\d{{14}}-{re.escape(run_id)}", container_name
    ) is None:
        raise UpgradeSmokeError("ISOLATION", "the database container was not identified as created by this run.")
    validate_disposable_database_url(database_url)
    database = urlsplit(database_url).path.removeprefix("/")
    if database != f"{EXPECTED_DATABASE_PREFIX}{run_id}":
        raise UpgradeSmokeError("TARGET", "the database target did not match this run's disposable database.")

    # Verify the task-owned container before dry-run, then check it again after
    # the dry-run so db push cannot proceed against a changed target.
    verify_container(container_name, run_id, port)
    verify_migration_connection(database_url, database, password)
    run_local_dry_run(database_url, password, pending_names)
    verify_container(container_name, run_id, port)
    verify_migration_connection(database_url, database, password)

    command = db_push_command(database_url, dry_run=False)
    try:
        exit_code, stdout, stderr = _run(
            command, stage="DB_PUSH", reason="pinned local Supabase CLI db push could not be started.",
            timeout=CLI_DB_PUSH_TIMEOUT_SECONDS, env=_cli_environment(password),
        )
    except ProcessTimeoutError as error:
        details = _db_push_failure_reason(
            f"{error.timeout}s", error.stdout + b"\n" + error.stderr,
            database_url, password, pending_names,
        )
        raise UpgradeSmokeError(
            "DB_PUSH", f"CLI_TIMEOUT {details}; process_group_cleanup="
            f"{'PASS' if error.process_group_cleanup else 'FAILED'}",
        ) from None
    except UpgradeSmokeError:
        raise UpgradeSmokeError(
            "DB_PUSH", "CLI_START_ERROR exit_code=<unavailable>; SQLSTATE=<unavailable>; "
            "migration=<not identified>; CLI=<process did not return output>.",
        ) from None
    if exit_code != 0:
        raise UpgradeSmokeError(
            "DB_PUSH", _db_push_failure_reason(exit_code, stdout + b"\n" + stderr, database_url, password, pending_names),
        )


def format_stop(error: UpgradeSmokeError, cleanup_status: str, cleanup_error: str | None = None) -> str:
    details = f"cleanup={cleanup_status}"
    if cleanup_error:
        details += f" ({cleanup_error})"
    return f"STOP [{error.stage}]: {error.reason}; {details}"


def _read_counts(container: str, password: str, database: str) -> str:
    return _psql(
        container, password, database, RESTORE_SMOKE._table_row_counts_sql(),
        stage="DATA", reason="aggregate per-table row counts could not be read safely.",
    )


def _read_rls_policy_inventory(container: str, password: str, database: str) -> dict[str, Any]:
    sql = """\
SELECT jsonb_build_object(
  'tables', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  ),
  'policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'permissive', permissive,
      'roles', roles, 'command', cmd, 'using', qual, 'check', with_check
    ) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies WHERE schemaname = 'public'
  )
)::text
"""
    raw = _psql(
        container, password, database, sql,
        stage="RLS", reason="the detailed RLS and policy inventory could not be read safely.",
    )
    try:
        inventory = json.loads(raw)
    except Exception:
        raise UpgradeSmokeError("RLS", "the detailed RLS and policy inventory result was invalid.") from None
    if not isinstance(inventory, dict):
        raise UpgradeSmokeError("RLS", "the detailed RLS and policy inventory result was invalid.")
    return inventory


def _read_inventory(container: str, password: str, database: str, *, current: bool) -> dict[str, Any]:
    expected_functions = RESTORE_SMOKE.CURRENT_APP_EXPECTED_FUNCTIONS if current else RESTORE_SMOKE.ARCHIVE_EXPECTED_FUNCTIONS
    raw = _psql(
        container, password, database, RESTORE_SMOKE._read_only_inventory_sql(expected_functions),
        stage="INVENTORY", reason="the public schema inventory could not be read safely.",
    )
    try:
        summary = json.loads(raw)
    except Exception:
        raise UpgradeSmokeError("INVENTORY", "the public schema inventory result was invalid.") from None
    RESTORE_SMOKE.validate_structure(
        summary, database, expected_functions=expected_functions,
    )
    return summary


def _check_unchanged_baseline(before: dict[str, Any], after: dict[str, Any]) -> None:
    for key in ("tables", "rls_table_count", "policy_count", "expected_policy_count", "all_expected_tables_rls_enabled"):
        if before.get(key) != after.get(key):
            raise UpgradeSmokeError("RLS", "table or RLS/policy inventory changed during migration replay.")


def validate_rls_policy_inventory(before: dict[str, Any], after: dict[str, Any]) -> None:
    if before != after:
        raise UpgradeSmokeError("RLS", "RLS flags or policy definitions changed during migration replay.")


def _apply_runtime_grants_and_checks(
    container: str, postgres_password: str, database: str, runtime_password: str, port: int
) -> None:
    scripts = BACKEND_ROOT / "scripts"
    grant_sql = (scripts / "grant-production-app-runtime-privileges.sql").read_bytes()
    verifier_sql = (scripts / "verify-production-app-runtime-privileges.sql").read_bytes()
    _psql(
        container, postgres_password, database, "", stage="GRANTS",
        reason="the existing runtime grant script failed on the disposable database.", input_data=grant_sql,
        diagnostics=True,
    )
    verifier = _psql(
        container, postgres_password, database, "", stage="PRIVILEGE_VERIFIER",
        reason="the existing runtime privilege verifier failed on the disposable database.",
        csv=True, input_data=verifier_sql, diagnostics=True,
    )
    try:
        _validate_local_runtime_grants_csv(verifier)
    except UpgradeSmokeError:
        raise
    except RESTORE_SMOKE.RestoreSmokeError as error:
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER", _privilege_verifier_failure_details(verifier, error.reason)
        ) from None
    except Exception:
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER", _privilege_verifier_failure_details(verifier)
        ) from None

    try:
        api_denials = _psql(
            container, postgres_password, database, RESTORE_SMOKE._api_role_function_denials_sql(),
            stage="PRIVILEGE_VERIFIER", reason="effective API role denials could not be checked.",
            diagnostics=True,
        )
        RESTORE_SMOKE.validate_api_role_function_denials(api_denials)
    except RESTORE_SMOKE.RestoreSmokeError:
        diagnostic_output = _psql(
            container, postgres_password, database, _api_role_function_denial_diagnostics_sql(),
            stage="PRIVILEGE_VERIFIER", reason="API-role privilege diagnostics could not be read safely.",
            diagnostics=True,
        )
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER", _api_role_function_denial_failure_details(diagnostic_output)
        ) from None
    except UpgradeSmokeError:
        raise
    except Exception:
        raise UpgradeSmokeError(
            "PRIVILEGE_VERIFIER",
            "check=api_role_execute_denial expected=no API-role EXECUTE actual=validation error",
        ) from None

    runtime_url = local_database_url("app_runtime", runtime_password, port, database)
    gate_env = os.environ.copy()
    for name in ("DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN"):
        gate_env.pop(name, None)
    gate_env["PRODUCTION_RUNTIME_DATABASE_URL"] = runtime_url
    gate_env["PGPASSWORD"] = runtime_password
    gate = [
        "uv", "run", "--python", "3.12", "--group", "dev", "python",
        str(scripts / "production-runtime-deployment-gate.py"),
    ]
    code, stdout, stderr = _run(
        gate, stage="DEPLOYMENT_GATE", reason="the runtime deployment gate failed on the disposable database.",
        timeout=300, env=gate_env, cwd=BACKEND_ROOT,
    )
    if code != 0:
        output = (stdout + b"\n" + stderr).decode("utf-8", errors="replace")
        sqlstate_match = re.search(r"(?i)\bSQLSTATE\s*[:=]?\s*([A-Z0-9]{5})\b", output)
        sqlstate = sqlstate_match.group(1).upper() if sqlstate_match else "<not reported>"
        raise UpgradeSmokeError(
            "DEPLOYMENT_GATE",
            f"check=deployment_gate exit_code={code} SQLSTATE={sqlstate} "
            "expected=all runtime checks pass actual=failed; gate details suppressed",
        )


def run_smoke() -> int:
    version = verify_cli_version()
    docker_version = verify_docker_and_image()
    manifest = RESTORE_SMOKE.validate_archive(ARCHIVE_PATH, MANIFEST_PATH)
    applied, pending = validate_repository_migration_sequence(manifest)
    pending_names = [path.name for path in pending]

    run_id = secrets.token_hex(6)
    container_name = f"tf-upgrade-{time.strftime('%Y%m%d%H%M%S', time.gmtime())}-{run_id}"
    database = f"{EXPECTED_DATABASE_PREFIX}{run_id}"
    port = choose_free_loopback_port()
    postgres_password = secrets.token_urlsafe(24)
    runtime_password = secrets.token_urlsafe(24)
    container_creation_attempted = False
    failure: UpgradeSmokeError | None = None
    cleanup_status = "NOT_REQUIRED"
    cleanup_error: str | None = None
    success = False
    try:
        if container_exists(container_name):
            raise UpgradeSmokeError("ISOLATION", "generated container name already exists; no existing container was modified.")
        container_creation_attempted = True
        code, _, _ = _run(
            docker_create_command(container_name, run_id, port),
            stage="DOCKER", reason="the unique disposable PostgreSQL container could not be created.", timeout=120,
            env={**os.environ, "POSTGRES_PASSWORD": postgres_password},
        )
        if code != 0:
            raise UpgradeSmokeError("DOCKER", "the unique disposable PostgreSQL container could not be created.")
        verify_container(container_name, run_id, port)
        _wait_for_database(container_name, postgres_password)
        server_version = _psql(
            container_name, postgres_password, "postgres", "SELECT current_setting('server_version')",
            stage="POSTGRESQL", reason="the disposable PostgreSQL server version could not be verified.",
        )
        if re.match(r"^17(?:\.|$)", server_version) is None:
            raise UpgradeSmokeError("POSTGRESQL", "the disposable server is not PostgreSQL major version 17.")

        _validate_archive_toc(container_name, postgres_password, ARCHIVE_PATH)
        _create_database_and_roles(container_name, postgres_password, database, runtime_password)
        _restore_archive(container_name, postgres_password, database, ARCHIVE_PATH)

        initial_inventory = _read_inventory(container_name, postgres_password, database, current=False)
        initial_policies = _read_rls_policy_inventory(container_name, postgres_password, database)
        initial_counts = _read_counts(container_name, postgres_password, database)
        migration_url = local_database_url("postgres", postgres_password, port, database)
        verify_migration_connection(migration_url, database, postgres_password)
        _cli(migration_repair_command(migration_url, applied), stage="LEDGER_SEED", password=postgres_password)
        _verify_ledger(_ledger(container_name, postgres_password, database), applied, "LEDGER_BEFORE")

        run_local_db_push(
            migration_url,
            postgres_password,
            pending_names,
            container_name=container_name,
            run_id=run_id,
            port=port,
        )

        expected_all = [*applied, *({"version": path.stem.partition("_")[0], "name": path.stem.partition("_")[2]} for path in pending)]
        _verify_ledger(_ledger(container_name, postgres_password, database), expected_all, "LEDGER_AFTER")
        post_counts = _read_counts(container_name, postgres_password, database)
        RESTORE_SMOKE.validate_migration_row_counts(initial_counts, post_counts)
        current_inventory = _read_inventory(container_name, postgres_password, database, current=True)
        current_policies = _read_rls_policy_inventory(container_name, postgres_password, database)
        _check_unchanged_baseline(initial_inventory, current_inventory)
        validate_rls_policy_inventory(initial_policies, current_policies)

        revoke_statements = RESTORE_SMOKE._repository_public_function_revokes()
        if revoke_statements:
            _psql(
                container_name, postgres_password, database, "", stage="ACL_HARDENING",
                reason="repository function hardening could not be applied in the disposable target.",
                input_data="\n".join(revoke_statements).encode("utf-8"),
            )
        _apply_runtime_grants_and_checks(container_name, postgres_password, database, runtime_password, port)
        success = True
    except UpgradeSmokeError as error:
        failure = error
    except Exception:
        failure = UpgradeSmokeError("SMOKE", "unexpected local smoke failure; detailed command output was suppressed.")
    finally:
        if container_creation_attempted:
            try:
                cleanup_container(container_name, run_id, port)
                cleanup_status = "PASS"
            except UpgradeSmokeError as error:
                cleanup_status = "FAILED"
                cleanup_error = error.reason
                if failure is None:
                    failure = error

    if failure is not None:
        print(format_stop(failure, cleanup_status, cleanup_error), file=sys.stderr)
        return 1
    if success:
        print(f"Local PostgreSQL: 127.0.0.1:{port}/{database}; server {server_version}; Docker Engine {docker_version}.")
        print(f"Supabase CLI: {version}; migration ledger: 19 → 24.")
        print("Migration order: " + " → ".join(pending_names))
        print("Archive: manifest/checksum verified; schema/data restored from read-only source archive.")
        print("Structure, 17 public tables, data row counts, RLS/policies, runtime grants, privilege verifier, and deployment gate: PASS.")
        print("Cleanup: task-owned container stopped; --rm removed its anonymous database volume; backup and manifest were read-only.")
        return 0
    return 1


def main() -> int:
    try:
        return run_smoke()
    except UpgradeSmokeError as error:
        print(f"STOP [{error.stage}]: {error.reason}", file=sys.stderr)
        return 1
    except RESTORE_SMOKE.RestoreSmokeError as error:
        print(f"STOP [{error.stage}]: {error.reason}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
