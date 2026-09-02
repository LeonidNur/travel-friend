"""Unit coverage for Chat Trip creation transaction branches."""

from __future__ import annotations

from contextlib import AbstractContextManager
from uuid import uuid4

import pytest
from fastapi import HTTPException

from travel_friend_backend.auth.service import AuthenticatedPrincipal
from travel_friend_backend.routers import trips
from travel_friend_backend.routers.trips import create_trip_for_chat


class QueryResult:
    def __init__(self, row: dict[str, object] | None = None, rows: list[dict[str, object]] | None = None) -> None:
        self.row = row
        self.rows = rows or []

    def fetchone(self) -> dict[str, object] | None:
        return self.row

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


class Transaction(AbstractContextManager[None]):
    def __exit__(self, *_: object) -> None:
        return None


class FakeConnection:
    def __init__(self, results: list[QueryResult]) -> None:
        self.results = results

    def transaction(self) -> Transaction:
        return Transaction()

    def execute(self, *_: object, **__: object) -> QueryResult:
        return self.results.pop(0)


def test_create_trip_inserts_server_derived_participants() -> None:
    chat_id, creator_id, companion_id, trip_id = uuid4(), uuid4(), uuid4(), uuid4()
    connection = FakeConnection(
        [
            QueryResult({"id": chat_id}),
            QueryResult(),
            QueryResult(rows=[{"user_id": creator_id}, {"user_id": companion_id}]),
            QueryResult(
                {
                    "trip_id": trip_id,
                    "chat_id": chat_id,
                    "created_by_user_id": creator_id,
                    "status": "forming",
                    "created_at": object(),
                }
            ),
            QueryResult(rows=[{"user_id": creator_id}, {"user_id": companion_id}]),
        ]
    )

    trip = create_trip_for_chat(
        connection, chat_id, AuthenticatedPrincipal(user_id=creator_id, session_id=uuid4())
    )

    assert trip["trip_id"] == trip_id
    assert connection.results == []


@pytest.mark.parametrize(
    ("results", "expected_status"),
    [([QueryResult()], 404), ([QueryResult({"id": uuid4()}), QueryResult({"id": uuid4()})], 409)],
)
def test_create_trip_hides_inaccessible_chat_and_rejects_existing_unfinished_trip(
    results: list[QueryResult], expected_status: int
) -> None:
    with pytest.raises(HTTPException) as error:
        create_trip_for_chat(
            FakeConnection(results), uuid4(), AuthenticatedPrincipal(user_id=uuid4(), session_id=uuid4())
        )

    assert error.value.status_code == expected_status


def test_create_trip_rejects_broken_chat_membership() -> None:
    chat_id, creator_id, other_participant_id = uuid4(), uuid4(), uuid4()
    connection = FakeConnection(
        [
            QueryResult({"id": chat_id}),
            QueryResult(),
            QueryResult(rows=[{"user_id": other_participant_id}]),
        ]
    )

    with pytest.raises(RuntimeError, match="membership invariant"):
        create_trip_for_chat(
            connection, chat_id, AuthenticatedPrincipal(user_id=creator_id, session_id=uuid4())
        )


def test_create_trip_route_delegates_to_the_transactional_use_case(monkeypatch) -> None:
    expected = {"trip_id": uuid4()}
    monkeypatch.setattr(trips, "create_trip_for_chat", lambda *_: expected)

    result = trips.create_trip(uuid4(), AuthenticatedPrincipal(uuid4(), uuid4()), object())

    assert result is expected
