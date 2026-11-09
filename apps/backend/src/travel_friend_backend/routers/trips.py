"""Authenticated Trip creation from an existing Chat."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.rate_limit import TRIP_CREATION_POLICY, authenticated_rate_limit
from travel_friend_backend.schemas.trips import (
    TripCreateResponse,
    TripDetailResponse,
    TripListItemResponse,
)
from travel_friend_backend.schemas.trip_drafts import (
    TripDraftAlternativeCreateRequest,
    TripDraftAlternativeMetadataResponse,
    TripDraftAlternativeResponse,
    TripDraftDetailResponse,
    TripDraftResponse,
    TripDraftSaveRequest,
    TripItineraryDayResponse,
    TripItineraryEventResponse,
    TripItineraryResponse,
)


router = APIRouter(prefix="/chats", tags=["trips"])
trip_list_router = APIRouter(prefix="/trips", tags=["trips"])
MAX_DRAFT_ALTERNATIVES = 20


def _is_named_database_error(error: psycopg.Error, *, sqlstate: str, message: str) -> bool:
    return error.sqlstate == sqlstate and getattr(error.diag, "message_primary", None) == message


@trip_list_router.get("", response_model=list[TripListItemResponse])
def get_trips(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> list[dict[str, object]]:
    """List all persisted Trips belonging to the authenticated participant."""
    rows = connection.execute(
        "SELECT t.id AS trip_id, t.chat_id, t.status, t.created_at, t.date_from, t.date_to, "
        "t.destination_status, t.dates_status, t.budget_status, t.transport_status, "
        "COALESCE(array_agg(ts.place_label ORDER BY ts.position) "
        "FILTER (WHERE ts.id IS NOT NULL), ARRAY[]::text[]) AS route_place_labels "
        "FROM public.trips t "
        "JOIN public.trip_participants tp ON tp.trip_id=t.id AND tp.left_at IS NULL "
        "LEFT JOIN public.trip_stops ts ON ts.trip_id=t.id "
        "WHERE tp.user_id=%s "
        "GROUP BY t.id, t.chat_id, t.status, t.created_at, t.date_from, t.date_to, "
        "t.destination_status, t.dates_status, t.budget_status, t.transport_status "
        "ORDER BY t.created_at DESC, t.id DESC",
        (principal.user_id,),
    ).fetchall()
    return [dict(row) for row in rows]


@trip_list_router.get("/{trip_id}", response_model=TripDetailResponse)
def get_trip(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read a persisted Trip only when the caller is a current participant."""
    trip = connection.execute(
        "SELECT t.id AS trip_id, t.chat_id, t.created_by_user_id, t.status, "
        "t.membership_version, t.state_version, t.destination_version, t.dates_version, "
        "t.budget_version, t.transport_version, t.destination_status, t.dates_status, "
        "t.budget_status, t.transport_status, t.date_from, t.date_to, t.budget_min, "
        "t.budget_max, t.budget_currency, t.budget_scope, t.started_at, t.completed_at, "
        "t.cancelled_at, t.created_at, t.updated_at "
        "FROM public.trips t "
        "JOIN public.trip_participants requester "
        "ON requester.trip_id=t.id AND requester.user_id=%s AND requester.left_at IS NULL "
        "WHERE t.id=%s",
        (principal.user_id, trip_id),
    ).fetchone()
    if trip is None:
        raise HTTPException(404, "Trip not found")

    route_stops = connection.execute(
        "SELECT id, position, place_label, country_code, place_ref, stay_from, stay_to, notes, "
        "created_at, updated_at FROM public.trip_stops WHERE trip_id=%s "
        "ORDER BY position ASC",
        (trip_id,),
    ).fetchall()
    participants = connection.execute(
        "SELECT user_id, display_name, age, city "
        "FROM public.trip_participant_profile_projection(%s)",
        (trip_id,),
    ).fetchall()
    return {
        "trip": dict(trip),
        "route_stops": [dict(stop) for stop in route_stops],
        "participants": [dict(participant) for participant in participants],
    }


