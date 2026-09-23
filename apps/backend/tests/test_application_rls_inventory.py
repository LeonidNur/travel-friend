"""Final RLS inventory for every current application table."""

from __future__ import annotations

import psycopg
import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
)


APPLICATION_TABLES = (
    "users",
    "telegram_identities",
    "profiles",
    "profile_photos",
    "user_settings",
    "user_activity_states",
    "travel_intents",
    "user_sessions",
    "discover_interest_decisions",
    "matches",
    "chats",
    "chat_participants",
    "messages",
    "chat_summaries",
    "trips",
    "trip_participants",
    "trip_stops",
)

EXPECTED_RUNTIME_POLICIES = [
    ("chat_participants", "chat_participants_select_active_chat", "SELECT", "{app_runtime}"),
    ("chats", "chats_select_active_participant", "SELECT", "{app_runtime}"),
    ("discover_interest_decisions", "discover_interest_decisions_select_own", "SELECT", "{app_runtime}"),
    ("matches", "matches_select_participant", "SELECT", "{app_runtime}"),
    ("messages", "messages_select_active_participant", "SELECT", "{app_runtime}"),
    ("profiles", "profiles_insert_own", "INSERT", "{app_runtime}"),
    ("profiles", "profiles_select_own", "SELECT", "{app_runtime}"),
    ("profiles", "profiles_update_own", "UPDATE", "{app_runtime}"),
    ("travel_intents", "travel_intents_insert_own_active", "INSERT", "{app_runtime}"),
    ("travel_intents", "travel_intents_select_own_active", "SELECT", "{app_runtime}"),
    ("travel_intents", "travel_intents_update_own_active", "UPDATE", "{app_runtime}"),
    ("trip_participants", "trip_participants_select_active_trip", "SELECT", "{app_runtime}"),
    ("trip_stops", "trip_stops_select_active_participant", "SELECT", "{app_runtime}"),
    ("trips", "trips_select_active_participant", "SELECT", "{app_runtime}"),
    ("user_activity_states", "user_activity_states_select_own", "SELECT", "{app_runtime}"),
    ("user_sessions", "user_sessions_select_own", "SELECT", "{app_runtime}"),
    ("user_sessions", "user_sessions_update_own", "UPDATE", "{app_runtime}"),
]


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


def test_all_application_tables_have_the_expected_rls_inventory(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        inventory = connection.execute(
            "SELECT relation.relname, relation.relrowsecurity, "
            "relation.relowner <> (SELECT oid FROM pg_roles WHERE rolname = %s) "
            "FROM pg_class AS relation JOIN pg_namespace AS namespace "
            "ON namespace.oid = relation.relnamespace "
            "WHERE namespace.nspname = 'public' AND relation.relname = ANY(%s::text[]) "
            "ORDER BY relation.relname",
            (APP_RUNTIME_ROLE, list(APPLICATION_TABLES)),
        ).fetchall()
        policies = connection.execute(
            "SELECT tablename, policyname, cmd, roles::text FROM pg_policies "
            "WHERE schemaname = 'public' AND tablename = ANY(%s::text[]) "
            "ORDER BY tablename, policyname",
            (list(APPLICATION_TABLES),),
        ).fetchall()

    assert inventory == [(table_name, True, True) for table_name in sorted(APPLICATION_TABLES)]
    assert policies == EXPECTED_RUNTIME_POLICIES
    assert [policy for policy in policies if policy[0] in {
        "users", "telegram_identities", "user_settings", "profile_photos", "chat_summaries"
    }] == []
