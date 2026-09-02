"""Response schemas for authenticated Trip lifecycle operations."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class TripCreateResponse(BaseModel):
    """Server-created initial snapshot for a direct Chat Trip."""

    trip_id: UUID
    chat_id: UUID
    created_by_user_id: UUID
    status: Literal["forming"]
    created_at: datetime


class TripListItemResponse(BaseModel):
    """Minimal persisted Trip read model for one authenticated participant."""

    trip_id: UUID
    chat_id: UUID
    status: Literal["forming", "active", "completed", "cancelled"]
    created_at: datetime
    date_from: date | None
    date_to: date | None
    destination_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    dates_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    budget_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    transport_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    route_place_labels: list[str]
