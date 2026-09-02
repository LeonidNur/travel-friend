"""Route-registration contract for authenticated Trip creation."""

import os

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-route-test/travel_friend_test")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app


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
