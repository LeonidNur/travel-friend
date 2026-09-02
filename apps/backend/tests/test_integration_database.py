"""Safety checks for destructive PostgreSQL integration-test setup."""

from __future__ import annotations

import pytest

from integration_database import (
    UnsafeTestDatabaseUrlError,
    require_disposable_test_database_url,
    truncate_disposable_test_database,
)


def test_allows_the_dedicated_disposable_test_database() -> None:
    database_url = "postgresql://tester:password@localhost:5432/travel_friend_test"

    assert require_disposable_test_database_url(database_url, environment={}) == database_url


@pytest.mark.parametrize("database_name", ["postgres", "template0", "template1"])
def test_rejects_postgres_and_template_databases(database_name: str) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="reserved PostgreSQL database"):
        require_disposable_test_database_url(
            f"postgresql://tester:password@localhost:5432/{database_name}",
            environment={},
        )


def test_rejects_a_dev_like_database() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="dedicated disposable database"):
        require_disposable_test_database_url(
            "postgresql://tester:password@localhost:5432/travel_friend_dev",
            environment={},
        )


def test_rejects_the_same_url_as_the_runtime_database() -> None:
    database_url = "postgresql://tester:password@localhost:5432/travel_friend_test"

    with pytest.raises(UnsafeTestDatabaseUrlError, match="must not equal DATABASE_URL"):
        require_disposable_test_database_url(
            database_url,
            environment={"DATABASE_URL": database_url},
        )


def test_rejects_an_equivalent_loopback_runtime_database_url() -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="must not equal DATABASE_URL"):
        require_disposable_test_database_url(
            "postgresql://tester:password@localhost:5432/travel_friend_test",
            environment={
                "DATABASE_URL": "postgres://runtime:other-password@127.0.0.1:5432/travel_friend_test"
            },
        )


def test_cleanup_revalidates_before_connecting_to_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    database_url = "postgresql://tester:password@localhost:5432/travel_friend_test"
    connect_was_called = False

    def fail_if_called(*args: object, **kwargs: object) -> None:
        nonlocal connect_was_called
        connect_was_called = True

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("integration_database.psycopg.connect", fail_if_called)

    with pytest.raises(UnsafeTestDatabaseUrlError, match="must not equal DATABASE_URL"):
        truncate_disposable_test_database(database_url, "TRUNCATE public.users")

    assert connect_was_called is False


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://tester:password@db.example.test:5432/travel_friend_dev",
        "postgresql://tester:password@localhost:15432/travel_friend_dev",
    ],
)
def test_rejects_remote_or_tunneled_unsafe_database_even_when_host_looks_local(
    database_url: str,
) -> None:
    with pytest.raises(UnsafeTestDatabaseUrlError, match="dedicated disposable database"):
        require_disposable_test_database_url(database_url, environment={})
