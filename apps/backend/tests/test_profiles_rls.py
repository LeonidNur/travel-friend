"""Real PostgreSQL coverage for the narrow profiles RLS slice."""

from __future__ import annotations

from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
    truncate_disposable_test_database,
)


CAPABILITIES = (
    "public.discover_candidate_profile_projection()",
    "public.discover_target_is_eligible(uuid)",
    "public.chat_participant_profile_projection(uuid)",
    "public.trip_participant_profile_projection(uuid)",
)


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture(autouse=True)
def clean_database(database_url: str) -> Iterator[None]:
    truncate_disposable_test_database(
        database_url,
        "TRUNCATE public.trip_stops, public.trip_participants, public.trips, public.chat_summaries, "
        "public.messages, public.chat_participants, public.matches, public.chats, "
        "public.discover_interest_decisions, public.user_sessions, public.travel_intents, "
        "public.profile_photos, public.profiles, public.user_activity_states, public.user_settings, "
        "public.telegram_identities, public.users RESTART IDENTITY",
    )
    yield


def create_user(database_url: str, name: str, *, eligible: bool = True) -> UUID:
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
        connection.execute(
            "INSERT INTO public.profiles "
            "(user_id, display_name, birth_date, city, bio, travel_style, interests, budget_level, comfort_level) "
            "VALUES (%s, %s, '1990-01-01', %s, 'bio', ARRAY['style'], ARRAY['interest'], 'medium', 'high')",
            (user_id, name, f"{name} city"),
        )
        connection.execute(
            "INSERT INTO public.user_activity_states (user_id, onboarding_status) VALUES (%s, %s)",
            (user_id, "completed" if eligible else "in_progress"),
        )
        connection.execute(
            "INSERT INTO public.travel_intents (user_id, destination_label, status) VALUES (%s, %s, 'active')",
            (user_id, f"{name} destination"),
        )
    return user_id


def set_authenticated_user(connection: psycopg.Connection, user_id: UUID | str) -> None:
    connection.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


def test_profiles_rls_catalog_has_exact_owner_policies_without_force(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.profiles'::regclass"
        ).fetchone() == (True, False)
        policies = connection.execute(
            "SELECT policyname, cmd, roles::text, qual, with_check "
            "FROM pg_policies WHERE schemaname='public' AND tablename='profiles' ORDER BY policyname"
        ).fetchall()
    assert policies == [
        ("profiles_insert_own", "INSERT", "{app_runtime}", None, "(user_id = current_authenticated_user_id())"),
        ("profiles_select_own", "SELECT", "{app_runtime}", "(user_id = current_authenticated_user_id())", None),
        ("profiles_update_own", "UPDATE", "{app_runtime}", "(user_id = current_authenticated_user_id())", "(user_id = current_authenticated_user_id())"),
    ]


def test_profiles_owner_crud_is_scoped_and_context_fails_closed(
    database_url: str, runtime_database_url: str
) -> None:
    user_a_id = create_user(database_url, "A")
    user_b_id = create_user(database_url, "B")
    with psycopg.connect(database_url) as connection:
        user_c_id = connection.execute("INSERT INTO public.users DEFAULT VALUES RETURNING id").fetchone()[0]
    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute("SELECT * FROM public.profiles").fetchall() == []
        with connection.transaction():
            set_authenticated_user(connection, "malformed")
            assert connection.execute("SELECT * FROM public.profiles").fetchall() == []
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'bad')", (user_a_id,))
        with connection.transaction():
            set_authenticated_user(connection, user_a_id)
            assert connection.execute("SELECT user_id FROM public.profiles ORDER BY user_id").fetchall() == [(user_a_id,)]
            assert connection.execute("UPDATE public.profiles SET city='new' WHERE user_id=%s RETURNING user_id", (user_a_id,)).fetchall() == [(user_a_id,)]
            assert connection.execute("UPDATE public.profiles SET city='bad' WHERE user_id=%s RETURNING user_id", (user_b_id,)).fetchall() == []
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute("INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'bad')", (user_b_id,))
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with connection.transaction():
                    connection.execute("DELETE FROM public.profiles WHERE user_id=%s", (user_a_id,))
        with connection.transaction():
            set_authenticated_user(connection, user_c_id)
            assert connection.execute(
                "INSERT INTO public.profiles (user_id, display_name) VALUES (%s, 'C') RETURNING user_id",
                (user_c_id,),
            ).fetchall() == [(user_c_id,)]


def test_profile_capabilities_are_owner_owned_and_private(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        for signature in CAPABILITIES:
            assert connection.execute("SELECT has_function_privilege('public', %s, 'EXECUTE')", (signature,)).fetchone() == (False,)
            assert connection.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (APP_RUNTIME_ROLE, signature)).fetchone() == (True,)
            assert connection.execute("SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=%s::regprocedure", (signature,)).fetchone() != (APP_RUNTIME_ROLE,)
            definition = connection.execute("SELECT pg_get_functiondef(%s::regprocedure)", (signature,)).fetchone()[0]
            for expected in ("SECURITY DEFINER", "SET search_path TO 'pg_catalog'", "public.current_authenticated_user_id()"):
                assert expected in definition
            assert "format(" not in definition
            assert "EXECUTE" not in definition


