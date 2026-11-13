from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from sql_export import (
    DAILY_QUERY,
    SNAPSHOT_QUERY,
    WEEKLY_QUERY,
    fetch_export_points,
    main,
    validate_date_range,
)


def test_sql_export_queries_are_fixed_aggregate_selects() -> None:
    sql = "\n".join((DAILY_QUERY, WEEKLY_QUERY, SNAPSHOT_QUERY)).lower()

    assert "begin transaction" not in sql
    assert "insert into" not in sql
    assert "update " not in sql
    assert "delete from" not in sql
    assert "count(distinct proposals.trip_id)" in sql
    assert "content_text" not in sql
    assert "telegram_user_id" not in sql
    assert "profile" not in sql
    assert "metadata" not in sql


def test_sql_export_date_range_is_inclusive_utc_and_bounded() -> None:
    assert validate_date_range("2026-11-01", "2026-11-30") == (
        date(2026, 11, 1),
        date(2026, 11, 30),
    )

    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        validate_date_range("2026-11-01T00:00:00Z", "2026-11-30")
    with pytest.raises(ValueError, match="cannot precede"):
        validate_date_range("2026-12-01", "2026-11-30")
    with pytest.raises(ValueError, match="10 years"):
        validate_date_range("2000-01-01", "2026-11-30")


def test_export_sql_files_are_only_the_reviewed_fixed_queries() -> None:
    sql_directory = Path(__file__).resolve().parents[1] / "sql"

    assert (sql_directory / "daily.sql").read_text() == DAILY_QUERY
    assert (sql_directory / "weekly.sql").read_text() == WEEKLY_QUERY
    assert (sql_directory / "snapshot.sql").read_text() == SNAPSHOT_QUERY


class _Result:
    def __init__(self, rows=()) -> None:
        self._rows = rows

    def fetchall(self):
        return list(self._rows)


class _ReadOnlyConnection:
    def __init__(self, *, fail_query: bool = False) -> None:
        self.calls: list[tuple[str, tuple[object, ...] | None]] = []
        self.fail_query = fail_query

    def execute(self, query: str, params=None):
        self.calls.append((query, params))
        if self.fail_query and query == DAILY_QUERY:
            raise RuntimeError("private connection error")
        if query == DAILY_QUERY:
            return _Result([])
        if query == WEEKLY_QUERY:
            return _Result([])
        if query == SNAPSHOT_QUERY:
            return _Result(
                [
                    ("snapshot", date(2026, 11, 30), "registered_accounts_ever", 8),
                    ("snapshot", date(2026, 11, 30), "registered_accounts_not_deleted", 7),
                ]
            )
        return _Result()


def test_sql_export_uses_one_read_only_transaction_and_returns_aggregates_only() -> None:
    connection = _ReadOnlyConnection()

    points = fetch_export_points(connection, date(2026, 11, 1), date(2026, 11, 30))

    assert connection.calls[0][0] == "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert connection.calls[-1][0] == "ROLLBACK"
    assert points[0].metric == "registered_accounts_ever"
    assert points[1].metric == "registered_accounts_not_deleted"
    assert connection.calls[4][1] == (date(2026, 10, 26), date(2026, 12, 7))
    assert connection.calls[5][1] is None


def test_sql_export_rolls_back_on_query_failure() -> None:
    connection = _ReadOnlyConnection(fail_query=True)

    with pytest.raises(RuntimeError, match="private connection error"):
        fetch_export_points(connection, date(2026, 11, 1), date(2026, 11, 30))

    assert connection.calls[-1][0] == "ROLLBACK"


def test_cli_does_not_connect_without_explicit_read_only_confirmation(monkeypatch) -> None:
    monkeypatch.setenv("TRAVEL_FRIEND_ANALYTICS_READONLY_DATABASE_URL", "postgresql://local-test")
    connections: list[object] = []

    result = main(
        ["--start", "2026-11-01", "--end", "2026-11-30", "--output", "unused.json"],
        connect=lambda *_args, **_kwargs: connections.append(True),
    )

    assert result == 2
    assert connections == []
