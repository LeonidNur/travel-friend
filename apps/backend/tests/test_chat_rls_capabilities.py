"""PostgreSQL coverage for the least-privilege Chat RLS capabilities."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


ACTIVE_PARTICIPANT_PREDICATE = "public.is_current_active_chat_participant(uuid)"
CREATE_GROUP_CAPABILITY = "public.create_current_group_chat(uuid[])"
SEND_MESSAGE_CAPABILITY = "public.send_current_chat_message(uuid,text)"


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture(autouse=True)
def clean_database(database_url: str):
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )
    yield


def create_user(database_url: str) -> UUID:
    with psycopg.connect(database_url) as connection:
        return connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def create_direct_chat(database_url: str, first_user_id: UUID, second_user_id: UUID) -> UUID:
    with psycopg.connect(database_url) as connection:
        chat_id = connection.execute(
            "INSERT INTO public.chats (type) VALUES ('direct') RETURNING id"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO public.chat_participants (chat_id, user_id) VALUES (%s, %s), (%s, %s)",
            (chat_id, first_user_id, chat_id, second_user_id),
        )
        connection.execute(
            "INSERT INTO public.matches (user_a_id, user_b_id, chat_id) VALUES (%s, %s, %s)",
            (*sorted((first_user_id, second_user_id)), chat_id),
        )
    return chat_id


def create_group_chat(database_url: str, participant_user_ids: list[UUID]) -> UUID:
    with psycopg.connect(database_url) as connection:
        chat_id = connection.execute(
            "INSERT INTO public.chats (type) VALUES ('group') RETURNING id"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO public.chat_participants (chat_id, user_id) "
            "SELECT %s, member.user_id FROM unnest(%s::uuid[]) AS member(user_id)",
            (chat_id, participant_user_ids),
        )
    return chat_id


def call_group_capability(connection: psycopg.Connection, companions: list[UUID]):
    return connection.execute(
        "SELECT * FROM public.create_current_group_chat(%s::uuid[])", (companions,)
    ).fetchone()


def call_send_capability(connection: psycopg.Connection, chat_id: UUID, text: str):
    return connection.execute(
        "SELECT * FROM public.send_current_chat_message(%s, %s)", (chat_id, text)
    ).fetchone()


def test_chat_rls_catalog_and_private_capabilities(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid IN ('public.chats'::regclass, 'public.chat_participants'::regclass, "
            "'public.messages'::regclass) ORDER BY relname"
        ).fetchall() == [
            ("chat_participants", True, False),
            ("chats", True, False),
            ("messages", True, False),
        ]
        policies = connection.execute(
            "SELECT tablename, cmd, roles::text, qual, with_check FROM pg_policies "
            "WHERE schemaname='public' AND tablename IN ('chats', 'chat_participants', 'messages') "
            "ORDER BY tablename, cmd"
        ).fetchall()
        assert [(table, command, roles) for table, command, roles, _, _ in policies] == [
            ("chat_participants", "SELECT", "{app_runtime}"),
            ("chats", "SELECT", "{app_runtime}"),
            ("messages", "SELECT", "{app_runtime}"),
        ]
        predicate_name = ACTIVE_PARTICIPANT_PREDICATE.rsplit(".", maxsplit=1)[1].split("(", maxsplit=1)[0]
        assert all(predicate_name in (qual or "") for _, command, _, qual, _ in policies if command == "SELECT")
        for function_name in (ACTIVE_PARTICIPANT_PREDICATE, CREATE_GROUP_CAPABILITY, SEND_MESSAGE_CAPABILITY):
            assert connection.execute(
                "SELECT prosecdef, proconfig FROM pg_proc WHERE oid=%s::regprocedure", (function_name,)
            ).fetchone() == (True, ["search_path=pg_catalog"])
            assert connection.execute(
                "SELECT has_function_privilege('public', %s, 'EXECUTE')", (function_name,)
            ).fetchone() == (False,)
            assert connection.execute(
                "SELECT has_function_privilege(%s, %s, 'EXECUTE')", (APP_RUNTIME_ROLE, function_name)
            ).fetchone() == (True,)
        assert connection.execute(
            "SELECT prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE'), "
            "has_function_privilege(%s, oid, 'EXECUTE') FROM pg_proc "
            "WHERE oid='public.enforce_direct_chat_participant_count()'::regprocedure",
            (APP_RUNTIME_ROLE,),
        ).fetchone() == (True, ["search_path=pg_catalog"], False, False)


def test_active_membership_scopes_chat_roster_and_message_reads(
    database_url: str, runtime_database_url: str
) -> None:
    actor, companion, outsider = (create_user(database_url) for _ in range(3))
    chat_id = create_direct_chat(database_url, actor, companion)
    with psycopg.connect(database_url) as owner:
        owner.execute("UPDATE public.chats SET last_sequence=2 WHERE id=%s", (chat_id,))
        owner.execute(
            "INSERT INTO public.messages (chat_id, sender_user_id, sequence_number, type, content_text) "
            "VALUES (%s, %s, 1, 'user', 'shared')",
            (chat_id, actor),
        )
        owner.execute(
            "INSERT INTO public.messages (chat_id, recipient_user_id, sequence_number, type, content_text) "
            "VALUES (%s, %s, 2, 'system', 'private')",
            (chat_id, companion),
        )
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, actor)
            assert runtime.execute("SELECT id FROM public.chats").fetchall() == [(chat_id,)]
            assert runtime.execute(
                "SELECT user_id FROM public.chat_participants WHERE chat_id=%s ORDER BY user_id", (chat_id,)
            ).fetchall() == sorted([(actor,), (companion,)])
            assert runtime.execute(
                "SELECT sequence_number FROM public.messages WHERE chat_id=%s ORDER BY sequence_number", (chat_id,)
            ).fetchall() == [(1,)]
        with runtime.transaction():
            set_authenticated_user(runtime, companion)
            assert runtime.execute(
                "SELECT sequence_number FROM public.messages WHERE chat_id=%s ORDER BY sequence_number", (chat_id,)
            ).fetchall() == [(1,), (2,)]
        with runtime.transaction():
            set_authenticated_user(runtime, outsider)
            assert runtime.execute("SELECT id FROM public.chats WHERE id=%s", (chat_id,)).fetchall() == []
            assert runtime.execute("SELECT user_id FROM public.chat_participants WHERE chat_id=%s", (chat_id,)).fetchall() == []
            assert runtime.execute("SELECT id FROM public.messages WHERE chat_id=%s", (chat_id,)).fetchall() == []
    with psycopg.connect(database_url) as owner:
        owner.execute("UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s", (chat_id, actor))
    with psycopg.connect(runtime_database_url) as runtime, runtime.transaction():
        set_authenticated_user(runtime, actor)
        assert runtime.execute("SELECT id FROM public.chats WHERE id=%s", (chat_id,)).fetchall() == []
        assert runtime.execute("SELECT user_id FROM public.chat_participants WHERE chat_id=%s", (chat_id,)).fetchall() == []
        assert runtime.execute("SELECT id FROM public.messages WHERE chat_id=%s", (chat_id,)).fetchall() == []


@pytest.mark.parametrize("participant_count", (0, 1, 3))
def test_hardened_direct_participant_trigger_rejects_non_two_physical_rows(
    database_url: str, participant_count: int
) -> None:
    users = [create_user(database_url) for _ in range(participant_count)]
    with pytest.raises(psycopg.errors.CheckViolation):
        with psycopg.connect(database_url) as owner:
            with owner.transaction():
                chat_id = owner.execute(
                    "INSERT INTO public.chats (type) VALUES ('direct') RETURNING id"
                ).fetchone()[0]
                for user_id in users:
                    owner.execute(
                        "INSERT INTO public.chat_participants (chat_id, user_id) VALUES (%s, %s)",
                        (chat_id, user_id),
                    )
    first_user_id, second_user_id = create_user(database_url), create_user(database_url)
    accepted_chat_id = create_direct_chat(database_url, first_user_id, second_user_id)
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT count(*) FROM public.chat_participants WHERE chat_id=%s", (accepted_chat_id,)
        ).fetchone() == (2,)


def test_runtime_direct_chat_mutations_and_locking_are_denied(
    database_url: str, runtime_database_url: str
) -> None:
    actor, companion = create_user(database_url), create_user(database_url)
    chat_id = create_direct_chat(database_url, actor, companion)
    with psycopg.connect(runtime_database_url) as runtime:
        for statement in (
            "SELECT id FROM public.chats WHERE id='%s' FOR UPDATE" % chat_id,
            "SELECT user_id FROM public.chat_participants WHERE chat_id='%s' FOR SHARE" % chat_id,
        ):
            with pytest.raises(psycopg.Error):
                with runtime.transaction():
                    set_authenticated_user(runtime, actor)
                    runtime.execute(statement)
        for statement in (
            "INSERT INTO public.chats (type) VALUES ('group')",
            "INSERT INTO public.chat_participants (chat_id, user_id) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001')",
            "INSERT INTO public.messages (chat_id, sender_user_id, sequence_number, type, content_text) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 1, 'user', 'spoof')",
            "UPDATE public.chats SET last_sequence=last_sequence+1 WHERE id='%s'" % chat_id,
            "UPDATE public.chat_participants SET left_at=now() WHERE chat_id='%s'" % chat_id,
            "UPDATE public.messages SET content_text='changed' WHERE chat_id='%s'" % chat_id,
            "DELETE FROM public.chats WHERE id='%s'" % chat_id,
            "DELETE FROM public.chat_participants WHERE chat_id='%s'" % chat_id,
            "DELETE FROM public.messages WHERE chat_id='%s'" % chat_id,
        ):
            with pytest.raises(psycopg.Error):
                with runtime.transaction():
                    set_authenticated_user(runtime, actor)
                    runtime.execute(statement)


def test_group_capability_validates_matched_active_companions_and_is_atomic(
    database_url: str, runtime_database_url: str
) -> None:
    actor, first, second, unmatched = (create_user(database_url) for _ in range(4))
    create_direct_chat(database_url, actor, first)
    create_direct_chat(database_url, actor, second)
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, actor)
            created = call_group_capability(runtime, [first, second])
            assert created[1:] == ("group", [actor, first, second], created[3])
            group_chat_id = created[0]
        for companions in ([actor, first], [first, first], [first]):
            with pytest.raises(psycopg.Error):
                with runtime.transaction():
                    set_authenticated_user(runtime, actor)
                    call_group_capability(runtime, companions)
        with pytest.raises(psycopg.Error):
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                call_group_capability(runtime, [first, unmatched])
    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT type FROM public.chats WHERE id=%s", (group_chat_id,)).fetchone() == ("group",)
        assert owner.execute(
            "SELECT user_id FROM public.chat_participants WHERE chat_id=%s ORDER BY user_id", (group_chat_id,)
        ).fetchall() == sorted([(actor,), (first,), (second,)])
        assert owner.execute("SELECT count(*) FROM public.chats WHERE type='group'").fetchone() == (1,)
        owner.execute("UPDATE public.chat_participants SET left_at=now() WHERE chat_id IN "
                      "(SELECT id FROM public.chats WHERE type='direct') AND user_id=%s", (second,))
    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.Error):
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                call_group_capability(runtime, [first, second])
    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT count(*) FROM public.chats WHERE type='group'").fetchone() == (1,)


def test_send_capability_uses_actor_and_serializes_sequences(
    database_url: str, runtime_database_url: str
) -> None:
    actor, companion, outsider = (create_user(database_url) for _ in range(3))
    chat_id = create_direct_chat(database_url, actor, companion)
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, actor)
            sent = call_send_capability(runtime, chat_id, "  hello  ")
            assert sent[1:] == (chat_id, 1, "user", actor, "hello", sent[6])
        for user_id in (outsider,):
            with pytest.raises(psycopg.Error):
                with runtime.transaction():
                    set_authenticated_user(runtime, user_id)
                    call_send_capability(runtime, chat_id, "blocked")
    with psycopg.connect(database_url) as owner:
        owner.execute("UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s", (chat_id, actor))
    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.Error):
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                call_send_capability(runtime, chat_id, "former")
    with psycopg.connect(database_url) as owner:
        owner.execute("UPDATE public.chat_participants SET left_at=NULL WHERE chat_id=%s AND user_id=%s", (chat_id, actor))

    barrier = Barrier(3)

    def send_concurrently(text: str):
        with psycopg.connect(runtime_database_url) as runtime, runtime.transaction():
            set_authenticated_user(runtime, actor)
            barrier.wait()
            return call_send_capability(runtime, chat_id, text)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(send_concurrently, "one")
        second_future = executor.submit(send_concurrently, "two")
        barrier.wait()
        assert {first_future.result()[2], second_future.result()[2]} == {2, 3}
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT sequence_number FROM public.messages WHERE chat_id=%s ORDER BY sequence_number", (chat_id,)
        ).fetchall() == [(1,), (2,), (3,)]
        assert owner.execute("SELECT last_sequence FROM public.chats WHERE id=%s", (chat_id,)).fetchone() == (3,)


def test_group_capability_rejects_more_than_twenty_companions_before_creating_a_chat(
    database_url: str, runtime_database_url: str
) -> None:
    actor = create_user(database_url)
    companions = [create_user(database_url) for _ in range(21)]

    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.errors.InvalidParameterValue, match="at most twenty companions"):
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                call_group_capability(runtime, companions)

    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT count(*) FROM public.chats WHERE type='group'").fetchone() == (0,)


def test_send_capability_rejects_message_over_four_thousand_characters(
    database_url: str, runtime_database_url: str
) -> None:
    actor, companion = create_user(database_url), create_user(database_url)
    chat_id = create_direct_chat(database_url, actor, companion)

    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.errors.InvalidParameterValue, match="content_text must not exceed 4000 characters"):
            with runtime.transaction():
                set_authenticated_user(runtime, actor)
                call_send_capability(runtime, chat_id, "x" * 4001)

    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT count(*) FROM public.messages WHERE chat_id=%s", (chat_id,)).fetchone() == (0,)
