"""PostgreSQL integration coverage for authenticated database unit-of-work context."""

from __future__ import annotations

from collections.abc import Iterator
import os
from typing import Annotated
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi import Body, Depends, FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-for-authenticated-context")
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-authenticated-context")

from travel_friend_backend.auth.service import AuthenticatedPrincipal, auth_dependency
from travel_friend_backend.config import BackendSettings
from travel_friend_backend.db import authenticated_transaction
from travel_friend_backend.dependencies import get_authenticated_database_connection
from travel_friend_backend.main import create_app
from integration_database import (
    IntegrationDatabaseNotConfiguredError,
    get_disposable_test_database_url,
)
from test_telegram_auth import TEST_BOT_TOKEN, sign_init_data, telegram_user


def current_setting(connection: psycopg.Connection) -> str | None:
    row = connection.execute(
        "SELECT current_setting('app.user_id', true) AS user_id"
    ).fetchone()
    return row["user_id"] if isinstance(row, dict) else row[0]


def current_context_is_absent(connection: psycopg.Connection) -> bool:
    value = connection.execute(
        "SELECT NULLIF(current_setting('app.user_id', true), '')"
    ).fetchone()[0]
    connection.rollback()
    return value is None


@pytest.fixture
def database_url() -> str:
    try:
        return get_disposable_test_database_url()
    except IntegrationDatabaseNotConfiguredError as error:
        pytest.skip(str(error))


@pytest.fixture
def context_test_app(runtime_database_url: str) -> FastAPI:
    app = create_app(
        BackendSettings(telegram_bot_token=TEST_BOT_TOKEN, database_url=runtime_database_url)
    )

    @app.post("/_test/authenticated-context")
    def authenticated_context(
        principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
        connection: Annotated[psycopg.Connection, Depends(get_authenticated_database_connection)],
        ignored_client_user_id: UUID = Body(embed=True),
    ) -> dict[str, str]:
        del ignored_client_user_id
        return {
            "principal_user_id": str(principal.user_id),
            "database_user_id": current_setting(connection),
        }

    return app


@pytest.fixture
def context_client(context_test_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(context_test_app) as test_client:
        yield test_client


def test_authenticated_request_sets_context_from_principal_not_client_body(
    context_client: TestClient,
) -> None:
    first = context_client.post(
        "/auth/telegram", json={"init_data": sign_init_data(telegram_user(id=1))}
    ).json()
    second = context_client.post(
        "/auth/telegram", json={"init_data": sign_init_data(telegram_user(id=2))}
    ).json()
    client_supplied_user_id = uuid4()

    first_response = context_client.post(
        "/_test/authenticated-context",
        headers={"Authorization": f"Bearer {first['access_token']}"},
        json={"ignored_client_user_id": str(client_supplied_user_id)},
    )
    second_response = context_client.post(
        "/_test/authenticated-context",
        headers={"Authorization": f"Bearer {second['access_token']}"},
        json={"ignored_client_user_id": str(first['user']['id'])},
    )

    assert first_response.status_code == second_response.status_code == 200
    assert first_response.json() == {
        "principal_user_id": first["user"]["id"],
        "database_user_id": first["user"]["id"],
    }
    assert second_response.json() == {
        "principal_user_id": second["user"]["id"],
        "database_user_id": second["user"]["id"],
    }
    assert context_client.post(
        "/_test/authenticated-context",
        json={"ignored_client_user_id": str(client_supplied_user_id)},
    ).status_code == 401


def test_authenticated_transaction_is_local_to_commit_and_connection_reuse(
    runtime_database_url: str,
) -> None:
    first_user_id = uuid4()
    second_user_id = uuid4()

    with psycopg.connect(runtime_database_url) as connection:
        assert current_context_is_absent(connection)

        with authenticated_transaction(connection, first_user_id):
            assert current_setting(connection) == str(first_user_id)
            with pytest.raises(psycopg.errors.DivisionByZero):
                with connection.transaction():
                    connection.execute("SELECT 1 / 0")
            assert current_setting(connection) == str(first_user_id)

        assert current_context_is_absent(connection)

        with authenticated_transaction(connection, second_user_id):
            assert current_setting(connection) == str(second_user_id)

        assert current_context_is_absent(connection)


def test_authenticated_transaction_is_local_to_rollback(runtime_database_url: str) -> None:
    user_id = uuid4()

    with psycopg.connect(runtime_database_url) as connection:
        with pytest.raises(RuntimeError, match="rollback"):
            with authenticated_transaction(connection, user_id):
                assert current_setting(connection) == str(user_id)
                raise RuntimeError("rollback")

        assert current_context_is_absent(connection)


def test_context_accessor_fails_closed_for_missing_empty_and_malformed_values(
    database_url: str,
) -> None:
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT public.current_authenticated_user_id()").fetchone()[0] is None
        with connection.transaction():
            connection.execute("SELECT set_config('app.user_id', '', true)")
            assert connection.execute("SELECT public.current_authenticated_user_id()").fetchone()[0] is None
        with connection.transaction():
            connection.execute("SELECT set_config('app.user_id', 'not-a-uuid', true)")
            assert connection.execute("SELECT public.current_authenticated_user_id()").fetchone()[0] is None
