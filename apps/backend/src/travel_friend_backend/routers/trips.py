"""Authenticated Trip creation from an existing Chat."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.rate_limit import TRIP_CREATION_POLICY, authenticated_rate_limit
from travel_friend_backend.schemas.trips import (
    TripCreateResponse,
    TripDetailResponse,
    TripListItemResponse,
)


router = APIRouter(prefix="/chats", tags=["trips"])
trip_list_router = APIRouter(prefix="/trips", tags=["trips"])


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
