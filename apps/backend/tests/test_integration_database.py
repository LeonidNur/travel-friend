"""Safety checks for destructive PostgreSQL integration-test setup."""

from __future__ import annotations

import pytest

from integration_database import (
    APP_RUNTIME_ROLE,
    DISPOSABLE_TEST_DATABASE_NAME,
    UnsafeTestDatabaseUrlError,
    get_disposable_runtime_database_url,
    require_disposable_test_database_url,
    truncate_disposable_test_database,
)

OWNER_DATABASE_URL = (
    "postgresql://travel_friend_test:travel_friend_test_local_only@localhost:55432/"
    f"{DISPOSABLE_TEST_DATABASE_NAME}"
)


def test_allows_the_dedicated_disposable_test_database() -> None:
    assert require_disposable_test_database_url(OWNER_DATABASE_URL, environment={}) == OWNER_DATABASE_URL


@pytest.mark.parametrize("database_name", ["postgres", "template0", "template1"])
def test_rejects_postgres_and_template_databases(database_name: str) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="reserved PostgreSQL database"):
        require_disposable_test_database_url(
            f"postgresql://travel_friend_test:password@localhost:5432/{database_name}",
            environment={},
        )


def test_rejects_a_dev_like_database() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="dedicated disposable database"):
        require_disposable_test_database_url(
            "postgresql://travel_friend_test:password@localhost:5432/travel_friend_dev",
            environment={},
        )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://travel_friend_test:password@db.example.test:55432/travel_friend_test",
        "postgresql://travel_friend_test:password@localhost:5432/travel_friend_test",
    ],
)
def test_rejects_non_workflow_host_or_port_for_the_disposable_database(database_url: str) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="local disposable PostgreSQL"):
        require_disposable_test_database_url(database_url, environment={})


def test_rejects_the_same_url_as_the_runtime_database() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="unvalidated DATABASE_URL"):
        require_disposable_test_database_url(
            OWNER_DATABASE_URL,
            environment={"DATABASE_URL": OWNER_DATABASE_URL},
        )


def test_allows_a_distinct_runtime_role_on_the_same_disposable_database() -> None:
    assert require_disposable_test_database_url(
        OWNER_DATABASE_URL,
        environment={
            "DATABASE_URL": "postgres://app_runtime:other-password@127.0.0.1:55432/travel_friend_test"
        },
    ) == OWNER_DATABASE_URL


def test_rejects_same_physical_target_for_a_non_runtime_database_user() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match=APP_RUNTIME_ROLE):
        require_disposable_test_database_url(
            OWNER_DATABASE_URL,
            environment={
                "DATABASE_URL": "postgres://not_runtime:other-password@127.0.0.1:55432/travel_friend_test"
            },
        )


@pytest.mark.parametrize(
    "runtime_database_url",
    [
        "postgresql://app_runtime:password@db.example.test:55432/travel_friend_test",
        "postgresql://app_runtime:password@localhost:5432/travel_friend_test",
        "postgresql://app_runtime:password@localhost:55432/travel_friend_other",
    ],
)
def test_rejects_a_runtime_url_outside_the_local_disposable_workflow(
    runtime_database_url: str,
) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError):
        require_disposable_test_database_url(
            OWNER_DATABASE_URL,
            environment={"DATABASE_URL": runtime_database_url},
        )


def test_rejects_a_test_database_url_without_the_disposable_owner_identity() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="travel_friend_test"):
        require_disposable_test_database_url(
            "postgresql://tester:password@localhost:55432/travel_friend_test",
            environment={},
        )


def test_runtime_database_url_requires_the_disposable_runtime_role() -> None:
    runtime_database_url = "postgresql://app_runtime:password@localhost:55432/travel_friend_test"

    assert get_disposable_runtime_database_url({"DATABASE_URL": runtime_database_url}) == runtime_database_url

    with pytest.raises(UnsafeTestDatabaseUrlError, match=APP_RUNTIME_ROLE):
        get_disposable_runtime_database_url(
            {"DATABASE_URL": OWNER_DATABASE_URL}
        )


def test_cleanup_revalidates_before_connecting_to_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    connect_was_called = False

    def fail_if_called(*args: object, **kwargs: object) -> None:
        nonlocal connect_was_called
        connect_was_called = True

    monkeypatch.setenv("DATABASE_URL", OWNER_DATABASE_URL)
    monkeypatch.setattr("integration_database.psycopg.connect", fail_if_called)

    with pytest.raises(UnsafeTestDatabaseUrlError, match="unvalidated DATABASE_URL"):
        truncate_disposable_test_database(OWNER_DATABASE_URL, "TRUNCATE public.users")

    assert connect_was_called is False


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://travel_friend_test:password@db.example.test:5432/travel_friend_dev",
        "postgresql://travel_friend_test:password@localhost:15432/travel_friend_dev",
    ],
)
def test_rejects_remote_or_tunneled_unsafe_database_even_when_host_looks_local(
    database_url: str,
) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="dedicated disposable database"):
        require_disposable_test_database_url(database_url, environment={})
