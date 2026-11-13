"""Strict aggregate-only input, calculation, and export helpers."""

from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

MAX_UPLOAD_BYTES = 1_000_000
MAX_METRIC_ROWS = 50_000
MAX_COUNT = 2**63 - 1
JSON_FIELDS = {"schema_version", "generated_at_utc", "metrics", "source_label"}
METRIC_FIELDS = {"period_type", "period_start", "metric", "value"}
CSV_FIELDS = ["period_type", "period_start", "metric", "value"]
DAILY_METRICS = (
    "new_users",
    "matches_created",
    "messages_all",
    "messages_user",
    "messages_system",
    "trips_created",
    "proposals_created",
    "proposals_accepted_applied",
)
WEEKLY_METRICS = ("wcat",)
SNAPSHOT_METRICS = ("registered_accounts_ever", "registered_accounts_not_deleted")
PERIOD_METRICS = {
    "day": frozenset(DAILY_METRICS),
    "week": frozenset(WEEKLY_METRICS),
    "snapshot": frozenset(SNAPSHOT_METRICS),
}


@dataclass(frozen=True)
class MetricPoint:
    period_type: str
    period_start: date
    metric: str
    value: int


@dataclass(frozen=True)
class DashboardDataset:
    source_label: str
    points: tuple[MetricPoint, ...]
    generated_at_utc: datetime | None = None


@dataclass(frozen=True)
class PeriodSummary:
    daily: dict[str, int]
    wcat: int
    registered_accounts_ever: int | None
    registered_accounts_not_deleted: int | None
    daily_available: bool
    wcat_available: bool
    has_data: bool


