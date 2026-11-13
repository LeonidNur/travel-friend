"""FastAPI dependencies for authenticated business database work."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

import psycopg
from fastapi import Depends, HTTPException, Request

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.analytics import AnalyticsDeliveryQueue, AnalyticsStaging, stage_until_commit
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.db import authenticated_transaction, database_connection


def get_analytics_staging(request: Request) -> AnalyticsStaging:
    """Return this request's analytics collector; it remains inert unless explicitly used."""
    staging = getattr(request.state, "analytics_staging", None)
    if staging is None:
        staging = AnalyticsStaging()
        request.state.analytics_staging = staging
    return staging


def get_authenticated_database_connection(
    request: Request,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
) -> Generator[psycopg.Connection, None, None]:
    """Provide a business connection scoped to one authenticated transaction."""
    settings: BackendSettings = request.app.state.backend_settings
    if not settings.database_url:
        raise HTTPException(503, "Database is not configured")

    staging = get_analytics_staging(request)
    delivery_queue: AnalyticsDeliveryQueue = request.app.state.analytics_delivery_queue
    with database_connection(settings.database_url) as connection:
        with stage_until_commit(
            authenticated_transaction(connection, principal.user_id),
            staging,
            delivery_queue,
        ):
            yield connection
