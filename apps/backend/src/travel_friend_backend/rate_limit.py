"""Minimal per-process fixed-window rate limiting for selected write routes."""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency


RATE_LIMIT_DETAIL = "Too many requests. Please retry later."
MAX_TRACKED_BUCKETS = 10_000
MAX_CLEANUP_ENTRIES_PER_CONSUME = 32
CAPACITY_RETRY_AFTER_SECONDS = 1


@dataclass(frozen=True, slots=True)
class RateLimitPolicy:
    """One independent fixed-window request policy."""

    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    """Outcome of consuming one request from a policy bucket."""

    allowed: bool
    retry_after_seconds: int | None = None


@dataclass(slots=True)
class _Bucket:
    reset_at: float
    count: int


TELEGRAM_LOGIN_POLICY = RateLimitPolicy("telegram-login", limit=12, window_seconds=600)
DISCOVER_DECISION_POLICY = RateLimitPolicy("discover-decision", limit=90, window_seconds=60)
MESSAGE_CREATION_POLICY = RateLimitPolicy("message-creation", limit=40, window_seconds=60)
GROUP_CREATION_POLICY = RateLimitPolicy("group-creation", limit=5, window_seconds=600)
TRIP_CREATION_POLICY = RateLimitPolicy("trip-creation", limit=5, window_seconds=600)


class FixedWindowRateLimiter:
    """Thread-safe in-memory limiter whose keys expire at a fixed window boundary."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_buckets: int = MAX_TRACKED_BUCKETS,
        cleanup_batch_size: int = MAX_CLEANUP_ENTRIES_PER_CONSUME,
    ) -> None:
        if max_buckets <= 0:
            raise ValueError("max_buckets must be positive")
        if cleanup_batch_size <= 0:
            raise ValueError("cleanup_batch_size must be positive")
        self._clock = clock
        self._max_buckets = max_buckets
        self._cleanup_batch_size = cleanup_batch_size
        self._buckets: OrderedDict[tuple[str, str], _Bucket] = OrderedDict()
        self._lock = threading.Lock()
        self._last_cleanup_checked_count = 0

    @property
    def stored_bucket_count(self) -> int:
        """Return stored bucket count for diagnostics and deterministic tests."""
        with self._lock:
            return len(self._buckets)

    @property
    def last_cleanup_checked_count(self) -> int:
        """Return the bounded cleanup work performed by the latest consume."""
        with self._lock:
            return self._last_cleanup_checked_count

    def consume(
        self, policy_name: str, key: str, *, limit: int, window_seconds: int
    ) -> RateLimitResult:
        """Consume a request or return the positive whole-second retry delay."""
        if limit <= 0:
            raise ValueError("limit must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")

        now = self._clock()
        bucket_key = (policy_name, key)
        with self._lock:
            self._last_cleanup_checked_count = self._remove_expired_buckets(now)
            bucket = self._buckets.get(bucket_key)
            if bucket is not None and bucket.reset_at <= now:
                del self._buckets[bucket_key]
                bucket = None
            if bucket is None:
                if len(self._buckets) >= self._max_buckets:
                    return RateLimitResult(
                        allowed=False,
                        retry_after_seconds=CAPACITY_RETRY_AFTER_SECONDS,
                    )
                reset_at = (math.floor(now / window_seconds) + 1) * window_seconds
                self._buckets[bucket_key] = _Bucket(reset_at=reset_at, count=1)
                return RateLimitResult(allowed=True)

            if bucket.count < limit:
                bucket.count += 1
                return RateLimitResult(allowed=True)

            retry_after_seconds = max(1, math.ceil(bucket.reset_at - now))
            return RateLimitResult(allowed=False, retry_after_seconds=retry_after_seconds)

    def _remove_expired_buckets(self, now: float) -> int:
        """Inspect a fixed batch, retaining active entries at the queue tail."""
        checked_count = 0
        while checked_count < self._cleanup_batch_size and self._buckets:
            bucket_key, bucket = self._buckets.popitem(last=False)
            checked_count += 1
            if bucket.reset_at > now:
                self._buckets[bucket_key] = bucket
        return checked_count


def enforce_rate_limit(
    limiter: FixedWindowRateLimiter, policy: RateLimitPolicy, key: str
) -> None:
    """Raise the API's stable 429 response when a bucket is exhausted."""
    result = limiter.consume(
        policy.name,
        key,
        limit=policy.limit,
        window_seconds=policy.window_seconds,
    )
    if not result.allowed:
        raise HTTPException(
            status_code=429,
            detail=RATE_LIMIT_DETAIL,
            headers={"Retry-After": str(result.retry_after_seconds)},
        )


def authenticated_rate_limit(policy: RateLimitPolicy) -> Callable[..., None]:
    """Build a dependency executed after session resolution and before route work."""

    def enforce_authenticated_rate_limit(
        request: Request,
        principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    ) -> None:
        limiter: FixedWindowRateLimiter = request.app.state.rate_limiter
        enforce_rate_limit(limiter, policy, str(principal.user_id))

    return enforce_authenticated_rate_limit
