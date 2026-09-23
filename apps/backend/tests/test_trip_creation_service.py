"""Unit coverage for the Chat Trip creation capability boundary."""

from __future__ import annotations

from uuid import uuid4

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


class FakeConnection:
    def __init__(self, results: list[QueryResult]) -> None:
        self.results = results
        self.queries: list[tuple[object, ...]] = []

    def execute(self, *args: object, **__: object) -> QueryResult:
        self.queries.append(args)
        return self.results.pop(0)


def test_create_trip_delegates_to_the_server_derived_capability() -> None:
    chat_id, creator_id, trip_id = uuid4(), uuid4(), uuid4()
    connection = FakeConnection(
        [
            QueryResult(
                {
                    "trip_id": trip_id,
                    "chat_id": chat_id,
                    "created_by_user_id": creator_id,
                    "status": "forming",
                    "created_at": object(),
                }
            )
        ]
    )

    trip = create_trip_for_chat(
        connection, chat_id, AuthenticatedPrincipal(user_id=creator_id, session_id=uuid4())
    )

    assert trip["trip_id"] == trip_id
    assert connection.results == []
    assert connection.queries == [
        ("SELECT * FROM public.create_current_trip_from_chat(%s)", (chat_id,))
    ]


def test_create_trip_route_delegates_to_the_transactional_use_case(monkeypatch) -> None:
    expected = {"trip_id": uuid4()}
    monkeypatch.setattr(trips, "create_trip_for_chat", lambda *_: expected)

    result = trips.create_trip(uuid4(), AuthenticatedPrincipal(uuid4(), uuid4()), object())

    assert result is expected
