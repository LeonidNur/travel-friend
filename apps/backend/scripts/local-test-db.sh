#!/bin/sh
# Isolated PostgreSQL lifecycle for destructive backend integration tests.
set -eu

CONTAINER_NAME="travel-friend-test-postgres"
CONTAINER_LABEL="com.travel-friend.disposable-test-db=true"
POSTGRES_IMAGE="postgres:17-alpine"
POSTGRES_DB="travel_friend_test"
POSTGRES_USER="travel_friend_test"
# Deliberately non-secret: this credential only exists in an ephemeral localhost container.
POSTGRES_PASSWORD="travel_friend_test_local_only"
APP_RUNTIME_USER="app_runtime"
APP_RUNTIME_PASSWORD="app_runtime_local_only"
HOST_PORT="55432"
CONTAINER_INSPECT_TEMPLATE='{{printf "NAME:%s\n" .Name}}{{printf "LABEL:%s\n" (index .Config.Labels "com.travel-friend.disposable-test-db")}}{{range .Config.Env}}{{printf "ENV:%s\n" .}}{{end}}{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{printf "BIND:%s|%s|%s\n" $port .HostIp .HostPort}}{{end}}{{end}}'

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$BACKEND_DIR/../.." && pwd)
MIGRATIONS_DIR="$REPOSITORY_ROOT/supabase/migrations"

database_url() {
  printf 'postgresql://%s:%s@127.0.0.1:%s/%s\n' \
    "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$HOST_PORT" "$POSTGRES_DB"
}

runtime_database_url() {
  printf 'postgresql://%s:%s@127.0.0.1:%s/%s\n' \
    "$APP_RUNTIME_USER" "$APP_RUNTIME_PASSWORD" "$HOST_PORT" "$POSTGRES_DB"
}

container_exists() {
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

require_own_container() {
  if ! inspect_output=$(docker container inspect --format "$CONTAINER_INSPECT_TEMPLATE" "$CONTAINER_NAME" 2>/dev/null); then
    echo "Refusing to modify $CONTAINER_NAME: unable to inspect container configuration." >&2
    exit 1
  fi

  expected_name="NAME:/$CONTAINER_NAME"
  expected_label="LABEL:true"
  expected_database="ENV:POSTGRES_DB=$POSTGRES_DB"
  expected_user="ENV:POSTGRES_USER=$POSTGRES_USER"
  expected_binding="BIND:5432/tcp|127.0.0.1|$HOST_PORT"
  database_count=$(printf '%s\n' "$inspect_output" | grep -c '^ENV:POSTGRES_DB=' || true)
  user_count=$(printf '%s\n' "$inspect_output" | grep -c '^ENV:POSTGRES_USER=' || true)
  binding_count=$(printf '%s\n' "$inspect_output" | grep -c '^BIND:' || true)
  name_matches=$(printf '%s\n' "$inspect_output" | grep -Fxc "$expected_name" || true)
  label_matches=$(printf '%s\n' "$inspect_output" | grep -Fxc "$expected_label" || true)
  database_matches=$(printf '%s\n' "$inspect_output" | grep -Fxc "$expected_database" || true)
  user_matches=$(printf '%s\n' "$inspect_output" | grep -Fxc "$expected_user" || true)
  binding_matches=$(printf '%s\n' "$inspect_output" | grep -Fxc "$expected_binding" || true)

  if [ "$name_matches" -ne 1 ] || [ "$label_matches" -ne 1 ] \
    || [ "$database_count" -ne 1 ] || [ "$database_matches" -ne 1 ] \
    || [ "$user_count" -ne 1 ] || [ "$user_matches" -ne 1 ] \
    || [ "$binding_count" -ne 1 ] || [ "$binding_matches" -ne 1 ]; then
    echo "Refusing to modify $CONTAINER_NAME: container does not match the disposable test configuration." >&2
    exit 1
  fi
}

wait_for_database() {
  attempts=0
  until docker exec --env "PGPASSWORD=$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql --no-password --host=127.0.0.1 --set=ON_ERROR_STOP=1 \
      --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
      --command='SELECT 1' >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "PostgreSQL test container did not become ready." >&2
      exit 1
    fi
    sleep 1
  done
}

start() {
  if ! container_exists; then
    docker run --detach --rm \
      --name "$CONTAINER_NAME" \
      --label "$CONTAINER_LABEL" \
      --publish "127.0.0.1:${HOST_PORT}:5432" \
      --env "POSTGRES_DB=$POSTGRES_DB" \
      --env "POSTGRES_USER=$POSTGRES_USER" \
      --env "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
      "$POSTGRES_IMAGE" >/dev/null
  fi
  require_own_container
  wait_for_database
}

reset() {
  start
  require_own_container
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DROP ROLE IF EXISTS app_runtime;
CREATE ROLE app_runtime
  LOGIN
  PASSWORD 'app_runtime_local_only'
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;
SQL
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DO $do$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN', api_role);
    END IF;
  END LOOP;
END
$do$;
SQL
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$migration"
  done
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < "$SCRIPT_DIR/local-test-db-runtime-role.sql"
}

stop() {
  if container_exists; then
    require_own_container
    docker rm --force "$CONTAINER_NAME" >/dev/null
  fi
}

case "${1:-}" in
  start)
    start
    ;;
  reset)
    reset
    ;;
  url)
    database_url
    ;;
  runtime-url)
    runtime_database_url
    ;;
  test)
    reset
    (
      cd "$BACKEND_DIR"
      TEST_DATABASE_URL="$(database_url)" DATABASE_URL="$(runtime_database_url)" \
        uv run --python 3.12 --group dev pytest --cov
    )
    ;;
  stop)
    stop
    ;;
  *)
    echo "Usage: $0 {start|reset|url|runtime-url|test|stop}" >&2
    exit 64
    ;;
esac
