"""PostgreSQL integration tests for frozen voting and atomic Proposal apply."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from time import sleep
from uuid import UUID, uuid4

import psycopg
import pytest

from test_discover import auth_headers, client, create_discover_eligible_user
from test_trip_draft import create_trip_context
from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)

pytestmark = pytest.mark.usefixtures("clean_database")


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture
def clean_database(database_url: str):
    truncate_sql = (
        "TRUNCATE public.trip_proposal_prerequisites, public.trip_proposal_voters, "
        "public.trip_proposal_operations, public.trip_proposals, public.trip_proposal_scope_versions, "
        "public.trip_confirmed_transport, public.trip_confirmed_accommodations, "
        "public.trip_draft_alternatives, public.trip_draft_versions, public.trip_drafts, "
        "public.trip_itinerary_events, public.trip_itinerary_days, public.trip_stops, "
        "public.trip_participants, public.trips, public.chat_summaries, public.messages, "
        "public.chat_participants, public.matches, public.chats, public.discover_interest_decisions, "
        "public.user_sessions, public.travel_intents, public.profile_photos, public.profiles, "
        "public.user_activity_states, public.user_settings, public.telegram_identities, "
        "public.users RESTART IDENTITY"
    )
    truncate_disposable_test_database(database_url, truncate_sql)
    yield
    truncate_disposable_test_database(database_url, truncate_sql)


def prepare_budget_proposal(client, first, trip_id: str, database_url: str, *, key: str | None = None, deadline=None):
    with psycopg.connect(database_url) as connection:
        version, content = connection.execute(
            "SELECT version,content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip_id),)
        ).fetchone()
    content["budget"] = {"min": "100.00", "max": "250.00", "currency": "RUB", "scope": "per_person"}
    saved = client.put(
        f"/trips/{trip_id}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": version, "content": content},
    )
    assert saved.status_code == 200
    return client.post(
        f"/trips/{trip_id}/proposals", headers=auth_headers(first["access_token"]),
        json={
            "draft_version": saved.json()["version"], "title": "Уточнить бюджет",
            "idempotency_key": key or str(uuid4()), "scopes": ["budget"],
            "deadline": deadline.isoformat() if deadline is not None else None,
        },
    )


def save_itinerary_draft(client, user, trip_id: str, database_url: str, days: list[dict]):
    with psycopg.connect(database_url) as connection:
        content = connection.execute(
            "SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip_id),)
        ).fetchone()[0]
    content["days"] = days
    return client.put(
        f"/trips/{trip_id}/draft", headers=auth_headers(user["access_token"]),
        json={"base_version": 1, "content": content},
    )


def itinerary_day(day_id: str, events: list[dict], *, title: str = "День") -> dict:
    return {"id": day_id, "date": None, "title": title, "notes": None, "events": events}


def itinerary_event(event_id: str, title: str, *, kind: str = "activity") -> dict:
    return {
        "id": event_id, "kind": kind, "title": title, "start_time": None,
        "duration_minutes": None, "address": None, "estimated_cost": None,
        "currency": None, "notes": None,
    }
def test_creator_must_vote_and_unanimous_vote_atomically_applies_budget_and_chat_event(client, database_url: str) -> None:
    first, second, chat_id, trip = create_trip_context(client, database_url)
    created = prepare_budget_proposal(client, first, trip["trip_id"], database_url)
    assert created.status_code == 201, created.text
    proposal = created.json()
    assert proposal["status"] == "pending"
    assert proposal["own_vote"] is None
    assert all(voter["vote"] is None for voter in proposal["voters"])
    assert proposal["operations"][0]["old_value"]["min"] is None
    assert proposal["operations"][0]["proposed_value"]["currency"] == "RUB"
    listed = client.get(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]))
    assert listed.status_code == 200
    assert listed.json()[0]["scopes"] == ["budget"]
    assert "operations" not in listed.json()[0]
    chat_messages = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(first["access_token"]))
    proposal_message = next(item for item in chat_messages.json() if item["proposal_id"] == proposal["id"])
    assert proposal_message["proposal_status"] == "pending"
    assert proposal_message["system_event"] == "proposal_created"

    first_vote = client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
        headers=auth_headers(first["access_token"]), json={"vote": "accept"},
    )
    assert first_vote.status_code == 200
    assert first_vote.json()["status"] == "pending"
    retried = client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
        headers=auth_headers(first["access_token"]), json={"vote": "accept"},
    )
    assert retried.status_code == 200
    conflicting_retry = client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
        headers=auth_headers(first["access_token"]), json={"vote": "reject"},
    )
    assert conflicting_retry.status_code == 409

    accepted = client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
        headers=auth_headers(second["access_token"]), json={"vote": "accept"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    assert accepted.json()["own_vote"] == "accept"
    refreshed_chat = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(second["access_token"]))
    proposal_messages = [item for item in refreshed_chat.json() if item["proposal_id"] == proposal["id"]]
    assert {item["proposal_status"] for item in proposal_messages} == {"accepted"}
    with psycopg.connect(database_url) as connection:
        confirmed = connection.execute(
            "SELECT budget_min,budget_max,budget_currency,budget_scope,budget_version,state_version FROM public.trips WHERE id=%s",
            (UUID(trip["trip_id"]),),
        ).fetchone()
        assert tuple(confirmed) == (100, 250, "RUB", "per_person", 1, 2)
        messages = connection.execute(
            "SELECT type,system_event,proposal_id,proposal_trip_id,sequence_number FROM public.messages WHERE chat_id=%s ORDER BY sequence_number",
            (chat_id,),
        ).fetchall()
    assert [(row[1], row[2], row[3]) for row in messages] == [
        ("proposal_created", UUID(proposal["id"]), UUID(trip["trip_id"])),
        ("proposal_accepted", UUID(proposal["id"]), UUID(trip["trip_id"])),
    ]


def test_idempotency_key_reuse_with_changed_deadline_or_prerequisites_conflicts(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    key = str(uuid4())
    created = prepare_budget_proposal(client, first, trip["trip_id"], database_url, key=key)
    assert created.status_code == 201
    original = created.json()
    base_request = {
        "draft_version": original["draft_version"], "title": original["title"],
        "idempotency_key": key, "scopes": ["budget"],
    }
    changed_deadline = client.post(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
                                   json={**base_request, "deadline": "2030-01-01T00:00:00Z"})
    changed_prerequisites = client.post(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
                                        json={**base_request, "prerequisite_proposal_ids": [str(uuid4())]})
    assert changed_deadline.status_code == 409
    assert changed_prerequisites.status_code == 409
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.trip_proposals WHERE trip_id=%s", (UUID(trip["trip_id"]),)).fetchone()[0] == 1


def test_rejection_preserves_confirmed_trip_and_draft_and_scope_conflicts_return_existing_proposal(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    created = prepare_budget_proposal(client, first, trip["trip_id"], database_url)
    proposal = created.json()
    conflict = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
        json={"draft_version": proposal["draft_version"], "title": "Параллельный бюджет",
              "idempotency_key": str(uuid4()), "scopes": ["budget"]},
    )
    assert conflict.status_code == 409
    rejected = client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
        headers=auth_headers(second["access_token"]), json={"vote": "reject"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    with psycopg.connect(database_url) as connection:
        unchanged = connection.execute(
            "SELECT budget_min,budget_version,state_version FROM public.trips WHERE id=%s",
            (UUID(trip["trip_id"]),),
        ).fetchone()
    assert tuple(unchanged) == (None, 0, 1)
    draft = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert draft.json()["draft"]["content"]["budget"]["currency"] == "RUB"


def test_proposal_reads_and_votes_are_hidden_from_nonmembers_and_read_payload_is_bounded(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    outsider = create_discover_eligible_user(client, 903)
    proposal = prepare_budget_proposal(client, first, trip["trip_id"], database_url).json()
    headers = auth_headers(outsider["access_token"])
    assert client.get(f"/trips/{trip['trip_id']}/proposals", headers=headers).status_code == 404
    assert client.get(f"/trips/{trip['trip_id']}/proposals/{proposal['id']}", headers=headers).status_code == 404
    assert client.post(
        f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes", headers=headers, json={"vote": "accept"}
    ).status_code == 404
    assert len(client.get(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"])).json()) <= 50


def test_concurrent_overlapping_itinerary_proposals_serialize_and_preserve_winner(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id = str(uuid4()), str(uuid4())
    with psycopg.connect(database_url) as connection:
        content = connection.execute("SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)).fetchone()[0]
    content["days"] = [itinerary_day(day_id, [itinerary_event(event_id, "День")])]
    saved = client.put(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
                       json={"base_version": 1, "content": content})
    assert saved.status_code == 200
    barrier = Barrier(3)

    def create(user, scope):
        barrier.wait()
        return client.post(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(user["access_token"]), json={
            "draft_version": saved.json()["version"], "title": "Параллельное изменение itinerary",
            "idempotency_key": str(uuid4()), "scopes": [scope],
        })

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [
            executor.submit(create, first, "itinerary:all"),
            executor.submit(create, second, f"itinerary:day:{day_id}"),
        ]
        barrier.wait()
        responses = [request.result() for request in requests]
    assert sorted(response.status_code for response in responses) == [201, 409]
    winner = next(response.json()["id"] for response in responses if response.status_code == 201)
    loser = next(response.json() for response in responses if response.status_code == 409)
    assert loser["detail"]["code"] == "proposal_scope_busy"
    assert loser["detail"]["proposal_id"] == winner
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.trip_proposals WHERE trip_id=%s", (UUID(trip["trip_id"]),)).fetchone()[0] == 1


def test_concurrent_final_votes_apply_once_and_preserve_unanimous_state(client, database_url: str) -> None:
    first, second, chat_id, trip = create_trip_context(client, database_url)
    proposal = prepare_budget_proposal(client, first, trip["trip_id"], database_url).json()
    barrier = Barrier(3)

    def vote(user):
        barrier.wait()
        return client.post(f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
                           headers=auth_headers(user["access_token"]), json={"vote": "accept"})

    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = [executor.submit(vote, user) for user in (first, second)]
        barrier.wait()
        responses = [request.result() for request in requests]
    assert [response.status_code for response in responses] == [200, 200]
    final_state = client.get(f"/trips/{trip['trip_id']}/proposals/{proposal['id']}", headers=auth_headers(first["access_token"]))
    assert final_state.status_code == 200
    assert final_state.json()["status"] == "accepted"
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.trip_proposal_voters WHERE proposal_id=%s AND vote='accept'", (UUID(proposal["id"]),)).fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM public.messages WHERE chat_id=%s AND proposal_id=%s AND system_event='proposal_accepted'", (chat_id, UUID(proposal["id"]))).fetchone()[0] == 1
        assert connection.execute("SELECT budget_version,state_version FROM public.trips WHERE id=%s", (UUID(trip["trip_id"]),)).fetchone() == (1, 2)


def test_disjoint_scope_proposals_can_both_apply_without_global_version_conflict(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    with psycopg.connect(database_url) as connection:
        content = connection.execute(
            "SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0]
    content["route_stops"] = [{
        "id": str(uuid4()), "place_label": "Казань", "country_code": None, "place_ref": None,
        "stay_from": None, "stay_to": None, "notes": None,
    }]
    content["budget"] = {"min": "100", "max": "250", "currency": "RUB", "scope": "per_person"}
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )
    assert saved.status_code == 200
    proposals = [
        client.post(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(user["access_token"]), json={
            "draft_version": saved.json()["version"], "title": scope, "idempotency_key": str(uuid4()), "scopes": [scope],
        })
        for user, scope in ((first, "budget"), (second, "route"))
    ]
    assert [response.status_code for response in proposals] == [201, 201]
    assert [response.json()["status"] for response in proposals] == ["pending", "pending"]
    for response in proposals:
        for user in (first, second):
            voted = client.post(
                f"/trips/{trip['trip_id']}/proposals/{response.json()['id']}/votes",
                headers=auth_headers(user["access_token"]), json={"vote": "accept"},
            )
            assert voted.status_code == 200, voted.text
    with psycopg.connect(database_url) as connection:
        trip_row = connection.execute(
            "SELECT budget_currency,budget_version,destination_version,state_version "
            "FROM public.trips WHERE id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()
    assert tuple(trip_row) == ("RUB", 1, 1, 3)
    confirmed = client.get(f"/trips/{trip['trip_id']}", headers=auth_headers(first["access_token"]))
    assert confirmed.status_code == 200
    assert [stop["place_label"] for stop in confirmed.json()["route_stops"]] == ["Казань"]


def test_accommodation_and_transport_apply_are_readable_from_confirmed_trip(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    with psycopg.connect(database_url) as connection:
        content = connection.execute(
            "SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0]
    accommodation_id, transport_id = str(uuid4()), str(uuid4())
    content["accommodations"] = [{
        "id": accommodation_id, "name": "Отель", "location": "Центр", "date_from": None, "date_to": None, "notes": None,
    }]
    content["transport"] = [{
        "id": transport_id, "mode": "Поезд", "origin": "Москва", "destination": "Казань",
        "departure_at": None, "arrival_at": None, "notes": None,
    }]
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )
    assert saved.status_code == 200, saved.text
    created = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Проживание и транспорт",
              "idempotency_key": str(uuid4()), "scopes": ["accommodation", "transport"]},
    )
    assert created.status_code == 201, created.text
    for user in (first, second):
        accepted = client.post(
            f"/trips/{trip['trip_id']}/proposals/{created.json()['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
        assert accepted.status_code == 200, accepted.text
    detail_response = client.get(f"/trips/{trip['trip_id']}", headers=auth_headers(first["access_token"]))
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["accommodations"][0]["id"] == accommodation_id
    assert detail_response.json()["transport"][0]["id"] == transport_id


def test_prerequisite_blocks_without_reserving_scope_then_rechecks_before_unblocking(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    with psycopg.connect(database_url) as connection:
        content = connection.execute(
            "SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0]
    content["route_stops"] = [{
        "id": str(uuid4()), "place_label": "Казань", "country_code": None, "place_ref": None,
        "stay_from": None, "stay_to": None, "notes": None,
    }]
    content["budget"] = {"min": "100", "max": "250", "currency": "RUB", "scope": "per_person"}
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )
    prerequisite = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Бюджет", "idempotency_key": str(uuid4()), "scopes": ["budget"]},
    ).json()
    blocked = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Маршрут", "idempotency_key": str(uuid4()),
              "scopes": ["route"], "prerequisite_proposal_ids": [prerequisite["id"]]},
    )
    assert blocked.status_code == 201, blocked.text
    assert blocked.json()["status"] == "blocked"
    for user in (first, second):
        accepted = client.post(
            f"/trips/{trip['trip_id']}/proposals/{prerequisite['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
        assert accepted.status_code == 200, accepted.text
    refreshed = client.get(f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]))
    assert refreshed.status_code == 200, refreshed.text
    dependent = next(item for item in refreshed.json() if item["id"] == blocked.json()["id"])
    assert dependent["status"] == "pending"


def test_itinerary_all_prerequisite_invalidates_blocked_day_snapshot(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id = str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_id, [itinerary_event(event_id, "Draft itinerary")])],
    )
    all_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Вся программа",
              "idempotency_key": str(uuid4()), "scopes": ["itinerary:all"]},
    ).json()
    dependent = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Отдельный день",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"],
              "prerequisite_proposal_ids": [all_proposal["id"]]},
    )
    assert dependent.status_code == 201, dependent.text
    for user in (first, second):
        accepted = client.post(
            f"/trips/{trip['trip_id']}/proposals/{all_proposal['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
        assert accepted.status_code == 200
    refreshed = client.get(
        f"/trips/{trip['trip_id']}/proposals/{dependent.json()['id']}",
        headers=auth_headers(first["access_token"]),
    )
    assert refreshed.json()["status"] == "needs_revision"
    with psycopg.connect(database_url) as connection:
        confirmed = connection.execute(
            "SELECT title FROM public.trip_itinerary_events WHERE trip_id=%s AND id=%s",
            (UUID(trip["trip_id"]), UUID(event_id)),
        ).fetchone()
    assert confirmed == ("Draft itinerary",)


def test_day_prerequisite_invalidates_blocked_whole_itinerary_snapshot(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id = str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_id, [itinerary_event(event_id, "Current day")])],
    )
    day_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "День",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    )
    assert day_proposal.status_code == 201, day_proposal.text
    day_proposal = day_proposal.json()
    whole = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Вся программа",
              "idempotency_key": str(uuid4()), "scopes": ["itinerary:all"],
              "prerequisite_proposal_ids": [day_proposal["id"]]},
    )
    assert whole.status_code == 201
    for user in (first, second):
        client.post(
            f"/trips/{trip['trip_id']}/proposals/{day_proposal['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
    state = client.get(
        f"/trips/{trip['trip_id']}/proposals/{whole.json()['id']}",
        headers=auth_headers(first["access_token"]),
    ).json()
    assert state["status"] == "needs_revision"
    confirmed = client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(first["access_token"]))
    assert [event["title"] for event in confirmed.json()["days"][0]["events"]] == ["Current day"]


def test_changing_one_day_does_not_stale_independent_day_proposal(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_one, day_two = str(uuid4()), str(uuid4())
    event_one, event_two = str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_one, [itinerary_event(event_one, "One")]),
         itinerary_day(day_two, [itinerary_event(event_two, "Two")])],
    )
    proposals = [client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(user["access_token"]),
        json={"draft_version": saved.json()["version"], "title": title,
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    ).json() for user, title, day_id in ((first, "Первый", day_one), (second, "Второй", day_two))]
    for proposal in proposals:
        for user in (first, second):
            result = client.post(
                f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
                headers=auth_headers(user["access_token"]), json={"vote": "accept"},
            )
            assert result.status_code == 200
    confirmed = client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(first["access_token"]))
    assert {event["title"] for day in confirmed.json()["days"] for event in day["events"]} == {"One", "Two"}


def test_event_proposal_changes_only_selected_event_and_preserves_sibling_ids(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id, sibling_id = str(uuid4()), str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_id, [itinerary_event(event_id, "Original"), itinerary_event(sibling_id, "Sibling")])],
    )
    day_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Создать день",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    )
    assert day_proposal.status_code == 201, day_proposal.text
    for user in (first, second):
        assert client.post(
            f"/trips/{trip['trip_id']}/proposals/{day_proposal.json()['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        ).status_code == 200
    current = saved.json()["content"]
    current["days"][0]["events"][0]["title"] = "Changed"
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": saved.json()["version"], "content": current},
    )
    assert saved.status_code == 200, saved.text
    scope = f"itinerary:event:{day_id}:{event_id}"
    created = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Изменить событие",
              "idempotency_key": str(uuid4()), "scopes": [scope]},
    )
    assert created.status_code == 201, created.text
    assert len(created.json()["operations"]) == 1
    assert created.json()["operations"][0]["proposed_value"]["id"] == event_id
    for user in (first, second):
        accepted = client.post(
            f"/trips/{trip['trip_id']}/proposals/{created.json()['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
        assert accepted.status_code == 200
    confirmed = client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(first["access_token"]))
    events = confirmed.json()["days"][0]["events"]
    assert [(event["id"], event["title"]) for event in events] == [(event_id, "Changed"), (sibling_id, "Sibling")]


def test_event_proposal_can_delete_selected_confirmed_event(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id, sibling_id = str(uuid4()), str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_id, [itinerary_event(event_id, "Delete me"), itinerary_event(sibling_id, "Keep me")])],
    )
    scope = f"itinerary:event:{day_id}:{event_id}"
    addition = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Add events",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    )
    assert addition.status_code == 201
    for user in (first, second):
        client.post(f"/trips/{trip['trip_id']}/proposals/{addition.json()['id']}/votes",
                    headers=auth_headers(user["access_token"]), json={"vote": "accept"})
    with psycopg.connect(database_url) as connection:
        current = connection.execute("SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)).fetchone()[0]
    current["days"][0]["events"] = [itinerary_event(sibling_id, "Keep me")]
    saved = client.put(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
                       json={"base_version": 2, "content": current})
    deletion = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Удалить событие",
              "idempotency_key": str(uuid4()), "scopes": [scope]},
    )
    assert deletion.status_code == 201, deletion.text
    assert deletion.json()["operations"][0]["proposed_value"] is None
    for user in (first, second):
        client.post(f"/trips/{trip['trip_id']}/proposals/{deletion.json()['id']}/votes",
                    headers=auth_headers(user["access_token"]), json={"vote": "accept"})
    confirmed = client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(first["access_token"]))
    assert [event["id"] for event in confirmed.json()["days"][0]["events"]] == [sibling_id]


def test_event_proposal_rejects_incomplete_selected_event_without_confirmed_mutation(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id = str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(
        client, first, trip["trip_id"], database_url,
        [itinerary_day(day_id, [itinerary_event(event_id, "Valid event")])],
    )
    day_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Создать день",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    )
    assert day_proposal.status_code == 201, day_proposal.text
    for user in (first, second):
        assert client.post(
            f"/trips/{trip['trip_id']}/proposals/{day_proposal.json()['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        ).status_code == 200
    content = saved.json()["content"]
    content["days"][0]["events"][0]["title"] = "   "
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": saved.json()["version"], "content": content},
    )
    assert saved.status_code == 200, saved.text
    rejected = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Неполное событие",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:event:{day_id}:{event_id}"]},
    )
    assert rejected.status_code == 422
    confirmed = client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(first["access_token"]))
    assert confirmed.json()["days"][0]["events"][0]["title"] == "Valid event"
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT count(*) FROM public.trip_proposals WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 1


def test_event_scope_conflicts_with_same_event_day_and_whole_itinerary(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    day_id, event_id, sibling_id = str(uuid4()), str(uuid4()), str(uuid4())
    saved = save_itinerary_draft(client, first, trip["trip_id"], database_url,
                                 [itinerary_day(day_id, [itinerary_event(event_id, "A"), itinerary_event(sibling_id, "B")])])
    day_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Создать день",
              "idempotency_key": str(uuid4()), "scopes": [f"itinerary:day:{day_id}"]},
    )
    assert day_proposal.status_code == 201, day_proposal.text
    for user in (first, second):
        assert client.post(
            f"/trips/{trip['trip_id']}/proposals/{day_proposal.json()['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        ).status_code == 200
    event_scope = f"itinerary:event:{day_id}:{event_id}"
    first_proposal = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Event", "idempotency_key": str(uuid4()), "scopes": [event_scope]},
    )
    assert first_proposal.status_code == 201, first_proposal.text
    for scope in (f"itinerary:day:{day_id}", "itinerary:all", f"itinerary:event:{day_id}:{sibling_id}"):
        conflict = client.post(
            f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
            json={"draft_version": saved.json()["version"], "title": "Overlap", "idempotency_key": str(uuid4()), "scopes": [scope]},
        )
        assert conflict.status_code == 409, conflict.text


def test_cancelling_proposal_releases_scope(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    proposal = prepare_budget_proposal(client, first, trip["trip_id"], database_url).json()
    cancelled = client.post(f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/cancel", headers=auth_headers(first["access_token"]))
    assert cancelled.status_code == 200
    replacement = prepare_budget_proposal(client, second, trip["trip_id"], database_url)
    assert replacement.status_code == 201, replacement.text


def test_expiry_releases_scope(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    deadline = datetime.now(timezone.utc) + timedelta(seconds=2)
    content_response = prepare_budget_proposal(client, first, trip["trip_id"], database_url, deadline=deadline)
    assert content_response.status_code == 201
    proposal = content_response.json()
    sleep(2.1)
    refreshed = client.get(f"/trips/{trip['trip_id']}/proposals/{proposal['id']}", headers=auth_headers(first["access_token"]))
    assert refreshed.json()["status"] == "expired"
    replacement = prepare_budget_proposal(client, second, trip["trip_id"], database_url)
    assert replacement.status_code == 201, replacement.text


def test_rejected_prerequisite_marks_dependent_for_revision(client, database_url: str) -> None:
    first, second, chat_id, trip = create_trip_context(client, database_url)
    prerequisite = prepare_budget_proposal(client, first, trip["trip_id"], database_url).json()
    dependent = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(second["access_token"]),
        json={"draft_version": prerequisite["draft_version"], "title": "Маршрут",
              "idempotency_key": str(uuid4()), "scopes": ["route"],
              "prerequisite_proposal_ids": [prerequisite["id"]]},
    ).json()
    blocked_chat = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(first["access_token"]))
    blocked_message = next(item for item in blocked_chat.json() if item["proposal_id"] == dependent["id"])
    assert blocked_message["proposal_status"] == "blocked"
    rejected = client.post(f"/trips/{trip['trip_id']}/proposals/{prerequisite['id']}/votes",
                           headers=auth_headers(second["access_token"]), json={"vote": "reject"})
    assert rejected.json()["status"] == "rejected"
    state = client.get(f"/trips/{trip['trip_id']}/proposals/{dependent['id']}", headers=auth_headers(first["access_token"]))
    assert state.json()["status"] == "needs_revision"
    refreshed_chat = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(first["access_token"]))
    dependent_messages = [item for item in refreshed_chat.json() if item["proposal_id"] == dependent["id"]]
    assert dependent_messages
    assert {item["proposal_status"] for item in dependent_messages} == {"needs_revision"}
    assert "proposal_needs_revision" in {item["system_event"] for item in dependent_messages}
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT budget_min,state_version FROM public.trips WHERE id=%s", (UUID(trip["trip_id"]),)).fetchone() == (None, 1)


def test_stale_scope_does_not_apply_or_accept_confirmed_changes(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    created = prepare_budget_proposal(client, first, trip["trip_id"], database_url)
    proposal = created.json()
    with psycopg.connect(database_url) as connection:
        connection.execute("UPDATE public.trips SET budget_version=budget_version+1 WHERE id=%s", (UUID(trip["trip_id"]),))
    for user in (first, second):
        result = client.post(
            f"/trips/{trip['trip_id']}/proposals/{proposal['id']}/votes",
            headers=auth_headers(user["access_token"]), json={"vote": "accept"},
        )
        assert result.status_code == 200, result.text
    assert result.json()["status"] == "stale"
    with psycopg.connect(database_url) as connection:
        confirmed = connection.execute(
            "SELECT budget_min,budget_version FROM public.trips WHERE id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()
    assert tuple(confirmed) == (None, 1)


def test_apply_failure_rolls_back_all_confirmed_changes_vote_status_and_chat_event(client, database_url: str) -> None:
    first, second, chat_id, trip = create_trip_context(client, database_url)
    with psycopg.connect(database_url) as connection:
        content = connection.execute(
            "SELECT content FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0]
    content["route_stops"] = [{
        "id": str(uuid4()), "place_label": "Казань", "country_code": None, "place_ref": None,
        "stay_from": None, "stay_to": None, "notes": None,
    }]
    content["budget"] = {"min": "100", "max": "250", "currency": "RUB", "scope": "per_person"}
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )
    created = client.post(
        f"/trips/{trip['trip_id']}/proposals", headers=auth_headers(first["access_token"]),
        json={"draft_version": saved.json()["version"], "title": "Маршрут и бюджет",
              "idempotency_key": str(uuid4()), "scopes": ["budget", "route"]},
    )
    assert created.status_code == 201, created.text
    proposal_id = created.json()["id"]
    with psycopg.connect(database_url) as connection:
        connection.execute("""
            CREATE FUNCTION public.test_fail_trip_stop_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test apply failure'; END $$
        """)
        connection.execute("""
            CREATE TRIGGER test_fail_trip_stop_insert BEFORE INSERT ON public.trip_stops
            FOR EACH ROW EXECUTE FUNCTION public.test_fail_trip_stop_insert()
        """)
    try:
        first_vote = client.post(
            f"/trips/{trip['trip_id']}/proposals/{proposal_id}/votes",
            headers=auth_headers(first["access_token"]), json={"vote": "accept"},
        )
        assert first_vote.status_code == 200, first_vote.text
        failed_final_vote = client.post(
            f"/trips/{trip['trip_id']}/proposals/{proposal_id}/votes",
            headers=auth_headers(second["access_token"]), json={"vote": "accept"},
        )
        assert failed_final_vote.status_code == 409, failed_final_vote.text
        with psycopg.connect(database_url) as connection:
            trip_state = connection.execute(
                "SELECT budget_min,budget_version,destination_version,state_version "
                "FROM public.trips WHERE id=%s", (UUID(trip["trip_id"]),)
            ).fetchone()
            proposal_state = connection.execute(
                "SELECT status FROM public.trip_proposals WHERE id=%s", (UUID(proposal_id),)
            ).fetchone()
            votes = connection.execute(
                "SELECT user_id,vote FROM public.trip_proposal_voters WHERE proposal_id=%s ORDER BY user_id",
                (UUID(proposal_id),),
            ).fetchall()
            events = connection.execute(
                "SELECT system_event FROM public.messages WHERE chat_id=%s ORDER BY sequence_number", (chat_id,)
            ).fetchall()
        assert tuple(trip_state) == (None, 0, 0, 1)
        assert tuple(proposal_state) == ("pending",)
        assert sorted((str(row[0]), row[1]) for row in votes) == sorted([
            (first["user"]["id"], "accept"), (second["user"]["id"], None)
        ])
        assert [row[0] for row in events] == ["proposal_created"]
    finally:
        with psycopg.connect(database_url) as connection:
            connection.execute("DROP TRIGGER IF EXISTS test_fail_trip_stop_insert ON public.trip_stops")
            connection.execute("DROP FUNCTION IF EXISTS public.test_fail_trip_stop_insert()")
