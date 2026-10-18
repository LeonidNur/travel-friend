#!/bin/sh
# Exercise pg_dump/pg_restore only inside the guarded localhost test container.
set -eu
umask 077

CONTAINER_NAME="travel-friend-test-postgres"
DATABASE_USER="travel_friend_test"
SOURCE_DATABASE="travel_friend_test"
RESTORE_DATABASE="travel_friend_backup_restore_test"
CONTROL_TABLE="backup_restore_smoke_control"
CONTROL_MARKER="travel-friend-local-backup-restore-v1"
SCHEMA_DIFF_MAX_LINES=80
SCHEMA_DIFF_MAX_COLUMNS=240

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_TEST_DB_SCRIPT="$SCRIPT_DIR/local-test-db.sh"

if [ "$SOURCE_DATABASE" = "$RESTORE_DATABASE" ]; then
  echo "Refusing backup/restore smoke: source and restore databases must differ." >&2
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ] || [ -n "${TEST_DATABASE_URL:-}" ] \
  || [ -n "${SUPABASE_DB_URL:-}" ] || [ -n "${PRODUCTION_RUNTIME_DATABASE_URL:-}" ]; then
  echo "Refusing backup/restore smoke: caller-supplied database URLs must be unset." >&2
  exit 1
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/travel-friend-backup-restore.XXXXXX")
BACKUP_FILE="$TEMP_DIR/local-test.dump"
SOURCE_SCHEMA_DUMP="$TEMP_DIR/source-schema-dump.sql"
RESTORE_SCHEMA_DUMP="$TEMP_DIR/restore-schema-dump.sql"
SOURCE_SCHEMA="$TEMP_DIR/source-schema-comparison.sql"
RESTORE_SCHEMA="$TEMP_DIR/restore-schema-comparison.sql"
RESTORE_DATABASE_CREATED=0
SOURCE_RESET_STARTED=0

cleanup() {
  status=$1
  trap - 0

  if [ "$RESTORE_DATABASE_CREATED" -eq 1 ]; then
    if ! docker exec "$CONTAINER_NAME" dropdb --username="$DATABASE_USER" "$RESTORE_DATABASE"; then
      echo "Failed to remove the restore database created by this smoke run." >&2
      status=1
    fi
  fi

  if [ "$SOURCE_RESET_STARTED" -eq 1 ]; then
    if ! sh "$LOCAL_TEST_DB_SCRIPT" reset >/dev/null; then
      echo "Failed to reset the disposable source database after smoke run." >&2
      status=1
    fi
  fi

  rm -f "$BACKUP_FILE" "$SOURCE_SCHEMA_DUMP" "$RESTORE_SCHEMA_DUMP" \
    "$SOURCE_SCHEMA" "$RESTORE_SCHEMA"
  rmdir "$TEMP_DIR" 2>/dev/null || status=1
  exit "$status"
}
trap 'cleanup $?' 0
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting guarded local disposable PostgreSQL."
sh "$LOCAL_TEST_DB_SCRIPT" start

# Refuse collisions before the source reset or any other destructive operation.
TARGET_EXISTS=$(docker exec "$CONTAINER_NAME" psql -X -A -t -v ON_ERROR_STOP=1 \
  --username="$DATABASE_USER" --dbname="$SOURCE_DATABASE" \
  --command="SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$RESTORE_DATABASE')")
if [ "$TARGET_EXISTS" != "f" ]; then
  echo "Refusing backup/restore smoke: restore database already exists or could not be checked." >&2
  exit 1
fi

echo "Resetting the dedicated local source database from repository migrations."
SOURCE_RESET_STARTED=1
sh "$LOCAL_TEST_DB_SCRIPT" reset

echo "Writing synthetic backup control data to the local source database."
docker exec -i "$CONTAINER_NAME" psql -X -v ON_ERROR_STOP=1 \
  --username="$DATABASE_USER" --dbname="$SOURCE_DATABASE" <<SQL
CREATE TABLE public.$CONTROL_TABLE (
  marker text PRIMARY KEY,
  quantity integer NOT NULL,
  metadata jsonb NOT NULL
);
INSERT INTO public.$CONTROL_TABLE (marker, quantity, metadata)
VALUES ('$CONTROL_MARKER', 42, '{"scope":"local-disposable","verified":true}'::jsonb);
SQL

echo "Creating and checking a custom-format logical backup in a private temporary directory."
if ! docker exec "$CONTAINER_NAME" pg_dump --username="$DATABASE_USER" \
  --format=custom --schema=public "$SOURCE_DATABASE" > "$BACKUP_FILE"; then
  echo "pg_dump failed for the local disposable source database." >&2
  exit 1
fi
if [ ! -s "$BACKUP_FILE" ] || ! docker exec -i "$CONTAINER_NAME" pg_restore --list < "$BACKUP_FILE" >/dev/null; then
  echo "The local backup is empty or pg_restore cannot read its archive." >&2
  exit 1
fi

echo "Creating a separate local disposable restore database."
if ! docker exec "$CONTAINER_NAME" createdb --username="$DATABASE_USER" \
  --owner="$DATABASE_USER" "$RESTORE_DATABASE"; then
  echo "createdb returned failure; the restore database may still exist. Stop and manually verify whether $RESTORE_DATABASE exists before retrying; no restore or automatic deletion was attempted." >&2
  exit 1
fi
RESTORE_DATABASE_CREATED=1

