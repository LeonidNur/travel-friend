"""Focused PostgreSQL checks for the TripStop persistence migration."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import pytest

from test_trip_persistence_migration import (
    clean_database,
    create_direct_chat,
    create_trip,
    expect_database_error,
)


MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260901150000_trip_stops_persistence.sql"
)
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture
def database_url() -> str:
    if not TEST_DATABASE_URL:
        pytest.fail("TEST_DATABASE_URL is required for focused PostgreSQL migration tests")

    parsed = urlparse(TEST_DATABASE_URL)
    if parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        pytest.fail("TEST_DATABASE_URL must point to a disposable local PostgreSQL database")
    if parsed.path.rstrip("/") in {"", "/postgres"}:
        pytest.fail("TEST_DATABASE_URL must name a dedicated test database")
    return TEST_DATABASE_URL


def test_trip_stops_migration_declares_the_approved_physical_schema() -> None:
    migration_sql = MIGRATION_PATH.read_text()

    assert "create table public.trip_stops" in migration_sql
    assert "id uuid primary key default gen_random_uuid()" in migration_sql
    assert "references public.trips (id) on delete restrict" in migration_sql
    assert "position integer not null" in migration_sql
    assert "place_label text not null" in migration_sql
    for nullable_column in (
        "country_code text",
        "place_ref text",
        "stay_from date",
        "stay_to date",
        "notes text",
    ):
        assert nullable_column in migration_sql
    assert "created_at timestamptz not null default now()" in migration_sql
    assert "updated_at timestamptz not null default now()" in migration_sql
    assert "unique (trip_id, position)" in migration_sql
    assert "unique (trip_id, id)" in migration_sql
    assert "check (position >= 1)" in migration_sql
    assert "stay_to >= stay_from" in migration_sql
    assert "destination_label" not in migration_sql


def test_trip_stops_preserve_a_valid_ordered_route(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])

    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            insert into public.trip_stops (trip_id, position, place_label, country_code, place_ref)
            values (%s, 2, 'Kyoto', 'JP', 'provider-neutral:kyoto')
            """,
            (trip_id,),
        )
        connection.execute(
            """
            insert into public.trip_stops (trip_id, position, place_label, stay_from, stay_to, notes)
            values (%s, 1, 'Tokyo', '2026-10-01', '2026-10-03', 'Arrival stop')
            """,
            (trip_id,),
        )
        route = connection.execute(
            """
            select position, place_label, country_code, place_ref, stay_from, stay_to, notes
            from public.trip_stops
            where trip_id = %s
            order by position
            """,
            (trip_id,),
        ).fetchall()

    assert route == [
        (1, "Tokyo", None, None, date(2026, 10, 1), date(2026, 10, 3), "Arrival stop"),
        (2, "Kyoto", "JP", "provider-neutral:kyoto", None, None, None),
    ]


def test_trip_stops_reject_missing_trip_invalid_order_and_invalid_dates(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])
    missing_trip_id = "00000000-0000-0000-0000-000000000000"

    with psycopg.connect(database_url) as connection:
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 1, 'Missing')",
            (missing_trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.CheckViolation,
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 0, 'Invalid')",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.InvalidTextRepresentation,
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 'first', 'Invalid type')",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.NotNullViolation,
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 1, null)",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.CheckViolation,
            """
            insert into public.trip_stops (trip_id, position, place_label, stay_from, stay_to)
            values (%s, 1, 'Invalid dates', '2026-10-03', '2026-10-01')
            """,
            (trip_id,),
        )
        connection.execute(
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 1, 'Tokyo')",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.UniqueViolation,
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 1, 'Duplicate')",
            (trip_id,),
        )


def test_trip_stops_fk_restrict_delete_semantics(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "insert into public.trip_stops (trip_id, position, place_label) values (%s, 1, 'Tokyo')",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "delete from public.trips where id = %s",
            (trip_id,),
        )
