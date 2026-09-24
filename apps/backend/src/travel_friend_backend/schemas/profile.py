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
    travel_style: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    budget_level: str | None = None
    comfort_level: str | None = None

    @field_validator("display_name")
    @classmethod
    def display_name_cannot_be_null(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("display_name must not be null")
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("display_name must not be blank")
        if len(normalized_value) > 100:
            raise ValueError("display_name must not exceed 100 characters")
        return normalized_value

    @field_validator("birth_date")
    @classmethod
    def birth_date_must_not_be_in_the_future(cls, value: date | None) -> date | None:
        if value is not None and value > date.today():
            raise ValueError("birth_date must not be in the future")
        return value

    @field_validator("city")
    @classmethod
    def normalize_city(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized_value = value.strip()
        if not normalized_value:
            return None
        if len(normalized_value) > 100:
            raise ValueError("city must not exceed 100 characters")
        return normalized_value

    @field_validator("bio")
    @classmethod
    def normalize_bio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized_value = value.strip()
        if len(normalized_value) > 1000:
            raise ValueError("bio must not exceed 1000 characters")
        return normalized_value

    @field_validator("travel_style", "interests")
    @classmethod
    def normalize_profile_collection(cls, value: list[str]) -> list[str]:
        if len(value) > 20:
            raise ValueError("profile collections must not contain more than 20 items")
        normalized_values = [item.strip() for item in value]
        if any(not item for item in normalized_values):
            raise ValueError("profile collection items must not be blank")
        if any(len(item) > 100 for item in normalized_values):
            raise ValueError("profile collection items must not exceed 100 characters")
        if len(normalized_values) != len(set(normalized_values)):
            raise ValueError("profile collection items must be unique after normalization")
        return normalized_values


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
