"""Schemas for the authenticated current-user travel-intent API."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class TravelIntentPutRequest(BaseModel):
    """The complete client-managed state of an active travel intent."""

    model_config = ConfigDict(extra="forbid")

    destination: str
    date_from: date | None = None
    date_to: date | None = None

    @model_validator(mode="after")
    def date_range_is_valid(self) -> TravelIntentPutRequest:
        if self.date_from is not None and self.date_to is not None and self.date_to < self.date_from:
            raise ValueError("date_to must be greater than or equal to date_from")
        return self


class TravelIntentResponse(BaseModel):
    """An intent row returned to its owning current user."""

    id: UUID
    user_id: UUID
    destination: str
    date_from: date | None
    date_to: date | None
    status: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
