"""Server-only backend configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass


class TelegramBotTokenNotConfiguredError(RuntimeError):
    """Raised when the backend cannot verify Telegram initData safely."""


class DatabaseUrlNotConfiguredError(RuntimeError):
    """Raised when the backend cannot access its server-side database."""


@dataclass(frozen=True, slots=True)
class BackendSettings:
    telegram_bot_token: str
    database_url: str | None = None


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

    return BackendSettings(telegram_bot_token=bot_token, database_url=database_url)
