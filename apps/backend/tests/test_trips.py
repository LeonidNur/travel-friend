"""PostgreSQL integration tests for authenticated direct Chat Trip creation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

import psycopg
import pytest
from psycopg import sql
from fastapi.testclient import TestClient

from test_discover import (
    auth_headers,
    client,
    create_discover_eligible_user,
    create_reciprocal_match,
    database_url,
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


def test_trip_creation_requires_authenticated_direct_chat_participant(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    outsider = create_discover_eligible_user(client, 3)
    chat_id = direct_chat_id(database_url, match["match_id"])
    with psycopg.connect(database_url) as connection:
        group_chat_id = connection.execute(
            "INSERT INTO public.chats (type) VALUES ('group') RETURNING id"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO public.chat_participants (chat_id, user_id) VALUES (%s, %s)",
            (group_chat_id, UUID(first["user"]["id"])),
        )

    assert client.post(f"/chats/{chat_id}/trips").status_code == 401
    assert create_trip(client, outsider["access_token"], chat_id).status_code == 404
    assert create_trip(client, first["access_token"], UUID("00000000-0000-0000-0000-000000000000")).status_code == 404
    assert create_trip(client, first["access_token"], group_chat_id).status_code == 404


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
    first, second, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])
    second_user_id = UUID(second["user"]["id"])
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
            ).format(sql.Literal(second_user_id))
        )
    try:
        with TestClient(client.app, raise_server_exceptions=False) as failure_client:
            response = create_trip(failure_client, first["access_token"], chat_id)

        assert response.status_code == 500
        with psycopg.connect(database_url) as connection:
            assert connection.execute(
                "SELECT count(*) FROM public.trips WHERE chat_id=%s", (chat_id,)
            ).fetchone() == (0,)
    finally:
        with psycopg.connect(database_url) as connection:
            connection.execute("DROP TRIGGER IF EXISTS fail_test_trip_participant_insert ON public.trip_participants")
            connection.execute("DROP FUNCTION IF EXISTS public.fail_test_trip_participant_insert()")
