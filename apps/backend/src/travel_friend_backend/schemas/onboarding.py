"""Schemas for authenticated current-user onboarding transitions."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class OnboardingPatchRequest(BaseModel):
    """The only onboarding status values a client may request."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["in_progress", "completed"]


class OnboardingResponse(BaseModel):
    """Current onboarding state returned to the authenticated user."""

    status: Literal["in_progress", "completed"]
