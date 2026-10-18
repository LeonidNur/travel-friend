"""Shared fixtures for local PostgreSQL-backed tests."""

from __future__ import annotations

import os

import pytest

from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_runtime_database_url,
)

# Importing the module-level FastAPI app requires a valid test-only admission
# policy. These synthetic IDs are isolated to pytest and are never production
# allowlist values.
os.environ["TELEGRAM_CORE_USER_IDS"] = "1,2,123"
os.environ["TELEGRAM_TESTER_USER_IDS"] = "4,7654321"
os.environ["TELEGRAM_TESTERS_PAUSED"] = "false"


@pytest.fixture
def runtime_database_url() -> str:
    try:
        return get_disposable_runtime_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))
