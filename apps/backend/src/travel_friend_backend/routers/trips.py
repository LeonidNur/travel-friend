"""Authenticated Trip creation from an existing Chat."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, Depends, HTTPException, status

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.rate_limit import TRIP_CREATION_POLICY, authenticated_rate_limit
from travel_friend_backend.schemas.trips import (
    TripCreateResponse,
    TripDetailResponse,
    TripListItemResponse,
)
from travel_friend_backend.schemas.trip_drafts import (
    TripDraftAlternativeCreateRequest,
    TripDraftAlternativeMetadataResponse,
    TripDraftAlternativeResponse,
    TripDraftContent,
    TripDraftDay,
    TripDraftDetailResponse,
    TripDraftResponse,
    TripDraftSaveRequest,
    TripDraftReadinessIssue,
    TripItineraryDayResponse,
    TripItineraryEventResponse,
    TripItineraryResponse,
)
from travel_friend_backend.schemas.trip_proposals import (
    TripProposalCreateRequest,
    TripProposalResponse,
    TripProposalSummaryResponse,
    TripProposalVoteRequest,
    proposal_scopes_overlap,
)
from travel_friend_backend.trip_draft_readiness import validate_trip_draft_fragment_for_confirmation


router = APIRouter(prefix="/chats", tags=["trips"])
trip_list_router = APIRouter(prefix="/trips", tags=["trips"])
MAX_DRAFT_ALTERNATIVES = 20


def _is_named_database_error(error: psycopg.Error, *, sqlstate: str, message: str) -> bool:
    return error.sqlstate == sqlstate and getattr(error.diag, "message_primary", None) == message


@trip_list_router.get("", response_model=list[TripListItemResponse])
def get_trips(
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> list[dict[str, object]]:
    """List all persisted Trips belonging to the authenticated participant."""
    rows = connection.execute(
        "SELECT t.id AS trip_id, t.chat_id, t.status, t.created_at, t.date_from, t.date_to, "
        "t.destination_status, t.dates_status, t.budget_status, t.transport_status, "
        "COALESCE(array_agg(ts.place_label ORDER BY ts.position) "
        "FILTER (WHERE ts.id IS NOT NULL), ARRAY[]::text[]) AS route_place_labels "
        "FROM public.trips t "
        "JOIN public.trip_participants tp ON tp.trip_id=t.id AND tp.left_at IS NULL "
        "LEFT JOIN public.trip_stops ts ON ts.trip_id=t.id "
        "WHERE tp.user_id=%s "
        "GROUP BY t.id, t.chat_id, t.status, t.created_at, t.date_from, t.date_to, "
        "t.destination_status, t.dates_status, t.budget_status, t.transport_status "
        "ORDER BY t.created_at DESC, t.id DESC",
        (principal.user_id,),
    ).fetchall()
    return [dict(row) for row in rows]


@trip_list_router.get("/{trip_id}", response_model=TripDetailResponse)
def get_trip(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read a persisted Trip only when the caller is a current participant."""
    trip = connection.execute(
        "SELECT t.id AS trip_id, t.chat_id, t.created_by_user_id, t.status, "
        "t.membership_version, t.state_version, t.destination_version, t.dates_version, "
        "t.budget_version, t.transport_version, t.destination_status, t.dates_status, "
        "t.budget_status, t.transport_status, t.date_from, t.date_to, t.budget_min, "
        "t.budget_max, t.budget_currency, t.budget_scope, t.started_at, t.completed_at, "
        "t.cancelled_at, t.created_at, t.updated_at "
        "FROM public.trips t "
        "JOIN public.trip_participants requester "
        "ON requester.trip_id=t.id AND requester.user_id=%s AND requester.left_at IS NULL "
        "WHERE t.id=%s",
        (principal.user_id, trip_id),
    ).fetchone()
    if trip is None:
        raise HTTPException(404, "Trip not found")

    route_stops = connection.execute(
        "SELECT id, position, place_label, country_code, place_ref, stay_from, stay_to, notes, "
        "created_at, updated_at FROM public.trip_stops WHERE trip_id=%s "
        "ORDER BY position ASC",
        (trip_id,),
    ).fetchall()
    accommodations = connection.execute(
        "SELECT id, name, location, date_from, date_to, notes "
        "FROM public.trip_confirmed_accommodations WHERE trip_id=%s ORDER BY id",
        (trip_id,),
    ).fetchall()
    transport = connection.execute(
        "SELECT id, mode, origin, destination, departure_at, arrival_at, notes "
        "FROM public.trip_confirmed_transport WHERE trip_id=%s ORDER BY id",
        (trip_id,),
    ).fetchall()
    participants = connection.execute(
        "SELECT user_id, display_name, age, city "
        "FROM public.trip_participant_profile_projection(%s)",
        (trip_id,),
    ).fetchall()
    return {
        "trip": dict(trip),
        "route_stops": [dict(stop) for stop in route_stops],
        "participants": [dict(participant) for participant in participants],
        "accommodations": [dict(item) for item in accommodations],
        "transport": [dict(item) for item in transport],
    }


