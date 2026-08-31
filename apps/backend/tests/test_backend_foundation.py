"""Focused tests for reusable database access and authenticated principals."""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from travel_friend_backend import db
from travel_friend_backend.auth import service
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.routers import me
from travel_friend_backend.schemas.onboarding import OnboardingPatchRequest
from travel_friend_backend.schemas.profile import ProfilePatchRequest
from travel_friend_backend.schemas.travel_intent import TravelIntentPutRequest


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


class ProfileQueryResult:
    def __init__(self, row: dict[str, object] | None) -> None:
        self._row = row

    def fetchone(self) -> dict[str, object] | None:
        return self._row


class RecordingProfileConnection:
    def __init__(self, rows: list[dict[str, object] | None]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(
        self, query: str, parameters: tuple[object, ...]
    ) -> ProfileQueryResult:
        self.calls.append((query, parameters))
        return ProfileQueryResult(self.rows.pop(0))


def test_current_user_profile_queries_only_the_authenticated_user() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    profile = {"user_id": principal.user_id, "display_name": "Ada"}
    connection = RecordingProfileConnection([profile])

    result = me.get_current_user_profile(principal, connection)  # type: ignore[arg-type]

    assert result is profile
    assert connection.calls[0][1] == (principal.user_id,)


def test_current_user_profile_missing_row_returns_null() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    connection = RecordingProfileConnection([None])

    result = me.get_current_user_profile(principal, connection)  # type: ignore[arg-type]

    assert result is None
    assert connection.calls[0][1] == (principal.user_id,)


def test_profile_patch_creates_then_updates_only_whitelisted_columns() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    created_profile = {"user_id": principal.user_id, "display_name": "Ada"}
    create_connection = RecordingProfileConnection([None, created_profile])

    assert me.patch_current_user_profile(  # type: ignore[arg-type]
        ProfilePatchRequest(display_name="Ada"), principal, create_connection
    ) is created_profile
    create_query, create_parameters = create_connection.calls[1]
    assert "INSERT INTO public.profiles (user_id, display_name, updated_at)" in create_query
    assert "ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name" in create_query
    assert create_parameters == (principal.user_id, "Ada")

    updated_profile = {"user_id": principal.user_id, "display_name": "Ada", "city": "Paris"}
    update_connection = RecordingProfileConnection([{"exists": 1}, updated_profile])

    assert me.patch_current_user_profile(  # type: ignore[arg-type]
        ProfilePatchRequest(city="Paris"), principal, update_connection
    ) is updated_profile
    update_query, update_parameters = update_connection.calls[1]
    assert "SET city=%s, updated_at=now()" in update_query
    assert update_parameters == ("Paris", principal.user_id)

    unchanged_profile = {"user_id": principal.user_id, "display_name": "Ada"}
    empty_patch_connection = RecordingProfileConnection([unchanged_profile])

    assert me.patch_current_user_profile(  # type: ignore[arg-type]
        ProfilePatchRequest(), principal, empty_patch_connection
    ) is unchanged_profile
    assert len(empty_patch_connection.calls) == 1


def test_profile_patch_rejects_null_display_name() -> None:
    with pytest.raises(ValidationError, match="display_name must not be null"):
        ProfilePatchRequest(display_name=None)


def test_current_user_travel_intent_queries_only_the_authenticated_active_intent() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    intent = {"user_id": principal.user_id, "destination": "Lisbon", "status": "active"}
    connection = RecordingProfileConnection([intent])

    assert me.get_current_user_travel_intent(principal, connection) is intent  # type: ignore[arg-type]
    query, parameters = connection.calls[0]
    assert "WHERE user_id=%s AND status='active'" in query
    assert parameters == (principal.user_id,)


def test_put_current_user_travel_intent_upserts_a_single_active_row() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    intent = {"user_id": principal.user_id, "destination": "Lisbon", "status": "active"}
    connection = RecordingProfileConnection([intent])
    payload = TravelIntentPutRequest(
        destination="Lisbon", date_from="2026-10-01", date_to="2026-10-14"
    )

    assert me.put_current_user_travel_intent(payload, principal, connection) is intent  # type: ignore[arg-type]
    query, parameters = connection.calls[0]
    assert "INSERT INTO public.travel_intents" in query
    assert "ON CONFLICT (user_id) WHERE status='active' DO UPDATE" in query
    assert "updated_at=CASE" in query
    assert "IS DISTINCT FROM" in query
    assert parameters == (principal.user_id, "Lisbon", payload.date_from, payload.date_to)


def test_delete_current_user_travel_intent_archives_only_the_current_users_active_row() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    connection = RecordingProfileConnection([None])

    assert me.delete_current_user_travel_intent(principal, connection) is None  # type: ignore[arg-type]
    query, parameters = connection.calls[0]
    assert "UPDATE public.travel_intents" in query
    assert "status='archived'" in query
    assert "archived_at=now()" in query
    assert "WHERE user_id=%s AND status='active'" in query
    assert parameters == (principal.user_id,)


def test_onboarding_patch_uses_only_the_authenticated_users_existing_state() -> None:
    principal = service.AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
    connection = RecordingProfileConnection([{"onboarding_status": "in_progress"}])

    result = me.patch_current_user_onboarding(  # type: ignore[arg-type]
        OnboardingPatchRequest(status="in_progress"), principal, connection
    )

    assert result == {"status": "in_progress"}
    query, parameters = connection.calls[0]
    assert "UPDATE public.user_activity_states" in query
    assert "WHERE user_id=%s" in query
    assert "IS DISTINCT FROM" in query
    assert parameters == ("in_progress", "in_progress", principal.user_id, "in_progress")


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "not_started"},
        {"status": "in_progress", "user_id": str(uuid4())},
        {"status": "in_progress", "updated_at": "2026-01-01T00:00:00Z"},
        {"status": "in_progress", "unknown": "field"},
    ],
)
def test_onboarding_patch_rejects_server_owned_and_invalid_statuses(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        OnboardingPatchRequest.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"destination": "Lisbon", "date_from": "2026-10-14", "date_to": "2026-10-01"},
        {"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14", "user_id": str(uuid4())},
        {"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14", "status": "active"},
        {"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14", "archived_at": None},
        {"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14", "id": str(uuid4())},
        {"destination": "Lisbon", "date_from": "2026-10-01", "date_to": "2026-10-14", "unknown": "field"},
    ],
)
def test_travel_intent_request_rejects_invalid_ranges_and_server_owned_fields(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        TravelIntentPutRequest.model_validate(payload)
