"""Focused schema checks for the Chats persistence migration."""

from __future__ import annotations

import os
from pathlib import Path
from collections.abc import Iterator
from urllib.parse import urlparse

import psycopg
import pytest


MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260901130000_chat_persistence.sql"
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
        "TRUNCATE public.chat_summaries, public.messages, public.chat_participants, "
        "public.matches, public.chats, public.discover_interest_decisions, "
        "public.user_sessions, public.travel_intents, public.profile_photos, "
        "public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY"
    )
    with psycopg.connect(database_url) as connection:
        connection.execute(truncate_sql)
    yield
    with psycopg.connect(database_url) as connection:
        connection.execute(truncate_sql)


def test_chat_migration_declares_the_mvp_schema_and_fk_semantics() -> None:
    migration_sql = MIGRATION_PATH.read_text()

    for table_name in ("chats", "chat_participants", "messages", "chat_summaries"):
        assert f"create table public.{table_name}" in migration_sql

    assert "alter table public.matches" in migration_sql
    assert "add column chat_id uuid unique" in migration_sql
    assert migration_sql.count("on delete restrict") == 7
    assert "create constraint trigger chats_direct_participant_count" in migration_sql
    assert "create constraint trigger chat_participants_direct_participant_count" in migration_sql
    assert "create trigger chat_participants_read_sequences_only_move_forward" in migration_sql


def create_direct_chat(database_url: str, participant_count: int) -> tuple[object, tuple[object, ...]]:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            user_ids = []
            for _ in range(participant_count):
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
            return chat_id, tuple(user_ids)


@pytest.mark.parametrize("participant_count", [0, 1])
def test_direct_chat_with_fewer_than_two_participants_cannot_commit(
    database_url: str,
    clean_database: None,
    participant_count: int,
) -> None:
    with pytest.raises(psycopg.errors.CheckViolation, match="direct chats require exactly two participants"):
        create_direct_chat(database_url, participant_count)


def test_direct_chat_with_two_distinct_participants_can_commit(
    database_url: str,
    clean_database: None,
) -> None:
    chat_id, user_ids = create_direct_chat(database_url, 2)

    with psycopg.connect(database_url) as connection:
        participant_count = connection.execute(
            "select count(*) from public.chat_participants where chat_id = %s",
            (chat_id,),
        ).fetchone()[0]

    assert len(user_ids) == participant_count == 2


def test_adding_a_third_direct_chat_participant_cannot_commit(
    database_url: str,
    clean_database: None,
) -> None:
    chat_id, _ = create_direct_chat(database_url, 2)

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("insert into public.users default values returning id")
            third_user_id = cursor.fetchone()[0]
            with pytest.raises(psycopg.errors.CheckViolation, match="direct chats require exactly two participants"):
                cursor.execute(
                    "insert into public.chat_participants (chat_id, user_id) values (%s, %s)",
                    (chat_id, third_user_id),
                )
                connection.commit()


@pytest.mark.parametrize(
    ("message_type", "sender_user_id", "recipient_user_id"),
    [
        ("user", None, None),
        ("user", "sender", "recipient"),
        ("system", "sender", None),
    ],
)
def test_message_sender_shape_is_constrained(
    database_url: str,
    clean_database: None,
    message_type: str,
    sender_user_id: str | None,
    recipient_user_id: str | None,
) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("insert into public.users default values returning id")
            user_id = cursor.fetchone()[0]
            cursor.execute("insert into public.chats (type) values ('group') returning id")
            chat_id = cursor.fetchone()[0]
            with pytest.raises(psycopg.errors.CheckViolation):
                cursor.execute(
                    """
                    insert into public.messages (
                        chat_id, sender_user_id, recipient_user_id, sequence_number, type
                    ) values (%s, %s, %s, 1, %s)
                    """,
                    (
                        chat_id,
                        user_id if sender_user_id else None,
                        user_id if recipient_user_id else None,
                        message_type,
                    ),
                )


def test_read_sequences_cannot_move_backwards(database_url: str, clean_database: None) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("insert into public.users default values returning id")
            user_id = cursor.fetchone()[0]
            cursor.execute("insert into public.chats (type) values ('group') returning id")
            chat_id = cursor.fetchone()[0]
            cursor.execute(
                """
                insert into public.chat_participants (
                    chat_id, user_id, last_read_sequence, last_visible_message_sequence
                ) values (%s, %s, 0, 1) returning id
                """,
                (chat_id, user_id),
            )
            participant_id = cursor.fetchone()[0]
            cursor.execute(
                "update public.chat_participants set last_read_sequence = 1 where id = %s",
                (participant_id,),
            )

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            with pytest.raises(psycopg.errors.CheckViolation, match="read sequences can only move forward"):
                cursor.execute(
                    "update public.chat_participants set last_read_sequence = 0 where id = %s",
                    (participant_id,),
                )
