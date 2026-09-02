"""Response schemas for authenticated Trip lifecycle operations."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
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


class TripSnapshotResponse(BaseModel):
    """Complete persisted Trip state, excluding related read models."""

    trip_id: UUID
    chat_id: UUID
    created_by_user_id: UUID
    status: Literal["forming", "active", "completed", "cancelled"]
    membership_version: int
    state_version: int
    destination_version: int
    dates_version: int
    budget_version: int
    transport_version: int
    destination_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    dates_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    budget_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    transport_status: Literal["empty", "confirmed", "review_required", "pending_analysis"]
    date_from: date | None
    date_to: date | None
    budget_min: Decimal | None
    budget_max: Decimal | None
    budget_currency: str | None
    budget_scope: Literal["per_person", "group_total"] | None
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TripRouteStopResponse(BaseModel):
    """One persisted, ordered stop in the confirmed Trip route."""

    id: UUID
    position: int
    place_label: str
    country_code: str | None
    place_ref: str | None
    stay_from: date | None
    stay_to: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class TripParticipantResponse(BaseModel):
    """Minimal participant profile projection for a Trip read."""

    user_id: UUID
    display_name: str | None
    age: int | None
    city: str | None


class TripDetailResponse(BaseModel):
    """Authenticated persisted Trip detail with route and current participants."""

    trip: TripSnapshotResponse
    route_stops: list[TripRouteStopResponse]
    participants: list[TripParticipantResponse]
