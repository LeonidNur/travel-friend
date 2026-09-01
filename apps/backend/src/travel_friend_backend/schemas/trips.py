"""Response schemas for authenticated Trip lifecycle operations."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class TripCreateResponse(BaseModel):
    """Server-created initial snapshot for a direct Chat Trip."""

    trip_id: UUID
    chat_id: UUID
    created_by_user_id: UUID
    status: Literal["forming"]
    created_at: datetime
