"""Authenticated routes that operate only on the current user."""

from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.schemas.profile import ProfilePatchRequest, ProfileResponse


router = APIRouter(prefix="/me", tags=["me"])

PROFILE_COLUMNS = (
    "id, user_id, display_name, birth_date, gender, city, bio, travel_style, "
    "interests, budget_level, comfort_level, created_at, updated_at"
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

    return profile
