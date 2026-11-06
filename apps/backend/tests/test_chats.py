"""PostgreSQL integration tests for the authenticated direct Chats list."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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


def create_group(client: TestClient, token: str, user_ids: list[str], *, title: str | None = None):
    payload: dict[str, object] = {"user_ids": user_ids}
    if title is not None:
        payload["title"] = title
    return client.post("/chats/groups", headers=auth_headers(token), json=payload)


def chat_id_for_match(database_url: str, match_id: str) -> str:
    with psycopg.connect(database_url) as connection:
        return str(connection.execute(
            "SELECT chat_id FROM public.matches WHERE id=%s", (match_id,)
        ).fetchone()[0])


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


def test_active_direct_participant_reads_the_companion_canonical_public_profile(
    client: TestClient, database_url: str
) -> None:
    requester, companion, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])
    assert client.patch(
        "/me/profile",
        headers=auth_headers(companion["access_token"]),
        json={
            "birth_date": "1990-09-01", "city": "Kazan", "bio": "Likes food",
            "travel_style": ["slow"], "interests": ["food"],
            "budget_level": "2", "comfort_level": "3",
        },
    ).status_code == 200

    response = client.get(
        f"/chats/{chat_id}/participants/{companion['user']['id']}/profile",
        headers=auth_headers(requester["access_token"]),
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": companion["user"]["id"], "display_name": "Candidate 2", "age": 36,
        "city": "Kazan", "bio": "Likes food", "travel_style": ["slow"],
        "interests": ["food"], "budget_level": "2", "comfort_level": "3",
        "travel_intent": {"destination": "Tbilisi", "date_from": None, "date_to": None},
    }


def test_active_group_participant_reads_another_active_member_canonical_public_profile(
    client: TestClient,
) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    group = create_group(
        client, initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title="Профиль участников",
    ).json()

    response = client.get(
        f"/chats/{group['chat_id']}/participants/{second_member['user']['id']}/profile",
        headers=auth_headers(first_member["access_token"]),
    )

    assert response.status_code == 200
    assert set(response.json()) == {
        "user_id", "display_name", "age", "city", "bio", "travel_style", "interests",
        "budget_level", "comfort_level", "travel_intent",
    }


def test_chat_participant_profile_hides_all_missing_or_unauthorized_relationships(
    client: TestClient, database_url: str
) -> None:
    requester, companion, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])
    outsider = create_discover_eligible_user(client, 3)
    unknown_user_id = "00000000-0000-0000-0000-000000000001"
    unknown_chat_id = "00000000-0000-0000-0000-000000000002"
    cases = [
        (outsider["access_token"], chat_id, companion["user"]["id"]),
        (requester["access_token"], chat_id, requester["user"]["id"]),
        (requester["access_token"], chat_id, unknown_user_id),
        (requester["access_token"], unknown_chat_id, companion["user"]["id"]),
    ]
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s",
            (chat_id, requester["user"]["id"]),
        )
        connection.commit()
    cases.append((requester["access_token"], chat_id, companion["user"]["id"]))
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.chat_participants SET left_at=NULL WHERE chat_id=%s AND user_id=%s",
            (chat_id, requester["user"]["id"]),
        )
        connection.execute(
            "UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s",
            (chat_id, companion["user"]["id"]),
        )
        connection.commit()
    cases.append((requester["access_token"], chat_id, companion["user"]["id"]))

    for token, requested_chat_id, target_user_id in cases:
        response = client.get(
            f"/chats/{requested_chat_id}/participants/{target_user_id}/profile",
            headers=auth_headers(token),
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Chat participant profile not found"}


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
        assert group_chat["title"] is None
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


def test_group_title_is_optional_trimmed_persisted_and_visible(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    named = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title="  Поездка на Байкал  ",
    )
    blank_named = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title=" \t ",
    )

    assert named.status_code == blank_named.status_code == 201
    chats = client.get("/chats", headers=auth_headers(first_member["access_token"]))
    by_id = {item["chat_id"]: item for item in chats.json()}
    assert by_id[named.json()["chat_id"]]["title"] == "Поездка на Байкал"
    assert by_id[blank_named.json()["chat_id"]]["title"] is None


def test_group_title_rejects_more_than_80_unicode_characters(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)

    response = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title="а" * 81,
    )

    assert response.status_code == 422


def test_active_group_participants_can_rename_with_whitespace_normalization(
    client: TestClient,
) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title="Первое название",
    ).json()

    renamed_by_member = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(first_member["access_token"]),
        json={"title": "  Маршрут выходного дня  "},
    )
    cleared_by_another_member = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(second_member["access_token"]),
        json={"title": " \t "},
    )

    assert renamed_by_member.status_code == 200
    assert renamed_by_member.json()["title"] == "Маршрут выходного дня"
    assert cleared_by_another_member.status_code == 200
    assert cleared_by_another_member.json()["title"] is None
    renamed_by_creator = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(initiator["access_token"]),
        json={"title": "Название от создателя"},
    )
    assert renamed_by_creator.status_code == 200
    assert renamed_by_creator.json()["title"] == "Название от создателя"


def test_group_rename_hides_direct_unknown_and_nonmember_chats(
    client: TestClient, database_url: str
) -> None:
    requester, _, match = create_reciprocal_match(client)
    direct_chat_id = chat_id_for_match(database_url, match["match_id"])
    initiator, first_member, second_member = create_group_eligible_users(client)
    group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    ).json()
    outsider = create_discover_eligible_user(client, 4)
    cases = (
        (requester["access_token"], direct_chat_id),
        (outsider["access_token"], group["chat_id"]),
        (initiator["access_token"], "00000000-0000-0000-0000-000000000001"),
    )

    for token, chat_id in cases:
        response = client.patch(
            f"/chats/{chat_id}/title", headers=auth_headers(token), json={"title": "Не должно сохраниться"}
        )
        assert response.status_code == 404

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s",
            (UUID(group["chat_id"]), UUID(second_member["user"]["id"])),
        )
    inactive_member_response = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(second_member["access_token"]),
        json={"title": "Не должно сохраниться"},
    )
    assert inactive_member_response.status_code == 404


def test_group_rename_rejects_invalid_payload_without_changing_title(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
        title="Сохранённое название",
    ).json()

    overlong = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(first_member["access_token"]),
        json={"title": "x" * 81},
    )
    extra_field = client.patch(
        f"/chats/{group['chat_id']}/title",
        headers=auth_headers(first_member["access_token"]),
        json={"title": "Новое", "type": "direct"},
    )
    chats = client.get("/chats", headers=auth_headers(first_member["access_token"]))

    assert overlong.status_code == extra_field.status_code == 422
    assert next(item for item in chats.json() if item["chat_id"] == group["chat_id"])["title"] == "Сохранённое название"


def test_concurrent_group_renames_are_last_write_wins(client: TestClient) -> None:
    initiator, first_member, second_member = create_group_eligible_users(client)
    group = create_group(
        client,
        initiator["access_token"],
        [first_member["user"]["id"], second_member["user"]["id"]],
    ).json()
    requests = (
        (first_member["access_token"], "Название от участника 1"),
        (second_member["access_token"], "Название от участника 2"),
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(
            lambda request: client.patch(
                f"/chats/{group['chat_id']}/title",
                headers=auth_headers(request[0]),
                json={"title": request[1]},
            ),
            requests,
        ))

    assert [response.status_code for response in responses] == [200, 200]
    current = client.get("/chats", headers=auth_headers(initiator["access_token"]))
    title = next(item for item in current.json() if item["chat_id"] == group["chat_id"])["title"]
    assert title in {request[1] for request in requests}
