"""Response schemas for the authenticated direct Chats list."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


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
