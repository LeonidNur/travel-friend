"""Bounded PostgreSQL readiness probe for the backend runtime dependency."""

from __future__ import annotations

import psycopg


READINESS_CONNECT_TIMEOUT_SECONDS = 3
READINESS_STATEMENT_TIMEOUT_MILLISECONDS = 2_000


def probe_database(database_url: str | None) -> bool:
    """Return whether a new bounded connection can execute the minimal probe."""
    if not database_url:
        return False

    try:
        with psycopg.connect(
            database_url,
            connect_timeout=READINESS_CONNECT_TIMEOUT_SECONDS,
            options=f"-c statement_timeout={READINESS_STATEMENT_TIMEOUT_MILLISECONDS}",
        ) as connection:
            connection.execute("SELECT 1")
    except (psycopg.OperationalError, psycopg.InterfaceError):
        return False

    return True
