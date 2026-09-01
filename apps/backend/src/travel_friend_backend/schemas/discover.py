"""Schemas for authenticated Discover candidate and decision APIs."""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DiscoverTravelIntentResponse(BaseModel):
    """The active travel intent visible on a Discover candidate."""

    destination: str
    date_from: date | None
    date_to: date | None


class DiscoverCandidateResponse(BaseModel):
    """Public candidate data needed by the future Discover UI."""

    user_id: UUID
    display_name: str
    age: int | None
    city: str | None
    bio: str | None
    travel_style: list[str]
    interests: list[str]
    budget_level: str | None
    comfort_level: str | None
    travel_intent: DiscoverTravelIntentResponse


class DiscoverDecisionRequest(BaseModel):
    """A final current user's decision about one candidate."""

    model_config = ConfigDict(extra="forbid")

    decision: Literal["interested", "rejected"]


class DiscoverDecisionResponse(BaseModel):
    """Persisted decision and any reciprocal match result."""

    decision: Literal["interested", "rejected"]
    match_created: bool
    match_id: UUID | None
