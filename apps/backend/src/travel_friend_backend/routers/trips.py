"""Authenticated Trip creation from an existing direct Chat."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.routers.chats import find_authorized_chat
from travel_friend_backend.schemas.trips import TripCreateResponse, TripListItemResponse


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


def create_trip_for_direct_chat(
    connection: psycopg.Connection, chat_id: UUID, principal: AuthenticatedPrincipal
) -> dict[str, object]:
    """Create one forming Trip and its direct Chat participants atomically."""
    with connection.transaction():
        if find_authorized_chat(connection, chat_id, principal.user_id, lock=True) is None:
            raise HTTPException(404, "Chat not found")

        existing_trip = connection.execute(
            "SELECT id FROM public.trips WHERE chat_id=%s AND status IN ('forming', 'active')",
            (chat_id,),
        ).fetchone()
        if existing_trip is not None:
            raise HTTPException(409, "Unfinished Trip already exists")

        participant_rows = connection.execute(
            "SELECT user_id FROM public.chat_participants WHERE chat_id=%s FOR SHARE",
            (chat_id,),
        ).fetchall()
        participant_ids = [row["user_id"] for row in participant_rows]
        if len(participant_ids) != 2 or principal.user_id not in participant_ids:
            raise RuntimeError("Direct Chat membership invariant is violated")

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
            "WHERE chat_id=%s RETURNING user_id",
            (trip["trip_id"], chat_id),
        ).fetchall()
        if len(inserted_participants) != 2:
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
    return create_trip_for_direct_chat(connection, chat_id, principal)
