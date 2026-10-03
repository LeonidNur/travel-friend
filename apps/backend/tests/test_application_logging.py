"""Regression coverage for backend-owned production logging."""

from __future__ import annotations

import io
import logging
import os
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-for-application-logging")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-application-logging")

from travel_friend_backend import readiness
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.logging_config import (
    APPLICATION_LOGGER_NAME,
    OWNED_HANDLER_ATTRIBUTE,
    configure_application_logging,
)
from travel_friend_backend.main import create_app
from travel_friend_backend.rate_limit import TELEGRAM_LOGIN_POLICY


def make_app():
    return create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))


@contextmanager
def capture_application_logs(caplog: pytest.LogCaptureFixture):
    application_logger = logging.getLogger(APPLICATION_LOGGER_NAME)
    application_logger.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.INFO, logger=APPLICATION_LOGGER_NAME):
            yield
    finally:
        application_logger.removeHandler(caplog.handler)


def completion_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        record
        for record in caplog.records
        if record.name == "travel_friend_backend.request_correlation"
        and record.levelno == logging.INFO
    ]


def test_configured_application_handler_delivers_a_completion_info_record_to_stderr() -> None:
    application_logger = configure_application_logging()
    owned_handlers = [
        handler
        for handler in application_logger.handlers
        if getattr(handler, OWNED_HANDLER_ATTRIBUTE, False)
    ]
    assert application_logger.level == logging.INFO
    assert application_logger.propagate is False
    assert len(owned_handlers) == 1

    handler = owned_handlers[0]
    assert isinstance(handler, logging.StreamHandler)
    captured_stream = io.StringIO()
    original_stream = handler.stream
    handler.setStream(captured_stream)
    try:
        with TestClient(make_app()) as client:
            response = client.get("/health")
    finally:
        handler.setStream(original_stream)

    assert response.status_code == 200
    assert len(
        [
            configured_handler
            for configured_handler in application_logger.handlers
            if getattr(configured_handler, OWNED_HANDLER_ATTRIBUTE, False)
        ]
    ) == 1
    rendered = captured_stream.getvalue()
    assert "Request completed" in rendered
    assert f"request_id={response.headers['X-Request-ID']}" in rendered
    assert "path=/health" in rendered


def test_one_request_emits_one_completion_record_without_root_duplicates(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with capture_application_logs(caplog):
        with TestClient(make_app()) as client:
            response = client.get("/health")

    assert response.status_code == 200
    records = completion_records(caplog)
    assert len(records) == 1
    assert records[0].request_id == response.headers["X-Request-ID"]


def test_4xx_completion_contains_the_request_id(caplog: pytest.LogCaptureFixture) -> None:
    request_id = "e6acfd74-969e-4f6f-8f64-4ca55b462d6b"

    with capture_application_logs(caplog):
        with TestClient(make_app()) as client:
            response = client.post("/auth/telegram", headers={"X-Request-ID": request_id})

    assert response.status_code == 422
    records = completion_records(caplog)
    assert len(records) == 1
    assert records[0].request_id == request_id
    assert records[0].status == 422
    assert not [record for record in caplog.records if record.levelno == logging.ERROR]


def test_429_completion_contains_the_request_id(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    request_id = "b60ce5df-bcd8-47f8-8cdb-f4e1642a1055"
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

    with capture_application_logs(caplog):
        with TestClient(app) as client:
            for _ in range(TELEGRAM_LOGIN_POLICY.limit):
                assert client.post("/auth/telegram", json={"init_data": "valid"}).status_code == 200
            response = client.post(
                "/auth/telegram",
                json={"init_data": "valid"},
                headers={"X-Request-ID": request_id},
            )

    assert response.status_code == 429
    records = [record for record in completion_records(caplog) if record.request_id == request_id]
    assert len(records) == 1
    assert records[0].status == 429
    assert not [record for record in caplog.records if record.levelno == logging.ERROR]


def test_ready_503_completion_contains_the_request_id(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    request_id = "60c72d71-f649-4711-a8b3-4e2584844044"
    monkeypatch.setattr(readiness, "probe_database", lambda _: False)

    with capture_application_logs(caplog):
        with TestClient(make_app()) as client:
            response = client.get("/ready", headers={"X-Request-ID": request_id})

    assert response.status_code == 503
    records = completion_records(caplog)
    assert len(records) == 1
    assert records[0].request_id == request_id
    assert records[0].status == 503
    assert not [record for record in caplog.records if record.levelno == logging.ERROR]


def test_unexpected_500_preserves_a_correlated_error_traceback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    request_id = "f41c432a-2021-4cc9-bafd-6d49dedde4cb"
    app = make_app()
    diagnostic = "diagnostic that must not be logged"

    @app.get("/test/unexpected-logging")
    def unexpected_failure() -> None:
        raise RuntimeError(diagnostic)

    with capture_application_logs(caplog):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/test/unexpected-logging", headers={"X-Request-ID": request_id})

    assert response.status_code == 500
    error_records = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(error_records) == 1
    assert error_records[0].request_id == request_id
    assert "Traceback" in error_records[0].getMessage()
    assert diagnostic not in error_records[0].getMessage()
