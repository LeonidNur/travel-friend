"""Authenticated routes that operate only on the current user."""

from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.schemas.onboarding import (
    OnboardingPatchRequest,
    OnboardingResponse,
)
from travel_friend_backend.schemas.profile import ProfilePatchRequest, ProfileResponse
from travel_friend_backend.schemas.travel_intent import (
    TravelIntentPutRequest,
    TravelIntentResponse,
)


router = APIRouter(prefix="/me", tags=["me"])

PROFILE_COLUMNS = (
    "id, user_id, display_name, birth_date, gender, city, bio, travel_style, "
    "interests, budget_level, comfort_level, created_at, updated_at"
)
TRAVEL_INTENT_COLUMNS = (
    "id, user_id, destination_label AS destination, date_from, date_to, status, "
    "created_at, updated_at, archived_at"
)


@router.get("/profile", response_model=ProfileResponse | None)
def get_current_user_profile(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object] | None:
    profile = connection.execute(
        f"SELECT {PROFILE_COLUMNS} FROM public.profiles WHERE user_id=%s",
        (principal.user_id,),
    ).fetchone()
    return profile


@router.patch("/profile", response_model=ProfileResponse)
def patch_current_user_profile(
    payload: ProfilePatchRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    changes = payload.model_dump(exclude_unset=True)
    existing_profile = connection.execute(
        f"SELECT {PROFILE_COLUMNS} FROM public.profiles WHERE user_id=%s",
        (principal.user_id,),
    ).fetchone()

    if existing_profile is None and "display_name" not in changes:
        raise HTTPException(422, "display_name is required when creating a profile")

    if existing_profile is None:
        columns = ("user_id", *changes.keys())
        placeholders = ", ".join("%s" for _ in columns)
        assignments = ", ".join(f"{column}=EXCLUDED.{column}" for column in changes)
        profile = connection.execute(
            f"INSERT INTO public.profiles ({', '.join(columns)}, updated_at) "
            f"VALUES ({placeholders}, now()) ON CONFLICT (user_id) DO UPDATE SET "
            f"{assignments}, updated_at=now() RETURNING {PROFILE_COLUMNS}",
            (principal.user_id, *changes.values()),
        ).fetchone()
    elif changes:
        assignments = ", ".join(f"{column}=%s" for column in changes)
        profile = connection.execute(
            f"UPDATE public.profiles SET {assignments}, updated_at=now() "
            f"WHERE user_id=%s RETURNING {PROFILE_COLUMNS}",
            (*changes.values(), principal.user_id),
        ).fetchone()
    else:
        profile = existing_profile

    connection.commit()
    return profile


@router.get("/travel-intent", response_model=TravelIntentResponse | None)
def get_current_user_travel_intent(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object] | None:
    return connection.execute(
        f"SELECT {TRAVEL_INTENT_COLUMNS} FROM public.travel_intents "
        "WHERE user_id=%s AND status='active'",
        (principal.user_id,),
    ).fetchone()


@router.put("/travel-intent", response_model=TravelIntentResponse)
def put_current_user_travel_intent(
    payload: TravelIntentPutRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    travel_intent = connection.execute(
        f"INSERT INTO public.travel_intents "
        "(user_id, destination_label, date_from, date_to, status, updated_at) "
        "VALUES (%s, %s, %s, %s, 'active', now()) "
        "ON CONFLICT (user_id) WHERE status='active' DO UPDATE "
        "SET destination_label=EXCLUDED.destination_label, "
        "date_from=EXCLUDED.date_from, date_to=EXCLUDED.date_to, "
        "updated_at=CASE WHEN "
        "(travel_intents.destination_label, travel_intents.date_from, travel_intents.date_to) "
        "IS DISTINCT FROM "
        "(EXCLUDED.destination_label, EXCLUDED.date_from, EXCLUDED.date_to) "
        "THEN now() ELSE travel_intents.updated_at END "
        f"RETURNING {TRAVEL_INTENT_COLUMNS}",
        (principal.user_id, payload.destination, payload.date_from, payload.date_to),
    ).fetchone()
    connection.commit()
    return travel_intent


@router.delete("/travel-intent", status_code=204, response_class=Response)
def delete_current_user_travel_intent(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> None:
    connection.execute(
        "UPDATE public.travel_intents "
        "SET status='archived', archived_at=now(), updated_at=now() "
        "WHERE user_id=%s AND status='active'",
        (principal.user_id,),
    )
    connection.commit()


@router.patch("/onboarding", response_model=OnboardingResponse)
def patch_current_user_onboarding(
    payload: OnboardingPatchRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, str]:
    onboarding = connection.execute(
        "UPDATE public.user_activity_states "
        "SET onboarding_status=%s, "
        "updated_at=CASE WHEN onboarding_status IS DISTINCT FROM %s "
        "THEN now() ELSE updated_at END "
        "WHERE user_id=%s "
        "AND NOT (onboarding_status='completed' AND %s='in_progress') "
        "RETURNING onboarding_status",
        (payload.status, payload.status, principal.user_id, payload.status),
    ).fetchone()

    if onboarding is None:
        raise HTTPException(409, "Cannot transition onboarding from completed to in_progress")

    connection.commit()
    return {"status": onboarding["onboarding_status"]}
