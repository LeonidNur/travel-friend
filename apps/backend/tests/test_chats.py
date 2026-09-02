"""PostgreSQL integration tests for the authenticated direct Chats list."""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi.testclient import TestClient

from test_discover import (
    auth_headers,
    clean_database,
    client,
    create_discover_eligible_user,
    create_reciprocal_match,
    database_url,
    decide,
)


def create_group_eligible_users(client: TestClient) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    initiator = create_discover_eligible_user(client, 1)
    first_member = create_discover_eligible_user(client, 2)
    second_member = create_discover_eligible_user(client, 3)

    for member in (first_member, second_member):
        assert decide(client, initiator["access_token"], member["user"]["id"], "interested").status_code == 200
        assert decide(client, member["access_token"], initiator["user"]["id"], "interested").status_code == 200

    return initiator, first_member, second_member


def create_group(client: TestClient, token: str, user_ids: list[str]):
    return client.post("/chats/groups", headers=auth_headers(token), json={"user_ids": user_ids})


def test_chats_requires_authentication(client: TestClient) -> None:
    assert client.get("/chats").status_code == 401


def test_chats_returns_only_authenticated_users_direct_chat_with_companion_data(
    client: TestClient, database_url: str
) -> None:
    first, second, _ = create_reciprocal_match(client)
    third = create_discover_eligible_user(client, 3)
    fourth = create_discover_eligible_user(client, 4)
    assert decide(client, third["access_token"], fourth["user"]["id"], "interested").status_code == 200
    assert decide(client, fourth["access_token"], third["user"]["id"], "interested").status_code == 200
    assert client.patch(
        "/me/profile",
        headers=auth_headers(second["access_token"]),
        json={"birth_date": "1990-09-01", "city": "Kazan"},
    ).status_code == 200

    response = client.get("/chats", headers=auth_headers(first["access_token"]))

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["type"] == "direct"
    assert payload[0]["companion"] == {
        "user_id": second["user"]["id"],
        "display_name": "Candidate 2",
        "age": 36,
        "city": "Kazan",
    }
    with psycopg.connect(database_url) as connection:
        own_chat_id = connection.execute(
            "SELECT chat_id FROM public.matches WHERE user_a_id=%s OR user_b_id=%s",
            (first["user"]["id"], first["user"]["id"]),
        ).fetchone()[0]
    assert payload[0]["chat_id"] == str(own_chat_id)
    assert "created_at" in payload[0]
    assert all(item["companion"]["user_id"] != third["user"]["id"] for item in payload)


def test_chats_returns_group_chat_to_every_current_participant(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    created_group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    ).json()

    expected_user_ids = {
        initiator["user"]["id"],
        first_member["user"]["id"],
        second_member["user"]["id"],
    }
    for participant in (initiator, first_member, second_member):
        response = client.get("/chats", headers=auth_headers(participant["access_token"]))

        assert response.status_code == 200
        group_chat = next(
            item for item in response.json() if item["chat_id"] == created_group["chat_id"]
        )
        assert group_chat["type"] == "group"
        assert group_chat["participant_count"] == 3
        assert {member["user_id"] for member in group_chat["participants"]} == expected_user_ids
        assert {member["display_name"] for member in group_chat["participants"]} == {
            "Candidate 1",
            "Candidate 2",
            "Candidate 3",
        }
        assert "created_at" in group_chat


def test_chats_does_not_return_group_chat_to_nonparticipant(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    created_group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    ).json()
    outsider = create_discover_eligible_user(client, 4)

    response = client.get("/chats", headers=auth_headers(outsider["access_token"]))

    assert response.status_code == 200
    assert all(item["chat_id"] != created_group["chat_id"] for item in response.json())


def test_chats_sorts_direct_and_group_chats_by_created_at_then_chat_id(
    client: TestClient, database_url: str
) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    created_group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    ).json()

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.chats SET created_at='2026-01-01T00:00:00Z' "
            "WHERE id IN ("
            "SELECT chat_id FROM public.chat_participants WHERE user_id=%s"
            ")",
            (initiator["user"]["id"],),
        )
        connection.commit()
        expected_chat_ids = [
            str(row[0])
            for row in connection.execute(
                "SELECT c.id FROM public.chats c "
                "JOIN public.chat_participants cp ON cp.chat_id=c.id "
                "WHERE cp.user_id=%s AND cp.left_at IS NULL "
                "ORDER BY c.created_at DESC, c.id DESC",
                (initiator["user"]["id"],),
            ).fetchall()
        ]

    response = client.get("/chats", headers=auth_headers(initiator["access_token"]))

    assert response.status_code == 200
    assert [item["chat_id"] for item in response.json()] == expected_chat_ids
    assert created_group["chat_id"] in expected_chat_ids


def test_chats_returns_an_empty_list_when_the_user_has_no_chats(client: TestClient) -> None:
    user = create_discover_eligible_user(client, 1)

    response = client.get("/chats", headers=auth_headers(user["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


def test_creates_group_chat_for_initiator_and_eligible_direct_chat_companions(
    client: TestClient, database_url: str
) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)

    response = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["type"] == "group"
    assert set(payload["participant_user_ids"]) == {
        initiator["user"]["id"],
        first_member["user"]["id"],
        second_member["user"]["id"],
    }
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT type FROM public.chats WHERE id=%s", (payload["chat_id"],)
        ).fetchone() == ("group",)
        participants = connection.execute(
            "SELECT user_id FROM public.chat_participants WHERE chat_id=%s ORDER BY user_id",
            (payload["chat_id"],),
        ).fetchall()
    assert participants == sorted(
        [
            (UUID(initiator["user"]["id"]),),
            (UUID(first_member["user"]["id"]),),
            (UUID(second_member["user"]["id"]),),
        ]
    )


def test_group_chat_rejects_duplicate_member_ids(client: TestClient) -> None:
    initiator, first_member, _ = create_group_eligible_users(client)

    response = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], first_member["user"]["id"]],
    )

    assert response.status_code == 422


def test_group_chat_rejects_the_initiator_in_member_ids(client: TestClient) -> None:
    initiator, first_member, _ = create_group_eligible_users(client)

    response = create_group(
        client,
        initiator["access_token"],
        [initiator["user"]["id"], first_member["user"]["id"]],
    )

    assert response.status_code == 422


def test_group_chat_requires_at_least_three_total_participants(client: TestClient) -> None:
    initiator, first_member, _ = create_group_eligible_users(client)

    response = create_group(client, initiator["access_token"], [first_member["user"]["id"]])

    assert response.status_code == 422


def test_group_chat_rejects_member_without_an_eligible_direct_chat_and_rolls_back(
    client: TestClient, database_url: str
) -> None:
    initiator, eligible_member, _ = create_group_eligible_users(client)
    ineligible_member = create_discover_eligible_user(client, 4)

    response = create_group(
        client,
        initiator["access_token"],
        [eligible_member["user"]["id"], ineligible_member["user"]["id"]],
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Every group member must have a matched direct Chat with the initiator"
    }
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.chats WHERE type='group'").fetchone() == (0,)
        assert connection.execute(
            "SELECT count(*) FROM public.chat_participants cp "
            "JOIN public.chats c ON c.id=cp.chat_id WHERE c.type='group'"
        ).fetchone() == (0,)
