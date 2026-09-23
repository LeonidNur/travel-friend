"""PostgreSQL coverage for Trip RLS and capability-only creation."""

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


ACTIVE_TRIP_PARTICIPANT_PREDICATE = "public.is_current_active_trip_participant(uuid)"
CREATE_TRIP_CAPABILITY = "public.create_current_trip_from_chat(uuid)"


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
    with psycopg.connect(database_url) as owner:
        return owner.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]


def create_chat(database_url: str, chat_type: str, user_ids: list[UUID]) -> UUID:
    with psycopg.connect(database_url) as owner:
        chat_id = owner.execute(
            "INSERT INTO public.chats (type) VALUES (%s) RETURNING id", (chat_type,)
        ).fetchone()[0]
        owner.execute(
            "INSERT INTO public.chat_participants (chat_id, user_id) "
            "SELECT %s, member.user_id FROM unnest(%s::uuid[]) AS member(user_id)",
            (chat_id, user_ids),
        )
    return chat_id


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def create_trip_from_chat(connection: psycopg.Connection, chat_id: UUID):
    return connection.execute("SELECT * FROM public.create_current_trip_from_chat(%s)", (chat_id,)).fetchone()


def test_trip_rls_catalog_policies_and_capabilities_are_exact(database_url: str) -> None:
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid IN ('public.trips'::regclass, 'public.trip_participants'::regclass, "
            "'public.trip_stops'::regclass) ORDER BY relname"
        ).fetchall() == [
            ("trip_participants", True, False),
            ("trip_stops", True, False),
            ("trips", True, False),
        ]
        policies = owner.execute(
            "SELECT tablename, cmd, roles::text, qual, with_check FROM pg_policies "
            "WHERE schemaname='public' AND tablename IN ('trips', 'trip_participants', 'trip_stops') "
            "ORDER BY tablename, cmd"
        ).fetchall()
        assert [(table, command, roles) for table, command, roles, _, _ in policies] == [
            ("trip_participants", "SELECT", "{app_runtime}"),
            ("trip_stops", "SELECT", "{app_runtime}"),
            ("trips", "SELECT", "{app_runtime}"),
        ]
        assert all(check is None for _, _, _, _, check in policies)
        predicate = ACTIVE_TRIP_PARTICIPANT_PREDICATE.rsplit(".", maxsplit=1)[1].split("(", maxsplit=1)[0]
        assert all(predicate in (qual or "") for _, _, _, qual, _ in policies)
        for function_name in (ACTIVE_TRIP_PARTICIPANT_PREDICATE, CREATE_TRIP_CAPABILITY):
            assert owner.execute(
                "SELECT prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE'), "
                "has_function_privilege(%s, oid, 'EXECUTE') FROM pg_proc WHERE oid=%s::regprocedure",
                (APP_RUNTIME_ROLE, function_name),
            ).fetchone() == (True, ["search_path=pg_catalog"], False, True)


def test_trip_reads_and_active_roster_are_scoped_to_active_participants(
    database_url: str, runtime_database_url: str
) -> None:
    actor, former, outsider = (create_user(database_url) for _ in range(3))
    chat_id = create_chat(database_url, "group", [actor, former])
    with psycopg.connect(database_url) as owner:
        trip_id = owner.execute(
            "INSERT INTO public.trips (chat_id, created_by_user_id, status) VALUES (%s, %s, 'forming') RETURNING id",
            (chat_id, actor),
        ).fetchone()[0]
        owner.execute(
            "INSERT INTO public.trip_participants (trip_id, user_id) VALUES (%s, %s), (%s, %s)",
            (trip_id, actor, trip_id, former),
        )
        owner.execute(
            "INSERT INTO public.trip_stops (trip_id, position, place_label) VALUES (%s, 1, 'Moscow')",
            (trip_id,),
        )
        owner.execute(
            "UPDATE public.trip_participants SET left_at=now() WHERE trip_id=%s AND user_id=%s",
            (trip_id, former),
        )
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, actor)
            assert runtime.execute("SELECT id FROM public.trips WHERE id=%s", (trip_id,)).fetchall() == [(trip_id,)]
            assert runtime.execute(
                "SELECT user_id FROM public.trip_participants WHERE trip_id=%s", (trip_id,)
            ).fetchall() == [(actor,)]
            assert runtime.execute(
                "SELECT place_label FROM public.trip_stops WHERE trip_id=%s", (trip_id,)
            ).fetchall() == [("Moscow",)]
        for user_id in (former, outsider):
            with runtime.transaction():
                set_authenticated_user(runtime, user_id)
                assert runtime.execute("SELECT id FROM public.trips WHERE id=%s", (trip_id,)).fetchall() == []
                assert runtime.execute(
                    "SELECT user_id FROM public.trip_participants WHERE trip_id=%s", (trip_id,)
                ).fetchall() == []
                assert runtime.execute(
                    "SELECT id FROM public.trip_stops WHERE trip_id=%s", (trip_id,)
                ).fetchall() == []


