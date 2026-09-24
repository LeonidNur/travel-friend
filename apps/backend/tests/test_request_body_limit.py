"""Tests for the global raw HTTP request-body size boundary."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-for-request-body-limit")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-request-body-limit")

from travel_friend_backend.config import BackendSettings
from travel_friend_backend.main import create_app
from travel_friend_backend.request_body_limit import (
    REQUEST_BODY_LIMIT_BYTES,
    RequestBodyLimitMiddleware,
)


ASGIApp = Callable[
    [dict[str, Any], Callable[[], Awaitable[dict[str, Any]]], Callable[[dict[str, Any]], Awaitable[None]]],
    Awaitable[None],
]


def http_scope(*, headers: list[tuple[bytes, bytes]] | None = None) -> dict[str, Any]:
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/test",
        "raw_path": b"/test",
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }


def run_asgi(
    app: ASGIApp, scope: dict[str, Any], messages: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    sent: list[dict[str, Any]] = []
    receive_calls = 0
    message_iterator = iter(messages)

    async def receive() -> dict[str, Any]:
        nonlocal receive_calls
        receive_calls += 1
        try:
            return next(message_iterator)
        except StopIteration as error:
            raise AssertionError("ASGI application read beyond supplied messages") from error

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent, receive_calls


def successful_response_app(received: list[dict[str, Any]]) -> ASGIApp:
    async def app(
        _: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        while True:
            message = await receive()
            received.append(message)
            if message["type"] != "http.request" or not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    return app


def response_status(sent: list[dict[str, Any]]) -> int:
    return next(message["status"] for message in sent if message["type"] == "http.response.start")


def response_body(sent: list[dict[str, Any]]) -> bytes:
    return b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")


def test_exactly_256_kib_is_replayed_downstream_byte_for_byte() -> None:
    received: list[dict[str, Any]] = []
    messages = [{"type": "http.request", "body": b"a" * REQUEST_BODY_LIMIT_BYTES, "more_body": False}]

    sent, _ = run_asgi(RequestBodyLimitMiddleware(successful_response_app(received)), http_scope(), messages)

    assert response_status(sent) == 200
    assert received == messages


def test_262145_bytes_return_413_without_calling_downstream_or_reading_more() -> None:
    downstream_called = False

    async def downstream(*_: object) -> None:
        nonlocal downstream_called
        downstream_called = True

    messages = [
        {"type": "http.request", "body": b"a" * REQUEST_BODY_LIMIT_BYTES, "more_body": True},
        {"type": "http.request", "body": b"b", "more_body": True},
        {"type": "http.request", "body": b"unread", "more_body": False},
    ]

    sent, receive_calls = run_asgi(RequestBodyLimitMiddleware(downstream), http_scope(), messages)

    assert response_status(sent) == 413
    assert response_body(sent) == b'{"detail":"Request body exceeds the 256 KiB limit"}'
    assert (b"content-type", b"application/json") in next(
        message["headers"] for message in sent if message["type"] == "http.response.start"
    )
    assert downstream_called is False
    assert receive_calls == 2


def test_oversized_valid_content_length_returns_413_without_receive_or_downstream() -> None:
    downstream_called = False

    async def downstream(*_: object) -> None:
        nonlocal downstream_called
        downstream_called = True

    sent, receive_calls = run_asgi(
        RequestBodyLimitMiddleware(downstream),
        http_scope(headers=[(b"content-length", str(REQUEST_BODY_LIMIT_BYTES + 1).encode())]),
        [],
    )

    assert response_status(sent) == 413
    assert downstream_called is False
    assert receive_calls == 0


def test_very_large_numeric_content_length_returns_413_without_integer_conversion() -> None:
    downstream_called = False

    async def downstream(*_: object) -> None:
        nonlocal downstream_called
        downstream_called = True

    sent, receive_calls = run_asgi(
        RequestBodyLimitMiddleware(downstream),
        http_scope(headers=[(b"content-length", b"9" * 5_000)]),
        [],
    )

    assert response_status(sent) == 413
    assert downstream_called is False
    assert receive_calls == 0


def test_chunked_body_without_content_length_is_enforced_cumulatively() -> None:
    received: list[dict[str, Any]] = []
    messages = [
        {"type": "http.request", "body": b"a" * (REQUEST_BODY_LIMIT_BYTES - 1), "more_body": True},
        {"type": "http.request", "body": b"bc", "more_body": False},
    ]

    sent, _ = run_asgi(RequestBodyLimitMiddleware(successful_response_app(received)), http_scope(), messages)

    assert response_status(sent) == 413
    assert received == []


def test_underreported_content_length_cannot_bypass_actual_body_limit() -> None:
    received: list[dict[str, Any]] = []
    messages = [{"type": "http.request", "body": b"a" * (REQUEST_BODY_LIMIT_BYTES + 1), "more_body": False}]

    sent, _ = run_asgi(
        RequestBodyLimitMiddleware(successful_response_app(received)),
        http_scope(headers=[(b"content-length", b"1")]),
        messages,
    )

    assert response_status(sent) == 413
    assert received == []


def test_malformed_content_length_uses_stream_enforcement() -> None:
    received: list[dict[str, Any]] = []
    messages = [{"type": "http.request", "body": b"safe", "more_body": False}]

    sent, _ = run_asgi(
        RequestBodyLimitMiddleware(successful_response_app(received)),
        http_scope(headers=[(b"content-length", b"not-a-number")]),
        messages,
    )

    assert response_status(sent) == 200
    assert received == messages


def test_non_http_scope_passes_through_without_reading() -> None:
    received_scope: dict[str, Any] | None = None

    async def downstream(scope: dict[str, Any], *_: object) -> None:
        nonlocal received_scope
        received_scope = scope

    scope = {"type": "websocket", "path": "/socket"}
    run_asgi(RequestBodyLimitMiddleware(downstream), scope, [])

    assert received_scope is scope


def test_normal_json_request_still_reaches_fastapi() -> None:
    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url=None))

    with TestClient(app) as client:
        response = client.post("/auth/telegram", json={"init_data": "invalid"})

    assert response.status_code == 503


def test_valid_telegram_auth_request_reaches_verifier_and_login(monkeypatch) -> None:
    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))
    verified_values: list[str] = []

    class Verifier:
        def verify(self, init_data: str) -> object:
            verified_values.append(init_data)
            return type("Verified", (), {"identity": object()})()

    app.state.telegram_init_data_verifier = Verifier()
    monkeypatch.setattr("travel_friend_backend.main.login", lambda *_: {"access_token": "token"})

    with TestClient(app) as client:
        response = client.post("/auth/telegram", json={"init_data": "valid"})

    assert response.status_code == 200
    assert response.json() == {"access_token": "token"}
    assert verified_values == ["valid"]


def test_oversized_telegram_auth_request_is_rejected_before_verifier_or_login(monkeypatch) -> None:
    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))
    verifier_called = False
    login_called = False

    class Verifier:
        def verify(self, _: str) -> object:
            nonlocal verifier_called
            verifier_called = True
            return type("Verified", (), {"identity": object()})()

    def fake_login(*_: object) -> dict[str, str]:
        nonlocal login_called
        login_called = True
        return {"access_token": "token"}

    app.state.telegram_init_data_verifier = Verifier()
    monkeypatch.setattr("travel_friend_backend.main.login", fake_login)
    payload = json.dumps({"init_data": "a" * REQUEST_BODY_LIMIT_BYTES}).encode()

    with TestClient(app) as client:
        response = client.post("/auth/telegram", content=payload, headers={"content-type": "application/json"})

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body exceeds the 256 KiB limit"}
    assert verifier_called is False
    assert login_called is False


def test_bodyless_health_request_continues_to_work() -> None:
    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url=None))

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
