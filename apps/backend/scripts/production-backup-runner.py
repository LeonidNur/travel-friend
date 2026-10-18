#!/usr/bin/env python3
"""Manual, fail-closed PostgreSQL backup runner for macOS Supabase production."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[3]
EXPECTED_POSTGRES_MAJOR = 17
EXPECTED_DATABASE_ROLE = "postgres"
EXPECTED_TABLE_COUNT = 17
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
KNOWN_ACL_PRINCIPALS = {"postgres", "app_runtime", "PUBLIC"}
EXPECTED_EXTENSION_INVENTORY = {
    "plpgsql": "1.0",
    "pgcrypto": "1.3",
    "uuid-ossp": "1.1",
    "pg_stat_statements": "1.11",
    "supabase_vault": "0.3.1",
}
EXPORT_CONFIRMATION = "BACKUP travel-friend-dev"
PREFLIGHT_CONFIRMATION = "PREFLIGHT travel-friend-dev"
BACKUP_FILENAME = "public.dump"
MANIFEST_FILENAME = "manifest.json"
INCOMPLETE_FILENAME = "INCOMPLETE.txt"
ARCHIVE_SUCCESS_MESSAGE = "Archive created and locally validated; restore has not been verified."


class RunnerError(Exception):
    """Safe-to-display failure without command output or secret values."""


@dataclass(frozen=True)
class PgTools:
    pg_dump: str
    pg_restore: str
    psql: str


def _load_connection_helper() -> Any:
    helper_path = SCRIPT_PATH.with_name("production-backup-connection-check.py")
    spec = importlib.util.spec_from_file_location("production_backup_connection_check", helper_path)
    if spec is None or spec.loader is None:
        raise RunnerError("Could not load the local Keychain connection helper.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        raise RunnerError("Could not load the local Keychain connection helper.") from None
    return module


connection_check = _load_connection_helper()


PREFLIGHT_SQL = r"""
SELECT json_build_object(
  'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'database', current_database(),
  'current_user', current_user,
  'session_user', session_user,
  'server_version', current_setting('server_version'),
  'bypass_rls', COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false),
  'tables', (
    SELECT COALESCE(json_agg(json_build_object(
      'name', c.relname,
      'owner', (SELECT rolname FROM pg_roles WHERE oid = c.relowner),
      'rls', c.relrowsecurity,
      'select', has_table_privilege(current_user, c.oid, 'SELECT')
    ) ORDER BY c.relname), '[]'::json)
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  ),
  'acl_principals_by_scope', (
    WITH acl_entries AS (
      SELECT 'relations'::text AS scope, acl.grantee, acl.grantor, c.relowner AS owner_oid
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(
        c.relacl,
        acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner)
      )) AS acl
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 't')
      UNION ALL
      SELECT 'functions', acl.grantee, acl.grantor, p.proowner
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) AS acl
      WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'types', acl.grantee, acl.grantor, t.typowner
      FROM pg_type t
      CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl, acldefault('T'::"char", t.typowner))) AS acl
      WHERE t.typnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'schema', acl.grantee, acl.grantor, n.nspowner
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n'::"char", n.nspowner))) AS acl
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'default_acl', acl.grantee, acl.grantor, d.defaclrole
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
      WHERE d.defaclnamespace IN (0, 'public'::regnamespace) AND d.defaclacl IS NOT NULL
    ), principal_rows AS (
      SELECT scope, grantee AS role_oid FROM acl_entries
      UNION SELECT scope, grantor FROM acl_entries
      UNION SELECT scope, owner_oid FROM acl_entries
      UNION SELECT 'relations', c.relowner FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
      UNION SELECT 'functions', p.proowner FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      UNION SELECT 'types', t.typowner FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
      UNION SELECT 'schema', n.nspowner FROM pg_namespace n WHERE n.nspname = 'public'
      UNION SELECT 'default_acl', d.defaclrole
        FROM pg_default_acl d WHERE d.defaclnamespace IN (0, 'public'::regnamespace)
    )
    SELECT COALESCE(json_object_agg(scope, principals), '{}'::json)
    FROM (
      SELECT scope, json_agg(principal ORDER BY principal) AS principals
      FROM (
        SELECT DISTINCT scope, CASE
          WHEN role_oid = 0::oid THEN 'PUBLIC'
          ELSE COALESCE(r.rolname, 'OID:' || role_oid::text)
        END AS principal
        FROM principal_rows LEFT JOIN pg_roles r ON r.oid = role_oid
      ) named
      GROUP BY scope
    ) grouped
  ),
  'extension_inventory', (
    SELECT COALESCE(json_agg(json_build_object(
      'name', e.extname, 'version', e.extversion, 'schema', n.nspname
    ) ORDER BY e.extname), '[]'::json)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  ),
  'extension_restore_dependencies', (
    WITH public_objects AS (
      SELECT 'pg_class'::regclass::oid AS classid, c.oid AS objid
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_proc'::regclass::oid, p.oid
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_type'::regclass::oid, t.oid
      FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_rewrite'::regclass::oid, rw.oid
      FROM pg_rewrite rw JOIN pg_class c ON c.oid = rw.ev_class
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_constraint'::regclass::oid, con.oid
      FROM pg_constraint con
      WHERE con.conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
         OR con.contypid IN (SELECT oid FROM pg_type WHERE typnamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'pg_trigger'::regclass::oid, trg.oid
      FROM pg_trigger trg JOIN pg_class c ON c.oid = trg.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_attrdef'::regclass::oid, ad.oid
      FROM pg_attrdef ad JOIN pg_class c ON c.oid = ad.adrelid
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_policy'::regclass::oid, pol.oid
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      WHERE c.relnamespace = 'public'::regnamespace
    ), referenced_extension_members AS (
      SELECT DISTINCT e.extname, e.extversion, n.nspname AS schema
      FROM pg_depend object_dep
      JOIN public_objects own ON own.classid = object_dep.classid AND own.objid = object_dep.objid
      JOIN pg_depend extension_member
        ON extension_member.classid = object_dep.refclassid
       AND extension_member.objid = object_dep.refobjid
       AND extension_member.refclassid = 'pg_extension'::regclass
       AND extension_member.deptype = 'e'
      JOIN pg_extension e ON e.oid = extension_member.refobjid
      JOIN pg_namespace n ON n.oid = e.extnamespace
    )
    SELECT COALESCE(json_agg(json_build_object(
      'name', extname, 'version', extversion, 'schema', schema
    ) ORDER BY extname), '[]'::json)
    FROM referenced_extension_members
  ),
  'large_object_count', (SELECT count(*) FROM pg_largeobject_metadata),
  'catalog_non_public_dependencies', (
    WITH public_objects AS (
      SELECT 'pg_class'::regclass::oid AS classid, c.oid AS objid
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_proc'::regclass::oid, p.oid
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_type'::regclass::oid, t.oid
      FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_rewrite'::regclass::oid, rw.oid
      FROM pg_rewrite rw JOIN pg_class c ON c.oid = rw.ev_class
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_constraint'::regclass::oid, con.oid
      FROM pg_constraint con
      WHERE con.conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
         OR con.contypid IN (SELECT oid FROM pg_type WHERE typnamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'pg_trigger'::regclass::oid, trg.oid
      FROM pg_trigger trg JOIN pg_class c ON c.oid = trg.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_attrdef'::regclass::oid, ad.oid
      FROM pg_attrdef ad JOIN pg_class c ON c.oid = ad.adrelid
      WHERE c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'pg_policy'::regclass::oid, pol.oid
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      WHERE c.relnamespace = 'public'::regnamespace
    ), referenced_namespaces AS (
      SELECT DISTINCT n.nspname
      FROM pg_depend d
      JOIN public_objects own ON own.classid = d.classid AND own.objid = d.objid
      JOIN pg_class ref ON d.refclassid = 'pg_class'::regclass AND d.refobjid = ref.oid
      JOIN pg_namespace n ON n.oid = ref.relnamespace
      UNION
      SELECT DISTINCT n.nspname
      FROM pg_depend d
      JOIN public_objects own ON own.classid = d.classid AND own.objid = d.objid
      JOIN pg_proc ref ON d.refclassid = 'pg_proc'::regclass AND d.refobjid = ref.oid
      JOIN pg_namespace n ON n.oid = ref.pronamespace
      UNION
      SELECT DISTINCT n.nspname
      FROM pg_depend d
      JOIN public_objects own ON own.classid = d.classid AND own.objid = d.objid
      JOIN pg_type ref ON d.refclassid = 'pg_type'::regclass AND d.refobjid = ref.oid
      JOIN pg_namespace n ON n.oid = ref.typnamespace
    )
    SELECT COALESCE(json_agg(nspname ORDER BY nspname), '[]'::json)
    FROM referenced_namespaces
    WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
      AND nspname NOT LIKE 'pg_%'
  ),
  'auth_user_count', (SELECT count(*) FROM auth.users),
  'storage_object_count', (SELECT count(*) FROM storage.objects),
  'vault_secret_count', (SELECT count(*) FROM vault.secrets)
)::text;
""".strip()

MIGRATION_LEDGER_SQL = r"""
SELECT json_build_object(
  'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'count', count(*),
  'versions', COALESCE(json_agg(json_build_object('version', version, 'name', name) ORDER BY version), '[]'::json)
)::text
FROM supabase_migrations.schema_migrations;
""".strip()

TABLE_COUNT_SQL_TEMPLATE = (
    "SELECT json_build_object("
    "'count', count(*), "
    "'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', "
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))::text "
    "FROM public.{quoted_table};"
)


def default_backup_root() -> Path:
    return Path.home() / ".local" / "share" / "travel-friend" / "backups"


def discover_pg_tool_paths() -> dict[str, str]:
    configured = os.environ.get("TRAVEL_FRIEND_PG17_BIN")
    candidates = [Path(configured)] if configured else [
        Path("/opt/homebrew/opt/postgresql@17/bin"),
        Path("/usr/local/opt/postgresql@17/bin"),
    ]
    for candidate in candidates:
        if not candidate.is_absolute():
            continue
        resolved = candidate.resolve()
        paths = {name: str(resolved / name) for name in ("pg_dump", "pg_restore", "psql")}
        if all(Path(path).is_file() and os.access(path, os.X_OK) for path in paths.values()):
            return paths
    raise RunnerError("PostgreSQL 17 client tools were not found in an absolute supported bin directory.")


def _run_local(args: list[str], timeout: int = 10) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, capture_output=True, text=True, check=False, timeout=timeout)
    except Exception:
        raise RunnerError("A required local prerequisite check failed.") from None


def validate_client_tools(paths: dict[str, str]) -> tuple[PgTools, dict[str, str]]:
    versions: dict[str, str] = {}
    for tool_name in ("pg_dump", "pg_restore", "psql"):
        path = paths.get(tool_name, "")
        if not Path(path).is_absolute():
            raise RunnerError("PostgreSQL client tool paths must be absolute.")
        result = _run_local([path, "--version"])
        if result.returncode != 0:
            raise RunnerError(f"Could not verify the local {tool_name} version.")
        match = re.search(r"PostgreSQL\)\s+([0-9]+(?:\.[0-9]+)*)", result.stdout)
        if match is None or int(match.group(1).split(".", 1)[0]) != EXPECTED_POSTGRES_MAJOR:
            raise RunnerError(f"Expected PostgreSQL {EXPECTED_POSTGRES_MAJOR} client tools.")
        versions[tool_name] = match.group(1)
    return PgTools(paths["pg_dump"], paths["pg_restore"], paths["psql"]), versions


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def check_backup_root_available(root: Path) -> None:
    expanded = root.expanduser()
    if expanded.is_symlink():
        raise RunnerError("The configured local backup location cannot be a symbolic link.")
    resolved = expanded.resolve()
    repository = REPOSITORY_ROOT.resolve()
    if _is_within(resolved, repository):
        raise RunnerError("The backup directory must be outside the repository.")

    existing = resolved
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    if not existing.is_dir() or not os.access(existing, os.W_OK | os.X_OK):
        raise RunnerError("The local backup location is not available for private output.")
    if resolved.exists():
        if resolved.is_symlink() or not resolved.is_dir():
            raise RunnerError("The configured local backup location is not a directory.")
        if stat.S_IMODE(resolved.stat().st_mode) & 0o077:
            raise RunnerError("The existing backup directory must have private permissions.")


def get_git_revision() -> str:
    result = _run_local(["git", "-C", str(REPOSITORY_ROOT), "rev-parse", "--verify", "HEAD"])
    revision = result.stdout.strip()
    if result.returncode != 0 or len(revision) not in (40, 64) or any(char not in "0123456789abcdef" for char in revision.lower()):
        raise RunnerError("Could not verify the repository revision for the backup manifest.")
    return revision


def check_local_prerequisites(root: Path | None = None) -> tuple[PgTools, dict[str, str], str, str]:
    if sys.platform != "darwin":
        raise RunnerError("The production backup runner is available only on macOS.")
    try:
        connection_check.validate_target(connection_check.EXPECTED_TARGET)
        password = connection_check.read_keychain_password()
    except Exception:
        raise RunnerError("The configured local Keychain target or credential is unavailable.") from None
    if not isinstance(password, str) or not password or any(char in password for char in "\x00\r\n"):
        raise RunnerError("The configured local Keychain target or credential is unavailable.")

    try:
        paths = discover_pg_tool_paths()
        tools, versions = validate_client_tools(paths)
        check_backup_root_available(root or default_backup_root())
        revision = get_git_revision()
        return tools, versions, revision, password
    except RunnerError:
        raise
    except Exception:
        raise RunnerError("A required local prerequisite check failed.") from None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def create_backup_directory(root: Path) -> Path:
    try:
        expanded = root.expanduser()
        if expanded.is_symlink():
            raise RunnerError("The configured local backup location cannot be a symbolic link.")
        root = expanded.resolve()
        root.mkdir(parents=True, mode=0o700, exist_ok=True)
        if root.is_symlink() or not root.is_dir() or stat.S_IMODE(root.stat().st_mode) & 0o077:
            raise RunnerError("The local backup root must be a private directory.")
        output_dir = root / f"{utc_stamp()}-{secrets.token_hex(4)}"
        output_dir.mkdir(mode=0o700, exist_ok=False)
        os.chmod(output_dir, 0o700)
        return output_dir
    except FileExistsError:
        raise RunnerError("A backup output directory already exists; refusing to overwrite it.") from None
    except RunnerError:
        raise
    except Exception:
        raise RunnerError("Could not create a private unique backup directory.") from None


def write_incomplete_marker(output_dir: Path, reason: str) -> None:
    safe_reason = reason if reason in {"export started", "read-only preflight failed", "archive creation or validation failed", "manifest writing failed"} else "operation failed"
    path = output_dir / INCOMPLETE_FILENAME
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as marker:
            marker.write(f"INCOMPLETE: {safe_reason}\n")
    except FileExistsError:
        raise RunnerError("The incomplete marker already exists; refusing to overwrite it.") from None
    except Exception:
        raise RunnerError("Could not mark the backup directory as INCOMPLETE.") from None


def connection_environment(password: str, app_name: str) -> dict[str, str]:
    env = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL")
        if key in os.environ
    }
    target = connection_check.EXPECTED_TARGET
    env.update({
        "PGHOST": target.host,
        "PGPORT": str(target.port),
        "PGUSER": target.username,
        "PGDATABASE": target.database,
        "PGPASSWORD": password,
        "PGSSLMODE": "require",
        "PGCONNECT_TIMEOUT": "10",
        "PGAPPNAME": app_name,
        "PGOPTIONS": "-c default_transaction_read_only=on",
    })
    return env


def run_psql_json(tools: PgTools, password: str, sql: str, app_name: str = "travel-friend-backup-preflight") -> dict[str, Any]:
    env = connection_environment(password, app_name)
    try:
        result = subprocess.run(
            [tools.psql, "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True,
            text=True,
            input=None,
            check=False,
            timeout=60,
            env=env,
        )
    except Exception:
        raise RunnerError("Read-only production metadata query could not be completed.") from None
    if result.returncode != 0:
        raise RunnerError("Read-only production metadata query failed; export stopped.")
    try:
        return json.loads(result.stdout.strip())
    except (TypeError, json.JSONDecodeError):
        raise RunnerError("Read-only production metadata was not in the expected format.") from None


def _quoted_identifier(identifier: str) -> str:
    if not identifier or "\x00" in identifier:
        raise RunnerError("The public table inventory contains an invalid identifier.")
    return '"' + identifier.replace('"', '""') + '"'


def run_table_count(tools: PgTools, password: str, table_name: str) -> dict[str, Any]:
    quoted = _quoted_identifier(table_name)
    sql = TABLE_COUNT_SQL_TEMPLATE.format(quoted_table=quoted)
    env = connection_environment(password, "travel-friend-backup-count")
    try:
        result = subprocess.run(
            [tools.psql, "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True,
            text=True,
            check=False,
            timeout=600,
            env=env,
        )
    except Exception:
        raise RunnerError("A read-only table count could not be completed; export stopped.") from None
    try:
        observation = json.loads(result.stdout.strip())
    except (TypeError, json.JSONDecodeError):
        observation = None
    if result.returncode != 0 or not isinstance(observation, dict) or not isinstance(observation.get("count"), int) or not isinstance(observation.get("observed_at"), str):
        raise RunnerError("A read-only table count failed; export stopped.")
    return observation


def run_migration_ledger(tools: PgTools, password: str) -> dict[str, Any]:
    result = run_psql_json(tools, password, MIGRATION_LEDGER_SQL, "travel-friend-backup-ledger")
    if not isinstance(result.get("versions"), list) or not isinstance(result.get("count"), int):
        raise RunnerError("Migration ledger metadata could not be validated; export stopped.")
    return result


def validate_preflight_metadata(metadata: dict[str, Any]) -> None:
    if metadata.get("database") != "postgres" or metadata.get("current_user") != EXPECTED_DATABASE_ROLE or metadata.get("session_user") != EXPECTED_DATABASE_ROLE:
        raise RunnerError("Read-only preflight found an unexpected database identity.")
    server_version = metadata.get("server_version")
    match = re.match(r"^(\d+)(?:\.|$)", server_version) if isinstance(server_version, str) else None
    if match is None or int(match.group(1)) != EXPECTED_POSTGRES_MAJOR:
        raise RunnerError(f"Expected PostgreSQL {EXPECTED_POSTGRES_MAJOR} server; export stopped.")
    if metadata.get("bypass_rls") is not True:
        raise RunnerError("Backup identity does not have confirmed full-row RLS coverage; export stopped.")

    tables = metadata.get("tables")
    if not isinstance(tables, list) or len(tables) != EXPECTED_TABLE_COUNT:
        raise RunnerError("Public table inventory differs from the reviewed MVP scope; export stopped.")
    actual_table_names = {table.get("name") for table in tables if isinstance(table, dict)}
    if actual_table_names != EXPECTED_PUBLIC_TABLES:
        raise RunnerError("Public table names differ from the reviewed MVP scope; export stopped.")
    if any(
        not isinstance(table, dict)
        or table.get("owner") != EXPECTED_DATABASE_ROLE
        or table.get("rls") is not True
        or table.get("select") is not True
        for table in tables
    ):
        raise RunnerError("Table ownership, RLS, or SELECT read coverage is incomplete; export stopped.")

    scoped_acl_principals = metadata.get("acl_principals_by_scope")
    required_acl_scopes = {"relations", "functions", "types", "schema", "default_acl"}
    if not isinstance(scoped_acl_principals, dict) or not required_acl_scopes.issubset(scoped_acl_principals):
        raise RunnerError("ACL principal inventory is incomplete; export stopped.")
    if any(
        not isinstance(scoped_acl_principals[scope], list)
        or any(not isinstance(principal, str) for principal in scoped_acl_principals[scope])
        for scope in required_acl_scopes
    ):
        raise RunnerError("ACL principal inventory is incomplete; export stopped.")
    principals = {
        principal
        for scope in required_acl_scopes
        for principal in scoped_acl_principals[scope]
    }
    if principals - KNOWN_ACL_PRINCIPALS:
        raise RunnerError("An unknown ACL principal was found; decide its handling before export.")

    extensions = metadata.get("extension_inventory")
    if not isinstance(extensions, list) or any(
        not isinstance(item, dict)
        or not isinstance(item.get("name"), str)
        or not isinstance(item.get("version"), str)
        for item in extensions
    ):
        raise RunnerError("PostgreSQL extension inventory could not be validated; export stopped.")
    observed_extensions = {item["name"]: item["version"] for item in extensions}
    if len(observed_extensions) != len(extensions) or observed_extensions != EXPECTED_EXTENSION_INVENTORY:
        raise RunnerError("PostgreSQL extension inventory or version differs from the reviewed inventory; export stopped.")
    restore_dependencies = metadata.get("extension_restore_dependencies")
    if not isinstance(restore_dependencies, list) or any(
        not isinstance(item, dict)
        or item.get("name") not in EXPECTED_EXTENSION_INVENTORY
        or item.get("version") != EXPECTED_EXTENSION_INVENTORY.get(item.get("name"))
        for item in restore_dependencies
    ):
        raise RunnerError("Public objects have an unreviewed extension restore dependency; export stopped.")
    if metadata.get("large_object_count") != 0:
        raise RunnerError("Large objects exist outside the selected public-schema archive; export stopped.")
    if metadata.get("catalog_non_public_dependencies") != []:
        raise RunnerError("A catalog-tracked dependency outside public was found; export stopped for scope review.")
    if any(metadata.get(key) != 0 for key in ("auth_user_count", "storage_object_count", "vault_secret_count")):
        raise RunnerError("Auth, Storage, or Vault inventory is non-empty; export stopped for scope review.")


def _check_migration_ledger(ledger: dict[str, Any]) -> dict[str, Any]:
    if ledger.get("count") != EXPECTED_MIGRATION_COUNT or len(ledger.get("versions", [])) != EXPECTED_MIGRATION_COUNT:
        raise RunnerError("Migration ledger count differs from the reviewed scope; export stopped.")
    migration_dir = REPOSITORY_ROOT / "supabase" / "migrations"
    local_versions = {path.name.split("_", 1)[0] for path in migration_dir.glob("*.sql")}
    production_versions = {str(item.get("version", "")) for item in ledger["versions"] if isinstance(item, dict)}
    if len(production_versions) != EXPECTED_MIGRATION_COUNT or not production_versions.issubset(local_versions):
        raise RunnerError("Migration ledger does not map completely to repository migrations; export stopped.")
    return ledger


def run_read_only_preflight(tools: PgTools, password: str) -> dict[str, Any]:
    metadata = run_psql_json(tools, password, PREFLIGHT_SQL)
    validate_preflight_metadata(metadata)

    table_counts = {
        f"public.{table['name']}": run_table_count(tools, password, table["name"])
        for table in metadata["tables"]
    }
    ledger = _check_migration_ledger(run_migration_ledger(tools, password))
    return {"metadata": metadata, "table_counts": table_counts, "migration_ledger": ledger}


def print_preflight_summary(preflight: dict[str, Any]) -> None:
    metadata = preflight["metadata"]
    tables = metadata["tables"]
    version = re.match(r"^\d+(?:\.\d+)*", metadata["server_version"]).group(0)
    rls_pass = all(table["rls"] is True and table["select"] is True for table in tables)
    acl_scopes = metadata["acl_principals_by_scope"]
    extension_versions = sorted(
        f"{item['name']} {item['version']}" for item in metadata["extension_inventory"]
    )
    migration_count = preflight["migration_ledger"]["count"]

    print("READ-ONLY PREFLIGHT: PASS")
    print(f"PostgreSQL server version: {version}")
    print(f"Public tables: {len(tables)}")
    print(f"RLS/read coverage: {'PASS' if rls_pass else 'FAIL'} ({len(tables)}/{len(tables)} tables)")
    print(f"ACL inventory: PASS ({len(acl_scopes)} scopes; reviewed principals only)")
    print(f"Extension inventory: {', '.join(extension_versions)}")
    print(f"Migration records: {migration_count}")
    print("STOP conditions: none detected by required checks.")
    print("No export was attempted; no backup artifacts were created.")


def _preflight_only(password: str, tools: PgTools) -> int:
    if not sys.stdin.isatty():
        print("Preflight-only mode requires an interactive terminal; no database connection was attempted.", file=sys.stderr)
        return 1
    try:
        confirmation = input(f"Type {PREFLIGHT_CONFIRMATION!r} to run read-only checks: ")
    except (EOFError, KeyboardInterrupt):
        print("Preflight cancelled; no database connection was attempted.", file=sys.stderr)
        return 1
    if confirmation != PREFLIGHT_CONFIRMATION:
        print("Preflight cancelled; confirmation did not match. No database connection was attempted.", file=sys.stderr)
        return 1

    try:
        preflight = run_read_only_preflight(tools, password)
    except Exception:
        print("STOP: a required read-only preflight check failed; no export was attempted.", file=sys.stderr)
        return 1
    print_preflight_summary(preflight)
    return 0


def run_export_dump(tools: PgTools, password: str, output_dir: Path) -> Path:
    archive = output_dir / BACKUP_FILENAME
    try:
        descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
    except Exception:
        raise RunnerError("Could not create the archive file without overwriting an existing file.") from None

    env = connection_environment(password, "travel-friend-manual-backup")
    try:
        result = subprocess.run(
            [tools.pg_dump, "--format=custom", "--schema=public", "--no-password", "--file", str(archive), "postgres"],
            capture_output=True,
            text=True,
            check=False,
            timeout=21600,
            env=env,
        )
    except Exception:
        raise RunnerError("pg_dump did not complete; backup remains INCOMPLETE.") from None
    if result.returncode != 0:
        raise RunnerError("pg_dump failed; backup remains INCOMPLETE.")
    try:
        os.chmod(archive, 0o600)
        if not archive.is_file() or archive.stat().st_size <= 0:
            raise RunnerError("The backup archive is missing or empty; backup remains INCOMPLETE.")
    except RunnerError:
        raise
    except Exception:
        raise RunnerError("The backup archive could not be checked; backup remains INCOMPLETE.") from None

    try:
        checked = subprocess.run(
            [tools.pg_restore, "--list", str(archive)],
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except Exception:
        raise RunnerError("pg_restore could not inspect the archive; backup remains INCOMPLETE.") from None
    if checked.returncode != 0 or not checked.stdout.strip():
        raise RunnerError("pg_restore could not read the archive; backup remains INCOMPLETE.")
    return archive


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as archive:
            for chunk in iter(lambda: archive.read(1024 * 1024), b""):
                digest.update(chunk)
    except Exception:
        raise RunnerError("Could not calculate the archive checksum; backup remains INCOMPLETE.") from None
    return digest.hexdigest()


def build_manifest(
    *,
    target: Any,
    tools: PgTools,
    git_revision: str,
    archive_size: int,
    archive_sha256: str,
    preflight: dict[str, Any],
    started_at: str,
    completed_at: str,
    client_versions: dict[str, str],
) -> dict[str, Any]:
    server_version = preflight["metadata"]["server_version"]
    return {
        "target": {
            "host": target.host,
            "port": target.port,
            "database": target.database,
            "username": target.username,
            "sslmode": target.sslmode,
            "server_version": server_version,
        },
        "archive": {
            "filename": BACKUP_FILENAME,
            "format": "custom",
            "scope": "schema=public",
            "started_at": started_at,
            "completed_at": completed_at,
            "size_bytes": archive_size,
            "sha256": archive_sha256,
            "snapshot_note": "pg_dump archive is internally consistent; other metadata observations are separately timed.",
        },
        "client_tools": {
            "pg_dump": {"path": tools.pg_dump, "version": client_versions["pg_dump"]},
            "pg_restore": {"path": tools.pg_restore, "version": client_versions["pg_restore"]},
            "psql": {"path": tools.psql, "version": client_versions["psql"]},
        },
        "git_revision": git_revision,
        "observations": {
            "metadata": preflight["metadata"],
            "table_counts": preflight["table_counts"],
            "migration_ledger": preflight["migration_ledger"],
            "snapshot_equivalent_to_archive": False,
        },
    }


def write_manifest(output_dir: Path, manifest: dict[str, Any]) -> None:
    path = output_dir / MANIFEST_FILENAME
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(manifest, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
    except Exception:
        raise RunnerError("Could not write the manifest; backup remains INCOMPLETE.") from None


def mark_complete(output_dir: Path) -> None:
    try:
        (output_dir / INCOMPLETE_FILENAME).unlink()
    except Exception:
        raise RunnerError("Could not finalize the manifest status; backup remains INCOMPLETE.") from None


def _export(password: str, tools: PgTools, client_versions: dict[str, str], git_revision: str, backup_root: Path) -> int:
    try:
        output_dir = create_backup_directory(backup_root)
        write_incomplete_marker(output_dir, "export started")
    except RunnerError as error:
        print(str(error), file=sys.stderr)
        return 1
    started_at = utc_now()
    try:
        preflight = run_read_only_preflight(tools, password)
    except Exception:
        print("Read-only production preflight failed; backup is marked INCOMPLETE and export stopped.", file=sys.stderr)
        return 1

    try:
        started_at = utc_now()
        archive = run_export_dump(tools, password, output_dir)
        completed_at = utc_now()
        manifest = build_manifest(
            target=connection_check.EXPECTED_TARGET,
            tools=tools,
            git_revision=git_revision,
            archive_size=archive.stat().st_size,
            archive_sha256=sha256_file(archive),
            preflight=preflight,
            started_at=started_at,
            completed_at=completed_at,
            client_versions=client_versions,
        )
        write_manifest(output_dir, manifest)
        mark_complete(output_dir)
    except Exception:
        print("Archive creation, validation, or manifest writing failed; files were preserved and the backup is marked INCOMPLETE.", file=sys.stderr)
        return 1
    print(f"{ARCHIVE_SUCCESS_MESSAGE} Private output directory: {output_dir}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args not in ([], ["--preflight-only"], ["--export"]):
        print("Usage: production-backup-runner.py [--preflight-only|--export]", file=sys.stderr)
        return 2
    exporting = args == ["--export"]
    preflight_only = args == ["--preflight-only"]
    try:
        tools, versions, git_revision, password = check_local_prerequisites()
    except RunnerError as error:
        if preflight_only:
            print("STOP: local preflight prerequisites failed; no database connection or export was attempted.", file=sys.stderr)
            return 1
        print(str(error), file=sys.stderr)
        return 1

    if not exporting:
        if preflight_only:
            return _preflight_only(password, tools)
        target = connection_check.EXPECTED_TARGET
        print("SAFE PREVIEW — no network connection or backup artifacts were created.")
        print(f"Target: {target.host}:{target.port}/{target.database} as {target.username}, sslmode={target.sslmode}")
        print(f"Tools: PostgreSQL {EXPECTED_POSTGRES_MAJOR} client major verified ({', '.join(f'{name} {version}' for name, version in versions.items())}).")
        print(f"Plan: read-only preflight, then one custom archive of schema=public.")
        print("Output: unique private directory under ~/.local/share/travel-friend/backups")
        print("Export requires --export and the exact interactive confirmation.")
        return 0

    if not sys.stdin.isatty():
        print("Export requires an interactive terminal confirmation; no production connection was attempted.", file=sys.stderr)
        return 1
    try:
        confirmation = input(f"Type {EXPORT_CONFIRMATION!r} to continue: ")
    except (EOFError, KeyboardInterrupt):
        print("Export cancelled; no production connection was attempted.", file=sys.stderr)
        return 1
    if confirmation != EXPORT_CONFIRMATION:
        print("Export cancelled; confirmation did not match. No production connection was attempted.", file=sys.stderr)
        return 1
    return _export(password, tools, versions, git_revision, default_backup_root())


if __name__ == "__main__":
    raise SystemExit(main())
