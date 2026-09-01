"""Route-registration contract for the authenticated direct Chats list."""

import os

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-route-test/travel_friend_test")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app


def test_chats_route_requires_authentication() -> None:
    app = create_app(
        BackendSettings(
            telegram_bot_token="test-token",
            database_url="postgresql://unused-for-route-test/travel_friend_test",
        )
    )
    with TestClient(app) as client:
        assert client.get("/chats").status_code == 401
