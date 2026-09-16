"""Shared fixtures for local PostgreSQL-backed tests."""

from __future__ import annotations

import pytest

from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_runtime_database_url,
)


@pytest.fixture
def runtime_database_url() -> str:
    try:
        return get_disposable_runtime_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))
