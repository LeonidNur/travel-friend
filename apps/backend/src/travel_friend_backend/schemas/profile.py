"""Schemas for the authenticated current-user profile API."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProfilePatchRequest(BaseModel):
    """Whitelisted mutable columns of the physical profiles table."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    birth_date: date | None = None
    gender: str | None = None
    city: str | None = None
    bio: str | None = None
    travel_style: list[str | None] = Field(default_factory=list)
    interests: list[str | None] = Field(default_factory=list)
    budget_level: str | None = None
    comfort_level: str | None = None

    @field_validator("display_name")
    @classmethod
    def display_name_cannot_be_null(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("display_name must not be null")
        return value


class ProfileResponse(BaseModel):
    """Physical profile row returned only to its owning user."""

    id: UUID
    user_id: UUID
    display_name: str
    birth_date: date | None
    gender: str | None
    city: str | None
    bio: str | None
    travel_style: list[str | None]
    interests: list[str | None]
    budget_level: str | None
    comfort_level: str | None
    created_at: datetime
    updated_at: datetime
