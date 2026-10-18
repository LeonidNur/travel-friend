"""Server-only backend configuration."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field


class TelegramBotTokenNotConfiguredError(RuntimeError):
    """Raised when the backend cannot verify Telegram initData safely."""


class DatabaseUrlNotConfiguredError(RuntimeError):
    """Raised when the backend cannot access its server-side database."""


class AdmissionConfigurationError(RuntimeError):
    """Raised when server-side admission settings are missing or invalid."""


@dataclass(frozen=True, slots=True)
class AdmissionPolicy:
    """Server-only allowlists used for login and every authenticated request."""

    core_user_ids: frozenset[int]
    tester_user_ids: frozenset[int]
    testers_paused: bool

    @classmethod
    def deny_all(cls) -> AdmissionPolicy:
        return cls(core_user_ids=frozenset(), tester_user_ids=frozenset(), testers_paused=True)

    def is_allowed(self, telegram_user_id: int) -> bool:
        return telegram_user_id in self.core_user_ids or (
            not self.testers_paused and telegram_user_id in self.tester_user_ids
        )


def _parse_telegram_id_list(
    value: str | None, *, allow_empty: bool = False
) -> frozenset[int]:
    if value is None:
        raise AdmissionConfigurationError("Tester admission configuration is invalid")
    if not value.strip():
        if allow_empty:
            return frozenset()
        raise AdmissionConfigurationError("Tester admission configuration is invalid")

    values = value.split(",")
    parsed: list[int] = []
    for raw_value in values:
        candidate = raw_value.strip()
        if not re.fullmatch(r"[1-9][0-9]*", candidate):
            raise AdmissionConfigurationError("Tester admission configuration is invalid")
        parsed_id = int(candidate)
        if parsed_id > 9_223_372_036_854_775_807:
            raise AdmissionConfigurationError("Tester admission configuration is invalid")
        parsed.append(parsed_id)

    result = frozenset(parsed)
    if len(result) != len(parsed):
        raise AdmissionConfigurationError("Tester admission configuration is invalid")
    return result


def _parse_admission_policy(source: Mapping[str, str]) -> AdmissionPolicy:
    try:
        core_user_ids = _parse_telegram_id_list(source.get("TELEGRAM_CORE_USER_IDS"))
        tester_user_ids = _parse_telegram_id_list(
            source.get("TELEGRAM_TESTER_USER_IDS"), allow_empty=True
        )
        paused_value = source.get("TELEGRAM_TESTERS_PAUSED", "").strip().lower()
        if paused_value not in {"true", "false"}:
            raise AdmissionConfigurationError("Tester admission configuration is invalid")
        if len(core_user_ids) != 3 or len(tester_user_ids) > 7 or core_user_ids & tester_user_ids:
            raise AdmissionConfigurationError("Tester admission configuration is invalid")
    except AdmissionConfigurationError:
        raise

    return AdmissionPolicy(
        core_user_ids=core_user_ids,
        tester_user_ids=tester_user_ids,
        testers_paused=paused_value == "true",
    )


@dataclass(frozen=True, slots=True)
class BackendSettings:
    telegram_bot_token: str
    database_url: str | None = None
    admission_policy: AdmissionPolicy = field(default_factory=AdmissionPolicy.deny_all)


def get_backend_settings(
    environment: Mapping[str, str] | None = None,
) -> BackendSettings:
    source = os.environ if environment is None else environment
    bot_token = source.get("TELEGRAM_BOT_TOKEN")
    if bot_token is None or not bot_token.strip():
        raise TelegramBotTokenNotConfiguredError(
            "TELEGRAM_BOT_TOKEN must be configured in the server environment"
        )
    database_url = source.get("DATABASE_URL")
    if database_url is None or not database_url.strip():
        raise DatabaseUrlNotConfiguredError(
            "DATABASE_URL must be configured in the server environment"
        )

    admission_policy = _parse_admission_policy(source)
    return BackendSettings(
        telegram_bot_token=bot_token,
        database_url=database_url,
        admission_policy=admission_policy,
    )
