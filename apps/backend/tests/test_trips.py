"""PostgreSQL integration tests for authenticated direct Chat Trip creation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import UUID

import psycopg
import pytest
from psycopg import sql
from fastapi.testclient import TestClient

from integration_database import require_disposable_test_database_url
from test_discover import (
    auth_headers,
    client,
    create_discover_eligible_user,
    create_reciprocal_match,
    database_url,
    decide,
)
from test_trip_persistence_migration import clean_database


pytestmark = pytest.mark.usefixtures("clean_database")


def direct_chat_id(database_url: str, match_id: str) -> UUID:
    with psycopg.connect(database_url) as connection:
        chat_id = connection.execute(
            "SELECT chat_id FROM public.matches WHERE id=%s", (match_id,)
        ).fetchone()[0]
    assert chat_id is not None
    return chat_id


def create_trip(client: TestClient, token: str, chat_id: UUID):
    return client.post(f"/chats/{chat_id}/trips", headers=auth_headers(token))


def get_trip(client: TestClient, token: str, trip_id: str):
    return client.get(f"/trips/{trip_id}", headers=auth_headers(token))


def current_age(birth_date: date) -> int:
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def create_direct_trip(client: TestClient, database_url: str):
    first, second, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])
    trip = create_trip(client, first["access_token"], chat_id).json()
    return first, second, chat_id, trip


def create_group_chat_with_three_participants(client: TestClient) -> tuple[dict[str, object], ...]:
    initiator = create_discover_eligible_user(client, 1)
    first_member = create_discover_eligible_user(client, 2)
    second_member = create_discover_eligible_user(client, 3)
    for member in (first_member, second_member):
        assert (
            decide(client, initiator["access_token"], member["user"]["id"], "interested").status_code
            == 200
        )
        assert (
            decide(client, member["access_token"], initiator["user"]["id"], "interested").status_code
            == 200
        )
    group_response = client.post(
        "/chats/groups",
        headers=auth_headers(initiator["access_token"]),
        json={"user_ids": [first_member["user"]["id"], second_member["user"]["id"]]},
    )
    assert group_response.status_code == 201
    return initiator, first_member, second_member, group_response.json()


def test_trip_list_returns_only_participant_trips_newest_first_with_persisted_route_summary(
    client: TestClient, database_url: str
) -> None:
    first, _, first_match = create_reciprocal_match(client)
    second = create_discover_eligible_user(client, 3)
    third = create_discover_eligible_user(client, 4)
    assert client.put(
        f"/discover/decisions/{third['user']['id']}",
        headers=auth_headers(second["access_token"]),
        json={"decision": "interested"},
    ).status_code == 200
    outsider_match = client.put(
        f"/discover/decisions/{second['user']['id']}",
        headers=auth_headers(third["access_token"]),
        json={"decision": "interested"},
    ).json()

    first_chat_id = direct_chat_id(database_url, first_match["match_id"])
    outsider_chat_id = direct_chat_id(database_url, outsider_match["match_id"])
    first_trip = create_trip(client, first["access_token"], first_chat_id).json()
    assert create_trip(client, second["access_token"], outsider_chat_id).status_code == 201

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.trips SET status='completed', created_at='2026-06-01T10:00:00Z', "
            "date_from='2026-07-01', date_to='2026-07-10', destination_status='confirmed', "
            "dates_status='confirmed', budget_status='review_required', transport_status='empty' "
            "WHERE id=%s",
            (UUID(first_trip["trip_id"]),),
        )
        connection.execute(
            "INSERT INTO public.trip_stops (trip_id, position, place_label) VALUES "
            "(%s, 2, 'Kyoto'), (%s, 1, 'Tokyo')",
            (UUID(first_trip["trip_id"]), UUID(first_trip["trip_id"])),
        )

    second_trip = create_trip(client, first["access_token"], first_chat_id).json()
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.trips SET created_at='2026-06-02T10:00:00Z' WHERE id=%s",
            (UUID(second_trip["trip_id"]),),
        )

    response = client.get("/trips", headers=auth_headers(first["access_token"]))

    assert response.status_code == 200
    assert response.json() == [
        {
            "trip_id": second_trip["trip_id"],
            "chat_id": str(first_chat_id),
            "status": "forming",
            "created_at": "2026-06-02T10:00:00Z",
            "date_from": None,
            "date_to": None,
            "destination_status": "empty",
            "dates_status": "empty",
            "budget_status": "empty",
            "transport_status": "empty",
            "route_place_labels": [],
        },
        {
            "trip_id": first_trip["trip_id"],
            "chat_id": str(first_chat_id),
            "status": "completed",
            "created_at": "2026-06-01T10:00:00Z",
            "date_from": "2026-07-01",
            "date_to": "2026-07-10",
            "destination_status": "confirmed",
            "dates_status": "confirmed",
            "budget_status": "review_required",
            "transport_status": "empty",
            "route_place_labels": ["Tokyo", "Kyoto"],
        },
    ]


def test_trip_list_returns_an_empty_list_when_current_user_has_no_trip_participation(
    client: TestClient,
) -> None:
    user = create_discover_eligible_user(client, 1)

    response = client.get("/trips", headers=auth_headers(user["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


def test_trip_detail_returns_persisted_snapshot_ordered_stops_and_trip_participants(
    client: TestClient, database_url: str
) -> None:
    first, second, chat_id, trip = create_direct_trip(client, database_url)
    trip_id = UUID(trip["trip_id"])
    assert client.patch(
        "/me/profile",
        headers=auth_headers(first["access_token"]),
        json={"birth_date": "1990-01-01", "city": "Moscow"},
    ).status_code == 200
    assert client.patch(
        "/me/profile",
        headers=auth_headers(second["access_token"]),
        json={"birth_date": "1995-12-31", "city": "Kazan"},
    ).status_code == 200
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.trips SET status='active', membership_version=2, state_version=3, "
            "destination_version=1, dates_version=1, budget_version=1, transport_version=1, "
            "destination_status='confirmed', dates_status='confirmed', budget_status='confirmed', "
            "transport_status='review_required', date_from='2026-10-01', date_to='2026-10-10', "
            "budget_min=1200.00, budget_max=1500.00, budget_currency='RUB', budget_scope='per_person', "
            "started_at='2026-09-01T10:00:00Z', updated_at='2026-09-01T11:00:00Z' WHERE id=%s",
            (trip_id,),
        )
        connection.execute(
            "INSERT INTO public.trip_stops "
            "(trip_id, position, place_label, country_code, place_ref, stay_from, stay_to, notes) VALUES "
            "(%s, 2, 'Kyoto', 'JP', 'place-kyoto', '2026-10-04', '2026-10-06', 'Stay near Gion'), "
            "(%s, 1, 'Tokyo', 'JP', 'place-tokyo', '2026-10-01', '2026-10-04', 'Arrive early')",
            (trip_id, trip_id),
        )

    response = get_trip(client, first["access_token"], trip["trip_id"])

    assert response.status_code == 200
    body = response.json()
    assert body["trip"] == {
        "trip_id": trip["trip_id"],
        "chat_id": str(chat_id),
        "created_by_user_id": first["user"]["id"],
        "status": "active",
        "membership_version": 2,
        "state_version": 3,
        "destination_version": 1,
        "dates_version": 1,
        "budget_version": 1,
        "transport_version": 1,
        "destination_status": "confirmed",
        "dates_status": "confirmed",
        "budget_status": "confirmed",
        "transport_status": "review_required",
        "date_from": "2026-10-01",
        "date_to": "2026-10-10",
        "budget_min": "1200.00",
        "budget_max": "1500.00",
        "budget_currency": "RUB",
        "budget_scope": "per_person",
        "started_at": "2026-09-01T10:00:00Z",
        "completed_at": None,
        "cancelled_at": None,
        "created_at": body["trip"]["created_at"],
        "updated_at": "2026-09-01T11:00:00Z",
    }
    assert [stop["position"] for stop in body["route_stops"]] == [1, 2]
    assert body["route_stops"] == [
        {
            "id": body["route_stops"][0]["id"],
            "position": 1,
            "place_label": "Tokyo",
            "country_code": "JP",
            "place_ref": "place-tokyo",
            "stay_from": "2026-10-01",
            "stay_to": "2026-10-04",
            "notes": "Arrive early",
            "created_at": body["route_stops"][0]["created_at"],
            "updated_at": body["route_stops"][0]["updated_at"],
        },
        {
            "id": body["route_stops"][1]["id"],
            "position": 2,
            "place_label": "Kyoto",
            "country_code": "JP",
            "place_ref": "place-kyoto",
            "stay_from": "2026-10-04",
            "stay_to": "2026-10-06",
            "notes": "Stay near Gion",
            "created_at": body["route_stops"][1]["created_at"],
            "updated_at": body["route_stops"][1]["updated_at"],
        },
    ]
    assert body["participants"] == sorted([
        {
            "user_id": first["user"]["id"],
            "display_name": "Candidate 1",
            "age": current_age(date(1990, 1, 1)),
            "city": "Moscow",
        },
        {
            "user_id": second["user"]["id"],
            "display_name": "Candidate 2",
            "age": current_age(date(1995, 12, 31)),
            "city": "Kazan",
        },
    ], key=lambda participant: participant["user_id"])


def test_trip_detail_returns_uniform_404_for_foreign_and_missing_trip(
    client: TestClient, database_url: str
) -> None:
    first, _, _, trip = create_direct_trip(client, database_url)
    outsider = create_discover_eligible_user(client, 3)

    foreign = get_trip(client, outsider["access_token"], trip["trip_id"])
    missing = get_trip(client, first["access_token"], "00000000-0000-0000-0000-000000000000")

    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json() == {"detail": "Trip not found"}


def test_trip_detail_excludes_former_participants_from_access_and_participant_projection(
    client: TestClient, database_url: str
) -> None:
    first, second, _, trip = create_direct_trip(client, database_url)
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.trip_participants SET left_at=now() WHERE trip_id=%s AND user_id=%s",
            (UUID(trip["trip_id"]), UUID(second["user"]["id"])),
        )

    former_participant = get_trip(client, second["access_token"], trip["trip_id"])
    current_participant = get_trip(client, first["access_token"], trip["trip_id"])

    assert former_participant.status_code == 404
    assert former_participant.json() == {"detail": "Trip not found"}
    assert current_participant.status_code == 200
    assert current_participant.json()["participants"] == [
        {"user_id": first["user"]["id"], "display_name": "Candidate 1", "age": None, "city": "Moscow"}
    ]


def test_trip_detail_reads_historical_trip_for_participant(
    client: TestClient, database_url: str
) -> None:
    first, _, _, trip = create_direct_trip(client, database_url)
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.trips SET status='completed', completed_at='2026-08-31T12:00:00Z' WHERE id=%s",
            (UUID(trip["trip_id"]),),
        )

    response = get_trip(client, first["access_token"], trip["trip_id"])

    assert response.status_code == 200
    assert response.json()["trip"]["status"] == "completed"
    assert response.json()["trip"]["completed_at"] == "2026-08-31T12:00:00Z"


def test_participant_creates_forming_trip_with_both_direct_chat_participants(
    client: TestClient, database_url: str
) -> None:
    first, second, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])

    response = create_trip(client, first["access_token"], chat_id)

    assert response.status_code == 201
    assert response.json() == {
        "trip_id": response.json()["trip_id"],
        "chat_id": str(chat_id),
        "created_by_user_id": first["user"]["id"],
        "status": "forming",
        "created_at": response.json()["created_at"],
    }
    with psycopg.connect(database_url) as connection:
        trip = connection.execute(
            "SELECT id, chat_id, created_by_user_id, status, membership_version, state_version, "
            "destination_version, dates_version, budget_version, transport_version, "
            "destination_status, dates_status, budget_status, transport_status "
            "FROM public.trips WHERE chat_id=%s",
            (chat_id,),
        ).fetchone()
        participants = connection.execute(
            "SELECT user_id FROM public.trip_participants WHERE trip_id=%s ORDER BY user_id",
            (trip[0],),
        ).fetchall()

    assert trip[0] == UUID(response.json()["trip_id"])
    assert trip[1:] == (
        chat_id,
        UUID(first["user"]["id"]),
        "forming",
        1,
        1,
        0,
        0,
        0,
        0,
        "empty",
        "empty",
        "empty",
        "empty",
    )
    assert participants == sorted(
        [(UUID(first["user"]["id"]),), (UUID(second["user"]["id"]),)]
    )


def test_group_chat_participant_creates_trip_with_all_active_chat_participants(
    client: TestClient, database_url: str
) -> None:
    initiator, first_member, second_member, group_chat = create_group_chat_with_three_participants(client)
    chat_id = UUID(group_chat["chat_id"])

    response = create_trip(client, first_member["access_token"], chat_id)

    assert response.status_code == 201
    assert response.json() == {
        "trip_id": response.json()["trip_id"],
        "chat_id": str(chat_id),
        "created_by_user_id": first_member["user"]["id"],
        "status": "forming",
        "created_at": response.json()["created_at"],
    }
    with psycopg.connect(database_url) as connection:
        participants = connection.execute(
            "SELECT user_id FROM public.trip_participants WHERE trip_id=%s ORDER BY user_id",
            (UUID(response.json()["trip_id"]),),
        ).fetchall()
    assert participants == sorted(
        [
            (UUID(initiator["user"]["id"]),),
            (UUID(first_member["user"]["id"]),),
            (UUID(second_member["user"]["id"]),),
        ]
    )


def test_trip_creation_requires_authenticated_direct_chat_participant(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    outsider = create_discover_eligible_user(client, 3)
    chat_id = direct_chat_id(database_url, match["match_id"])

    assert client.post(f"/chats/{chat_id}/trips").status_code == 401
    assert create_trip(client, outsider["access_token"], chat_id).status_code == 404
    assert create_trip(client, first["access_token"], UUID("00000000-0000-0000-0000-000000000000")).status_code == 404


def test_trip_creation_hides_group_chat_from_nonparticipant(client: TestClient) -> None:
    initiator, first_member, second_member, group_chat = create_group_chat_with_three_participants(client)
    outsider = create_discover_eligible_user(client, 4)

    response = create_trip(client, outsider["access_token"], UUID(group_chat["chat_id"]))

    assert response.status_code == 404


def test_repeated_trip_creation_conflicts_without_creating_a_second_trip(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])

    assert create_trip(client, first["access_token"], chat_id).status_code == 201
    repeated = create_trip(client, first["access_token"], chat_id)

    assert repeated.status_code == 409
    assert repeated.json() == {"detail": "Unfinished Trip already exists"}
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT count(*) FROM public.trips WHERE chat_id=%s AND status IN ('forming', 'active')",
            (chat_id,),
        ).fetchone() == (1,)


def test_concurrent_trip_creation_creates_exactly_one_trip(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda _: create_trip(client, first["access_token"], chat_id),
                range(2),
            )
        )

    assert sorted(response.status_code for response in responses) == [201, 409]
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT count(*) FROM public.trips WHERE chat_id=%s AND status IN ('forming', 'active')",
            (chat_id,),
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT count(*) FROM public.trip_participants tp "
            "JOIN public.trips t ON t.id=tp.trip_id WHERE t.chat_id=%s",
            (chat_id,),
        ).fetchone() == (2,)


def test_participant_insert_failure_rolls_back_trip_creation(
    client: TestClient, database_url: str
) -> None:
    first, second, third, group_chat = create_group_chat_with_three_participants(client)
    chat_id = UUID(group_chat["chat_id"])
    third_user_id = UUID(third["user"]["id"])
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "CREATE FUNCTION public.fail_test_trip_participant_insert() RETURNS trigger "
            "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test participant insert failure'; END; $$"
        )
        connection.execute(
            sql.SQL(
                "CREATE TRIGGER fail_test_trip_participant_insert "
                "BEFORE INSERT ON public.trip_participants "
                "FOR EACH ROW WHEN (NEW.user_id = {}) "
                "EXECUTE FUNCTION public.fail_test_trip_participant_insert()"
            ).format(sql.Literal(third_user_id))
        )
    try:
        with TestClient(client.app, raise_server_exceptions=False) as failure_client:
            response = create_trip(failure_client, first["access_token"], chat_id)

        assert response.status_code == 500
        with psycopg.connect(database_url) as connection:
            assert connection.execute(
                "SELECT count(*) FROM public.trips WHERE chat_id=%s", (chat_id,)
            ).fetchone() == (0,)
            assert connection.execute(
                "SELECT count(*) FROM public.trip_participants tp "
                "JOIN public.trips t ON t.id=tp.trip_id WHERE t.chat_id=%s",
                (chat_id,),
            ).fetchone() == (0,)
    finally:
        require_disposable_test_database_url(database_url)
        with psycopg.connect(database_url) as connection:
            connection.execute("DROP TRIGGER IF EXISTS fail_test_trip_participant_insert ON public.trip_participants")
            connection.execute("DROP FUNCTION IF EXISTS public.fail_test_trip_participant_insert()")
