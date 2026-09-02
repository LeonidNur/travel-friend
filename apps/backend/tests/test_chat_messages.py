"""PostgreSQL integration tests for authenticated Chat message history and sending."""

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


def chat_id_for_match(database_url: str, match_id: str) -> UUID:
    with psycopg.connect(database_url) as connection:
        chat_id = connection.execute(
            "SELECT chat_id FROM public.matches WHERE id=%s", (match_id,)
        ).fetchone()[0]
    assert chat_id is not None
    return chat_id


def send_message(client: TestClient, token: str, chat_id: UUID, content_text: str):
    return client.post(
        f"/chats/{chat_id}/messages",
        headers=auth_headers(token),
        json={"content_text": content_text},
    )


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
    response = client.post(
        "/chats/groups",
        headers=auth_headers(initiator["access_token"]),
        json={"user_ids": [first_member["user"]["id"], second_member["user"]["id"]]},
    )
    assert response.status_code == 201
    return initiator, first_member, second_member, response.json()


def test_messages_require_authentication(client: TestClient) -> None:
    assert client.get("/chats/00000000-0000-0000-0000-000000000000/messages").status_code == 401
    assert client.post(
        "/chats/00000000-0000-0000-0000-000000000000/messages",
        json={"content_text": "Hello"},
    ).status_code == 401


def test_participant_reads_history_in_ascending_sequence_order(
    client: TestClient, database_url: str
) -> None:
    first, second, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE public.chats SET last_sequence=4 WHERE id=%s", (chat_id,)
        )
        connection.execute(
            "INSERT INTO public.messages "
            "(chat_id, sender_user_id, sequence_number, type, content_text) "
            "VALUES (%s, %s, 3, 'user', 'third'), (%s, %s, 2, 'user', 'second')",
            (chat_id, UUID(first["user"]["id"]), chat_id, UUID(second["user"]["id"])),
        )
        connection.execute(
            "INSERT INTO public.messages (chat_id, sequence_number, type, content_text) "
            "VALUES (%s, 1, 'system', 'system notice')",
            (chat_id,),
        )
        connection.execute(
            "INSERT INTO public.messages "
            "(chat_id, recipient_user_id, sequence_number, type, content_text) "
            "VALUES (%s, %s, 4, 'system', 'private notice')",
            (chat_id, UUID(second["user"]["id"])),
        )

    response = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(first["access_token"]))

    assert response.status_code == 200
    payload = response.json()
    assert [message["sequence_number"] for message in payload] == [1, 2, 3]
    assert payload[0] == {
        "message_id": payload[0]["message_id"],
        "chat_id": str(chat_id),
        "sequence_number": 1,
        "type": "system",
        "sender_user_id": None,
        "content_text": "system notice",
        "created_at": payload[0]["created_at"],
    }

    recipient_response = client.get(
        f"/chats/{chat_id}/messages", headers=auth_headers(second["access_token"])
    )
    assert recipient_response.status_code == 200
    assert [message["sequence_number"] for message in recipient_response.json()] == [1, 2, 3, 4]


def test_non_participant_cannot_read_chat_history(client: TestClient, database_url: str) -> None:
    first, _, match = create_reciprocal_match(client)
    outsider = create_discover_eligible_user(client, 3)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    response = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(outsider["access_token"]))

    assert response.status_code == 404


def test_missing_chat_returns_not_found_for_authenticated_user(client: TestClient) -> None:
    participant, _, _ = create_reciprocal_match(client)

    assert client.get(
        "/chats/00000000-0000-0000-0000-000000000000/messages",
        headers=auth_headers(participant["access_token"]),
    ).status_code == 404
    assert client.post(
        "/chats/00000000-0000-0000-0000-000000000000/messages",
        headers=auth_headers(participant["access_token"]),
        json={"content_text": "Hello"},
    ).status_code == 404


