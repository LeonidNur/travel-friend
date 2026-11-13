from __future__ import annotations

import json
from datetime import date

import pytest

from analytics_data import (
    DAILY_METRICS,
    DashboardDataset,
    MetricPoint,
    build_demo_dataset,
    export_csv,
    export_json,
    import_dataset,
    filtered_points,
    summarize_period,
)


def _payload() -> dict[str, object]:
    metrics: list[dict[str, object]] = []
    for day, new_users, accepted in (
        ("2026-11-12", 2, 0),
        ("2026-11-13", 1, 3),
    ):
        values = {
            "new_users": new_users,
            "matches_created": 1,
            "messages_all": 3,
            "messages_user": 2,
            "messages_system": 1,
            "trips_created": 1,
            "proposals_created": 2,
            "proposals_accepted_applied": accepted,
        }
        metrics.extend(
            {"period_type": "day", "period_start": day, "metric": metric, "value": value}
            for metric, value in values.items()
        )
    metrics.append(
        {"period_type": "week", "period_start": "2026-11-09", "metric": "wcat", "value": 2}
    )
    metrics.extend(
        [
            {
                "period_type": "snapshot",
                "period_start": "2026-11-13",
                "metric": "registered_accounts_ever",
                "value": 12,
            },
            {
                "period_type": "snapshot",
                "period_start": "2026-11-13",
                "metric": "registered_accounts_not_deleted",
                "value": 10,
            },
        ]
    )
    return {
        "schema_version": 1,
        "generated_at_utc": "2026-11-13T12:00:00Z",
        "metrics": metrics,
    }


def test_imports_valid_json_as_unverified_aggregates() -> None:
    dataset = import_dataset(json.dumps(_payload()).encode(), "dashboard.json")

    assert dataset.source_label == "IMPORTED AGGREGATES"
    assert len(dataset.points) == 19
    assert all(isinstance(point.value, int) for point in dataset.points)


@pytest.mark.parametrize("source_label", ["DEMO", "SQL_EXPORT", "IMPORTED AGGREGATES"])
def test_imported_json_cannot_claim_a_trusted_source_label(source_label: str) -> None:
    payload = _payload()
    payload["source_label"] = source_label

    dataset = import_dataset(json.dumps(payload).encode(), "dashboard.json")

    assert dataset.source_label == "IMPORTED AGGREGATES"


def test_latest_user_snapshot_is_independent_of_selected_activity_period() -> None:
    dataset = import_dataset(json.dumps(_payload()).encode(), "dashboard.json")

    summary = summarize_period(dataset, date(2026, 10, 1), date(2026, 10, 31))
    report_points = filtered_points(dataset, date(2026, 10, 1), date(2026, 10, 31))

    assert summary.registered_accounts_ever == 12
    assert summary.registered_accounts_not_deleted == 10
    assert {point.metric for point in report_points if point.period_type == "snapshot"} == {
        "registered_accounts_ever",
        "registered_accounts_not_deleted",
    }


def test_period_summary_uses_utc_range_and_wcat_rows_not_proposal_counts() -> None:
    dataset = import_dataset(json.dumps(_payload()).encode(), "dashboard.json")

    summary = summarize_period(dataset, date(2026, 11, 9), date(2026, 11, 13))

    assert summary.daily["new_users"] == 3
    assert summary.daily["proposals_accepted_applied"] == 3
    assert summary.wcat == 2
    assert summary.registered_accounts_ever == 12
    assert summary.registered_accounts_not_deleted == 10


def test_demo_data_is_marked_demo_and_has_no_claimed_activity_metrics() -> None:
    dataset = build_demo_dataset(today=date(2026, 11, 13))

    assert dataset.source_label == "DEMO — СИНТЕТИЧЕСКИЕ ДАННЫЕ"
    assert all(point.metric in (*DAILY_METRICS, "wcat", "registered_accounts_ever", "registered_accounts_not_deleted") for point in dataset.points)
    assert not any(point.metric in {"dau", "mau", "retention", "discover_views"} for point in dataset.points)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda payload: payload.update(extra="private"), "Unknown JSON field"),
        (lambda payload: payload.update(schema_version=2), "Unsupported schema_version"),
    ],
)
def test_rejects_unknown_json_fields_and_versions(mutate, message: str) -> None:
    payload = _payload()
    mutate(payload)

    with pytest.raises(ValueError, match=message):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")


def test_rejects_unknown_fields_duplicate_rows_and_non_aggregate_data() -> None:
    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics[0]["user_id"] = "user-123"
    with pytest.raises(ValueError, match="Unknown metric row field"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")

    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics.append(metrics[0])
    with pytest.raises(ValueError, match="Duplicate metric row"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")


@pytest.mark.parametrize("bad_value", [-1, 1.5, True, "NaN", 2**64])
def test_rejects_invalid_aggregate_counts(bad_value: object) -> None:
    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics[0]["value"] = bad_value

    with pytest.raises(ValueError, match="non-negative integer"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")


def test_rejects_non_utc_or_invalid_bucket_dates() -> None:
    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics[0]["period_start"] = "2026-11-12T00:00:00-05:00"

    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")

    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics[-1]["value"] = 13
    with pytest.raises(ValueError, match="cannot exceed lifetime"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")


def test_rejects_incomplete_daily_buckets_and_mismatched_message_totals() -> None:
    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics.pop(0)
    with pytest.raises(ValueError, match="Incomplete day bucket"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")

    payload = _payload()
    metrics = payload["metrics"]
    assert isinstance(metrics, list)
    metrics[3]["value"] = 99
    with pytest.raises(ValueError, match="messages_all must equal"):
        import_dataset(json.dumps(payload).encode(), "dashboard.json")


def test_rejects_oversized_or_unsupported_files_and_accepts_empty_dataset() -> None:
    with pytest.raises(ValueError, match="1 MB"):
        import_dataset(b"0" * (1_000_001), "dashboard.json")
    with pytest.raises(ValueError, match="CSV or JSON"):
        import_dataset(b"{}", "dashboard.xlsx")
    with pytest.raises(ValueError, match="CSV field is invalid or too large"):
        import_dataset(b"period_type,period_start,metric,value\n" + b"x" * 150_000 + b",,,,,", "large-field.csv")

    empty_payload = {
        "schema_version": 1,
        "generated_at_utc": "2026-11-13T12:00:00Z",
        "metrics": [],
    }
    empty_dataset = import_dataset(json.dumps(empty_payload).encode(), "empty.json")
    assert empty_dataset.points == ()
    assert summarize_period(empty_dataset, date(2026, 11, 1), date(2026, 11, 13)).has_data is False


def test_csv_round_trip_and_aggregated_json_export_contain_no_person_fields() -> None:
    dataset = import_dataset(json.dumps(_payload()).encode(), "dashboard.json")
    csv_bytes = export_csv(dataset.points)
    json_bytes = export_json(dataset.points, source_label=dataset.source_label)

    csv_text = csv_bytes.decode()
    json_text = json_bytes.decode()
    assert csv_text.startswith("period_type,period_start,metric,value\n")
    assert "user_id" not in csv_text
    assert "content_text" not in csv_text
    assert "telegram_id" not in json_text
    assert "content_text" not in json_text
    assert "DEMO" not in json_text

    csv_dataset = import_dataset(csv_bytes, "report.csv")
    assert csv_dataset.points == dataset.points


def test_empty_dashboard_dataset_has_a_safe_shape() -> None:
    dataset = DashboardDataset(source_label="IMPORTED AGGREGATES", points=())

    assert summarize_period(dataset, date(2026, 1, 1), date(2026, 1, 2)).has_data is False
