"""Authenticated Chat list and direct-message routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
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
    """Create one Group Chat through the database's scoped capability."""
    del principal
    try:
        with connection.transaction():
            chat = connection.execute(
                "SELECT * FROM public.create_current_group_chat(%s::uuid[])",
                (companion_user_ids,),
            ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "22023":
            raise HTTPException(422, error.diag.message_primary) from error
        raise

    if chat is None:
        raise RuntimeError("Group Chat capability returned no result")
    return dict(chat)


@router.post("/groups", response_model=GroupChatCreateResponse, status_code=status.HTTP_201_CREATED)
def create_group_chat_route(
    payload: GroupChatCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    return create_group_chat(connection, principal, payload.user_ids)


def direct_chat_list_item(
    connection: psycopg.Connection, chat_id: UUID, created_at: object
) -> dict[str, object] | None:
    """Return the existing companion projection for one accessible direct Chat."""
    row = connection.execute(
        "SELECT user_id, display_name, age, city "
        "FROM public.chat_participant_profile_projection(%s)",
        (chat_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "chat_id": chat_id,
        "type": "direct",
        "companion": {
            "user_id": row["user_id"],
            "display_name": row["display_name"],
            "age": row["age"],
            "city": row["city"],
        },
        "created_at": created_at,
    }


def group_chat_list_item(
    connection: psycopg.Connection, chat_id: UUID, created_at: object
) -> dict[str, object]:
    """Return persisted current membership for one accessible Group Chat."""
    participants = connection.execute(
        "SELECT user_id, display_name "
        "FROM public.chat_participant_profile_projection(%s)",
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
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
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
            direct_chat = direct_chat_list_item(connection, row["chat_id"], row["created_at"])
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


def find_authorized_message_chat(
    connection: psycopg.Connection, chat_id: UUID, user_id: UUID, *, lock: bool
) -> dict[str, object] | None:
    """Find a Chat an active participant may access for Messages, optionally locking it."""
    lock_clause = " FOR UPDATE" if lock else ""
    return connection.execute(
        "SELECT c.id FROM public.chats c "
        "WHERE c.id=%s AND EXISTS ("
        "SELECT 1 FROM public.chat_participants cp "
        "WHERE cp.chat_id=c.id AND cp.user_id=%s AND cp.left_at IS NULL"
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
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> list[dict[str, object]]:
    if find_authorized_message_chat(connection, chat_id, principal.user_id, lock=False) is None:
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
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    with connection.transaction():
        try:
            message = connection.execute(
                "SELECT * FROM public.send_current_chat_message(%s, %s)",
                (chat_id, payload.content_text),
            ).fetchone()
        except psycopg.Error as error:
            if error.sqlstate == "P0002":
                raise HTTPException(404, "Chat not found") from error
            raise

    if message is None:
        raise RuntimeError("Chat message capability returned no result")

    return message_response(message)
