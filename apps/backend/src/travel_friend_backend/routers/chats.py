"""Authenticated direct Chat list routes."""

from __future__ import annotations

from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.schemas.chats import DirectChatListItemResponse


router = APIRouter(prefix="/chats", tags=["chats"])


@router.get("", response_model=list[DirectChatListItemResponse])
def get_direct_chats(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> list[dict[str, object]]:
    rows = connection.execute(
        "SELECT c.id AS chat_id, c.type, other.user_id, p.display_name, "
        "EXTRACT(YEAR FROM age(CURRENT_DATE, p.birth_date))::integer AS age, p.city, "
        "c.created_at "
        "FROM public.chat_participants own "
        "JOIN public.chats c ON c.id=own.chat_id AND c.type='direct' "
        "JOIN public.chat_participants other "
        "ON other.chat_id=c.id AND other.user_id<>own.user_id "
        "JOIN public.profiles p ON p.user_id=other.user_id "
        "WHERE own.user_id=%s "
        "ORDER BY c.created_at DESC, c.id DESC",
        (principal.user_id,),
    ).fetchall()
    return [
        {
            "chat_id": row["chat_id"],
            "type": row["type"],
            "companion": {
                "user_id": row["user_id"],
                "display_name": row["display_name"],
                "age": row["age"],
                "city": row["city"],
            },
            "created_at": row["created_at"],
        }
        for row in rows
    ]
