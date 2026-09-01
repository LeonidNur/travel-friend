"""Focused PostgreSQL checks for the Trips persistence foundation."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import pytest


MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260901140000_trip_persistence.sql"
)
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def require_safe_test_database_url(database_url: str) -> str:
    parsed = urlparse(database_url)
    if parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        pytest.skip("TEST_DATABASE_URL must point to a disposable local PostgreSQL database")
    if parsed.path.rstrip("/") in {"", "/postgres"}:
        pytest.skip("TEST_DATABASE_URL must name a dedicated test database")
    return database_url


@pytest.fixture
def database_url() -> str:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return require_safe_test_database_url(TEST_DATABASE_URL)


@pytest.fixture
def clean_database(database_url: str) -> Iterator[None]:
    truncate_sql = (
        "TRUNCATE public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, "
        "public.user_settings, public.telegram_identities, public.users RESTART IDENTITY"
    )
    with psycopg.connect(database_url) as connection:
        connection.execute(truncate_sql)
    yield
    with psycopg.connect(database_url) as connection:
        connection.execute(truncate_sql)


def create_direct_chat(database_url: str) -> tuple[object, tuple[object, object]]:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            user_ids = []
            for _ in range(2):
                cursor.execute("insert into public.users default values returning id")
                user_ids.append(cursor.fetchone()[0])
            cursor.execute("insert into public.chats (type) values ('direct') returning id")
            chat_id = cursor.fetchone()[0]
            for user_id in user_ids:
                cursor.execute(
                    "insert into public.chat_participants (chat_id, user_id) values (%s, %s)",
                    (chat_id, user_id),
                )
            connection.commit()
    return chat_id, (user_ids[0], user_ids[1])


def create_trip(database_url: str, chat_id: object, creator_id: object, status: str = "forming") -> object:
    with psycopg.connect(database_url) as connection:
        trip_id = connection.execute(
            """
            insert into public.trips (chat_id, created_by_user_id, status)
            values (%s, %s, %s)
            returning id
            """,
            (chat_id, creator_id, status),
        ).fetchone()[0]
    return trip_id


def expect_database_error(
    connection: psycopg.Connection[object],
    error_type: type[psycopg.Error],
    query: str,
    parameters: tuple[object, ...],
) -> None:
    with pytest.raises(error_type):
        with connection.transaction():
            connection.execute(query, parameters)


def test_trip_migration_declares_the_physical_schema_and_explicit_fk_policy() -> None:
    migration_sql = MIGRATION_PATH.read_text()

    assert "create table public.trips" in migration_sql
    assert "create table public.trip_participants" in migration_sql
    assert "destination_label" not in migration_sql
    assert migration_sql.count("on delete restrict") == 4
    assert "where status in ('forming', 'active')" in migration_sql
    assert "unique (trip_id, user_id)" in migration_sql


def test_valid_trip_with_two_direct_chat_users_can_have_two_participants(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])

    with psycopg.connect(database_url) as connection:
        for user_id in user_ids:
            connection.execute(
                "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
                (trip_id, user_id),
            )
        trip = connection.execute(
            """
            select membership_version, state_version, destination_version,
                   dates_version, budget_version, transport_version,
                   destination_status, dates_status, budget_status, transport_status
            from public.trips where id = %s
            """,
            (trip_id,),
        ).fetchone()

    assert trip == (1, 1, 0, 0, 0, 0, "empty", "empty", "empty", "empty")


def test_trip_and_participant_foreign_keys_and_restrict_deletes_are_enforced(
    database_url: str, clean_database: None
) -> None:
    missing_id = "00000000-0000-0000-0000-000000000000"
    with psycopg.connect(database_url) as connection:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            connection.execute(
                "insert into public.trips (chat_id, created_by_user_id, status) values (%s, %s, 'forming')",
                (missing_id, missing_id),
            )

    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])
    with psycopg.connect(database_url) as connection:
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (missing_id, user_ids[0]),
        )
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (trip_id, missing_id),
        )
        connection.execute(
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (trip_id, user_ids[0]),
        )
        standalone_participant_id = connection.execute(
            "insert into public.users default values returning id"
        ).fetchone()[0]
        connection.execute(
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (trip_id, standalone_participant_id),
        )
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "delete from public.trips where id = %s",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "delete from public.chats where id = %s",
            (chat_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.ForeignKeyViolation,
            "delete from public.users where id = %s",
            (standalone_participant_id,),
        )


def test_trip_rejects_duplicate_participants_invalid_statuses_versions_and_block_values(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    trip_id = create_trip(database_url, chat_id, user_ids[0])

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (trip_id, user_ids[0]),
        )
        expect_database_error(
            connection,
            psycopg.errors.UniqueViolation,
            "insert into public.trip_participants (trip_id, user_id) values (%s, %s)",
            (trip_id, user_ids[0]),
        )
        for column, value in (
            ("status", "draft"),
            ("destination_status", "draft"),
            ("dates_status", "draft"),
            ("budget_status", "draft"),
            ("transport_status", "draft"),
            ("budget_scope", "team"),
        ):
            expect_database_error(
                connection,
                psycopg.errors.CheckViolation,
                f"update public.trips set {column} = %s where id = %s",
                (value, trip_id),
            )
        for column in ("membership_version", "state_version"):
            expect_database_error(
                connection,
                psycopg.errors.CheckViolation,
                f"update public.trips set {column} = 0 where id = %s",
                (trip_id,),
            )
        for column in ("destination_version", "dates_version", "budget_version", "transport_version"):
            expect_database_error(
                connection,
                psycopg.errors.CheckViolation,
                f"update public.trips set {column} = -1 where id = %s",
                (trip_id,),
            )
        expect_database_error(
            connection,
            psycopg.errors.CheckViolation,
            "update public.trips set date_from = '2026-10-02', date_to = '2026-10-01' where id = %s",
            (trip_id,),
        )
        expect_database_error(
            connection,
            psycopg.errors.CheckViolation,
            "update public.trips set budget_min = 200, budget_max = 100 where id = %s",
            (trip_id,),
        )


def test_only_one_unfinished_trip_per_chat_and_finished_history_is_allowed(
    database_url: str, clean_database: None
) -> None:
    chat_id, user_ids = create_direct_chat(database_url)
    first_trip_id = create_trip(database_url, chat_id, user_ids[0], "forming")

    with pytest.raises(psycopg.errors.UniqueViolation):
        create_trip(database_url, chat_id, user_ids[0], "active")

    with psycopg.connect(database_url) as connection:
        connection.execute("update public.trips set status = 'completed' where id = %s", (first_trip_id,))

    active_trip_id = create_trip(database_url, chat_id, user_ids[0], "active")

    with psycopg.connect(database_url) as connection:
        connection.execute("update public.trips set status = 'cancelled' where id = %s", (active_trip_id,))

    forming_trip_id = create_trip(database_url, chat_id, user_ids[0], "forming")
    assert forming_trip_id != first_trip_id
