"""Contract checks for the isolated local PostgreSQL integration-test workflow."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest


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


def run_with_docker_stub(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    *,
    name: str = "/travel-friend-test-postgres",
    label: str = "true",
    database: str = "travel_friend_test",
    user: str = "travel_friend_test",
    binding: str = "5432/tcp|127.0.0.1|55432",
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    stub_dir = tmp_path / "bin"
    stub_dir.mkdir()
    docker_stub = stub_dir / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s|%s\\n' \"$1\" \"$2\" >> \"$DOCKER_CALL_LOG\"\n"
        "if [ \"$1:$2\" = 'container:inspect' ]; then\n"
        "  if [ \"$3\" = '--format' ]; then\n"
        "    if [ \"$4\" = '{{ index .Config.Labels \"com.travel-friend.disposable-test-db\" }}' ]; then\n"
        "      printf '%s\\n' \"$DOCKER_STUB_LABEL\"\n"
        "      exit 0\n"
        "    fi\n"
        "    printf 'NAME:%s\\nLABEL:%s\\nENV:POSTGRES_DB=%s\\nENV:POSTGRES_USER=%s\\nBIND:%s\\n' \\\n"
        "      \"$DOCKER_STUB_NAME\" \"$DOCKER_STUB_LABEL\" \\\n"
        "      \"$DOCKER_STUB_DATABASE\" \"$DOCKER_STUB_USER\" \\\n"
        "      \"$DOCKER_STUB_BINDING\"\n"
        "  fi\n"
        "  exit 0\n"
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    docker_stub.chmod(0o755)

    call_log = tmp_path / "docker-calls.log"
    monkeypatch.setenv("DOCKER_CALL_LOG", str(call_log))
    monkeypatch.setenv("DOCKER_STUB_NAME", name)
    monkeypatch.setenv("DOCKER_STUB_LABEL", label)
    monkeypatch.setenv("DOCKER_STUB_DATABASE", database)
    monkeypatch.setenv("DOCKER_STUB_USER", user)
    monkeypatch.setenv("DOCKER_STUB_BINDING", binding)
    monkeypatch.setenv("PATH", f"{stub_dir}{os.pathsep}{os.environ['PATH']}")

    result = subprocess.run(
        ["/bin/sh", str(SCRIPT_PATH), command],
        capture_output=True,
        check=False,
        env=os.environ.copy(),
        text=True,
    )
    calls = call_log.read_text(encoding="utf-8").splitlines() if call_log.exists() else []
    return result, calls


@pytest.mark.parametrize(
    ("command", "expected_destructive_call"),
    [("reset", "exec|-i"), ("stop", "rm|--force")],
)
def test_valid_disposable_container_allows_reset_and_stop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    expected_destructive_call: str,
) -> None:
    result, calls = run_with_docker_stub(tmp_path, monkeypatch, command)

    assert result.returncode == 0, result.stderr
    assert expected_destructive_call in calls


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "/other-container"),
        ("label", "false"),
        ("database", "production"),
        ("user", "postgres"),
        ("binding", "5432/tcp|0.0.0.0|55432"),
        ("binding", "5432/tcp|127.0.0.1|5432"),
    ],
)
@pytest.mark.parametrize("command", ["reset", "stop"])
def test_mismatched_container_fails_closed_without_destructive_actions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    field: str,
    value: str,
) -> None:
    result, calls = run_with_docker_stub(
        tmp_path,
        monkeypatch,
        command,
        **{field: value},
    )

    assert result.returncode != 0
    assert "exec|-i" not in calls
    assert "rm|--force" not in calls
