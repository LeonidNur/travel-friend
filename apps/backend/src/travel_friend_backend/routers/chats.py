"""Authenticated Chat list and direct-message routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.schemas.chats import (
    ChatListItemResponse,
    ChatMessageCreateRequest,
    ChatMessageResponse,
    GroupChatCreateRequest,
    GroupChatCreateResponse,
)


router = APIRouter(prefix="/chats", tags=["chats"])


def create_group_chat(
    connection: psycopg.Connection,
    principal: AuthenticatedPrincipal,
    companion_user_ids: list[UUID],
) -> dict[str, object]:
    """Create one Group Chat from the initiator's matched direct Chat companions."""
    if principal.user_id in companion_user_ids:
        raise HTTPException(422, "Group members cannot include the initiator")

    participant_user_ids = [principal.user_id, *companion_user_ids]

    with connection.transaction():
        chat = connection.execute(
            "INSERT INTO public.chats (type) VALUES ('group') "
            "RETURNING id AS chat_id, type, created_at"
        ).fetchone()
        if chat is None:
            raise RuntimeError("Group Chat was not created")

        eligible_rows = connection.execute(
            "SELECT DISTINCT companion.user_id "
            "FROM public.chats direct_chat "
            "JOIN public.chat_participants initiator "
            "ON initiator.chat_id=direct_chat.id AND initiator.user_id=%s AND initiator.left_at IS NULL "
            "JOIN public.chat_participants companion "
            "ON companion.chat_id=direct_chat.id AND companion.user_id<>initiator.user_id "
            "AND companion.left_at IS NULL "
            "JOIN public.matches matched_flow ON matched_flow.chat_id=direct_chat.id "
            "WHERE direct_chat.type='direct' AND companion.user_id=ANY(%s::uuid[])",
            (principal.user_id, companion_user_ids),
        ).fetchall()
        if {row["user_id"] for row in eligible_rows} != set(companion_user_ids):
            raise HTTPException(
                422, "Every group member must have a matched direct Chat with the initiator"
            )

        connection.execute(
            "INSERT INTO public.chat_participants (chat_id, user_id) "
            "SELECT %s, participant.user_id FROM unnest(%s::uuid[]) AS participant(user_id)",
            (chat["chat_id"], participant_user_ids),
        )

    return {
        "chat_id": chat["chat_id"],
        "type": chat["type"],
        "participant_user_ids": participant_user_ids,
        "created_at": chat["created_at"],
    }


