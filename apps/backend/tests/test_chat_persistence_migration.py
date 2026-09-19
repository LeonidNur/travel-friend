"""Focused schema checks for the Chats persistence migration."""

from __future__ import annotations

from pathlib import Path
from collections.abc import Iterator

import psycopg
import pytest

from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260901130000_chat_persistence.sql"
)
TRIGGER_FUNCTION_HARDENING_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "20260901210000_revoke_trigger_function_public_execute.sql"
)
TRIGGER_FUNCTION_SIGNATURES = (
    "public.enforce_chat_participant_read_sequences()",
    "public.enforce_direct_chat_participant_count()",
)


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture
def clean_database(database_url: str) -> Iterator[None]:
    truncate_sql = (
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, "
        "public.matches, public.chats, public.discover_interest_decisions, "
        "public.user_sessions, public.travel_intents, public.profile_photos, "
        "public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY"
    )
    truncate_disposable_test_database(database_url, truncate_sql)
    yield
    truncate_disposable_test_database(database_url, truncate_sql)


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


def test_trigger_function_execute_is_private_and_triggers_remain_registered(
    database_url: str,
    clean_database: None,
) -> None:
    hardening_sql = TRIGGER_FUNCTION_HARDENING_MIGRATION_PATH.read_text()

    with psycopg.connect(database_url) as connection:
        for function_signature in TRIGGER_FUNCTION_SIGNATURES:
            connection.execute(f"grant execute on function {function_signature} to public")
        connection.execute(hardening_sql)

    for function_signature in TRIGGER_FUNCTION_SIGNATURES:
        assert f"revoke execute on function {function_signature} from public;" in hardening_sql.lower()

        with psycopg.connect(database_url) as connection:
            assert connection.execute(
                "select has_function_privilege('public', %s, 'execute')",
                (function_signature,),
            ).fetchone() == (False,)
            assert connection.execute(
                "select has_function_privilege('app_runtime', %s, 'execute')",
                (function_signature,),
            ).fetchone() == (False,)

    with psycopg.connect(database_url) as connection:
        trigger_rows = connection.execute(
            """
            select triggers.tgname, pg_get_function_identity_arguments(functions.oid)
            from pg_trigger as triggers
            join pg_proc as functions on functions.oid = triggers.tgfoid
            join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
            where not triggers.tgisinternal
              and namespaces.nspname = 'public'
              and functions.proname in (
                'enforce_chat_participant_read_sequences',
                'enforce_direct_chat_participant_count'
              )
            order by triggers.tgname
            """
        ).fetchall()

    assert trigger_rows == [
        ("chat_participants_direct_participant_count", ""),
        ("chat_participants_read_sequences_only_move_forward", ""),
        ("chats_direct_participant_count", ""),
    ]

    chat_id, user_ids = create_direct_chat(database_url, 2)
    assert chat_id
    assert len(user_ids) == 2

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("insert into public.users default values returning id")
            user_id = cursor.fetchone()[0]
            cursor.execute("insert into public.chats (type) values ('group') returning id")
            group_chat_id = cursor.fetchone()[0]
            cursor.execute(
                """
                insert into public.chat_participants (
                    chat_id, user_id, last_read_sequence, last_visible_message_sequence
                ) values (%s, %s, 0, 1) returning id
                """,
                (group_chat_id, user_id),
            )
            participant_id = cursor.fetchone()[0]
            cursor.execute(
                "update public.chat_participants set last_read_sequence = 1 where id = %s",
                (participant_id,),
            )
            with pytest.raises(psycopg.errors.CheckViolation, match="read sequences can only move forward"):
                cursor.execute(
                    "update public.chat_participants set last_read_sequence = 0 where id = %s",
                    (participant_id,),
                )


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
