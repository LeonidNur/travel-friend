"""Reserved authenticated user routes."""

from fastapi import APIRouter


router = APIRouter(prefix="/me", tags=["me"])
