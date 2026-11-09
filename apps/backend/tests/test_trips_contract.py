"""Route-registration contract for authenticated Trip creation."""

import os
from types import SimpleNamespace

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-route-test/travel_friend_test")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app
from travel_friend_backend.routers.trips import _is_named_database_error


def test_trip_creation_route_requires_authentication() -> None:
    app = create_app(
        BackendSettings(
            telegram_bot_token="test-token",
            database_url="postgresql://unused-for-route-test/travel_friend_test",
        )
    )
    with TestClient(app) as client:
        assert client.post("/chats/00000000-0000-0000-0000-000000000000/trips").status_code == 401
        assert client.get("/trips").status_code == 401


def test_trip_draft_and_itinerary_routes_require_authentication() -> None:
    app = create_app(
        BackendSettings(
            telegram_bot_token="test-token",
            database_url="postgresql://unused-for-route-test/travel_friend_test",
        )
    )
    trip_id = "00000000-0000-0000-0000-000000000001"
    with TestClient(app) as client:
        assert client.get(f"/trips/{trip_id}/itinerary").status_code == 401
        assert client.get(f"/trips/{trip_id}/draft").status_code == 401
        assert client.get(
            f"/trips/{trip_id}/draft/alternatives/00000000-0000-0000-0000-000000000002"
        ).status_code == 401
        assert client.put(
            f"/trips/{trip_id}/draft",
            json={"base_version": 1, "content": {}},
        ).status_code == 401
        assert client.post(
            f"/trips/{trip_id}/draft/alternatives",
            json={"title": "Plan", "content": {}},
        ).status_code == 401


def test_trip_draft_size_mapping_requires_the_specific_database_message() -> None:
    expected_limit_error = SimpleNamespace(
        sqlstate="22023", diag=SimpleNamespace(message_primary="trip draft content exceeds 256 KiB")
    )
    unrelated_validation_error = SimpleNamespace(
        sqlstate="22023", diag=SimpleNamespace(message_primary="base version must be positive")
    )

    assert _is_named_database_error(
        expected_limit_error, sqlstate="22023", message="trip draft content exceeds 256 KiB"
    )
    assert not _is_named_database_error(
        unrelated_validation_error, sqlstate="22023", message="trip draft content exceeds 256 KiB"
    )
