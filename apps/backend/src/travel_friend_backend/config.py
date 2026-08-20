"""Server-only backend configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass


class TelegramBotTokenNotConfiguredError(RuntimeError):
    """Raised when the backend cannot verify Telegram initData safely."""


@dataclass(frozen=True, slots=True)
class BackendSettings:
    telegram_bot_token: str


def get_backend_settings(
    environment: Mapping[str, str] | None = None,
) -> BackendSettings:
    source = os.environ if environment is None else environment
    bot_token = source.get("TELEGRAM_BOT_TOKEN")
    if bot_token is None or not bot_token.strip():
        raise TelegramBotTokenNotConfiguredError(
            "TELEGRAM_BOT_TOKEN must be configured in the server environment"
        )

    return BackendSettings(telegram_bot_token=bot_token)
