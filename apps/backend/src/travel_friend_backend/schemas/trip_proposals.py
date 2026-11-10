"""Validated authenticated Trip Proposal request and response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ProposalStatus = Literal[
    "pending", "blocked", "accepted", "rejected", "cancelled", "expired", "stale", "needs_revision"
]


def _scope_day_id(scope: str) -> str | None:
    parts = scope.split(":")
    if len(parts) >= 3 and parts[0] == "itinerary" and parts[1] in {"day", "event"}:
        return parts[2]
    return None


def proposal_scopes_overlap(left: str, right: str) -> bool:
    if left == right:
        return True
    if left == "itinerary:all":
        return right.startswith(("itinerary:day:", "itinerary:event:"))
    if right == "itinerary:all":
        return left.startswith(("itinerary:day:", "itinerary:event:"))
    left_day, right_day = _scope_day_id(left), _scope_day_id(right)
    return left_day is not None and left_day == right_day and (
        left.startswith("itinerary:event:") or right.startswith("itinerary:event:")
    )


class TripProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=120)
    idempotency_key: UUID
    scopes: list[str] = Field(min_length=1, max_length=20)
    prerequisite_proposal_ids: list[UUID] = Field(default_factory=list, max_length=10)
    deadline: datetime | None = None

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("title must not be blank")
        return value.strip()

    @field_validator("scopes")
    @classmethod
    def scopes_must_be_canonical(cls, value: list[str]) -> list[str]:
        allowed = {"route", "dates", "budget", "transport", "accommodation", "itinerary:all"}
        if len(set(value)) != len(value):
            raise ValueError("scopes must be unique")
        for scope in value:
            is_day = scope.startswith("itinerary:day:") and len(scope) == 50
            is_event = scope.startswith("itinerary:event:") and len(scope) == 89
            if scope not in allowed and not is_day and not is_event:
                raise ValueError("unsupported scope")
            if is_day or is_event:
                parts = scope.split(":")
                uuid_parts = parts[2:] if is_day else (parts[2], parts[3])
                try:
                    for part in uuid_parts:
                        UUID(part)
                except (ValueError, IndexError) as error:
                    raise ValueError("itinerary scope must include valid UUIDs") from error
        return value

    @model_validator(mode="after")
    def prerequisites_must_be_unique(self) -> TripProposalCreateRequest:
        if len(set(self.prerequisite_proposal_ids)) != len(self.prerequisite_proposal_ids):
            raise ValueError("prerequisite proposal IDs must be unique")
        for index, scope in enumerate(self.scopes):
            if any(proposal_scopes_overlap(scope, other) for other in self.scopes[index + 1:]):
                raise ValueError("proposal scopes must not overlap")
        return self


class TripProposalVoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vote: Literal["accept", "reject"]


class TripProposalOperationResponse(BaseModel):
    scope: str
    expected_version: int
    old_value: object
    proposed_value: object


class TripProposalVoterResponse(BaseModel):
    user_id: UUID
    vote: Literal["accept", "reject"] | None
    voted_at: datetime | None


class TripProposalResponse(BaseModel):
    id: UUID
    trip_id: UUID
    creator_user_id: UUID
    title: str
    status: ProposalStatus
    draft_version: int
    deadline: datetime | None
    blocked_reason: str | None
    created_at: datetime
    decided_at: datetime | None
    own_vote: Literal["accept", "reject"] | None
    operations: list[TripProposalOperationResponse] = Field(max_length=20)
    voters: list[TripProposalVoterResponse] = Field(max_length=50)
    prerequisite_proposal_ids: list[UUID] = Field(max_length=10)


class TripProposalSummaryResponse(BaseModel):
    """Compact list item; immutable snapshots are available via the detail endpoint."""

    id: UUID
    trip_id: UUID
    creator_user_id: UUID
    title: str
    status: ProposalStatus
    draft_version: int
    deadline: datetime | None
    blocked_reason: str | None
    created_at: datetime
    decided_at: datetime | None
    own_vote: Literal["accept", "reject"] | None
    scopes: list[str] = Field(max_length=20)
    voters: list[TripProposalVoterResponse] = Field(max_length=50)
    prerequisite_proposal_ids: list[UUID] = Field(max_length=10)
