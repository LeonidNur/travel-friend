"""Authenticated Trip creation from an existing Chat."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
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
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> list[dict[str, object]]:
    """List all persisted Trips belonging to the authenticated participant."""
    rows = connection.execute(
        "SELECT t.id AS trip_id, t.chat_id, t.status, t.created_at, t.date_from, t.date_to, "
        "t.destination_status, t.dates_status, t.budget_status, t.transport_status, "
        "COALESCE(array_agg(ts.place_label ORDER BY ts.position) "
        "FILTER (WHERE ts.id IS NOT NULL), ARRAY[]::text[]) AS route_place_labels "
        "FROM public.trips t "
        "JOIN public.trip_participants tp ON tp.trip_id=t.id "
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
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
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
        "SELECT tp.user_id, p.display_name, "
        "EXTRACT(YEAR FROM age(CURRENT_DATE, p.birth_date))::integer AS age, p.city "
        "FROM public.trip_participants tp "
        "LEFT JOIN public.profiles p ON p.user_id=tp.user_id "
        "WHERE tp.trip_id=%s AND tp.left_at IS NULL "
        "ORDER BY tp.joined_at ASC, tp.user_id ASC",
        (trip_id,),
    ).fetchall()
    return {
        "trip": dict(trip),
        "route_stops": [dict(stop) for stop in route_stops],
        "participants": [dict(participant) for participant in participants],
    }


def find_authorized_trip_chat(
    connection: psycopg.Connection, chat_id: UUID, user_id: UUID
) -> dict[str, object] | None:
    """Lock and return a Chat only when the requester is an active participant."""
    return connection.execute(
        "SELECT c.id FROM public.chats c "
        "WHERE c.id=%s AND EXISTS ("
        "SELECT 1 FROM public.chat_participants cp "
        "WHERE cp.chat_id=c.id AND cp.user_id=%s AND cp.left_at IS NULL"
        ") FOR UPDATE",
        (chat_id, user_id),
    ).fetchone()


def create_trip_for_chat(
    connection: psycopg.Connection, chat_id: UUID, principal: AuthenticatedPrincipal
) -> dict[str, object]:
    """Create one forming Trip and all active Chat participants atomically."""
    with connection.transaction():
        if find_authorized_trip_chat(connection, chat_id, principal.user_id) is None:
            raise HTTPException(404, "Chat not found")

        existing_trip = connection.execute(
            "SELECT id FROM public.trips WHERE chat_id=%s AND status IN ('forming', 'active')",
            (chat_id,),
        ).fetchone()
        if existing_trip is not None:
            raise HTTPException(409, "Unfinished Trip already exists")

        participant_rows = connection.execute(
            "SELECT user_id FROM public.chat_participants "
            "WHERE chat_id=%s AND left_at IS NULL FOR SHARE",
            (chat_id,),
        ).fetchall()
        participant_ids = [row["user_id"] for row in participant_rows]
        if not participant_ids or principal.user_id not in participant_ids:
            raise RuntimeError("Chat membership invariant is violated")

        trip = connection.execute(
            "INSERT INTO public.trips (chat_id, created_by_user_id, status) "
            "VALUES (%s, %s, 'forming') "
            "RETURNING id AS trip_id, chat_id, created_by_user_id, status, created_at",
            (chat_id, principal.user_id),
        ).fetchone()
        if trip is None:
            raise RuntimeError("Trip was not created")

        inserted_participants = connection.execute(
            "INSERT INTO public.trip_participants (trip_id, user_id) "
            "SELECT %s, user_id FROM public.chat_participants "
            "WHERE chat_id=%s AND left_at IS NULL RETURNING user_id",
            (trip["trip_id"], chat_id),
        ).fetchall()
        if len(inserted_participants) != len(participant_ids):
            raise RuntimeError("Trip participant creation invariant is violated")

    return dict(trip)


@router.post(
    "/{chat_id}/trips",
    response_model=TripCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_trip(
    chat_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    return create_trip_for_chat(connection, chat_id, principal)
