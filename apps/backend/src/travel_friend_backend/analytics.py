"""Fail-closed typed analytics staging and bounded best-effort delivery."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import queue
import re
from threading import Event, Thread
from types import MappingProxyType
from typing import Literal, TypeAlias
from uuid import UUID

AnalyticsEventName: TypeAlias = Literal[
    "user_registered", "onboarding_completed", "app_opened",
    "discover_candidate_viewed", "discover_decision_saved", "match_created",
    "chat_first_message_sent", "chat_message_sent", "group_chat_created",
    "trip_created", "trip_opened", "trip_draft_updated", "trip_proposal_created",
    "trip_proposal_vote_cast", "trip_proposal_accepted", "trip_proposal_rejected",
    "trip_proposal_conflict",
]
BackendAnalyticsEventName: TypeAlias = Literal[
    "user_registered", "onboarding_completed", "discover_decision_saved", "match_created",
    "chat_first_message_sent", "chat_message_sent", "group_chat_created", "trip_created",
    "trip_draft_updated", "trip_proposal_created", "trip_proposal_vote_cast",
    "trip_proposal_accepted", "trip_proposal_rejected",
]

@dataclass(frozen=True, slots=True)
class AnalyticsEvent:
    event: BackendAnalyticsEventName
    distinct_id: str
    event_id: UUID
    timestamp: datetime
    properties: Mapping[str, object]


class AnalyticsEventValidationError(ValueError):
    """Raised for a payload outside the reviewed event taxonomy."""


_REF = re.compile(r"^[a-f0-9]{64}$")
_ALLOWED: dict[str, frozenset[str]] = {
    "user_registered": frozenset({"registration_method", "app_surface"}),
    "onboarding_completed": frozenset({"completion_path", "app_surface"}),
    "app_opened": frozenset({"app_surface", "entry_state"}),
    "discover_candidate_viewed": frozenset({"candidate_ref", "position_bucket"}),
    "discover_decision_saved": frozenset({"decision", "candidate_ref"}),
    "match_created": frozenset({"match_ref", "chat_type"}),
    "chat_first_message_sent": frozenset({"chat_ref", "chat_type"}),
    "chat_message_sent": frozenset({"chat_ref", "chat_type"}),
    "group_chat_created": frozenset({"chat_ref", "participant_count_bucket"}),
    "trip_created": frozenset({"trip_ref", "chat_ref", "chat_type", "initial_state"}),
    "trip_opened": frozenset({"trip_ref", "trip_status"}),
    "trip_draft_updated": frozenset({"trip_ref", "draft_version_bucket", "changed_scope_groups"}),
    "trip_proposal_created": frozenset({"trip_ref", "proposal_ref", "proposal_status", "scope_group_count_bucket", "has_prerequisites"}),
    "trip_proposal_vote_cast": frozenset({"trip_ref", "proposal_ref", "vote", "voter_count_bucket"}),
    "trip_proposal_accepted": frozenset({"trip_ref", "proposal_ref", "participant_count_bucket"}),
    "trip_proposal_rejected": frozenset({"trip_ref", "proposal_ref", "participant_count_bucket"}),
    "trip_proposal_conflict": frozenset({"conflict_kind", "trip_ref"}),
}
ANALYTICS_EVENT_NAMES = tuple(_ALLOWED)
_BACKEND_EVENTS = frozenset({
    "user_registered", "onboarding_completed", "discover_decision_saved", "match_created",
    "chat_first_message_sent", "chat_message_sent", "group_chat_created", "trip_created",
    "trip_draft_updated", "trip_proposal_created", "trip_proposal_vote_cast",
    "trip_proposal_accepted", "trip_proposal_rejected",
})
_ENUMS: dict[str, frozenset[str]] = {
    "registration_method": frozenset({"telegram"}),
    "app_surface": frozenset({"telegram_mini_app"}),
    "completion_path": frozenset({"profile_and_travel_intent"}),
    "entry_state": frozenset({"authenticated", "unauthenticated"}),
    "position_bucket": frozenset({"first", "later"}),
    "decision": frozenset({"interested", "rejected"}),
    "chat_type": frozenset({"direct", "group"}),
    "initial_state": frozenset({"empty"}),
    "trip_status": frozenset({"forming", "confirmed", "cancelled"}),
    "draft_version_bucket": frozenset({"1", "2_5", "6_plus"}),
    "proposal_status": frozenset({"pending", "blocked"}),
    "scope_group_count_bucket": frozenset({"1", "2_5", "6_plus"}),
    "vote": frozenset({"accept", "reject"}),
    "voter_count_bucket": frozenset({"2", "3_5", "6_plus"}),
    "conflict_kind": frozenset({"scope_overlap"}),
}
_SCOPE_GROUPS = frozenset({"route", "dates", "budget", "accommodation", "transport", "itinerary", "notes"})
_BOOLEAN_PROPERTIES = frozenset({"has_prerequisites"})
_ARRAY_PROPERTIES = frozenset({"changed_scope_groups"})


def build_analytics_event(
    event: BackendAnalyticsEventName,
    *,
    distinct_id: str,
    properties: Mapping[str, object],
    event_id: UUID,
    timestamp: datetime,
) -> AnalyticsEvent:
    """Validate the exact event property allowlist and produce an immutable envelope."""
    try:
        UUID(distinct_id)
    except (ValueError, AttributeError) as error:
        raise AnalyticsEventValidationError("Analytics distinct_id must be an authenticated user UUID") from error
    if event not in _ALLOWED or event not in _BACKEND_EVENTS:
        raise AnalyticsEventValidationError("Analytics event is not allowlisted")
    if not isinstance(properties, Mapping) or set(properties) != _ALLOWED[event]:
        raise AnalyticsEventValidationError("Analytics properties do not match the event contract")
    safe: dict[str, object] = {}
    for key, value in properties.items():
        if key.endswith("_ref"):
            if not isinstance(value, str) or _REF.fullmatch(value) is None:
                raise AnalyticsEventValidationError("Analytics entity refs must be pseudonymous hashes")
        elif key in _BOOLEAN_PROPERTIES:
            if not isinstance(value, bool):
                raise AnalyticsEventValidationError("Analytics boolean property has an invalid value")
        elif key in _ARRAY_PROPERTIES:
            if (not isinstance(value, (list, tuple)) or not value
                    or any(not isinstance(item, str) or item not in _SCOPE_GROUPS for item in value)):
                raise AnalyticsEventValidationError("Analytics scope group list has an invalid value")
            value = tuple(value)
        elif key in _ENUMS:
            if not isinstance(value, str) or value not in _ENUMS[key]:
                raise AnalyticsEventValidationError("Analytics enum property has an invalid value")
        elif key == "participant_count_bucket":
            event_buckets = (
                frozenset({"3", "4_5", "6_plus"})
                if event == "group_chat_created"
                else frozenset({"2", "3_5", "6_plus"})
            )
            if not isinstance(value, str) or value not in event_buckets:
                raise AnalyticsEventValidationError("Analytics participant bucket is invalid for this event")
        else:
            raise AnalyticsEventValidationError("Analytics property is not allowlisted")
        safe[key] = value
    if not isinstance(event_id, UUID) or event_id.version != 5:
        raise AnalyticsEventValidationError("Backend analytics event ID must be a stable UUIDv5")
    if not isinstance(timestamp, datetime) or timestamp.tzinfo is None:
        raise AnalyticsEventValidationError("Analytics timestamps must include a timezone")
    return AnalyticsEvent(
        event=event,
        distinct_id=distinct_id,
        event_id=event_id,
        timestamp=timestamp.astimezone(UTC),
        properties=MappingProxyType(safe),
    )


AnalyticsSender: TypeAlias = Callable[[AnalyticsEvent], None]


class AnalyticsDeliveryQueue:
    """Nonblocking bounded queue; no worker or delivery exists unless explicitly enabled."""

    def __init__(
        self,
        sender: AnalyticsSender | None = None,
        *,
        enabled: bool = False,
        max_size: int = 1000,
    ) -> None:
        if max_size <= 0:
            raise ValueError("Analytics queue capacity must be positive")
        self._queue: queue.Queue[AnalyticsEvent] = queue.Queue(maxsize=max_size)
        self._sender = sender
        self._enabled = enabled and sender is not None
        self._thread: Thread | None = None
        self._failed_count = 0
        self._stop = Event()
        if self._enabled:
            self._thread = Thread(target=self._run, name="analytics-delivery", daemon=True)
            self._thread.start()

    @property
    def pending_count(self) -> int:
        return self._queue.qsize()

    @property
    def failed_count(self) -> int:
        return self._failed_count

    def enqueue(self, event: AnalyticsEvent) -> bool:
        if not self._enabled:
            return False
        try:
            self._queue.put_nowait(event)
            return True
        except queue.Full:
            return False

    def close(self, timeout: float = 0.5) -> None:
        if self._thread is not None:
            self._stop.set()
            self._thread.join(timeout=max(0, timeout))

    def _run(self) -> None:
        while not self._stop.is_set() or not self._queue.empty():
            try:
                event = self._queue.get(timeout=0.05)
            except queue.Empty:
                continue
            try:
                sender = self._sender
                if sender is not None:
                    sender(event)
            except Exception:
                self._failed_count += 1
            finally:
                self._queue.task_done()


class AnalyticsStaging:
    """Request-local immutable intents; intentionally has no persistence or network behavior."""

    def __init__(self) -> None:
        self._events: list[AnalyticsEvent] = []
        self._closed = False

    def add(self, event: AnalyticsEvent) -> None:
        if not self._closed:
            self._events.append(event)

    def discard(self) -> None:
        self._events.clear()
        self._closed = True

    def publish(self, delivery_queue: AnalyticsDeliveryQueue) -> None:
        if self._closed:
            return
        events = tuple(self._events)
        self._events.clear()
        self._closed = True
        for event in events:
            try:
                delivery_queue.enqueue(event)
            except Exception:
                continue


@contextmanager
def stage_until_commit(
    transaction: AbstractContextManager[object],
    staging: AnalyticsStaging,
    delivery_queue: AnalyticsDeliveryQueue,
) -> Iterator[AnalyticsStaging]:
    """Discard on rollback/commit error; enqueue only after the outer transaction exits."""
    try:
        with transaction:
            yield staging
    except BaseException:
        staging.discard()
        raise
    else:
        staging.publish(delivery_queue)
