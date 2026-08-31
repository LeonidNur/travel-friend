"""Focused tests for reusable database access and authenticated principals."""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

from travel_friend_backend import db
from travel_friend_backend.auth import service
from travel_friend_backend.config import BackendSettings


class FakeConnection:
    def __init__(self) -> None:
        self.closed = False

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_: object) -> None:
        self.closed = True


def test_database_connection_opens_a_short_lived_dict_row_connection(
    monkeypatch,
) -> None:
    connection = FakeConnection()
    captured: dict[str, object] = {}

    def connect(database_url: str, *, row_factory: object) -> FakeConnection:
        captured.update(database_url=database_url, row_factory=row_factory)
        return connection

    monkeypatch.setattr(db.psycopg, "connect", connect)

    with db.database_connection("postgresql://example.test/travel-friend") as opened:
        assert opened is connection

    assert captured["database_url"] == "postgresql://example.test/travel-friend"
    assert captured["row_factory"] is db.dict_row
    assert connection.closed is True


def test_database_dependency_reads_the_application_database_url(monkeypatch) -> None:
    connection = object()

    @contextmanager
    def open_connection(database_url: str):
        assert database_url == "postgresql://example.test/travel-friend"
        yield connection

    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                backend_settings=BackendSettings(
                    telegram_bot_token="test-token",
                    database_url="postgresql://example.test/travel-friend",
                )
            )
        )
    )
    monkeypatch.setattr(db, "database_connection", open_connection)

    dependency = db.get_database_connection(request)

    assert next(dependency) is connection
    dependency.close()


def test_current_user_returns_a_typed_authenticated_principal(monkeypatch) -> None:
    user_id = uuid4()
    session_id = uuid4()

    class FakeCursor:
        def __enter__(self) -> FakeCursor:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, *_: object) -> None:
            return None

        def fetchone(self) -> dict[str, UUID]:
            return {"id": user_id, "session_id": session_id}

    class FakeDatabaseConnection:
        def cursor(self) -> FakeCursor:
            return FakeCursor()

    @contextmanager
    def connection(_: str):
        yield FakeDatabaseConnection()

    monkeypatch.setattr(service, "database_connection", connection)

    principal = service.current_user("postgresql://example.test/travel-friend", "Bearer token")

    assert principal == service.AuthenticatedPrincipal(
        user_id=user_id,
        session_id=session_id,
    )


def test_auth_dependency_reads_settings_and_authorization_header(monkeypatch) -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    captured: dict[str, object] = {}
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                backend_settings=BackendSettings(
                    telegram_bot_token="test-token",
                    database_url="postgresql://example.test/travel-friend",
                )
            )
        )
    )

    def current_user(database_url: str, authorization: str | None):
        captured.update(database_url=database_url, authorization=authorization)
        return principal

    monkeypatch.setattr(service, "current_user", current_user)

    assert service.auth_dependency(request, "Bearer token") is principal
    assert captured == {
        "database_url": "postgresql://example.test/travel-friend",
        "authorization": "Bearer token",
    }