def test_group_chat_participants_send_and_read_shared_history(client: TestClient) -> None:
    initiator, first_member, second_member, group_chat = create_group_chat_with_three_participants(client)
    chat_id = UUID(group_chat["chat_id"])
    participants = (initiator, first_member, second_member)

    sent_messages = [
        send_message(client, participant["access_token"], chat_id, f"message from {index}")
        for index, participant in enumerate(participants, start=1)
    ]

    assert [response.status_code for response in sent_messages] == [201, 201, 201]
    assert [response.json()["sequence_number"] for response in sent_messages] == [1, 2, 3]
    for participant in participants:
        response = client.get(f"/chats/{chat_id}/messages", headers=auth_headers(participant["access_token"]))

        assert response.status_code == 200
        assert [message["sequence_number"] for message in response.json()] == [1, 2, 3]
        assert [message["sender_user_id"] for message in response.json()] == [
            initiator["user"]["id"],
            first_member["user"]["id"],
            second_member["user"]["id"],
        ]


def test_non_participant_receives_not_found_for_group_chat_messages(
    client: TestClient, database_url: str
) -> None:
    initiator, first_member, second_member, group_chat = create_group_chat_with_three_participants(client)
    chat_id = UUID(group_chat["chat_id"])
    outsider = create_discover_eligible_user(client, 4)

    get_response = client.get(
        f"/chats/{chat_id}/messages", headers=auth_headers(outsider["access_token"])
    )
    post_response = send_message(client, outsider["access_token"], chat_id, "Not allowed")

    assert get_response.status_code == 404
    assert post_response.status_code == 404
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)
        ).fetchone() == (0,)
        assert connection.execute(
            "SELECT count(*) FROM public.messages WHERE chat_id=%s", (chat_id,)
        ).fetchone() == (0,)


def test_participant_sends_user_message_from_principal_and_updates_sequence(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    response = send_message(client, first["access_token"], chat_id, "  Hello  ")

    assert response.status_code == 201
    assert response.json() == {
        "message_id": response.json()["message_id"],
        "chat_id": str(chat_id),
        "sequence_number": 1,
        "type": "user",
        "sender_user_id": first["user"]["id"],
        "content_text": "Hello",
        "created_at": response.json()["created_at"],
    }
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)).fetchone() == (1,)
        assert connection.execute(
            "SELECT sender_user_id, recipient_user_id, type, content_text FROM public.messages WHERE chat_id=%s",
            (chat_id,),
        ).fetchone() == (UUID(first["user"]["id"]), None, "user", "Hello")


def test_client_cannot_supply_server_controlled_message_fields(
    client: TestClient, database_url: str
) -> None:
    first, second, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    response = client.post(
        f"/chats/{chat_id}/messages",
        headers=auth_headers(first["access_token"]),
        json={
            "content_text": "Hello",
            "sender_user_id": second["user"]["id"],
            "sequence_number": 99,
            "type": "system",
        },
    )

    assert response.status_code == 422
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.messages WHERE chat_id=%s", (chat_id,)).fetchone() == (0,)


def test_sequential_messages_receive_continuous_sequence_numbers(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    responses = [send_message(client, first["access_token"], chat_id, f"message {number}") for number in range(1, 4)]

    assert [response.status_code for response in responses] == [201, 201, 201]
    assert [response.json()["sequence_number"] for response in responses] == [1, 2, 3]
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)).fetchone() == (3,)


def test_empty_or_whitespace_only_message_is_rejected(client: TestClient, database_url: str) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    responses = [send_message(client, first["access_token"], chat_id, content) for content in ("", " \t\n ")]

    assert [response.status_code for response in responses] == [422, 422]
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)).fetchone() == (0,)


def test_non_participant_cannot_send_message(client: TestClient, database_url: str) -> None:
    _, _, match = create_reciprocal_match(client)
    outsider = create_discover_eligible_user(client, 3)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    response = send_message(client, outsider["access_token"], chat_id, "Not allowed")

    assert response.status_code == 404


def test_concurrent_sends_use_distinct_continuous_sequences(
    client: TestClient, database_url: str
) -> None:
    first, _, match = create_reciprocal_match(client)
    chat_id = chat_id_for_match(database_url, match["match_id"])

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda content: send_message(client, first["access_token"], chat_id, content),
                ("one", "two"),
            )
        )

    assert [response.status_code for response in responses] == [201, 201]
    assert sorted(response.json()["sequence_number"] for response in responses) == [1, 2]
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT sequence_number FROM public.messages WHERE chat_id=%s ORDER BY sequence_number",
            (chat_id,),
        ).fetchall() == [(1,), (2,)]
        assert connection.execute("SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)).fetchone() == (2,)
