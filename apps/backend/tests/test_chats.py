"""PostgreSQL integration tests for the authenticated direct Chats list."""

from __future__ import annotations

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
