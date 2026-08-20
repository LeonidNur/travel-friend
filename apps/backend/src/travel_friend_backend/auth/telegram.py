"""Verification of Telegram Mini App raw initData."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl


TELEGRAM_WEB_APP_SECRET_KEY = b"WebAppData"
DEFAULT_MAX_AGE_SECONDS = 86_400
MAX_FUTURE_CLOCK_SKEW_SECONDS = 30


class TelegramInitDataVerificationError(ValueError):
    """Base class for rejected Telegram Mini App initData."""


class MalformedTelegramInitDataError(TelegramInitDataVerificationError):
    """Raised when initData cannot be safely parsed or normalized."""


class InvalidTelegramInitDataSignatureError(TelegramInitDataVerificationError):
    """Raised when Telegram's hash does not match the supplied initData."""


class ExpiredTelegramInitDataError(TelegramInitDataVerificationError):
    """Raised when a cryptographically valid initData is too old."""


@dataclass(frozen=True, slots=True)
class VerifiedTelegramIdentity:
    """Normalized Telegram user information from verified initData."""

    telegram_user_id: int
    first_name: str
    last_name: str | None
    username: str | None
    language_code: str | None
    is_premium: bool


@dataclass(frozen=True, slots=True)
class VerifiedTelegramInitData:
    """Cryptographically verified Telegram Mini App context."""

    identity: VerifiedTelegramIdentity
    auth_date: int
    query_id: str | None


class TelegramInitDataVerifier:
    """Validates raw initData before any Telegram user data is consumed."""

    def __init__(
        self,
        *,
        bot_token: str,
        max_age_seconds: int = DEFAULT_MAX_AGE_SECONDS,
        clock: Callable[[], int] = lambda: int(time.time()),
    ) -> None:
        if not bot_token:
            raise ValueError("Telegram bot token must not be empty")
        if max_age_seconds <= 0:
            raise ValueError("max_age_seconds must be positive")

        self._bot_token = bot_token
        self._max_age_seconds = max_age_seconds
        self._clock = clock

    def verify(self, raw_init_data: str) -> VerifiedTelegramInitData:
        fields = _parse_init_data(raw_init_data)
        supplied_hash = fields.pop("hash")
        _verify_signature(fields, supplied_hash, self._bot_token)

        auth_date = _parse_auth_date(fields.get("auth_date"))
        _verify_auth_date_freshness(
            auth_date=auth_date,
            now=self._clock(),
            max_age_seconds=self._max_age_seconds,
        )
        identity = _parse_verified_identity(fields.get("user"))

        return VerifiedTelegramInitData(
            identity=identity,
            auth_date=auth_date,
            query_id=fields.get("query_id"),
        )


def _parse_init_data(raw_init_data: str) -> dict[str, str]:
    if not isinstance(raw_init_data, str) or not raw_init_data:
        raise MalformedTelegramInitDataError("initData must be a non-empty query string")

    try:
        pairs = parse_qsl(raw_init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as error:
        raise MalformedTelegramInitDataError("initData is not a valid query string") from error

    fields: dict[str, str] = {}
    for key, value in pairs:
        if not key or key in fields:
            raise MalformedTelegramInitDataError("initData has invalid or duplicate fields")
        fields[key] = value

    if not fields.get("hash"):
        raise MalformedTelegramInitDataError("initData hash is missing")

    return fields


def _verify_signature(
    fields: dict[str, str], supplied_hash: str, bot_token: str
) -> None:
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(fields.items())
    )
    secret_key = hmac.new(
        TELEGRAM_WEB_APP_SECRET_KEY, bot_token.encode("utf-8"), hashlib.sha256
    ).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, supplied_hash):
        raise InvalidTelegramInitDataSignatureError("initData hash is invalid")


def _parse_auth_date(raw_auth_date: str | None) -> int:
    if raw_auth_date is None:
        raise MalformedTelegramInitDataError("initData auth_date is missing")

    try:
        auth_date = int(raw_auth_date)
    except ValueError as error:
        raise MalformedTelegramInitDataError("initData auth_date is invalid") from error

    if auth_date < 0:
        raise MalformedTelegramInitDataError("initData auth_date is invalid")

    return auth_date


def _verify_auth_date_freshness(
    *, auth_date: int, now: int, max_age_seconds: int
) -> None:
    if auth_date > now + MAX_FUTURE_CLOCK_SKEW_SECONDS:
        raise MalformedTelegramInitDataError("initData auth_date is in the future")
    if now - auth_date > max_age_seconds:
        raise ExpiredTelegramInitDataError("initData auth_date is too old")


def _parse_verified_identity(raw_user: str | None) -> VerifiedTelegramIdentity:
    if raw_user is None:
        raise MalformedTelegramInitDataError("initData user is missing")

    try:
        user: Any = json.loads(raw_user)
    except json.JSONDecodeError as error:
        raise MalformedTelegramInitDataError("initData user is invalid JSON") from error

    if not isinstance(user, dict):
        raise MalformedTelegramInitDataError("initData user must be an object")

    telegram_user_id = user.get("id")
    first_name = user.get("first_name")
    if (
        not isinstance(telegram_user_id, int)
        or isinstance(telegram_user_id, bool)
        or telegram_user_id <= 0
        or not isinstance(first_name, str)
        or not first_name
    ):
        raise MalformedTelegramInitDataError("initData user has invalid required fields")

    return VerifiedTelegramIdentity(
        telegram_user_id=telegram_user_id,
        first_name=first_name,
        last_name=_optional_string(user, "last_name"),
        username=_optional_string(user, "username"),
        language_code=_optional_string(user, "language_code"),
        is_premium=_optional_bool(user, "is_premium"),
    )


def _optional_string(user: dict[str, Any], field_name: str) -> str | None:
    value = user.get(field_name)
    if value is not None and not isinstance(value, str):
        raise MalformedTelegramInitDataError(f"initData user {field_name} is invalid")
    return value


def _optional_bool(user: dict[str, Any], field_name: str) -> bool:
    value = user.get(field_name, False)
    if not isinstance(value, bool):
        raise MalformedTelegramInitDataError(f"initData user {field_name} is invalid")
    return value