@trip_list_router.get("/{trip_id}/itinerary", response_model=TripItineraryResponse)
def get_trip_itinerary(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read the confirmed day itinerary for a current Trip participant."""
    trip = connection.execute(
        "SELECT id FROM public.trips WHERE id=%s", (trip_id,)
    ).fetchone()
    if trip is None:
        raise HTTPException(404, "Trip not found")
    day_rows = connection.execute(
        "SELECT id, position, day_date, title, notes FROM public.trip_itinerary_days "
        "WHERE trip_id=%s ORDER BY position, id",
        (trip_id,),
    ).fetchall()
    event_rows = connection.execute(
        "SELECT id, day_id, position, kind, title, start_time, duration_minutes, "
        "address, estimated_cost, currency, notes FROM public.trip_itinerary_events "
        "WHERE trip_id=%s ORDER BY day_id, position, id",
        (trip_id,),
    ).fetchall()
    events_by_day: dict[UUID, list[dict[str, object]]] = {}
    for event in event_rows:
        events_by_day.setdefault(event["day_id"], []).append(dict(event))
    days = [
        {
            **dict(day),
            "events": events_by_day.get(day["id"], []),
        }
        for day in day_rows
    ]
    return {"trip_id": trip_id, "days": days}


@trip_list_router.get("/{trip_id}/draft", response_model=TripDraftDetailResponse)
def get_trip_draft(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read the shared Draft and bounded alternative metadata."""
    draft = connection.execute(
        "SELECT trip_id, version, content, updated_by_user_id, updated_at "
        "FROM public.trip_drafts WHERE trip_id=%s",
        (trip_id,),
    ).fetchone()
    if draft is None:
        raise HTTPException(404, "Trip Draft not found")
    alternatives = connection.execute(
        "SELECT id, trip_id, title, created_by_user_id, created_at "
        "FROM public.trip_draft_alternatives WHERE trip_id=%s "
        "ORDER BY created_at DESC, id DESC LIMIT %s",
        (trip_id, MAX_DRAFT_ALTERNATIVES),
    ).fetchall()
    return {
        "draft": dict(draft),
        "alternatives": [dict(item) for item in alternatives],
    }


@trip_list_router.get(
    "/{trip_id}/draft/alternatives/{alternative_id}",
    response_model=TripDraftAlternativeResponse,
)
def get_trip_draft_alternative(
    trip_id: UUID,
    alternative_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Read one bounded alternative snapshot for an active Trip participant."""
    row = connection.execute(
        "SELECT id, trip_id, title, content, created_by_user_id, created_at "
        "FROM public.trip_draft_alternatives WHERE trip_id=%s AND id=%s",
        (trip_id, alternative_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Trip Draft alternative not found")
    return dict(row)


@trip_list_router.put("/{trip_id}/draft", response_model=TripDraftResponse)
def save_trip_draft(
    trip_id: UUID,
    payload: TripDraftSaveRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Save the shared Draft only if the caller's base version is current."""
    try:
        row = connection.execute(
            "SELECT * FROM public.save_current_trip_draft(%s, %s, %s)",
            (trip_id, payload.base_version, Jsonb(payload.content.model_dump(mode="json"))),
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "40001":
            raise HTTPException(409, "Trip Draft changed; reload before saving") from error
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip Draft not found") from error
        if _is_named_database_error(error, sqlstate="22023", message="trip draft content exceeds 256 KiB"):
            raise HTTPException(422, "Содержимое черновика превышает лимит 256 КиБ.") from error
        raise
    if row is None:
        raise RuntimeError("Trip Draft save capability returned no Draft")
    return dict(row)


@trip_list_router.post(
    "/{trip_id}/draft/alternatives",
    response_model=TripDraftAlternativeMetadataResponse,
    status_code=201,
)
def save_trip_draft_alternative(
    trip_id: UUID,
    payload: TripDraftAlternativeCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    """Save a named snapshot as a shared alternative without applying it."""
    try:
        row = connection.execute(
            "SELECT * FROM public.save_current_trip_draft_alternative(%s, %s, %s)",
            (trip_id, payload.title, Jsonb(payload.content.model_dump(mode="json"))),
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip Draft not found") from error
        if _is_named_database_error(error, sqlstate="22023", message="trip draft alternative content exceeds 256 KiB"):
            raise HTTPException(422, "Содержимое варианта превышает лимит 256 КиБ.") from error
        if _is_named_database_error(error, sqlstate="P0001", message="trip draft alternative limit reached"):
            raise HTTPException(409, "Сохранено максимальное число вариантов поездки.") from error
        raise
    if row is None:
        raise RuntimeError("Trip Draft alternative capability returned no alternative")
    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "title": row["title"],
        "created_by_user_id": row["created_by_user_id"],
        "created_at": row["created_at"],
    }


def _get_trip_proposal_response(connection: psycopg.Connection, trip_id: UUID, proposal_id: UUID, user_id: UUID) -> dict[str, object]:
    proposal = connection.execute(
        "SELECT id, trip_id, creator_user_id, title, status, draft_version, deadline, "
        "blocked_reason, created_at, decided_at FROM public.trip_proposals WHERE trip_id=%s AND id=%s",
        (trip_id, proposal_id),
    ).fetchone()
    if proposal is None:
        raise HTTPException(404, "Proposal not found")
    operations = connection.execute(
        "SELECT scope_key AS scope, expected_version, old_value, proposed_value "
        "FROM public.trip_proposal_operations WHERE proposal_id=%s ORDER BY scope_key LIMIT 20",
        (proposal_id,),
    ).fetchall()
    voters = connection.execute(
        "SELECT user_id, vote, voted_at FROM public.trip_proposal_voters "
        "WHERE proposal_id=%s ORDER BY user_id LIMIT 50",
        (proposal_id,),
    ).fetchall()
    prerequisites = connection.execute(
        "SELECT prerequisite_proposal_id FROM public.trip_proposal_prerequisites "
        "WHERE proposal_id=%s ORDER BY prerequisite_proposal_id LIMIT 10",
        (proposal_id,),
    ).fetchall()
    own_vote = next((row["vote"] for row in voters if row["user_id"] == user_id), None)
    return {
        **dict(proposal),
        "own_vote": own_vote,
        "operations": [dict(row) for row in operations],
        "voters": [dict(row) for row in voters],
        "prerequisite_proposal_ids": [row["prerequisite_proposal_id"] for row in prerequisites],
    }


def _get_trip_proposal_summary(connection: psycopg.Connection, trip_id: UUID, proposal_id: UUID, user_id: UUID) -> dict[str, object]:
    proposal = connection.execute(
        "SELECT id, trip_id, creator_user_id, title, status, draft_version, deadline, "
        "blocked_reason, created_at, decided_at FROM public.trip_proposals WHERE trip_id=%s AND id=%s",
        (trip_id, proposal_id),
    ).fetchone()
    if proposal is None:
        raise HTTPException(404, "Proposal not found")
    scopes = connection.execute(
        "SELECT scope_key FROM public.trip_proposal_operations WHERE proposal_id=%s ORDER BY scope_key LIMIT 20",
        (proposal_id,),
    ).fetchall()
    voters = connection.execute(
        "SELECT user_id, vote, voted_at FROM public.trip_proposal_voters "
        "WHERE proposal_id=%s ORDER BY user_id LIMIT 50", (proposal_id,),
    ).fetchall()
    prerequisites = connection.execute(
        "SELECT prerequisite_proposal_id FROM public.trip_proposal_prerequisites "
        "WHERE proposal_id=%s ORDER BY prerequisite_proposal_id LIMIT 10", (proposal_id,),
    ).fetchall()
    own_vote = next((row["vote"] for row in voters if row["user_id"] == user_id), None)
    return {
        **dict(proposal), "own_vote": own_vote,
        "scopes": [row["scope_key"] for row in scopes],
        "voters": [dict(row) for row in voters],
        "prerequisite_proposal_ids": [row["prerequisite_proposal_id"] for row in prerequisites],
    }


def _refresh_trip_proposals(connection: psycopg.Connection, trip_id: UUID) -> None:
    try:
        connection.execute("SELECT public.refresh_current_trip_proposals(%s)", (trip_id,))
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip not found") from error
        raise


@trip_list_router.post("/{trip_id}/proposals", response_model=TripProposalResponse, status_code=201)
def create_trip_proposal(
    trip_id: UUID,
    payload: TripProposalCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    draft = connection.execute(
        "SELECT version, content FROM public.trip_drafts WHERE trip_id=%s", (trip_id,)
    ).fetchone()
    if draft is None:
        raise HTTPException(404, "Trip not found")
    if draft["version"] != payload.draft_version:
        raise HTTPException(409, "Общий черновик изменился. Обновите его перед отправкой предложения.")
    try:
        content = TripDraftContent.model_validate(draft["content"])
    except ValueError as error:
        raise HTTPException(409, "Текущий черновик требует обновления перед созданием предложения.") from error
    all_itinerary = "itinerary:all" in payload.scopes
    whole_day_ids = {
        UUID(scope.removeprefix("itinerary:day:"))
        for scope in payload.scopes if scope.startswith("itinerary:day:")
    }
    event_ids_by_day: dict[UUID, set[UUID]] = {}
    for scope in payload.scopes:
        if scope.startswith("itinerary:event:"):
            _, _, day_id, event_id = scope.split(":")
            event_ids_by_day.setdefault(UUID(day_id), set()).add(UUID(event_id))
    selected_days: list[TripDraftDay] = []
    for day in content.days:
        if all_itinerary or day.id in whole_day_ids:
            selected_days.append(day)
        elif day.id in event_ids_by_day:
            event_ids = event_ids_by_day[day.id]
            selected_days.append(day.model_copy(update={"events": [event for event in day.events if event.id in event_ids]}))
    selected_fragment = content.model_copy(update={"days": selected_days})
    readiness_issues = list(validate_trip_draft_fragment_for_confirmation(selected_fragment))
    for scope, collection, field, code, label in (
        ("route", content.route_stops, "place_label", "route_place_required", "место маршрута"),
        ("accommodation", content.accommodations, "name", "accommodation_name_required", "вариант проживания"),
        ("transport", content.transport, "mode", "transport_mode_required", "способ перемещения"),
    ):
        if scope in payload.scopes:
            for index, item in enumerate(collection):
                if not getattr(item, field).strip():
                    readiness_issues.append(TripDraftReadinessIssue(
                        path=f"{scope}[{index}].{field}", code=code,
                        message=f"Укажите {label} перед подтверждением.",
                    ))
    if readiness_issues:
        raise HTTPException(422, detail={"code": "draft_fragment_not_ready", "issues": [issue.model_dump() for issue in readiness_issues]})
    try:
        with connection.transaction():
            result = connection.execute(
                "SELECT * FROM public.create_current_trip_proposal(%s,%s,%s,%s,%s::text[],%s::uuid[],%s)",
                (trip_id, payload.draft_version, payload.title, payload.idempotency_key,
                 payload.scopes, payload.prerequisite_proposal_ids, payload.deadline),
            ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Trip or prerequisite Proposal not found") from error
        if error.sqlstate == "P0001" and error.diag.message_primary == "proposal scope is already pending":
            scope = error.diag.message_detail
            pending_scopes = connection.execute(
                "SELECT p.id,o.scope_key FROM public.trip_proposals p "
                "JOIN public.trip_proposal_operations o ON o.proposal_id=p.id "
                "WHERE p.trip_id=%s AND p.status='pending' ORDER BY p.created_at,p.id,o.scope_key LIMIT 1000",
                (trip_id,),
            ).fetchall()
            existing = next((row for row in pending_scopes if proposal_scopes_overlap(scope, row["scope_key"])), None)
            raise HTTPException(409, detail={
                "code": "proposal_scope_busy",
                "proposal_id": str(existing["id"]) if existing else None,
                "message": "Выбранная область уже обсуждается участниками.",
            }) from error
        if error.sqlstate in {"40001", "P0001", "23505"}:
            raise HTTPException(409, "Предложение конфликтует с текущим состоянием поездки.") from error
        if error.sqlstate == "22023":
            raise HTTPException(422, "Выбранные изменения нельзя отправить на голосование.") from error
        raise
    if result is None:
        raise RuntimeError("Trip Proposal capability returned no result")
    return _get_trip_proposal_response(connection, trip_id, result["proposal_id"], principal.user_id)


@trip_list_router.get("/{trip_id}/proposals", response_model=list[TripProposalSummaryResponse])
def list_trip_proposals(
    trip_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
    limit: int = 50,
) -> list[dict[str, object]]:
    if limit < 1 or limit > 50:
        raise HTTPException(422, "limit must be between 1 and 50")
    _refresh_trip_proposals(connection, trip_id)
    rows = connection.execute(
        "SELECT id FROM public.trip_proposals WHERE trip_id=%s "
        "ORDER BY created_at DESC,id DESC LIMIT %s", (trip_id, limit)
    ).fetchall()
    if not rows and connection.execute("SELECT 1 FROM public.trips WHERE id=%s", (trip_id,)).fetchone() is None:
        raise HTTPException(404, "Trip not found")
    return [_get_trip_proposal_summary(connection, trip_id, row["id"], principal.user_id) for row in rows]


@trip_list_router.get("/{trip_id}/proposals/{proposal_id}", response_model=TripProposalResponse)
def get_trip_proposal(
    trip_id: UUID,
    proposal_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    _refresh_trip_proposals(connection, trip_id)
    return _get_trip_proposal_response(connection, trip_id, proposal_id, principal.user_id)


@trip_list_router.post("/{trip_id}/proposals/{proposal_id}/votes", response_model=TripProposalResponse)
def vote_trip_proposal(
    trip_id: UUID,
    proposal_id: UUID,
    payload: TripProposalVoteRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    if connection.execute(
        "SELECT 1 FROM public.trip_proposals WHERE id=%s AND trip_id=%s", (proposal_id, trip_id)
    ).fetchone() is None:
        raise HTTPException(404, "Proposal not found")
    try:
        connection.execute("SELECT * FROM public.cast_current_trip_proposal_vote(%s,%s)", (proposal_id, payload.vote)).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Proposal not found") from error
        if error.sqlstate in {"P0001", "40001"}:
            raise HTTPException(409, "Состояние предложения изменилось. Обновите страницу.") from error
        if error.sqlstate == "22023":
            raise HTTPException(422, "Недопустимый голос.") from error
        raise
    return _get_trip_proposal_response(connection, trip_id, proposal_id, principal.user_id)


@trip_list_router.post("/{trip_id}/proposals/{proposal_id}/cancel", response_model=TripProposalResponse)
def cancel_trip_proposal(
    trip_id: UUID,
    proposal_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    if connection.execute(
        "SELECT 1 FROM public.trip_proposals WHERE id=%s AND trip_id=%s", (proposal_id, trip_id)
    ).fetchone() is None:
        raise HTTPException(404, "Proposal not found")
    try:
        connection.execute("SELECT * FROM public.cancel_current_trip_proposal(%s)", (proposal_id,)).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Proposal not found") from error
        if error.sqlstate == "P0001":
            raise HTTPException(409, "Предложение уже нельзя отменить.") from error
        raise
    return _get_trip_proposal_response(connection, trip_id, proposal_id, principal.user_id)


def create_trip_for_chat(
    connection: psycopg.Connection, chat_id: UUID, principal: AuthenticatedPrincipal
) -> dict[str, object]:
    """Create one forming Trip through the database-owned capability."""
    del principal
    try:
        trip = connection.execute(
            "SELECT * FROM public.create_current_trip_from_chat(%s)", (chat_id,)
        ).fetchone()
    except psycopg.Error as error:
        if error.sqlstate == "P0002":
            raise HTTPException(404, "Chat not found") from error
        if error.sqlstate == "23505" or (
            error.sqlstate == "P0001"
            and error.diag.message_primary == "unfinished trip already exists"
        ):
            raise HTTPException(409, "Unfinished Trip already exists") from error
        raise
    if trip is None:
        raise RuntimeError("Trip creation capability returned no Trip")
    return dict(trip)


@router.post(
    "/{chat_id}/trips",
    response_model=TripCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(authenticated_rate_limit(TRIP_CREATION_POLICY))],
)
def create_trip(
    chat_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
) -> dict[str, object]:
    return create_trip_for_chat(connection, chat_id, principal)