prepare_restore_database() {
  if [ "$RESTORE_DATABASE" != "travel_friend_backup_restore_test" ] \
    || [ "$RESTORE_DATABASE_CREATED" -ne 1 ]; then
    echo "Refusing to prepare public schema: restore target identity or ownership check failed." >&2
    exit 1
  fi

  if ! RESTORE_DATABASE_IDENTITY=$(docker exec "$CONTAINER_NAME" psql -X -A -t \
    -v ON_ERROR_STOP=1 --username="$DATABASE_USER" \
    --dbname="$RESTORE_DATABASE" --command='SELECT current_database()'); then
    echo "Could not confirm the restore database identity before schema preparation." >&2
    exit 1
  fi
  if [ "$RESTORE_DATABASE_IDENTITY" != "travel_friend_backup_restore_test" ]; then
    echo "Refusing to prepare public schema: connected database is not the owned restore target." >&2
    exit 1
  fi

  docker exec "$CONTAINER_NAME" psql -X -v ON_ERROR_STOP=1 \
    --username="$DATABASE_USER" --dbname="$RESTORE_DATABASE" \
    --command='DROP SCHEMA public CASCADE'
}

echo "Preparing public schema in the restore database created by this run."
prepare_restore_database

echo "Restoring the archive without clean/overwrite options."
if ! docker exec -i "$CONTAINER_NAME" pg_restore --username="$DATABASE_USER" \
  --dbname="$RESTORE_DATABASE" --exit-on-error < "$BACKUP_FILE"; then
  echo "pg_restore failed in the separate local disposable database." >&2
  exit 1
fi

echo "Comparing normalized public schema dumps."
if ! docker exec "$CONTAINER_NAME" pg_dump --schema-only --schema=public \
  --no-owner --no-privileges --username="$DATABASE_USER" \
  --dbname="$SOURCE_DATABASE" > "$SOURCE_SCHEMA_DUMP"; then
  echo "Could not produce the source public schema dump." >&2
  exit 1
fi
if ! docker exec "$CONTAINER_NAME" pg_dump --schema-only --schema=public \
    --no-owner --no-privileges --username="$DATABASE_USER" \
    --dbname="$RESTORE_DATABASE" > "$RESTORE_SCHEMA_DUMP"; then
  echo "Could not produce the restored public schema dump." >&2
  exit 1
fi
if ! sed -E \
  -e '/^\\restrict([[:space:]].*)?$/d' \
  -e '/^\\unrestrict([[:space:]].*)?$/d' \
  "$SOURCE_SCHEMA_DUMP" > "$SOURCE_SCHEMA"; then
  echo "Could not prepare the source schema comparison file." >&2
  exit 1
fi
if ! sed -E \
  -e '/^\\restrict([[:space:]].*)?$/d' \
  -e '/^\\unrestrict([[:space:]].*)?$/d' \
  "$RESTORE_SCHEMA_DUMP" > "$RESTORE_SCHEMA"; then
  echo "Could not prepare the restored schema comparison file." >&2
  exit 1
fi
if ! cmp -s "$SOURCE_SCHEMA" "$RESTORE_SCHEMA"; then
  echo "Restored public schema does not match the source schema." >&2
  echo "Unified schema diff (up to $SCHEMA_DIFF_MAX_LINES lines, $SCHEMA_DIFF_MAX_COLUMNS characters per line):" >&2
  diff -u -L source-public-schema -L restored-public-schema \
    "$SOURCE_SCHEMA" "$RESTORE_SCHEMA" 2>/dev/null \
    | sed -E \
      -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED_DB_URL]#g' \
      -e 's/((password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1[REDACTED]/Ig' \
    | sed -n "1,${SCHEMA_DIFF_MAX_LINES}p" \
    | cut -c "1-${SCHEMA_DIFF_MAX_COLUMNS}" >&2
  echo "[schema diff output limit applied]" >&2
  exit 1
fi

echo "Checking the restored control table structure and synthetic row."
STRUCTURE_MATCH=$(docker exec "$CONTAINER_NAME" psql -X -A -t -v ON_ERROR_STOP=1 \
  --username="$DATABASE_USER" --dbname="$RESTORE_DATABASE" \
  --command="SELECT count(*) = 3 FROM pg_attribute WHERE attrelid = 'public.$CONTROL_TABLE'::regclass AND attnum > 0 AND NOT attisdropped AND ((attname = 'marker' AND atttypid = 'text'::regtype) OR (attname = 'quantity' AND atttypid = 'integer'::regtype) OR (attname = 'metadata' AND atttypid = 'jsonb'::regtype))")
if [ "$STRUCTURE_MATCH" != "t" ]; then
  echo "Restored control table structure does not match the expected columns." >&2
  exit 1
fi

DATA_MATCH=$(docker exec "$CONTAINER_NAME" psql -X -A -t -v ON_ERROR_STOP=1 \
  --username="$DATABASE_USER" --dbname="$RESTORE_DATABASE" \
  --command="SELECT count(*) = 1 AND bool_and(marker = '$CONTROL_MARKER' AND quantity = 42 AND metadata = '{\"scope\":\"local-disposable\",\"verified\":true}'::jsonb) FROM public.$CONTROL_TABLE")
if [ "$DATA_MATCH" != "t" ]; then
  echo "Restored control data does not match the expected marker and values." >&2
  exit 1
fi

echo "Local pg_dump/pg_restore smoke passed; cleanup will remove the temporary archive and restore database."
