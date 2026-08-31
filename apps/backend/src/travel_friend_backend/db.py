"""Minimal PostgreSQL connection helpers for backend dependencies."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

import psycopg
from fastapi import HTTPException, Request
from psycopg.rows import dict_row

from travel_friend_backend.config import BackendSettings


@contextmanager
def database_connection(database_url: str) -> Generator[psycopg.Connection, None, None]:
    """Open one short-lived connection with dictionary rows."""
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        yield connection


def get_database_connection(request: Request) -> Generator[psycopg.Connection, None, None]:
    """Provide a request-scoped connection for future authenticated routers."""
    settings: BackendSettings = request.app.state.backend_settings
    if not settings.database_url:
        raise HTTPException(503, "Database is not configured")

    with database_connection(settings.database_url) as connection:
        yield connection
