"""Aggregate-only reporting view security and correctness checks."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
MIGRATION_PATH = next(MIGRATIONS_DIR.glob("*_analytics_reporting_views.sql"))


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture
def clean_database(database_url: str) -> Iterator[None]:
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_proposal_prerequisites, public.trip_proposal_voters, "
        "public.trip_proposal_operations, public.trip_proposals, "
        "public.trip_proposal_scope_versions, public.trip_confirmed_transport, "
        "public.trip_confirmed_accommodations, public.trip_draft_alternatives, "
        "public.trip_draft_versions, public.trip_drafts, public.trip_itinerary_events, "
        "public.trip_itinerary_days, public.trip_stops, public.trip_participants, "
        "public.trips, public.chat_summaries, public.messages, public.chat_participants, "
        "public.matches, public.chats, public.discover_interest_decisions, "
        "public.user_sessions, public.travel_intents, public.profile_photos, "
        "public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )
    yield
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_proposal_prerequisites, public.trip_proposal_voters, "
        "public.trip_proposal_operations, public.trip_proposals, "
        "public.trip_proposal_scope_versions, public.trip_confirmed_transport, "
        "public.trip_confirmed_accommodations, public.trip_draft_alternatives, "
        "public.trip_draft_versions, public.trip_drafts, public.trip_itinerary_events, "
        "public.trip_itinerary_days, public.trip_stops, public.trip_participants, "
        "public.trips, public.chat_summaries, public.messages, public.chat_participants, "
        "public.matches, public.chats, public.discover_interest_decisions, "
        "public.user_sessions, public.travel_intents, public.profile_photos, "
        "public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )


def create_facts(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        user_ids = [
            connection.execute(
                "INSERT INTO public.users (created_at) VALUES (%s) RETURNING id",
                (created_at,),
            ).fetchone()[0]
            for created_at in (
                "2025-01-06T10:00:00Z",
                "2025-01-06T11:00:00Z",
                "2025-01-07T10:00:00Z",
            )
        ]
        connection.execute(
            "UPDATE public.users SET deleted_at = %s WHERE id = %s",
            ("2025-01-07T12:00:00Z", user_ids[1]),
        )
        connection.execute(
            "INSERT INTO public.matches (user_a_id, user_b_id, created_at) "
            "VALUES (%s, %s, %s)",
            (min(user_ids[0], user_ids[2]), max(user_ids[0], user_ids[2]), "2025-01-06T13:00:00Z"),
        )
        chat_id = connection.execute(
            "INSERT INTO public.chats (type) VALUES ('group') RETURNING id"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO public.messages "
            "(chat_id, sender_user_id, sequence_number, type, content_text, created_at) "
            "VALUES (%s, %s, 1, 'user', 'fixture text', %s)",
            (chat_id, user_ids[0], "2025-01-06T14:00:00Z"),
        )
        connection.execute(
            "INSERT INTO public.messages "
            "(chat_id, sequence_number, type, system_event, created_at) "
            "VALUES (%s, 2, 'system', 'fixture_event', %s)",
            (chat_id, "2025-01-07T14:00:00Z"),
        )
        trip_ids = []
        for created_at in ("2025-01-06T15:00:00Z", "2025-01-07T15:00:00Z"):
            trip_ids.append(
                connection.execute(
                    "INSERT INTO public.trips "
                    "(chat_id, created_by_user_id, status, created_at) "
                    "VALUES (%s, %s, 'completed', %s) RETURNING id",
                    (chat_id, user_ids[0], created_at),
                ).fetchone()[0]
            )
        proposals = (
            (trip_ids[0], uuid4(), "2025-01-06T16:00:00Z", "2025-01-07T09:00:00Z", "accepted"),
            (trip_ids[0], uuid4(), "2025-01-06T17:00:00Z", "2025-01-07T10:00:00Z", "accepted"),
            (trip_ids[1], uuid4(), "2025-01-06T18:00:00Z", "2025-01-07T11:00:00Z", "accepted"),
            (trip_ids[1], uuid4(), "2025-01-07T18:00:00Z", None, "pending"),
        )
        for index, (trip_id, idempotency_key, created_at, decided_at, status) in enumerate(proposals):
            connection.execute(
                "INSERT INTO public.trip_proposals "
                "(trip_id, creator_user_id, idempotency_key, status, title, draft_version, "
                "created_at, decided_at) "
                "VALUES (%s, %s, %s, %s, 'fixture', 1, %s, %s)",
                (trip_id, user_ids[0], idempotency_key, status, created_at, decided_at),
            )
            if index == 0:
                replay = connection.execute(
                    "INSERT INTO public.trip_proposals "
                    "(trip_id, creator_user_id, idempotency_key, status, title, draft_version, "
                    "created_at, decided_at) "
                    "VALUES (%s, %s, %s, %s, 'fixture', 1, %s, %s) "
                    "ON CONFLICT (trip_id, creator_user_id, idempotency_key) DO NOTHING",
                    (trip_id, user_ids[0], idempotency_key, status, created_at, decided_at),
                )
                assert replay.rowcount == 0


def test_reporting_migration_exposes_only_curated_aggregate_views() -> None:
    migration_sql = MIGRATION_PATH.read_text().lower()

    assert "create schema analytics_reporting" in migration_sql
    assert "create role analytics_reporting_reader" in migration_sql
    assert "security_barrier = true" in migration_sql
    assert "security_invoker = false" in migration_sql
    assert "grant select on\n  analytics_reporting." in migration_sql
    assert "grant select on public." not in migration_sql
    assert "bypassrls" in migration_sql


def test_reporting_views_aggregate_facts_and_deduplicate_wcat(
    database_url: str, clean_database: None
) -> None:
    create_facts(database_url)

    with psycopg.connect(database_url) as connection:
        days = connection.execute(
            "SELECT metric_date, new_users, matches_created, messages_all, messages_user, "
            "messages_system, trips_created, proposals_created, proposals_accepted_applied "
            "FROM analytics_reporting.daily_metrics "
            "WHERE metric_date BETWEEN DATE '2025-01-06' AND DATE '2025-01-08' "
            "ORDER BY metric_date"
        ).fetchall()
        totals = connection.execute(
            "SELECT registered_accounts_ever, registered_accounts_not_deleted "
            "FROM analytics_reporting.user_totals"
        ).fetchone()
        wcat = connection.execute(
            "SELECT week_start_utc, trips_with_accepted_proposal "
            "FROM analytics_reporting.weekly_wcat "
            "WHERE week_start_utc = DATE '2025-01-06'"
        ).fetchone()
        empty_period = connection.execute(
            "SELECT count(*) FROM analytics_reporting.daily_metrics "
            "WHERE metric_date = DATE '2025-01-08'"
        ).fetchone()[0]
        view_columns = connection.execute(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'analytics_reporting' "
            "ORDER BY table_name, ordinal_position"
        ).fetchall()

    assert days == [
        (date(2025, 1, 6), 2, 1, 1, 1, 0, 1, 3, 0),
        (date(2025, 1, 7), 1, 0, 1, 0, 1, 1, 1, 3),
    ]
    assert totals == (3, 2)
    assert wcat == (date(2025, 1, 6), 2)
    assert empty_period == 0
    assert view_columns == [
        ("daily_metrics", "metric_date"),
        ("daily_metrics", "new_users"),
        ("daily_metrics", "matches_created"),
        ("daily_metrics", "messages_all"),
        ("daily_metrics", "messages_user"),
        ("daily_metrics", "messages_system"),
        ("daily_metrics", "trips_created"),
        ("daily_metrics", "proposals_created"),
        ("daily_metrics", "proposals_accepted_applied"),
        ("user_totals", "as_of_utc"),
        ("user_totals", "registered_accounts_ever"),
        ("user_totals", "registered_accounts_not_deleted"),
        ("weekly_wcat", "week_start_utc"),
        ("weekly_wcat", "trips_with_accepted_proposal"),
    ]


def test_live_query_chart_shapes_and_empty_period_zero_fill(
    database_url: str, clean_database: None
) -> None:
    create_facts(database_url)

    with psycopg.connect(database_url) as connection:
        daily = connection.execute(
            "WITH date_spine AS ("
            "  SELECT generate_series(DATE '2025-01-08'::timestamp, "
            "                         DATE '2025-01-10'::timestamp, "
            "                         interval '1 day')::date AS metric_date"
            ") "
            "SELECT date_spine.metric_date AS date, "
            "       coalesce(daily_metrics.new_users, 0)::bigint AS value "
            "FROM date_spine "
            "LEFT JOIN analytics_reporting.daily_metrics USING (metric_date) "
            "ORDER BY date_spine.metric_date"
        )
        daily_rows = daily.fetchall()
        daily_column_names = [column.name for column in daily.description]

        weekly = connection.execute(
            "WITH week_spine AS ("
            "  SELECT generate_series(DATE '2024-12-30'::timestamp, "
            "                         DATE '2025-01-13'::timestamp, "
            "                         interval '1 week')::date AS week_start_utc"
            ") "
            "SELECT week_spine.week_start_utc AS date, "
            "       coalesce(weekly_wcat.trips_with_accepted_proposal, 0)::bigint AS value "
            "FROM week_spine "
            "LEFT JOIN analytics_reporting.weekly_wcat USING (week_start_utc) "
            "ORDER BY week_spine.week_start_utc"
        )
        weekly_rows = weekly.fetchall()
        weekly_column_names = [column.name for column in weekly.description]

    assert daily_column_names == ["date", "value"]
    assert daily_rows == [
        (date(2025, 1, 8), 0),
        (date(2025, 1, 9), 0),
        (date(2025, 1, 10), 0),
    ]
    assert weekly_column_names == ["date", "value"]
    assert weekly_rows == [
        (date(2024, 12, 30), 0),
        (date(2025, 1, 6), 2),
        (date(2025, 1, 13), 0),
    ]


def test_reporting_role_can_read_views_but_not_source_tables(
    database_url: str, clean_database: None
) -> None:
    create_facts(database_url)

    with psycopg.connect(database_url) as connection:
        connection.execute("SET ROLE analytics_reporting_reader")
        assert connection.execute(
            "SELECT count(*) FROM analytics_reporting.daily_metrics"
        ).fetchone() is not None
        assert connection.execute(
            "SELECT count(*) FROM analytics_reporting.user_totals"
        ).fetchone() is not None
        assert connection.execute(
            "SELECT count(*) FROM analytics_reporting.weekly_wcat"
        ).fetchone() is not None
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with connection.transaction():
                connection.execute("SELECT count(*) FROM public.users")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with connection.transaction():
                connection.execute("SELECT content_text FROM public.messages LIMIT 1")
        assert connection.execute(
            "SELECT has_table_privilege('analytics_reporting_reader', "
            "'analytics_reporting.daily_metrics', 'SELECT'), "
            "has_table_privilege('analytics_reporting_reader', "
            "'analytics_reporting.daily_metrics', 'INSERT'), "
            "has_table_privilege('analytics_reporting_reader', "
            "'analytics_reporting.daily_metrics', 'UPDATE'), "
            "has_table_privilege('analytics_reporting_reader', "
            "'analytics_reporting.daily_metrics', 'DELETE')"
        ).fetchone() == (True, False, False, False)
        assert connection.execute(
            "SELECT bool_or(has_table_privilege('analytics_reporting_reader', relations.oid, 'SELECT')) "
            "FROM pg_catalog.pg_class AS relations "
            "JOIN pg_catalog.pg_namespace AS schemas ON schemas.oid = relations.relnamespace "
            "WHERE schemas.nspname = 'public' "
            "AND relations.relname IN ('users', 'matches', 'messages', 'trips', 'trip_proposals')"
        ).fetchone()[0] is False
