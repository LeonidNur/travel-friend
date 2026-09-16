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
  if [ "$(docker container inspect --format '{{ index .Config.Labels "com.travel-friend.disposable-test-db" }}' "$CONTAINER_NAME")" != "true" ]; then
    echo "Refusing to modify $CONTAINER_NAME: it is not this disposable test container." >&2
    exit 1
  fi
}

wait_for_database() {
  attempts=0
  until docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "PostgreSQL test container did not become ready." >&2
      exit 1
    fi
    sleep 1
  done
}

start() {
  if container_exists; then
    require_own_container
  else
    docker run --detach --rm \
      --name "$CONTAINER_NAME" \
      --label "$CONTAINER_LABEL" \
      --publish "127.0.0.1:${HOST_PORT}:5432" \
      --env "POSTGRES_DB=$POSTGRES_DB" \
      --env "POSTGRES_USER=$POSTGRES_USER" \
      --env "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
      "$POSTGRES_IMAGE" >/dev/null
  fi
  wait_for_database
}

reset() {
  start
  docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
