"""Focused tests for the in-process fixed-window rate-limit boundary."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-test-import")

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.main import create_app
from travel_friend_backend.rate_limit import (
    DISCOVER_DECISION_POLICY,
    GROUP_CREATION_POLICY,
    MAX_CLEANUP_ENTRIES_PER_CONSUME,
    MESSAGE_CREATION_POLICY,
    RateLimitPolicy,
    TRIP_CREATION_POLICY,
    FixedWindowRateLimiter,
)
from travel_friend_backend.auth.telegram import TelegramInitDataVerificationError
from travel_friend_backend.routers import chats, discover, trips


class FakeClock:
    def __init__(self, now: float = 0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def test_fixed_window_allows_the_exact_limit_then_rejects_with_positive_retry_after() -> None:
    clock = FakeClock(12.25)
    limiter = FixedWindowRateLimiter(clock=clock)

    for _ in range(3):
        assert limiter.consume("example", "user", limit=3, window_seconds=60).allowed is True

    rejected = limiter.consume("example", "user", limit=3, window_seconds=60)

    assert rejected.allowed is False
    assert rejected.retry_after_seconds is not None
    assert rejected.retry_after_seconds >= 1


def test_fixed_window_keeps_keys_independent_and_resets_at_the_next_window() -> None:
    clock = FakeClock(0)
    limiter = FixedWindowRateLimiter(clock=clock)

    assert limiter.consume("example", "first", limit=1, window_seconds=60).allowed is True
    assert limiter.consume("example", "first", limit=1, window_seconds=60).allowed is False
    assert limiter.consume("example", "second", limit=1, window_seconds=60).allowed is True

    clock.now = 60

    assert limiter.consume("example", "first", limit=1, window_seconds=60).allowed is True


def test_fixed_window_keeps_named_buckets_independent_for_the_same_key() -> None:
    limiter = FixedWindowRateLimiter(clock=FakeClock())

    assert limiter.consume("group", "same-user", limit=1, window_seconds=600).allowed is True
    assert limiter.consume("group", "same-user", limit=1, window_seconds=600).allowed is False
    assert limiter.consume("trip", "same-user", limit=1, window_seconds=600).allowed is True


def test_fixed_window_lazily_removes_stale_buckets() -> None:
    clock = FakeClock()
    limiter = FixedWindowRateLimiter(clock=clock)
    assert limiter.consume("short", "stale", limit=1, window_seconds=60).allowed is True
    assert limiter.stored_bucket_count == 1

    clock.now = 60
    assert limiter.consume("short", "current", limit=1, window_seconds=60).allowed is True

    assert limiter.stored_bucket_count == 1


def test_cleanup_checks_only_a_bounded_batch_on_the_normal_consume_path() -> None:
    limiter = FixedWindowRateLimiter(clock=FakeClock(), cleanup_batch_size=3)
    for index in range(20):
        assert limiter.consume("example", str(index), limit=1, window_seconds=600).allowed

    assert limiter.consume("example", "current", limit=1, window_seconds=600).allowed

    assert limiter.last_cleanup_checked_count == 3
    assert limiter.last_cleanup_checked_count <= MAX_CLEANUP_ENTRIES_PER_CONSUME


def test_incremental_cleanup_removes_expired_buckets_without_removing_active_ones() -> None:
    clock = FakeClock()
    limiter = FixedWindowRateLimiter(clock=clock, cleanup_batch_size=1)
    assert limiter.consume("long", "active", limit=1, window_seconds=120).allowed
    assert limiter.consume("short", "stale-first", limit=1, window_seconds=60).allowed
    assert limiter.consume("short", "stale-second", limit=1, window_seconds=60).allowed

    clock.now = 60

    assert limiter.consume("long", "active", limit=1, window_seconds=120).allowed is False
    assert limiter.stored_bucket_count == 2
    assert limiter.consume("long", "active", limit=1, window_seconds=120).allowed is False
    assert limiter.consume("long", "active", limit=1, window_seconds=120).allowed is False
    assert limiter.stored_bucket_count == 1


def test_expired_requested_bucket_resets_even_when_outside_the_cleanup_batch() -> None:
    clock = FakeClock()
    limiter = FixedWindowRateLimiter(clock=clock, cleanup_batch_size=1)
    assert limiter.consume("example", "first", limit=1, window_seconds=60).allowed
    assert limiter.consume("example", "second", limit=1, window_seconds=60).allowed

    clock.now = 60

    assert limiter.consume("example", "second", limit=1, window_seconds=60).allowed is True


def test_capacity_rejects_new_keys_without_evicting_or_resetting_existing_buckets() -> None:
    limiter = FixedWindowRateLimiter(clock=FakeClock(), max_buckets=2, cleanup_batch_size=1)
    assert limiter.consume("example", "first", limit=2, window_seconds=600).allowed
    assert limiter.consume("example", "second", limit=1, window_seconds=600).allowed

    capacity_rejected = limiter.consume("example", "new", limit=1, window_seconds=600)

    assert capacity_rejected.allowed is False
    assert capacity_rejected.retry_after_seconds == 1
    assert limiter.stored_bucket_count == 2
    assert limiter.consume("example", "first", limit=2, window_seconds=600).allowed
    assert limiter.consume("example", "first", limit=2, window_seconds=600).allowed is False
    assert limiter.stored_bucket_count == 2


def test_bounded_cleanup_eventually_frees_capacity_for_a_new_key() -> None:
    clock = FakeClock()
    limiter = FixedWindowRateLimiter(clock=clock, max_buckets=2, cleanup_batch_size=1)
    assert limiter.consume("example", "first", limit=1, window_seconds=60).allowed
    assert limiter.consume("example", "second", limit=1, window_seconds=60).allowed

    clock.now = 60

    assert limiter.consume("example", "new", limit=1, window_seconds=60).allowed
    assert limiter.stored_bucket_count == 2


@dataclass
class FakeResult:
    value: dict[str, object]

    def fetchone(self) -> dict[str, object]:
        return self.value


class FakeConnection:
    def __init__(self, *, fail_on_execute: bool = False) -> None:
        self._fail_on_execute = fail_on_execute

    @contextmanager
    def transaction(self):
        yield self

    def execute(self, *_: object) -> FakeResult:
        if self._fail_on_execute:
            raise AssertionError("rate-limited request reached database business work")
        return FakeResult(
            {
                "decision": "interested",
                "match_created": False,
                "match_id": None,
                "message_id": "00000000-0000-0000-0000-000000000010",
                "chat_id": "00000000-0000-0000-0000-000000000011",
                "sequence_number": 1,
                "type": "text",
                "sender_user_id": "00000000-0000-0000-0000-000000000001",
                "content_text": "hello",
                "created_at": "2026-01-01T00:00:00Z",
            }
        )


@pytest.fixture
def endpoint_client() -> TestClient:
    app = create_app(
        BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused")
    )
    principal = AuthenticatedPrincipal(
        user_id=UUID("00000000-0000-0000-0000-000000000001"),
        session_id=UUID("00000000-0000-0000-0000-000000000002"),
    )
    app.dependency_overrides[auth_dependency] = lambda: principal
    app.state.fail_on_db_execute = False

    def fake_connection():
        yield FakeConnection(fail_on_execute=app.state.fail_on_db_execute)

    app.dependency_overrides[get_authenticated_database_connection] = fake_connection
    with TestClient(app) as client:
        yield client


def exhaust(limiter: FixedWindowRateLimiter, policy: RateLimitPolicy, user_id: UUID) -> None:
    for _ in range(policy.limit):
        assert limiter.consume(
            policy.name,
            str(user_id),
            limit=policy.limit,
            window_seconds=policy.window_seconds,
        ).allowed


@pytest.mark.parametrize(
    ("policy", "method", "path", "payload", "capability_name", "module"),
    [
        (
            DISCOVER_DECISION_POLICY,
            "PUT",
            "/discover/decisions/00000000-0000-0000-0000-000000000003",
            {"decision": "interested"},
            "ensure_discover_requester_eligibility",
            discover,
        ),
        (
            MESSAGE_CREATION_POLICY,
            "POST",
            "/chats/00000000-0000-0000-0000-000000000003/messages",
            {"content_text": "hello"},
            "create_chat_message",
            chats,
        ),
        (
            GROUP_CREATION_POLICY,
            "POST",
            "/chats/groups",
            {"user_ids": ["00000000-0000-0000-0000-000000000003"]},
            "create_group_chat",
            chats,
        ),
        (
            TRIP_CREATION_POLICY,
            "POST",
            "/chats/00000000-0000-0000-0000-000000000003/trips",
            {},
            "create_trip_for_chat",
            trips,
        ),
    ],
)
def test_limited_mutations_reject_before_their_business_capability(
    endpoint_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    policy: RateLimitPolicy,
    method: str,
    path: str,
    payload: dict[str, object],
    capability_name: str,
    module: object,
) -> None:
    limiter = endpoint_client.app.state.rate_limiter
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    exhaust(limiter, policy, user_id)
    endpoint_client.app.state.fail_on_db_execute = True

    def forbidden_capability(*_: object, **__: object) -> None:
        raise AssertionError("rate-limited request reached business capability")

    monkeypatch.setattr(module, capability_name, forbidden_capability)
    response = endpoint_client.request(method, path, json=payload)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests. Please retry later."}
    assert int(response.headers["Retry-After"]) >= 1


def test_group_and_trip_creation_use_independent_endpoint_buckets(
    endpoint_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = endpoint_client.app.state.rate_limiter
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    exhaust(limiter, GROUP_CREATION_POLICY, user_id)
    monkeypatch.setattr(
        trips,
        "create_trip_for_chat",
        lambda _connection, chat_id, principal: {
            "trip_id": "00000000-0000-0000-0000-000000000010",
            "chat_id": str(chat_id),
            "created_by_user_id": str(principal.user_id),
            "status": "forming",
            "created_at": "2026-01-01T00:00:00Z",
        },
    )

    group_response = endpoint_client.post(
        "/chats/groups", json={"user_ids": ["00000000-0000-0000-0000-000000000003"]}
    )
    trip_response = endpoint_client.post(
        "/chats/00000000-0000-0000-0000-000000000003/trips", json={})

    assert group_response.status_code == 429
    assert trip_response.status_code == 201


def test_health_and_an_unlimited_authenticated_mutation_do_not_create_rate_limit_buckets(
    endpoint_client: TestClient,
) -> None:
    for _ in range(20):
        assert endpoint_client.get("/health").status_code == 200
        assert endpoint_client.delete("/me/travel-intent").status_code == 204

    assert endpoint_client.app.state.rate_limiter.stored_bucket_count == 0


def test_telegram_login_is_limited_after_verification_and_before_login(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import travel_friend_backend.main as backend_main

    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))
    events: list[str] = []

    class Verifier:
        def verify(self, _: str) -> object:
            events.append("verify")
            return SimpleNamespace(identity=SimpleNamespace(telegram_user_id=123))

    def fake_login(_: str, __: object) -> dict[str, object]:
        events.append("login")
        return {"access_token": "token"}

    app.state.telegram_init_data_verifier = Verifier()
    original_limiter = app.state.rate_limiter

    class RecordingLimiter:
        def consume(self, *args: object, **kwargs: object) -> object:
            events.append("limit")
            return original_limiter.consume(*args, **kwargs)

    app.state.rate_limiter = RecordingLimiter()
    monkeypatch.setattr(backend_main, "login", fake_login)
    with TestClient(app) as client:
        for _ in range(12):
            assert client.post("/auth/telegram", json={"init_data": "valid"}).status_code == 200
        rejected = client.post("/auth/telegram", json={"init_data": "valid"})

    assert rejected.status_code == 429
    assert int(rejected.headers["Retry-After"]) >= 1
    assert events == [item for _ in range(12) for item in ("verify", "limit", "login")] + [
        "verify",
        "limit",
    ]


def test_invalid_telegram_init_data_does_not_create_a_limiter_bucket_or_login(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import travel_friend_backend.main as backend_main

    app = create_app(BackendSettings(telegram_bot_token="test-token", database_url="postgresql://unused"))
    login_called = False

    class InvalidVerifier:
        def verify(self, _: str) -> object:
            raise TelegramInitDataVerificationError("invalid")

    def fake_login(_: str, __: object) -> dict[str, object]:
        nonlocal login_called
        login_called = True
        return {}

    app.state.telegram_init_data_verifier = InvalidVerifier()
    monkeypatch.setattr(backend_main, "login", fake_login)
    with TestClient(app) as client:
        response = client.post("/auth/telegram", json={"init_data": "invalid"})

    assert response.status_code == 401
    assert login_called is False
    assert app.state.rate_limiter.stored_bucket_count == 0
