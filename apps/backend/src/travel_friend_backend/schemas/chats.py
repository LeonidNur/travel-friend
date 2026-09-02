"""Response schemas for the authenticated direct Chats list."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DirectChatCompanionResponse(BaseModel):
    """The other participant shown in a direct Chats list item."""

    user_id: UUID
    display_name: str
    age: int | None
    city: str | None


class DirectChatListItemResponse(BaseModel):
    """MVP data required to render one direct Chat list item."""

    chat_id: UUID
    type: Literal["direct"]
    companion: DirectChatCompanionResponse
    created_at: datetime


class GroupChatParticipantResponse(BaseModel):
    """One current Group Chat participant from persisted membership and profile data."""

    user_id: UUID
    display_name: str | None


class GroupChatListItemResponse(BaseModel):
    """Minimal persisted data required to render one Group Chat list item."""

    chat_id: UUID
    type: Literal["group"]
    participants: list[GroupChatParticipantResponse]
    participant_count: int
    created_at: datetime


ChatListItemResponse: TypeAlias = Annotated[
    DirectChatListItemResponse | GroupChatListItemResponse,
    Field(discriminator="type"),
]


class GroupChatCreateRequest(BaseModel):
    """Requested companions for one immutable MVP Group Chat."""

    model_config = ConfigDict(extra="forbid")

    user_ids: list[UUID] = Field(min_length=2)

    @field_validator("user_ids")
    @classmethod
    def user_ids_must_be_unique(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("user_ids must not contain duplicates")
        return value


class GroupChatCreateResponse(BaseModel):
    """Persisted Group Chat and its initial immutable participant set."""

    chat_id: UUID
    type: Literal["group"]
    participant_user_ids: list[UUID]
    created_at: datetime


class ChatMessageCreateRequest(BaseModel):
    """The only client-provided field when sending a Chat message."""

    model_config = ConfigDict(extra="forbid")

    content_text: str

    @field_validator("content_text")
    @classmethod
    def content_text_must_not_be_blank(cls, value: str) -> str:
        trimmed_value = value.strip()
        if not trimmed_value:
            raise ValueError("content_text must not be blank")
        return trimmed_value


class ChatMessageResponse(BaseModel):
    """MVP Chat message fields exposed to an authorized participant."""

    message_id: UUID
    chat_id: UUID
    sequence_number: int
    type: Literal["user", "system"]
    sender_user_id: UUID | None
    content_text: str | None
    created_at: datetime
