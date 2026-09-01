"""Focused route-registration test for the Discover API contract."""

import os

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-route-test/travel_friend_test")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app


def test_discover_routes_are_registered() -> None:
    app = create_app(
        BackendSettings(
            telegram_bot_token="test-token",
            database_url="postgresql://unused-for-route-test/travel_friend_test",
        )
    )
    with TestClient(app) as client:
        assert client.get("/discover/candidates").status_code == 401
        assert client.put(
            "/discover/decisions/00000000-0000-0000-0000-000000000000",
            json={"decision": "interested"},
        ).status_code == 401
