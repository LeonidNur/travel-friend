"""Contract checks for the isolated local PostgreSQL integration-test workflow."""

from __future__ import annotations

from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "local-test-db.sh"
WORKFLOW_PATH = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "ci.yml"


def test_local_test_database_script_is_dedicated_and_disposable() -> None:
    script = SCRIPT_PATH.read_text()

    assert 'CONTAINER_NAME="travel-friend-test-postgres"' in script
    assert 'POSTGRES_DB="travel_friend_test"' in script
    assert 'HOST_PORT="55432"' in script
    assert '127.0.0.1:${HOST_PORT}:5432' in script
    assert 'postgres:17-alpine' in script
    assert 'com.travel-friend.disposable-test-db=true' in script
    assert 'DROP SCHEMA public CASCADE' in script
    assert 'CREATE EXTENSION IF NOT EXISTS pgcrypto' in script
    assert 'supabase/migrations' in script


def test_local_test_database_script_uses_separate_owner_and_runtime_urls_for_pytest() -> None:
    script = SCRIPT_PATH.read_text()

    assert 'TEST_DATABASE_URL="$(database_url)" DATABASE_URL="$(runtime_database_url)"' in script
    assert 'local-test-db-runtime-role.sql' in script
    assert 'runtime-url)' in script


def test_backend_ci_always_stops_disposable_postgres_after_tests() -> None:
    workflow = WORKFLOW_PATH.read_text()
    backend_job = workflow.split("  backend:\n", maxsplit=1)[1]
    test_step_marker = "      - name: Run backend tests with disposable PostgreSQL\n"
    cleanup_step_marker = "      - name: Stop disposable PostgreSQL\n"

    test_step_index = backend_job.index(test_step_marker)
    cleanup_step_index = backend_job.index(cleanup_step_marker)
    test_step = backend_job[test_step_index:cleanup_step_index]
    cleanup_step = backend_job[cleanup_step_index:]

    assert test_step_index < cleanup_step_index
    assert "run: ./scripts/local-test-db.sh test" in test_step
    assert "continue-on-error: true" not in test_step
    assert "if: always()" in cleanup_step
    assert "run: ./scripts/local-test-db.sh stop" in cleanup_step
    assert "secrets." not in backend_job
    assert "DATABASE_URL" not in backend_job
