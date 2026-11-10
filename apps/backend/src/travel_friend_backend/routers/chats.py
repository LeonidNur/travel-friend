"""Authenticated Chat list and direct-message routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.rate_limit import (
    GROUP_CREATION_POLICY,
    MESSAGE_CREATION_POLICY,
    authenticated_rate_limit,
)
from travel_friend_backend.schemas.chats import (
    ChatListItemResponse,
    ChatMessageCreateRequest,
    ChatMessagePageResponse,
    ChatMessageResponse,
    ChatReadRequest,
    ChatReadResponse,
    GroupChatCreateRequest,
    GroupChatCreateResponse,
    GroupChatRenameRequest,
    GroupChatRenameResponse,
)
from travel_friend_backend.schemas.discover import DiscoverCandidateResponse


router = APIRouter(prefix="/chats", tags=["chats"])


def public_profile_response(row: dict[str, object]) -> dict[str, object]:
    """Map the scoped SQL capability to the canonical Discover public profile."""
    return {
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


def create_group_chat(
    connection: psycopg.Connection,
    principal: AuthenticatedPrincipal,
    companion_user_ids: list[UUID],
    title: str | None = None,
) -> dict[str, object]:
    """Create one Group Chat through the database's scoped capability."""
    del principal
    try:
        with connection.transaction():
            chat = connection.execute(
                "SELECT * FROM public.create_current_group_chat(%s::uuid[], %s::text)",
                (companion_user_ids, title),
            ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "22023":
            raise HTTPException(422, error.diag.message_primary) from error
        raise

    if chat is None:
        raise RuntimeError("Group Chat capability returned no result")
    return dict(chat)


@router.post(
    "/groups",
    response_model=GroupChatCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(authenticated_rate_limit(GROUP_CREATION_POLICY))],
)
def create_group_chat_route(
    payload: GroupChatCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    return create_group_chat(connection, principal, payload.user_ids, payload.title)


@router.patch("/{chat_id}/title", response_model=GroupChatRenameResponse)
def rename_group_chat_route(
    chat_id: UUID,
    payload: GroupChatRenameRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    del principal
    try:
        with connection.transaction():
            row = connection.execute(
                "SELECT * FROM public.rename_current_group_chat(%s, %s::text)",
                (chat_id, payload.title),
            ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "22023":
            raise HTTPException(422, error.diag.message_primary) from error
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Chat not found") from error
        raise
    if row is None:
        raise RuntimeError("Group Chat rename capability returned no result")
    return dict(row)


@router.get("", response_model=list[ChatListItemResponse])
def get_chats(
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> list[dict[str, object]]:
    rows = connection.execute(
        "SELECT * FROM public.chat_list_projection() "
        "ORDER BY COALESCE((last_message->>'created_at')::timestamptz, created_at) DESC, chat_id DESC"
    ).fetchall()
    chat_items: list[dict[str, object]] = []
    for row in rows:
        chat_id = row["chat_id"]
        participants = row["participants"]
        if row["chat_type"] == "direct":
            if participants:
                companion = participants[0]
                chat_items.append({
                    "chat_id": chat_id,
                    "type": "direct",
                    "companion": {
                        "user_id": companion["user_id"],
                        "display_name": companion["display_name"],
                        "age": companion["age"],
                        "city": companion["city"],
                    },
                    "created_at": row["created_at"],
                    "last_message": row["last_message"],
                    "unread_count": row["unread_count"],
                })
            continue
        chat_items.append({
            "chat_id": chat_id,
            "type": "group",
            "title": row["title"],
            "participants": [
                {"user_id": participant["user_id"], "display_name": participant["display_name"]}
                for participant in participants
            ],
            "participant_count": row["participant_count"],
            "created_at": row["created_at"],
            "last_message": row["last_message"],
            "unread_count": row["unread_count"],
        })
    return chat_items


@router.get(
    "/{chat_id}/participants/{user_id}/profile",
    response_model=DiscoverCandidateResponse,
)
def get_chat_participant_profile(
    chat_id: UUID,
    user_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read the canonical profile only for another active Chat participant."""
    del principal
    row = connection.execute(
        "SELECT * FROM public.chat_participant_public_profile(%s, %s)",
        (chat_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Chat participant profile not found")
    return public_profile_response(row)


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
        "system_event": row.get("system_event"),
        "proposal_id": row.get("proposal_id"),
        "proposal_trip_id": row.get("proposal_trip_id"),
        "proposal_status": row.get("proposal_status"),
        "proposal_blocked_reason": row.get("proposal_blocked_reason"),
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
        "SELECT message.id AS message_id, message.chat_id, message.sequence_number, message.type, message.sender_user_id, "
        "message.content_text, message.created_at, message.system_event, message.proposal_id, message.proposal_trip_id, "
        "proposal.status AS proposal_status, proposal.blocked_reason AS proposal_blocked_reason "
        "FROM public.messages AS message LEFT JOIN public.trip_proposals AS proposal "
        "ON proposal.id=message.proposal_id AND proposal.trip_id=message.proposal_trip_id "
        "WHERE message.chat_id=%s AND (message.recipient_user_id IS NULL OR message.recipient_user_id=%s) "
        "ORDER BY message.sequence_number ASC",
        (chat_id, principal.user_id),
    ).fetchall()
    return [message_response(row) for row in rows]


@router.get("/{chat_id}/messages/page", response_model=ChatMessagePageResponse)
def get_chat_message_page(
    chat_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
    before_sequence: Annotated[int | None, Query(ge=0)] = None,
    after_sequence: Annotated[int | None, Query(ge=0)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, object]:
    """Return a bounded history page or one incremental page after a sequence cursor."""
    if before_sequence is not None and after_sequence is not None:
        raise HTTPException(422, "before_sequence and after_sequence cannot be combined")
    if find_authorized_message_chat(connection, chat_id, principal.user_id, lock=False) is None:
        raise HTTPException(404, "Chat not found")

    high_water_sequence = connection.execute(
        "SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)
    ).fetchone()["last_sequence"]
    visibility = "(recipient_user_id IS NULL OR recipient_user_id=%s)"
    base_parameters: tuple[object, ...] = (chat_id, principal.user_id, high_water_sequence)

    if after_sequence is not None:
        rows = connection.execute(
            "SELECT message.id AS message_id, message.chat_id, message.sequence_number, message.type, message.sender_user_id, "
            "message.content_text, message.created_at, message.system_event, message.proposal_id, message.proposal_trip_id, "
            "proposal.status AS proposal_status, proposal.blocked_reason AS proposal_blocked_reason "
            "FROM public.messages AS message LEFT JOIN public.trip_proposals AS proposal "
            "ON proposal.id=message.proposal_id AND proposal.trip_id=message.proposal_trip_id "
            f"WHERE message.chat_id=%s AND {visibility.replace('recipient_user_id', 'message.recipient_user_id')} "
            "AND message.sequence_number>%s AND message.sequence_number<=%s "
            "ORDER BY message.sequence_number ASC LIMIT %s",
            (chat_id, principal.user_id, after_sequence, high_water_sequence, limit),
        ).fetchall()
        page_rows = rows
    else:
        cursor = before_sequence
        cursor_filter = "" if cursor is None else " AND sequence_number<%s"
        parameters: tuple[object, ...] = base_parameters + (() if cursor is None else (cursor,))
        rows = connection.execute(
            "SELECT message.id AS message_id, message.chat_id, message.sequence_number, message.type, message.sender_user_id, "
            "message.content_text, message.created_at, message.system_event, message.proposal_id, message.proposal_trip_id, "
            "proposal.status AS proposal_status, proposal.blocked_reason AS proposal_blocked_reason "
            "FROM public.messages AS message LEFT JOIN public.trip_proposals AS proposal "
            "ON proposal.id=message.proposal_id AND proposal.trip_id=message.proposal_trip_id "
            f"WHERE message.chat_id=%s AND {visibility.replace('recipient_user_id', 'message.recipient_user_id')} "
            f"AND message.sequence_number<=%s{cursor_filter} "
            "ORDER BY message.sequence_number DESC LIMIT %s",
            parameters + (limit,),
        ).fetchall()
        page_rows = list(reversed(rows))
        has_more_newer = False

    page_messages = [message_response(row) for row in page_rows]
    if page_messages:
        first_sequence = page_messages[0]["sequence_number"]
        last_sequence = page_messages[-1]["sequence_number"]
        has_more_older = connection.execute(
            "SELECT EXISTS (SELECT 1 FROM public.messages WHERE chat_id=%s "
            f"AND {visibility} AND sequence_number<%s AND sequence_number<=%s)",
            (chat_id, principal.user_id, first_sequence, high_water_sequence),
        ).fetchone()["exists"]
        has_more_newer = connection.execute(
            "SELECT EXISTS (SELECT 1 FROM public.messages WHERE chat_id=%s "
            f"AND {visibility} AND sequence_number>%s AND sequence_number<=%s)",
            (chat_id, principal.user_id, last_sequence, high_water_sequence),
        ).fetchone()["exists"]
        next_after_sequence = (
            last_sequence
            if after_sequence is not None and has_more_newer
            else high_water_sequence
        )
    else:
        has_more_older = False
        has_more_newer = False
        next_after_sequence = high_water_sequence

    return {
        "messages": page_messages,
        "high_water_sequence": high_water_sequence,
        "next_after_sequence": next_after_sequence,
        "has_more_older": has_more_older,
        "has_more_newer": has_more_newer,
    }


@router.post("/{chat_id}/read", response_model=ChatReadResponse)
def mark_chat_read(
    chat_id: UUID,
    payload: ChatReadRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Advance the authenticated participant's read watermark monotonically."""
    del principal
    try:
        result = connection.execute(
            "SELECT * FROM public.mark_current_chat_read(%s, %s)",
            (chat_id, payload.sequence_number),
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Chat not found") from error
        raise
    if result is None:
        raise RuntimeError("Chat read capability returned no result")
    return dict(result)


@router.post(
    "/{chat_id}/messages",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(authenticated_rate_limit(MESSAGE_CREATION_POLICY))],
)
def create_chat_message(
    chat_id: UUID,
    payload: ChatMessageCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
    response: Response,
) -> dict[str, object]:
    with connection.transaction():
        try:
            if payload.client_request_id is None:
                message = connection.execute(
                    "SELECT * FROM public.send_current_chat_message(%s, %s)",
                    (chat_id, payload.content_text),
                ).fetchone()
            else:
                message = connection.execute(
                    "SELECT * FROM public.send_current_chat_message(%s, %s, %s)",
                    (chat_id, payload.content_text, payload.client_request_id),
                ).fetchone()
        except psycopg.Error as error:
            if error.sqlstate == "P0002":
                raise HTTPException(404, "Chat not found") from error
            if error.sqlstate == "23505":
                raise HTTPException(409, "client_request_id was already used for another message") from error
            raise

    if message is None:
        raise RuntimeError("Chat message capability returned no result")

    response.status_code = status.HTTP_201_CREATED
    return message_response(message)
