"""FastAPI dependencies for authenticated business database work."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

import psycopg
from fastapi import Depends, HTTPException, Request

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.db import authenticated_transaction, database_connection


def get_authenticated_database_connection(
    request: Request,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
) -> Generator[psycopg.Connection, None, None]:
    """Provide a business connection scoped to one authenticated transaction."""
    settings: BackendSettings = request.app.state.backend_settings
    if not settings.database_url:
        raise HTTPException(503, "Database is not configured")

    with database_connection(settings.database_url) as connection:
        with authenticated_transaction(connection, principal.user_id):
            yield connection
