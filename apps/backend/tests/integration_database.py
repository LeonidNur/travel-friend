"""Fail-closed safety boundary for destructive PostgreSQL integration tests."""

from __future__ import annotations

import os
from collections.abc import Mapping
from urllib.parse import unquote, urlparse

import psycopg


DISPOSABLE_TEST_DATABASE_NAME = "travel_friend_test"
RESERVED_DATABASE_NAMES = frozenset({"postgres", "template0", "template1"})
POSTGRESQL_SCHEMES = frozenset({"postgres", "postgresql"})
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


class UnsafeTestDatabaseUrlError(RuntimeError):
    """Raised when a database target is not explicitly disposable for tests."""


class IntegrationDatabaseNotConfiguredError(UnsafeTestDatabaseUrlError):
    """Raised when PostgreSQL integration tests have no configured target."""


def require_disposable_test_database_url(
    database_url: str,
    *,
    environment: Mapping[str, str] | None = None,
) -> str:
    """Validate the only database target permitted for destructive test cleanup."""
    parsed = _parse_postgresql_url(database_url)
    database_name = unquote(parsed.path.lstrip("/"))

    if database_name in RESERVED_DATABASE_NAMES:
        raise UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must not target a reserved PostgreSQL database")
    if database_name != DISPOSABLE_TEST_DATABASE_NAME:
        raise UnsafeTestDatabaseUrlError(
            f"TEST_DATABASE_URL must target the dedicated disposable database {DISPOSABLE_TEST_DATABASE_NAME!r}"
        )

    source = os.environ if environment is None else environment
    runtime_database_url = source.get("DATABASE_URL")
    if runtime_database_url and _same_database_target(database_url, runtime_database_url):
        raise UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must not equal DATABASE_URL")

    return database_url


def get_disposable_test_database_url(
    environment: Mapping[str, str] | None = None,
) -> str:
    """Read and validate the integration-test database URL from the environment."""
    source = os.environ if environment is None else environment
    database_url = source.get("TEST_DATABASE_URL")
    if database_url is None or not database_url.strip():
        raise IntegrationDatabaseNotConfiguredError("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return require_disposable_test_database_url(database_url, environment=source)


def truncate_disposable_test_database(database_url: str, truncate_sql: str) -> None:
    """Revalidate immediately before a destructive cleanup statement."""
    require_disposable_test_database_url(database_url)
    with psycopg.connect(database_url) as connection:
        connection.execute(truncate_sql)


def _parse_postgresql_url(database_url: str):
    parsed = urlparse(database_url)
    if parsed.scheme.lower() not in POSTGRESQL_SCHEMES or not parsed.hostname:
        raise UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must be a PostgreSQL URL with a database host")
    if not parsed.path or parsed.path.count("/") != 1:
        raise UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must name exactly one database")
    try:
        parsed.port
    except ValueError as error:
        raise UnsafeTestDatabaseUrlError("TEST_DATABASE_URL has an invalid PostgreSQL port") from error
    return parsed


def _same_database_target(first_url: str, second_url: str) -> bool:
    if first_url == second_url:
        return True
    try:
        return _database_target(first_url) == _database_target(second_url)
    except UnsafeTestDatabaseUrlError:
        return False


def _database_target(database_url: str) -> tuple[str, str, int, str]:
    parsed = _parse_postgresql_url(database_url)
    port = parsed.port or 5432
    host = parsed.hostname.lower()
    canonical_host = "loopback" if host in LOOPBACK_HOSTS else host
    return ("postgresql", canonical_host, port, unquote(parsed.path.lstrip("/")))