def test_runtime_trip_mutations_are_denied_and_creation_snapshots_only_active_chat_members(
    database_url: str, runtime_database_url: str
) -> None:
    actor, active_member, former_member, outsider = (create_user(database_url) for _ in range(4))
    chat_id = create_chat(database_url, "group", [actor, active_member, former_member])
    with psycopg.connect(database_url) as owner:
        owner.execute(
            "UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s",
            (chat_id, former_member),
        )
    with psycopg.connect(runtime_database_url) as runtime:
        with runtime.transaction():
            set_authenticated_user(runtime, actor)
            trip = create_trip_from_chat(runtime, chat_id)
            assert trip[1:] == (chat_id, actor, "forming", trip[4])
            trip_id = trip[0]
        for statement in (
            "INSERT INTO public.trips (chat_id, created_by_user_id, status) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'forming')",
            "UPDATE public.trips SET status='active' WHERE id='%s'" % trip_id,
            "DELETE FROM public.trips WHERE id='%s'" % trip_id,
            "INSERT INTO public.trip_participants (trip_id, user_id) VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001')",
            "UPDATE public.trip_participants SET left_at=now() WHERE trip_id='%s'" % trip_id,
            "DELETE FROM public.trip_participants WHERE trip_id='%s'" % trip_id,
            "INSERT INTO public.trip_stops (trip_id, position, place_label) VALUES ('00000000-0000-0000-0000-000000000000', 1, 'spoof')",
            "UPDATE public.trip_stops SET place_label='spoof' WHERE trip_id='%s'" % trip_id,
            "DELETE FROM public.trip_stops WHERE trip_id='%s'" % trip_id,
        ):
            with pytest.raises(psycopg.Error):
                with runtime.transaction():
                    set_authenticated_user(runtime, actor)
                    runtime.execute(statement)
        with pytest.raises(psycopg.Error):
            with runtime.transaction():
                set_authenticated_user(runtime, outsider)
                create_trip_from_chat(runtime, chat_id)
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT user_id FROM public.trip_participants WHERE trip_id=%s ORDER BY user_id", (trip_id,)
        ).fetchall() == sorted([(actor,), (active_member,)])
        assert owner.execute("SELECT count(*) FROM public.trips WHERE chat_id=%s", (chat_id,)).fetchone() == (1,)


def test_trip_creation_capability_is_atomic_and_serializes_one_unfinished_trip(
    database_url: str, runtime_database_url: str
) -> None:
    actor, companion, outsider = (create_user(database_url) for _ in range(3))
    chat_id = create_chat(database_url, "direct", [actor, companion])
    with psycopg.connect(runtime_database_url) as runtime:
        with pytest.raises(psycopg.Error):
            with runtime.transaction():
                set_authenticated_user(runtime, outsider)
                create_trip_from_chat(runtime, chat_id)
    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT count(*) FROM public.trips WHERE chat_id=%s", (chat_id,)).fetchone() == (0,)

    barrier = Barrier(3)

    def create_concurrently():
        with psycopg.connect(runtime_database_url) as runtime:
            try:
                with runtime.transaction():
                    set_authenticated_user(runtime, actor)
                    barrier.wait()
                    return create_trip_from_chat(runtime, chat_id)
            except psycopg.Error:
                return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(create_concurrently)
        second = executor.submit(create_concurrently)
        barrier.wait()
        assert sum(result is not None for result in (first.result(), second.result())) == 1
    with psycopg.connect(database_url) as owner:
        assert owner.execute("SELECT count(*) FROM public.trips WHERE chat_id=%s", (chat_id,)).fetchone() == (1,)
        assert owner.execute(
            "SELECT count(*) FROM public.trip_participants WHERE trip_id=(SELECT id FROM public.trips WHERE chat_id=%s)",
            (chat_id,),
        ).fetchone() == (2,)
