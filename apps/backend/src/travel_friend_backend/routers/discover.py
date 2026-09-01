"""Authenticated Discover candidates and final interest decisions."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.schemas.discover import (
    DiscoverCandidateResponse,
    DiscoverDecisionRequest,
    DiscoverDecisionResponse,
)


router = APIRouter(prefix="/discover", tags=["discover"])


@router.get("/candidates", response_model=list[DiscoverCandidateResponse])
def get_discover_candidates(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> list[dict[str, object]]:
    rows = connection.execute(
        "SELECT p.user_id, p.display_name, "
        "EXTRACT(YEAR FROM age(CURRENT_DATE, p.birth_date))::integer AS age, "
        "p.city, p.bio, p.travel_style, p.interests, p.budget_level, p.comfort_level, "
        "ti.destination_label AS destination, ti.date_from, ti.date_to "
        "FROM public.profiles p "
        "JOIN public.users u ON u.id=p.user_id AND u.deleted_at IS NULL "
        "JOIN public.user_activity_states activity "
        "ON activity.user_id=p.user_id AND activity.onboarding_status='completed' "
        "JOIN public.travel_intents ti ON ti.user_id=p.user_id AND ti.status='active' "
        "WHERE p.user_id <> %s "
        "AND NOT EXISTS ("
        "SELECT 1 FROM public.discover_interest_decisions decision "
        "WHERE decision.actor_user_id=%s AND decision.target_user_id=p.user_id"
        ") "
        "ORDER BY p.created_at ASC, p.user_id ASC",
        (principal.user_id, principal.user_id),
    ).fetchall()
    return [
        {
            "user_id": row["user_id"],
            "display_name": row["display_name"],
            "age": row["age"],
            "city": row["city"],
            "bio": row["bio"],
            "travel_style": [value for value in row["travel_style"] if value is not None],
            "interests": [value for value in row["interests"] if value is not None],
            "budget_level": row["budget_level"],
            "comfort_level": row["comfort_level"],
            "travel_intent": {
                "destination": row["destination"],
                "date_from": row["date_from"],
                "date_to": row["date_to"],
            },
        }
        for row in rows
    ]


@router.put("/decisions/{target_user_id}", response_model=DiscoverDecisionResponse)
def save_discover_decision(
    target_user_id: UUID,
    payload: DiscoverDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    if target_user_id == principal.user_id:
        raise HTTPException(422, "Cannot decide about the current user")

    user_a_id, user_b_id = sorted((principal.user_id, target_user_id))
    pair_key = f"{user_a_id}:{user_b_id}"
    connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (pair_key,))

    existing_decision = connection.execute(
        "SELECT decision FROM public.discover_interest_decisions "
        "WHERE actor_user_id=%s AND target_user_id=%s FOR UPDATE",
        (principal.user_id, target_user_id),
    ).fetchone()
    if existing_decision is not None and existing_decision["decision"] != payload.decision:
        raise HTTPException(409, "Discover decision is final")

    if existing_decision is None:
        target_exists = connection.execute(
            "SELECT 1 FROM public.users u "
            "JOIN public.profiles p ON p.user_id=u.id "
            "JOIN public.user_activity_states activity "
            "ON activity.user_id=u.id AND activity.onboarding_status='completed' "
            "JOIN public.travel_intents ti ON ti.user_id=u.id AND ti.status='active' "
            "WHERE u.id=%s AND u.deleted_at IS NULL",
            (target_user_id,),
        ).fetchone()
        if target_exists is None:
            raise HTTPException(404, "Discover target not found")
        connection.execute(
            "INSERT INTO public.discover_interest_decisions "
            "(actor_user_id, target_user_id, decision) VALUES (%s, %s, %s)",
            (principal.user_id, target_user_id, payload.decision),
        )

    match_created = False
    match = connection.execute(
        "SELECT id FROM public.matches WHERE user_a_id=%s AND user_b_id=%s",
        (user_a_id, user_b_id),
    ).fetchone()
    if payload.decision == "interested" and match is None:
        reciprocal_interest = connection.execute(
            "SELECT 1 FROM public.discover_interest_decisions "
            "WHERE actor_user_id=%s AND target_user_id=%s AND decision='interested'",
            (target_user_id, principal.user_id),
        ).fetchone()
        if reciprocal_interest is not None:
            match = connection.execute(
                "INSERT INTO public.matches (user_a_id, user_b_id) VALUES (%s, %s) "
                "ON CONFLICT (user_a_id, user_b_id) DO NOTHING RETURNING id",
                (user_a_id, user_b_id),
            ).fetchone()
            match_created = match is not None
            if match is None:
                match = connection.execute(
                    "SELECT id FROM public.matches WHERE user_a_id=%s AND user_b_id=%s",
                    (user_a_id, user_b_id),
                ).fetchone()

    return {
        "decision": payload.decision,
        "match_created": match_created,
        "match_id": match["id"] if match is not None else None,
    }
