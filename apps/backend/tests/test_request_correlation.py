"""Contract tests for backend HTTP request correlation."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-for-request-correlation")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-request-correlation")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app
from travel_friend_backend.rate_limit import TELEGRAM_LOGIN_POLICY
from travel_friend_backend.request_correlation import RequestCorrelationMiddleware


def make_app():
    return create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))


def assert_generated_v4(value: str) -> None:
    assert UUID(value).version == 4


def test_missing_request_id_generates_a_uuidv4() -> None:
    with TestClient(make_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert_generated_v4(response.headers["X-Request-ID"])


def test_valid_inbound_request_id_is_normalized_and_reused() -> None:
    inbound_request_id = "e6acfd74-969e-4f6f-8f64-4ca55b462d6b"

    with TestClient(make_app()) as client:
        response = client.get("/health", headers={"X-Request-ID": inbound_request_id.upper()})

    assert response.headers["X-Request-ID"] == inbound_request_id


@pytest.mark.parametrize(
    "headers",
    [
        [("X-Request-ID", "not-a-uuid")],
        [
            ("X-Request-ID", "e6acfd74-969e-4f6f-8f64-4ca55b462d6b"),
            ("x-request-id", "bdd1741c-dbc4-47ec-895e-161eacd433a1"),
        ],
        [("X-Request-ID", "x" * 1024)],
    ],
    ids=["malformed", "duplicate", "oversized"],
)
def test_invalid_inbound_request_id_is_replaced(headers: list[tuple[str, str]]) -> None:
    with TestClient(make_app()) as client:
        response = client.get("/health", headers=headers)

    assert_generated_v4(response.headers["X-Request-ID"])


def test_response_id_covers_fastapi_401_and_422() -> None:
    with TestClient(make_app()) as client:
        unauthorized = client.get("/auth/test-current")
        validation_error = client.post("/auth/telegram", json={"init_data": 123})

    assert unauthorized.status_code == 401
    assert_generated_v4(unauthorized.headers["X-Request-ID"])
    assert validation_error.status_code == 422
    assert_generated_v4(validation_error.headers["X-Request-ID"])


def test_response_id_covers_existing_rate_limit_429(monkeypatch: pytest.MonkeyPatch) -> None:
    app = make_app()

    class Verifier:
        def verify(self, _: str) -> object:
            return type(
                "Verified",
                (),
                {"identity": type("Identity", (), {"telegram_user_id": 123})()},
            )()

    app.state.telegram_init_data_verifier = Verifier()
    monkeypatch.setattr("travel_friend_backend.main.login", lambda *_: {"access_token": "token"})

    with TestClient(app) as client:
        for _ in range(TELEGRAM_LOGIN_POLICY.limit):
            assert client.post("/auth/telegram", json={"init_data": "valid"}).status_code == 200
        response = client.post("/auth/telegram", json={"init_data": "valid"})

    assert response.status_code == 429
    assert_generated_v4(response.headers["X-Request-ID"])


def test_response_id_covers_early_body_limit_413() -> None:
    oversized_body = b"a" * (256 * 1024 + 1)

    with TestClient(make_app()) as client:
        response = client.post("/auth/telegram", content=oversized_body)

    assert response.status_code == 413
    assert_generated_v4(response.headers["X-Request-ID"])


def test_unexpected_exception_returns_generic_500_with_request_id_and_traceback_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = make_app()
    inbound_request_id = "b60ce5df-bcd8-47f8-8cdb-f4e1642a1055"
    secret_diagnostic = "postgresql://user:password@db.example/private"

    @app.get("/test/unexpected")
    def unexpected_failure() -> None:
        raise RuntimeError(secret_diagnostic)

    with caplog.at_level(logging.INFO, logger="travel_friend_backend.request_correlation"):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/test/unexpected", headers={"X-Request-ID": inbound_request_id})

    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == inbound_request_id
    assert response.json() == {"detail": "Internal server error"}
    assert secret_diagnostic not in response.text
    error_record = next(
        record
        for record in caplog.records
        if record.name == "travel_friend_backend.request_correlation" and record.levelno == logging.ERROR
    )
    assert error_record.request_id == inbound_request_id
    assert "Traceback" in error_record.getMessage()
    assert secret_diagnostic not in error_record.getMessage()


def test_completion_log_uses_only_safe_request_metadata(caplog: pytest.LogCaptureFixture) -> None:
    app = make_app()
    inbound_request_id = "60c72d71-f649-4711-a8b3-4e2584844044"
    query_secret = "query-secret"
    authorization_secret = "Bearer authorization-secret"
    cookie_secret = "session=cookie-secret"
    init_data_secret = "telegram-init-data-secret"

    with caplog.at_level(logging.INFO, logger="travel_friend_backend.request_correlation"):
        with TestClient(app) as client:
            response = client.post(
                f"/auth/telegram?token={query_secret}",
                json={"init_data": init_data_secret},
                headers={
                    "X-Request-ID": inbound_request_id,
                    "Authorization": authorization_secret,
                    "Cookie": cookie_secret,
                },
            )

    assert response.status_code == 401
    correlation_records = [
        record for record in caplog.records if record.name == "travel_friend_backend.request_correlation"
    ]
    completion_record = next(record for record in correlation_records if record.levelno == logging.INFO)
    assert completion_record.request_id == inbound_request_id
    assert completion_record.method == "POST"
    assert completion_record.path == "/auth/telegram"
    assert completion_record.status == 401
    assert completion_record.duration_ms >= 0
    rendered_logs = "\n".join(record.getMessage() for record in correlation_records)
    for secret in (query_secret, authorization_secret, cookie_secret, init_data_secret):
        assert secret not in rendered_logs


def test_completion_log_preserves_started_response_status_on_late_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    sent: list[dict[str, Any]] = []

    async def failing_app(
        _: dict[str, Any],
        __: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        await send({"type": "http.response.start", "status": 201, "headers": []})
        raise RuntimeError("late failure")

    async def receive() -> dict[str, Any]:
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/test/late-failure",
        "headers": [],
    }
    middleware = RequestCorrelationMiddleware(failing_app)

    with caplog.at_level(logging.INFO, logger="travel_friend_backend.request_correlation"):
        with pytest.raises(RuntimeError, match="late failure"):
            asyncio.run(middleware(scope, receive, send))

    completion_record = next(
        record
        for record in caplog.records
        if record.name == "travel_friend_backend.request_correlation" and record.levelno == logging.INFO
    )
    assert completion_record.status == 201
    assert any(
        name == b"x-request-id"
        for message in sent
        if message["type"] == "http.response.start"
        for name, _ in message["headers"]
    )
