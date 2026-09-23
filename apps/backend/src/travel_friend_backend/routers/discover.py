"""Authenticated Discover candidates and final interest decisions."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.schemas.discover import (
    DiscoverCandidateResponse,
    DiscoverDecisionRequest,
    DiscoverDecisionResponse,
)


router = APIRouter(prefix="/discover", tags=["discover"])

DISCOVER_REQUESTER_INELIGIBLE_DETAIL = (
    "Discover requires completed onboarding, a profile, and an active TravelIntent"
)


def ensure_discover_requester_eligibility(
    connection: psycopg.Connection, requester_user_id: UUID
) -> None:
    """Require the persisted state needed to use Discover."""
    requester_is_eligible = connection.execute(
        "SELECT 1 FROM public.user_activity_states activity "
        "JOIN public.profiles p ON p.user_id=activity.user_id "
        "JOIN public.travel_intents ti ON ti.user_id=activity.user_id AND ti.status='active' "
        "WHERE activity.user_id=%s AND activity.onboarding_status='completed'",
        (requester_user_id,),
    ).fetchone()
    if requester_is_eligible is None:
        raise HTTPException(403, DISCOVER_REQUESTER_INELIGIBLE_DETAIL)


@router.get("/candidates", response_model=list[DiscoverCandidateResponse])
def get_discover_candidates(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> list[dict[str, object]]:
    ensure_discover_requester_eligibility(connection, principal.user_id)
    rows = connection.execute(
        "SELECT p.user_id, p.display_name, p.age, "
        "p.city, p.bio, p.travel_style, p.interests, p.budget_level, p.comfort_level, "
        "ti.destination_label AS destination, ti.date_from, ti.date_to "
        "FROM public.discover_candidate_profile_projection() WITH ORDINALITY AS p("
        "user_id, display_name, age, city, bio, travel_style, interests, budget_level, "
        "comfort_level, candidate_order) "
        "JOIN public.discover_eligible_travel_intents() ti ON ti.user_id=p.user_id "
        "ORDER BY p.candidate_order ASC",
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
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    ensure_discover_requester_eligibility(connection, principal.user_id)
    if target_user_id == principal.user_id:
        raise HTTPException(422, "Cannot decide about the current user")

    try:
        result = connection.execute(
            "SELECT * FROM public.record_current_discover_decision(%s, %s)",
            (target_user_id, payload.decision),
        ).fetchone()
    except psycopg.Error as error:
        detail = error.diag.message_primary
        if detail == "Discover target not found" or detail == "discover target not found":
            raise HTTPException(404, "Discover target not found") from error
        if detail == "discover decision is final":
            raise HTTPException(409, "Discover decision is final") from error
        raise

    if result is None:
        raise RuntimeError("Discover decision capability returned no result")
    return {
        "decision": result["decision"],
        "match_created": result["match_created"],
        "match_id": result["match_id"],
    }
