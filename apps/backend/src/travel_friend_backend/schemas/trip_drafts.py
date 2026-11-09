"""Validated read and write models for the shared Trip Draft."""

from __future__ import annotations

from datetime import date as DateValue
from datetime import datetime, time
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TripDraftRouteStop(StrictModel):
    id: UUID
    place_label: str = Field(default="", max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    place_ref: str | None = Field(default=None, max_length=200)
    stay_from: DateValue | None = None
    stay_to: DateValue | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_stay_dates(self) -> TripDraftRouteStop:
        if self.stay_from and self.stay_to and self.stay_to < self.stay_from:
            raise ValueError("stay_to must not be before stay_from")
        return self


class TripDraftAccommodation(StrictModel):
    id: UUID
    name: str = Field(default="", max_length=160)
    location: str | None = Field(default=None, max_length=240)
    date_from: DateValue | None = None
    date_to: DateValue | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_dates(self) -> TripDraftAccommodation:
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("date_to must not be before date_from")
        return self


class TripDraftTransport(StrictModel):
    id: UUID
    mode: str = Field(default="", max_length=80)
    origin: str | None = Field(default=None, max_length=160)
    destination: str | None = Field(default=None, max_length=160)
    departure_at: datetime | None = None
    arrival_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)

class TripDraftBudget(StrictModel):
    min: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    max: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    scope: Literal["per_person", "group_total"] | None = None

    @model_validator(mode="after")
    def validate_range(self) -> TripDraftBudget:
        if self.min is not None and self.max is not None and self.max < self.min:
            raise ValueError("max must be greater than or equal to min")
        return self


class TripDraftEvent(StrictModel):
    id: UUID
    kind: Literal["activity", "transport", "accommodation", "meal", "note", "other"]
    title: str = Field(default="", max_length=200)
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    address: str | None = Field(default=None, max_length=240)
    estimated_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = Field(default=None, max_length=2000)

class TripDraftDay(StrictModel):
    id: UUID
    date: DateValue | None = None
    title: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)
    events: list[TripDraftEvent] = Field(default_factory=list, max_length=80)


class TripDraftContent(StrictModel):
    route_stops: list[TripDraftRouteStop] = Field(default_factory=list, max_length=60)
    date_from: DateValue | None = None
    date_to: DateValue | None = None
    accommodations: list[TripDraftAccommodation] = Field(default_factory=list, max_length=60)
    transport: list[TripDraftTransport] = Field(default_factory=list, max_length=100)
    budget: TripDraftBudget = Field(default_factory=TripDraftBudget)
    days: list[TripDraftDay] = Field(default_factory=list, max_length=180)
    notes: str = Field(default="", max_length=12000)

    @model_validator(mode="after")
    def validate_dates(self) -> TripDraftContent:
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("date_to must not be before date_from")
        if len({day.id for day in self.days}) != len(self.days):
            raise ValueError("day IDs must be unique")
        event_ids = [event.id for day in self.days for event in day.events]
        if len(set(event_ids)) != len(event_ids):
            raise ValueError("event IDs must be unique across the itinerary")
        if len({stop.id for stop in self.route_stops}) != len(self.route_stops):
            raise ValueError("route stop IDs must be unique")
        return self


class TripDraftSaveRequest(StrictModel):
    base_version: int = Field(ge=1)
    content: TripDraftContent


class TripDraftAlternativeCreateRequest(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    content: TripDraftContent

    @model_validator(mode="after")
    def validate_title(self) -> TripDraftAlternativeCreateRequest:
        if not self.title.strip():
            raise ValueError("title must not be blank")
        return self


class TripItineraryEventResponse(StrictModel):
    id: UUID
    day_id: UUID
    position: int
    kind: Literal["activity", "transport", "accommodation", "meal", "note", "other"]
    title: str
    start_time: time | None
    duration_minutes: int | None
    address: str | None
    estimated_cost: Decimal | None
    currency: str | None
    notes: str | None


class TripItineraryDayResponse(StrictModel):
    id: UUID
    position: int
    day_date: DateValue | None
    title: str | None
    notes: str | None
    events: list[TripItineraryEventResponse]


class TripItineraryResponse(StrictModel):
    trip_id: UUID
    days: list[TripItineraryDayResponse]


class TripDraftAlternativeMetadataResponse(StrictModel):
    id: UUID
    trip_id: UUID
    title: str
    created_by_user_id: UUID
    created_at: datetime


class TripDraftAlternativeResponse(TripDraftAlternativeMetadataResponse):
    content: TripDraftContent


class TripDraftResponse(StrictModel):
    trip_id: UUID
    version: int
    content: TripDraftContent
    updated_by_user_id: UUID
    updated_at: datetime


class TripDraftDetailResponse(StrictModel):
    draft: TripDraftResponse
    alternatives: list[TripDraftAlternativeMetadataResponse] = Field(max_length=20)


class TripDraftReadinessIssue(StrictModel):
    path: str
    code: str
    message: str