@trip_list_router.get("/{trip_id}/itinerary", response_model=TripItineraryResponse)
def get_trip_itinerary(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read the confirmed day itinerary for a current Trip participant."""
    trip = connection.execute(
        "SELECT id FROM public.trips WHERE id=%s", (trip_id,)
    ).fetchone()
    if trip is None:
        raise HTTPException(404, "Trip not found")
    day_rows = connection.execute(
        "SELECT id, position, day_date, title, notes FROM public.trip_itinerary_days "
        "WHERE trip_id=%s ORDER BY position, id",
        (trip_id,),
    ).fetchall()
    event_rows = connection.execute(
        "SELECT id, day_id, position, kind, title, start_time, duration_minutes, "
        "address, estimated_cost, currency, notes FROM public.trip_itinerary_events "
        "WHERE trip_id=%s ORDER BY day_id, position, id",
        (trip_id,),
    ).fetchall()
    events_by_day: dict[UUID, list[dict[str, object]]] = {}
    for event in event_rows:
        events_by_day.setdefault(event["day_id"], []).append(dict(event))
    days = [
        {
            **dict(day),
            "events": events_by_day.get(day["id"], []),
        }
        for day in day_rows
    ]
    return {"trip_id": trip_id, "days": days}


@trip_list_router.get("/{trip_id}/draft", response_model=TripDraftDetailResponse)
def get_trip_draft(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read the shared Draft and bounded alternative metadata."""
    draft = connection.execute(
        "SELECT trip_id, version, content, updated_by_user_id, updated_at "
        "FROM public.trip_drafts WHERE trip_id=%s",
        (trip_id,),
    ).fetchone()
    if draft is None:
        raise HTTPException(404, "Trip Draft not found")
    alternatives = connection.execute(
        "SELECT id, trip_id, title, created_by_user_id, created_at "
        "FROM public.trip_draft_alternatives WHERE trip_id=%s "
        "ORDER BY created_at DESC, id DESC LIMIT %s",
        (trip_id, MAX_DRAFT_ALTERNATIVES),
    ).fetchall()
    return {
        "draft": dict(draft),
        "alternatives": [dict(item) for item in alternatives],
    }


@trip_list_router.get(
    "/{trip_id}/draft/alternatives/{alternative_id}",
    response_model=TripDraftAlternativeResponse,
)
def get_trip_draft_alternative(
    trip_id: UUID,
    alternative_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read one bounded alternative snapshot for an active Trip participant."""
    row = connection.execute(
        "SELECT id, trip_id, title, content, created_by_user_id, created_at "
        "FROM public.trip_draft_alternatives WHERE trip_id=%s AND id=%s",
        (trip_id, alternative_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Trip Draft alternative not found")
    return dict(row)


@trip_list_router.put("/{trip_id}/draft", response_model=TripDraftResponse)
def save_trip_draft(
    trip_id: UUID,
    payload: TripDraftSaveRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Save the shared Draft only if the caller's base version is current."""
    try:
        row = connection.execute(
            "SELECT * FROM public.save_current_trip_draft(%s, %s, %s)",
            (trip_id, payload.base_version, Jsonb(payload.content.model_dump(mode="json"))),
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "40001":
            raise HTTPException(409, "Trip Draft changed; reload before saving") from error
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip Draft not found") from error
        if _is_named_database_error(error, sqlstate="22023", message="trip draft content exceeds 256 KiB"):
            raise HTTPException(422, "Содержимое черновика превышает лимит 256 КиБ.") from error
        raise
    if row is None:
        raise RuntimeError("Trip Draft save capability returned no Draft")
    return dict(row)


@trip_list_router.post(
    "/{trip_id}/draft/alternatives",
    response_model=TripDraftAlternativeMetadataResponse,
    status_code=201,
)
def save_trip_draft_alternative(
    trip_id: UUID,
    payload: TripDraftAlternativeCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Save a named snapshot as a shared alternative without applying it."""
    try:
        row = connection.execute(
            "SELECT * FROM public.save_current_trip_draft_alternative(%s, %s, %s)",
            (trip_id, payload.title, Jsonb(payload.content.model_dump(mode="json"))),
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip Draft not found") from error
        if _is_named_database_error(error, sqlstate="22023", message="trip draft alternative content exceeds 256 KiB"):
            raise HTTPException(422, "Содержимое варианта превышает лимит 256 КиБ.") from error
        if _is_named_database_error(error, sqlstate="P0001", message="trip draft alternative limit reached"):
            raise HTTPException(409, "Сохранено максимальное число вариантов поездки.") from error
        raise
    if row is None:
        raise RuntimeError("Trip Draft alternative capability returned no alternative")
    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "title": row["title"],
        "created_by_user_id": row["created_by_user_id"],
        "created_at": row["created_at"],
    }


def create_trip_for_chat(
    connection: psycopg.Connection, chat_id: UUID, principal: AuthenticatedPrincipal
) -> dict[str, object]:
    """Create one forming Trip through the database-owned capability."""
    del principal
    try:
        trip = connection.execute(
            "SELECT * FROM public.create_current_trip_from_chat(%s)", (chat_id,)
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Chat not found") from error
        if error.sqlstate == "23505" or (
            error.sqlstate == "P0001"
            and error.diag.message_primary == "unfinished trip already exists"
        ):
            raise HTTPException(409, "Unfinished Trip already exists") from error
        raise
    if trip is None:
        raise RuntimeError("Trip creation capability returned no Trip")
    return dict(trip)


@router.post(
    "/{chat_id}/trips",
    response_model=TripCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(authenticated_rate_limit(TRIP_CREATION_POLICY))],
)
def create_trip(
    chat_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    return create_trip_for_chat(connection, chat_id, principal)