@router.post("/groups", response_model=GroupChatCreateResponse, status_code=status.HTTP_201_CREATED)
def create_group_chat_route(
    payload: GroupChatCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    return create_group_chat(connection, principal, payload.user_ids)


def direct_chat_list_item(
    connection: psycopg.Connection, chat_id: UUID, user_id: UUID
) -> dict[str, object] | None:
    """Return the existing companion projection for one accessible direct Chat."""
    row = connection.execute(
        "SELECT c.id AS chat_id, c.type, other.user_id, p.display_name, "
        "EXTRACT(YEAR FROM age(CURRENT_DATE, p.birth_date))::integer AS age, p.city, "
        "c.created_at "
        "FROM public.chats c "
        "JOIN public.chat_participants own "
        "ON own.chat_id=c.id AND own.user_id=%s AND own.left_at IS NULL "
        "JOIN public.chat_participants other "
        "ON other.chat_id=c.id AND other.user_id<>own.user_id AND other.left_at IS NULL "
        "JOIN public.profiles p ON p.user_id=other.user_id "
        "WHERE c.id=%s AND c.type='direct'",
        (user_id, chat_id),
    ).fetchone()
    if row is None:
        return None
    return {
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


def group_chat_list_item(
    connection: psycopg.Connection, chat_id: UUID, created_at: object
) -> dict[str, object]:
    """Return persisted current membership for one accessible Group Chat."""
    participants = connection.execute(
        "SELECT cp.user_id, p.display_name "
        "FROM public.chat_participants cp "
        "LEFT JOIN public.profiles p ON p.user_id=cp.user_id "
        "WHERE cp.chat_id=%s AND cp.left_at IS NULL "
        "ORDER BY cp.joined_at ASC, cp.user_id ASC",
        (chat_id,),
    ).fetchall()
    participant_projection = [
        {"user_id": participant["user_id"], "display_name": participant["display_name"]}
        for participant in participants
    ]
    return {
        "chat_id": chat_id,
        "type": "group",
        "participants": participant_projection,
        "participant_count": len(participant_projection),
        "created_at": created_at,
    }


@router.get("", response_model=list[ChatListItemResponse])
def get_chats(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> list[dict[str, object]]:
    rows = connection.execute(
        "SELECT c.id AS chat_id, c.type, c.created_at "
        "FROM public.chats c "
        "JOIN public.chat_participants own "
        "ON own.chat_id=c.id AND own.user_id=%s AND own.left_at IS NULL "
        "ORDER BY c.created_at DESC, c.id DESC",
        (principal.user_id,),
    ).fetchall()
    chat_items: list[dict[str, object]] = []
    for row in rows:
        if row["type"] == "direct":
            direct_chat = direct_chat_list_item(connection, row["chat_id"], principal.user_id)
            if direct_chat is not None:
                chat_items.append(direct_chat)
            continue
        chat_items.append(group_chat_list_item(connection, row["chat_id"], row["created_at"]))
    return chat_items


def find_authorized_chat(
    connection: psycopg.Connection, chat_id: UUID, user_id: UUID, *, lock: bool
) -> dict[str, object] | None:
    """Find a direct Chat participant may access, optionally locking its row."""
    lock_clause = " FOR UPDATE" if lock else ""
    return connection.execute(
        "SELECT c.id FROM public.chats c "
        "WHERE c.id=%s AND c.type='direct' AND EXISTS ("
        "SELECT 1 FROM public.chat_participants cp "
        "WHERE cp.chat_id=c.id AND cp.user_id=%s"
        ")"
        f"{lock_clause}",
        (chat_id, user_id),
    ).fetchone()


def message_response(row: dict[str, object]) -> dict[str, object]:
    """Map selected persistence columns to the public MVP message contract."""
    return {
        "message_id": row["message_id"],
        "chat_id": row["chat_id"],
        "sequence_number": row["sequence_number"],
        "type": row["type"],
        "sender_user_id": row["sender_user_id"],
        "content_text": row["content_text"],
        "created_at": row["created_at"],
    }


@router.get("/{chat_id}/messages", response_model=list[ChatMessageResponse])
def get_chat_messages(
    chat_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> list[dict[str, object]]:
    if find_authorized_chat(connection, chat_id, principal.user_id, lock=False) is None:
        raise HTTPException(404, "Chat not found")

    rows = connection.execute(
        "SELECT id AS message_id, chat_id, sequence_number, type, sender_user_id, "
        "content_text, created_at FROM public.messages WHERE chat_id=%s "
        "AND (recipient_user_id IS NULL OR recipient_user_id=%s) "
        "ORDER BY sequence_number ASC",
        (chat_id, principal.user_id),
    ).fetchall()
    return [message_response(row) for row in rows]


@router.post(
    "/{chat_id}/messages",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_chat_message(
    chat_id: UUID,
    payload: ChatMessageCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_database_connection)],
) -> dict[str, object]:
    with connection.transaction():
        if find_authorized_chat(connection, chat_id, principal.user_id, lock=True) is None:
            raise HTTPException(404, "Chat not found")

        chat = connection.execute(
            "UPDATE public.chats SET last_sequence=last_sequence+1, updated_at=now() "
            "WHERE id=%s RETURNING last_sequence",
            (chat_id,),
        ).fetchone()
        if chat is None:
            raise RuntimeError("Locked Chat disappeared while creating a message")

        message = connection.execute(
            "INSERT INTO public.messages "
            "(chat_id, sender_user_id, recipient_user_id, sequence_number, type, content_text) "
            "VALUES (%s, %s, NULL, %s, 'user', %s) "
            "RETURNING id AS message_id, chat_id, sequence_number, type, sender_user_id, "
            "content_text, created_at",
            (chat_id, principal.user_id, chat["last_sequence"], payload.content_text),
        ).fetchone()

    return message_response(message)
