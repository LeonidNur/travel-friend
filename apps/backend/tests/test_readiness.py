"""Focused contracts for the bounded database-backed readiness probe."""

from __future__ import annotations

import os
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-for-readiness")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-readiness")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app
from travel_friend_backend import readiness


class RecordingConnection:
    def __init__(self, failure: Exception | None = None) -> None:
        self.closed = False
        self.failure = failure
        self.queries: list[str] = []

    def __enter__(self) -> RecordingConnection:
        return self

    def __exit__(self, *_: object) -> None:
        self.closed = True

    def execute(self, query: str) -> None:
        self.queries.append(query)
        if self.failure is not None:
            raise self.failure


def make_app() -> object:
    return create_app(
        BackendSettings(
            telegram_bot_token="test-token",
            database_url="postgresql://runtime@example.test/travel_friend",
        )
    )


def assert_generated_v4(value: str) -> None:
    assert UUID(value).version == 4


def test_health_remains_liveness_without_a_database_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        readiness,
        "probe_database",
        lambda _: (_ for _ in ()).throw(AssertionError("health must not probe the database")),
    )

    with TestClient(make_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_probes_the_runtime_database_with_bounded_timeouts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = RecordingConnection()
    captured: dict[str, object] = {}

    def connect(database_url: str, **kwargs: object) -> RecordingConnection:
        captured["database_url"] = database_url
        captured.update(kwargs)
        return connection

    monkeypatch.setattr(readiness.psycopg, "connect", connect)

    assert readiness.probe_database("postgresql://runtime@example.test/travel_friend") is True
    assert captured == {
        "database_url": "postgresql://runtime@example.test/travel_friend",
        "connect_timeout": readiness.READINESS_CONNECT_TIMEOUT_SECONDS,
        "options": f"-c statement_timeout={readiness.READINESS_STATEMENT_TIMEOUT_MILLISECONDS}",
    }
    assert connection.queries == ["SELECT 1"]
    assert connection.closed is True


def test_ready_returns_success_and_preserves_a_valid_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_id = "e6acfd74-969e-4f6f-8f64-4ca55b462d6b"
    monkeypatch.setattr(readiness, "probe_database", lambda _: True)

    with TestClient(make_app()) as client:
        response = client.get("/ready", headers={"X-Request-ID": request_id})

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    assert response.headers["X-Request-ID"] == request_id


def test_ready_success_generates_a_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(readiness, "probe_database", lambda _: True)

    with TestClient(make_app()) as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert_generated_v4(response.headers["X-Request-ID"])


@pytest.mark.parametrize(
    ("failure_site", "error_type"),
    [("connect", psycopg.OperationalError), ("query", psycopg.errors.QueryCanceled)],
    ids=["connect-failure", "statement-timeout"],
)
def test_ready_database_failures_are_generic_and_keep_request_id(
    monkeypatch: pytest.MonkeyPatch,
    failure_site: str,
    error_type: type[psycopg.Error],
) -> None:
    diagnostic = "postgresql://runtime:password@db.example/private"
    request_id = "b60ce5df-bcd8-47f8-8cdb-f4e1642a1055"
    connection = RecordingConnection(error_type(diagnostic))

    def connect(_: str, **__: object) -> RecordingConnection:
        if failure_site == "connect":
            raise error_type(diagnostic)
        return connection

    monkeypatch.setattr(readiness.psycopg, "connect", connect)

    with TestClient(make_app()) as client:
        response = client.get("/ready", headers={"X-Request-ID": request_id})

    assert response.status_code == 503
    assert response.json() == {"detail": "Service unavailable"}
    assert response.headers["X-Request-ID"] == request_id
    assert diagnostic not in response.text
    if failure_site == "query":
        assert connection.closed is True


def test_ready_failure_generates_a_request_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(readiness, "probe_database", lambda _: False)

    with TestClient(make_app()) as client:
        response = client.get("/ready")

    assert response.status_code == 503
    assert_generated_v4(response.headers["X-Request-ID"])


def test_readiness_does_not_classify_programming_errors_as_dependency_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = RecordingConnection(psycopg.ProgrammingError("unexpected SQL bug"))
    monkeypatch.setattr(readiness.psycopg, "connect", lambda *_args, **_kwargs: connection)

    with pytest.raises(psycopg.ProgrammingError, match="unexpected SQL bug"):
        readiness.probe_database("postgresql://runtime@example.test/travel_friend")

    assert connection.closed is True
