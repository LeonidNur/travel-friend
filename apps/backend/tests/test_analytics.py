from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from threading import Event
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest

from travel_friend_backend.analytics import (
    ANALYTICS_EVENT_NAMES,
    AnalyticsDeliveryQueue,
    AnalyticsEventValidationError,
    AnalyticsStaging,
    build_analytics_event,
    stage_until_commit,
)


def sample_backend_event():
    return build_analytics_event(
        "trip_draft_updated",
        distinct_id=str(uuid4()),
        properties={
            "trip_ref": "a" * 64,
            "draft_version_bucket": "1",
            "changed_scope_groups": ["budget"],
        },
        event_id=uuid5(NAMESPACE_URL, "trip_draft_updated:fact-1"),
        timestamp=datetime.now(UTC),
    )


def test_analytics_disabled_without_sender_and_missing_sdk_sends_nothing() -> None:
    queue = AnalyticsDeliveryQueue()
    assert queue.enqueue(sample_backend_event()) is False
    assert queue.pending_count == 0


def test_event_contract_rejects_unknown_properties_and_pii() -> None:
    event_defaults = {"event_id": uuid5(NAMESPACE_URL, "validation-test"), "timestamp": datetime.now(UTC)}
    with pytest.raises(AnalyticsEventValidationError):
        build_analytics_event(
            "trip_opened", distinct_id=str(uuid4()),
            properties={"trip_ref": "a" * 64, "trip_status": "forming", "route": "Rome"},
            **event_defaults,
        )
    with pytest.raises(AnalyticsEventValidationError):
        build_analytics_event(
            "chat_message_sent", distinct_id=str(uuid4()),
            properties={"chat_ref": "a" * 64, "message_text": "hello"},
            **event_defaults,
        )
    with pytest.raises(AnalyticsEventValidationError):
        build_analytics_event(
            "trip_opened", distinct_id=str(uuid4()),
            properties={"trip_ref": "raw-database-id", "trip_status": "forming"},
            **event_defaults,
        )


def test_event_contract_has_exactly_the_approved_seventeen_names() -> None:
    assert ANALYTICS_EVENT_NAMES == (
        "user_registered", "onboarding_completed", "app_opened", "discover_candidate_viewed",
        "discover_decision_saved", "match_created", "chat_first_message_sent", "chat_message_sent",
        "group_chat_created", "trip_created", "trip_opened", "trip_draft_updated",
        "trip_proposal_created", "trip_proposal_vote_cast", "trip_proposal_accepted",
        "trip_proposal_rejected", "trip_proposal_conflict",
    )


def test_event_builder_preserves_caller_supplied_retry_identity() -> None:
    event_id = uuid5(NAMESPACE_URL, "trip_draft_updated:stable-fact")
    timestamp = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
    kwargs = {
        "distinct_id": str(uuid4()),
        "event_id": event_id,
        "timestamp": timestamp,
    }

    event_kwargs = {
        **kwargs,
        "properties": {
            "trip_ref": "a" * 64,
            "draft_version_bucket": "1",
            "changed_scope_groups": ["budget"],
        },
    }
    first = build_analytics_event("trip_draft_updated", **event_kwargs)
    retry = build_analytics_event("trip_draft_updated", **event_kwargs)

    assert first.event_id == retry.event_id == event_id
    assert first.timestamp == retry.timestamp == timestamp


def test_backend_rejects_frontend_owned_events_and_invalid_bucket_for_owner() -> None:
    with pytest.raises(AnalyticsEventValidationError):
        build_analytics_event(
            "trip_opened", distinct_id=str(uuid4()),
            properties={"trip_ref": "a" * 64, "trip_status": "forming"},
            event_id=uuid5(NAMESPACE_URL, "trip-opened"), timestamp=datetime.now(UTC),
        )  # type: ignore[arg-type]
    with pytest.raises(AnalyticsEventValidationError):
        build_analytics_event(
            "group_chat_created", distinct_id=str(uuid4()),
            properties={"chat_ref": "a" * 64, "participant_count_bucket": "2"},
            event_id=uuid5(NAMESPACE_URL, "group-chat"), timestamp=datetime.now(UTC),
        )


@pytest.mark.parametrize("capacity", [0, -1])
def test_queue_rejects_non_positive_capacity(capacity: int) -> None:
    with pytest.raises(ValueError, match="capacity must be positive"):
        AnalyticsDeliveryQueue(sender=lambda _event: None, enabled=True, max_size=capacity)


def test_queue_is_bounded_and_enqueue_does_not_wait_for_sender() -> None:
    release_sender = Event()
    started_sender = Event()

    def blocked_sender(_event) -> None:
        started_sender.set()
        release_sender.wait(timeout=1)

    queue = AnalyticsDeliveryQueue(sender=blocked_sender, enabled=True, max_size=1)
    try:
        assert queue.enqueue(sample_backend_event()) is True
        assert started_sender.wait(timeout=1)
        assert queue.enqueue(sample_backend_event()) is True
        assert queue.enqueue(sample_backend_event()) is False
    finally:
        release_sender.set()
        queue.close(timeout=1)


def test_sender_failure_is_swallowed_and_queue_worker_continues() -> None:
    sent = Event()

    def failing_sender(_event) -> None:
        sent.set()
        raise RuntimeError("provider unavailable")

    queue = AnalyticsDeliveryQueue(sender=failing_sender, enabled=True, max_size=2)
    try:
        assert queue.enqueue(sample_backend_event()) is True
        assert sent.wait(timeout=1)
        assert queue.failed_count == 1
    finally:
        queue.close(timeout=1)


@contextmanager
def transaction_with_failure(kind: str | None = None):
    yield
    if kind == "commit":
        raise RuntimeError("commit failed")


def test_staged_events_are_enqueued_only_after_successful_commit() -> None:
    committed = Event()
    delivered_after_commit = Event()

    def sender(_event) -> None:
        assert committed.is_set()
        delivered_after_commit.set()

    @contextmanager
    def transaction():
        yield
        committed.set()

    queue = AnalyticsDeliveryQueue(sender=sender, enabled=True, max_size=2)
    stage = AnalyticsStaging()
    event = sample_backend_event()

    with stage_until_commit(transaction(), stage, queue):
        stage.add(event)
        assert queue.pending_count == 0

    assert delivered_after_commit.wait(timeout=1)
    queue.close(timeout=0.1)


@pytest.mark.parametrize("failure", ["rollback", "commit"])
def test_rollback_or_commit_failure_discards_staged_events(failure: str) -> None:
    sender_called = Event()

    def sender(_event) -> None:
        sender_called.set()

    queue = AnalyticsDeliveryQueue(sender=sender, enabled=True, max_size=2)
    stage = AnalyticsStaging()
    with pytest.raises(RuntimeError):
        with stage_until_commit(transaction_with_failure(failure), stage, queue):
            stage.add(sample_backend_event())
            if failure == "rollback":
                raise RuntimeError("transaction rolled back")
    assert queue.pending_count == 0
    assert not sender_called.wait(timeout=0.1)
    queue.close(timeout=0.1)


def test_queue_enqueue_failure_after_commit_does_not_escape_to_business_flow() -> None:
    class BrokenQueue:
        def enqueue(self, _event) -> bool:
            raise RuntimeError("queue unavailable")

    stage = AnalyticsStaging()
    with stage_until_commit(transaction_with_failure(), stage, BrokenQueue()):  # type: ignore[arg-type]
        stage.add(sample_backend_event())