def test_profile_capabilities_enforce_relationships_and_fixed_projections(
    database_url: str, runtime_database_url: str
) -> None:
    requester_id = create_user(database_url, "Requester")
    candidate_id = create_user(database_url, "Candidate")
    outsider_id = create_user(database_url, "Outsider")
    with psycopg.connect(database_url) as connection:
        direct_chat_id = connection.execute("INSERT INTO public.chats (type) VALUES ('direct') RETURNING id").fetchone()[0]
        connection.execute("INSERT INTO public.chat_participants (chat_id, user_id) VALUES (%s, %s), (%s, %s)", (direct_chat_id, requester_id, direct_chat_id, candidate_id))
        group_chat_id = connection.execute("INSERT INTO public.chats (type) VALUES ('group') RETURNING id").fetchone()[0]
        connection.execute("INSERT INTO public.chat_participants (chat_id, user_id) VALUES (%s, %s), (%s, %s)", (group_chat_id, requester_id, group_chat_id, candidate_id))
        trip_id = connection.execute("INSERT INTO public.trips (chat_id, created_by_user_id, status) VALUES (%s, %s, 'forming') RETURNING id", (direct_chat_id, requester_id)).fetchone()[0]
        connection.execute("INSERT INTO public.trip_participants (trip_id, user_id) VALUES (%s, %s), (%s, %s)", (trip_id, requester_id, trip_id, candidate_id))
    with psycopg.connect(runtime_database_url) as connection:
        assert connection.execute("SELECT * FROM public.discover_candidate_profile_projection()").fetchall() == []
        assert connection.execute(
            "SELECT public.discover_target_is_eligible(%s)", (candidate_id,)
        ).fetchone() == (False,)
        assert connection.execute("SELECT * FROM public.chat_participant_profile_projection(%s)", (direct_chat_id,)).fetchall() == []
        assert connection.execute("SELECT * FROM public.trip_participant_profile_projection(%s)", (trip_id,)).fetchall() == []
        with connection.transaction():
            set_authenticated_user(connection, requester_id)
            candidates = connection.execute("SELECT * FROM public.discover_candidate_profile_projection()").fetchall()
            assert [row[0] for row in candidates] == [candidate_id, outsider_id]
            assert connection.execute("SELECT public.discover_target_is_eligible(%s)", (candidate_id,)).fetchone() == (True,)
            direct = connection.execute("SELECT * FROM public.chat_participant_profile_projection(%s)", (direct_chat_id,)).fetchall()
            assert direct == [(candidate_id, "Candidate", 36, "Candidate city")]
            group = connection.execute("SELECT * FROM public.chat_participant_profile_projection(%s) ORDER BY user_id", (group_chat_id,)).fetchall()
            assert [(row[0], row[1], row[2], row[3]) for row in group] == sorted(
                [(requester_id, "Requester", None, None), (candidate_id, "Candidate", None, None)]
            )
            assert connection.execute("SELECT * FROM public.trip_participant_profile_projection(%s) ORDER BY user_id", (trip_id,)).fetchall() == sorted([(requester_id, "Requester", 36, "Requester city"), (candidate_id, "Candidate", 36, "Candidate city")])
        with connection.transaction():
            set_authenticated_user(connection, outsider_id)
            assert connection.execute("SELECT public.discover_target_is_eligible(%s)", (candidate_id,)).fetchone() == (True,)
            assert connection.execute("SELECT * FROM public.chat_participant_profile_projection(%s)", (direct_chat_id,)).fetchall() == []
            assert connection.execute("SELECT * FROM public.trip_participant_profile_projection(%s)", (trip_id,)).fetchall() == []
            assert connection.execute("SELECT public.discover_target_is_eligible(NULL)").fetchone() == (False,)
        with connection.transaction():
            set_authenticated_user(connection, "malformed")
            assert connection.execute("SELECT * FROM public.discover_candidate_profile_projection()").fetchall() == []
            assert connection.execute(
                "SELECT public.discover_target_is_eligible(%s)", (candidate_id,)
            ).fetchone() == (False,)
    with psycopg.connect(database_url) as connection:
        connection.execute("UPDATE public.chat_participants SET left_at=now() WHERE chat_id=%s AND user_id=%s", (direct_chat_id, candidate_id))
        connection.execute("UPDATE public.trip_participants SET left_at=now() WHERE trip_id=%s AND user_id=%s", (trip_id, candidate_id))
    with psycopg.connect(runtime_database_url) as connection:
        with connection.transaction():
            set_authenticated_user(connection, candidate_id)
            assert connection.execute("SELECT * FROM public.chat_participant_profile_projection(%s)", (direct_chat_id,)).fetchall() == []
            assert connection.execute("SELECT * FROM public.trip_participant_profile_projection(%s)", (trip_id,)).fetchall() == []
