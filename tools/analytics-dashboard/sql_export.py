"""Explicit one-shot read-only export. The dashboard app never imports or calls this."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Sequence

from analytics_data import MetricPoint, _validate_points, export_csv, export_json

SQL_DIRECTORY = Path(__file__).resolve().parent / "sql"
DAILY_QUERY = (SQL_DIRECTORY / "daily.sql").read_text(encoding="utf-8")
WEEKLY_QUERY = (SQL_DIRECTORY / "weekly.sql").read_text(encoding="utf-8")
SNAPSHOT_QUERY = (SQL_DIRECTORY / "snapshot.sql").read_text(encoding="utf-8")
DEFAULT_DATABASE_URL_ENV = "TRAVEL_FRIEND_ANALYTICS_READONLY_DATABASE_URL"


def validate_date_range(start_value: str, end_value: str) -> tuple[date, date]:
    try:
        start = date.fromisoformat(start_value)
        end = date.fromisoformat(end_value)
    except ValueError as error:
        raise ValueError("Dates must use YYYY-MM-DD") from error
    if start.isoformat() != start_value or end.isoformat() != end_value:
        raise ValueError("Dates must use YYYY-MM-DD")
    if end < start:
        raise ValueError("End date cannot precede start date")
    if (end - start).days > 3653:
        raise ValueError("Export range cannot exceed 10 years")
    return start, end


def _as_point(row: Sequence[object]) -> MetricPoint:
    period_type, period_start, metric, value = row
    if not isinstance(period_start, date):
        raise ValueError("Database returned an invalid aggregate period")
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("Database returned an invalid aggregate count")
    if not isinstance(period_type, str) or not isinstance(metric, str):
        raise ValueError("Database returned an invalid aggregate metric")
    return MetricPoint(period_type, period_start, metric, value)


def fetch_export_points(connection: object, start: date, end: date) -> tuple[MetricPoint, ...]:
    """Run only fixed parameterized aggregate SELECTs in one read-only snapshot."""
    end_exclusive = end + timedelta(days=1)
    start_week = start - timedelta(days=start.weekday())
    end_week_exclusive = end - timedelta(days=end.weekday()) + timedelta(days=7)
    connection.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    try:
        connection.execute("SET LOCAL statement_timeout = '15s'")
        connection.execute("SET LOCAL lock_timeout = '1s'")
        rows = connection.execute(DAILY_QUERY, (start, end_exclusive)).fetchall()
        rows += connection.execute(WEEKLY_QUERY, (start_week, end_week_exclusive)).fetchall()
        rows += connection.execute(SNAPSHOT_QUERY).fetchall()
        points = _validate_points(_as_point(row) for row in rows)
        connection.execute("ROLLBACK")
        return points
    except Exception:
        try:
            connection.execute("ROLLBACK")
        except Exception:
            pass
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export aggregate Travel Friend metrics to a local file.")
    parser.add_argument("--start", required=True, help="Inclusive UTC date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="Inclusive UTC date (YYYY-MM-DD)")
    parser.add_argument("--format", choices=("json", "csv"), default="json")
    parser.add_argument("--output", required=True, type=Path, help="New local file path; existing files are not overwritten")
    parser.add_argument("--database-url-env", default=DEFAULT_DATABASE_URL_ENV)
    parser.add_argument(
        "--confirm-read-only-source",
        action="store_true",
        help="Confirm that the manually configured database target and account are read-only",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    connect: Callable[..., object] | None = None,
) -> int:
    args = _parser().parse_args(argv)
    if not args.confirm_read_only_source:
        print("Refusing to connect without --confirm-read-only-source.", file=sys.stderr)
        return 2
    try:
        start, end = validate_date_range(args.start, args.end)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    if args.output.exists():
        print("Output file already exists; choose a new path.", file=sys.stderr)
        return 2
    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        print(f"Set {args.database_url_env} for this one-shot export.", file=sys.stderr)
        return 2

    try:
        if connect is None:
            import psycopg

            connect = psycopg.connect
        with connect(database_url, autocommit=True, connect_timeout=5) as connection:
            points = fetch_export_points(connection, start, end)
        content = (
            export_json(points, source_label="SQL_EXPORT")
            if args.format == "json"
            else export_csv(points)
        )
        with args.output.open("xb") as output_file:
            output_file.write(content)
    except Exception as error:
        print(f"Aggregate export failed ({type(error).__name__}); no database details were printed.", file=sys.stderr)
        return 1

    print(f"Exported {len(points)} aggregate rows to {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