def _reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _parse_utc_datetime(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("generated_at_utc must be an ISO UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("generated_at_utc must be an ISO UTC timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError("generated_at_utc must use UTC")
    return parsed.astimezone(timezone.utc)


def _parse_date(value: object) -> date:
    if not isinstance(value, str):
        raise ValueError("period_start must use YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("period_start must use YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise ValueError("period_start must use YYYY-MM-DD")
    return parsed


def _parse_point(row: object, *, from_csv: bool = False) -> MetricPoint:
    if not isinstance(row, dict):
        raise ValueError("Every metric row must be an object")
    if set(row) != METRIC_FIELDS:
        raise ValueError("Unknown metric row field or missing aggregate field")
    period_type = row["period_type"]
    metric = row["metric"]
    if not isinstance(period_type, str) or period_type not in PERIOD_METRICS:
        raise ValueError("Unknown metric or period type")
    if not isinstance(metric, str) or metric not in PERIOD_METRICS[period_type]:
        raise ValueError("Unknown metric or period type")
    period_start = _parse_date(row["period_start"])
    if period_type == "week" and period_start.weekday() != 0:
        raise ValueError("Weekly period_start must be Monday UTC")
    raw_value = row["value"]
    if from_csv:
        if not isinstance(raw_value, str) or not raw_value.isascii() or not raw_value.isdecimal():
            raise ValueError("Metric value must be a non-negative integer")
        value: object = int(raw_value)
    else:
        value = raw_value
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_COUNT:
        raise ValueError("Metric value must be a non-negative integer")
    return MetricPoint(period_type, period_start, metric, value)


def _validate_points(points: Iterable[MetricPoint]) -> tuple[MetricPoint, ...]:
    point_list = tuple(points)
    if len(point_list) > MAX_METRIC_ROWS:
        raise ValueError("Too many aggregate rows")
    keys: set[tuple[str, date, str]] = set()
    buckets: dict[tuple[str, date], dict[str, int]] = {}
    for point in point_list:
        if point.period_type not in PERIOD_METRICS or point.metric not in PERIOD_METRICS[point.period_type]:
            raise ValueError("Unknown metric or period type")
        if not isinstance(point.period_start, date) or not isinstance(point.value, int) or isinstance(point.value, bool):
            raise ValueError("Metric value and period must be valid aggregate values")
        if point.value < 0 or point.value > MAX_COUNT:
            raise ValueError("Metric value must be a non-negative integer")
        if point.period_type == "week" and point.period_start.weekday() != 0:
            raise ValueError("Weekly period_start must be Monday UTC")
        key = (point.period_type, point.period_start, point.metric)
        if key in keys:
            raise ValueError("Duplicate metric row")
        keys.add(key)
        buckets.setdefault((point.period_type, point.period_start), {})[point.metric] = point.value

    day_buckets = sorted(day for period, day in buckets if period == "day")
    if day_buckets and day_buckets != [
        day_buckets[0] + timedelta(days=offset) for offset in range((day_buckets[-1] - day_buckets[0]).days + 1)
    ]:
        raise ValueError("Daily buckets must be contiguous; include empty days with zero counts")
    week_buckets = sorted(day for period, day in buckets if period == "week")
    if week_buckets and week_buckets != [
        week_buckets[0] + timedelta(days=7 * offset) for offset in range((week_buckets[-1] - week_buckets[0]).days // 7 + 1)
    ]:
        raise ValueError("Weekly buckets must be contiguous; include empty weeks with zero counts")

    for (period_type, _), values in buckets.items():
        expected = PERIOD_METRICS[period_type]
        if set(values) != expected:
            raise ValueError(f"Incomplete {period_type} bucket")
        if period_type == "day" and values["messages_all"] != values["messages_user"] + values["messages_system"]:
            raise ValueError("messages_all must equal messages_user plus messages_system")
        if period_type == "snapshot" and values["registered_accounts_not_deleted"] > values["registered_accounts_ever"]:
            raise ValueError("Non-deleted accounts cannot exceed lifetime registrations")

    snapshot_dates = [day for period, day in buckets if period == "snapshot"]
    if len(snapshot_dates) > 1:
        raise ValueError("Only one user totals snapshot is allowed")
    return tuple(sorted(point_list, key=lambda point: (point.period_type, point.period_start, point.metric)))


def import_dataset(raw: bytes, filename: str) -> DashboardDataset:
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload must be 1 MB or smaller")
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {"csv", "json"}:
        raise ValueError("Only aggregate CSV or JSON files are supported")
    if not raw:
        raise ValueError("The aggregate file is empty")

    if suffix == "json":
        try:
            payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_json_keys)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Invalid UTF-8 JSON aggregate file") from error
        if not isinstance(payload, dict):
            raise ValueError("JSON document must be an object")
        unknown_fields = set(payload) - JSON_FIELDS
        if unknown_fields:
            raise ValueError("Unknown JSON field")
        if type(payload.get("schema_version")) is not int or payload.get("schema_version") != 1:
            raise ValueError("Unsupported schema_version")
        if not isinstance(payload.get("metrics"), list):
            raise ValueError("metrics must be a list")
        generated_at = _parse_utc_datetime(payload.get("generated_at_utc"))
        source_label = "IMPORTED AGGREGATES"
        points = tuple(_parse_point(row) for row in payload["metrics"])
    else:
        try:
            content = raw.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(content, newline=""))
            if reader.fieldnames != CSV_FIELDS:
                raise ValueError("CSV must contain exactly: period_type,period_start,metric,value")
            rows = list(reader)
        except UnicodeDecodeError as error:
            raise ValueError("Invalid UTF-8 CSV aggregate file") from error
        except csv.Error as error:
            raise ValueError("CSV field is invalid or too large") from error
        if len(rows) > MAX_METRIC_ROWS:
            raise ValueError("Too many aggregate rows")
        if any(None in row or None in row.values() for row in rows):
            raise ValueError("CSV contains an invalid row or extra field")
        points = tuple(_parse_point(row, from_csv=True) for row in rows)
        generated_at = datetime.now(timezone.utc)
        source_label = "IMPORTED AGGREGATES"

    return DashboardDataset(source_label, _validate_points(points), generated_at)


def summarize_period(dataset: DashboardDataset, start: date, end: date) -> PeriodSummary:
    if end < start:
        raise ValueError("Period end cannot precede period start")
    daily = {metric: 0 for metric in DAILY_METRICS}
    wcat = 0
    snapshots: dict[date, dict[str, int]] = {}
    daily_available = False
    wcat_available = False
    for point in dataset.points:
        if point.period_type == "day" and start <= point.period_start <= end:
            daily[point.metric] += point.value
            daily_available = True
        elif point.period_type == "week" and point.period_start <= end and point.period_start + timedelta(days=6) >= start:
            wcat += point.value
            wcat_available = True
        elif point.period_type == "snapshot":
            snapshots.setdefault(point.period_start, {})[point.metric] = point.value
    snapshot_values = snapshots[max(snapshots)] if snapshots else {}
    return PeriodSummary(
        daily=daily,
        wcat=wcat,
        registered_accounts_ever=snapshot_values.get("registered_accounts_ever"),
        registered_accounts_not_deleted=snapshot_values.get("registered_accounts_not_deleted"),
        daily_available=daily_available,
        wcat_available=wcat_available,
        has_data=daily_available or wcat_available or bool(snapshot_values),
    )


def filtered_points(dataset: DashboardDataset, start: date, end: date) -> tuple[MetricPoint, ...]:
    latest_snapshot = max(
        (point.period_start for point in dataset.points if point.period_type == "snapshot"),
        default=None,
    )
    return tuple(
        point
        for point in dataset.points
        if start <= point.period_start <= end
        or (point.period_type == "week" and point.period_start <= end and point.period_start + timedelta(days=6) >= start)
        or (point.period_type == "snapshot" and point.period_start == latest_snapshot)
    )


def export_csv(points: Iterable[MetricPoint]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for point in _validate_points(points):
        writer.writerow(
            {
                "period_type": point.period_type,
                "period_start": point.period_start.isoformat(),
                "metric": point.metric,
                "value": point.value,
            }
        )
    return output.getvalue().encode("utf-8")


def export_json(points: Iterable[MetricPoint], *, source_label: str) -> bytes:
    if source_label not in {"DEMO", "SQL_EXPORT", "IMPORTED AGGREGATES"}:
        raise ValueError("Unknown source_label")
    point_list = _validate_points(points)
    payload = {
        "schema_version": 1,
        "source_label": source_label,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "metrics": [
            {
                "period_type": point.period_type,
                "period_start": point.period_start.isoformat(),
                "metric": point.metric,
                "value": point.value,
            }
            for point in point_list
        ],
    }
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build_demo_dataset(*, today: date | None = None) -> DashboardDataset:
    import random

    anchor = today or datetime.now(timezone.utc).date()
    rng = random.Random(20261113)
    points: list[MetricPoint] = []
    for offset in range(59, -1, -1):
        day = anchor - timedelta(days=offset)
        new_users = max(0, round(2.3 + 1.2 * math.sin(offset / 5) + rng.random()))
        values = {
            "new_users": new_users,
            "matches_created": max(0, round(new_users * 0.42 + rng.random())),
            "messages_all": rng.randint(12, 48),
            "messages_user": 0,
            "messages_system": 0,
            "trips_created": rng.randint(0, 5),
            "proposals_created": rng.randint(0, 8),
            "proposals_accepted_applied": rng.randint(0, 5),
        }
        values["messages_user"] = round(values["messages_all"] * 0.82)
        values["messages_system"] = values["messages_all"] - values["messages_user"]
        points.extend(MetricPoint("day", day, metric, value) for metric, value in values.items())

    first_monday = anchor - timedelta(days=anchor.weekday()) - timedelta(weeks=8)
    for week_offset in range(9):
        week = first_monday + timedelta(weeks=week_offset)
        points.append(MetricPoint("week", week, "wcat", rng.randint(0, 3)))
    total_users = sum(point.value for point in points if point.metric == "new_users") + 1_240
    snapshot_day = anchor
    points.extend(
        [
            MetricPoint("snapshot", snapshot_day, "registered_accounts_ever", total_users),
            MetricPoint("snapshot", snapshot_day, "registered_accounts_not_deleted", total_users - 23),
        ]
    )
    return DashboardDataset("DEMO — СИНТЕТИЧЕСКИЕ ДАННЫЕ", _validate_points(points), datetime.now(timezone.utc))
