"""PostgreSQL integration tests for Discover candidates and decisions."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from collections.abc import Iterator
from urllib.parse import urlencode, urlparse
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from travel_friend_backend.config import BackendSettings


TEST_BOT_TOKEN = "test-bot-token-for-discover"
os.environ.setdefault("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)
os.environ.setdefault("DATABASE_URL", "postgresql://unused-for-test-import")
from travel_friend_backend.main import create_app


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def sign_init_data(user: dict[str, object]) -> str:
    fields = {
        "auth_date": str(int(time.time())),
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", TEST_BOT_TOKEN.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": signature})


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


@pytest.fixture(autouse=True)
def clean_database(database_url: str) -> Iterator[None]:
    with psycopg.connect(database_url) as connection:
        connection.execute(
            "TRUNCATE public.matches, public.discover_interest_decisions, "
            "public.user_sessions, public.travel_intents, "
            "public.profile_photos, public.profiles, public.user_activity_states, "
            "public.user_settings, public.telegram_identities, public.users RESTART IDENTITY"
        )
    yield


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    app = create_app(BackendSettings(telegram_bot_token=TEST_BOT_TOKEN, database_url=database_url))
    with TestClient(app) as test_client:
        yield test_client


def telegram_user(telegram_id: int) -> dict[str, object]:
    return {"id": telegram_id, "first_name": f"User {telegram_id}"}


def login(client: TestClient, telegram_id: int) -> dict[str, object]:
    response = client.post("/auth/telegram", json={"init_data": sign_init_data(telegram_user(telegram_id))})
    assert response.status_code == 200
    return response.json()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def create_profile(client: TestClient, token: str, display_name: str) -> None:
    response = client.patch(
        "/me/profile",
        headers=auth_headers(token),
        json={"display_name": display_name, "city": "Moscow"},
    )
    assert response.status_code == 200


def create_discover_eligible_user(client: TestClient, telegram_id: int) -> dict[str, object]:
    session = login(client, telegram_id)
    token = session["access_token"]
    create_profile(client, token, f"Candidate {telegram_id}")
    assert client.patch("/me/onboarding", headers=auth_headers(token), json={"status": "completed"}).status_code == 200
    assert client.put("/me/travel-intent", headers=auth_headers(token), json={"destination": "Tbilisi"}).status_code == 200
    return session


def decide(client: TestClient, token: str, target_user_id: str, decision: str):
    return client.put(
        f"/discover/decisions/{target_user_id}",
        headers=auth_headers(token),
        json={"decision": decision},
    )


def test_discover_candidates_excludes_current_user(client: TestClient) -> None:
    actor = create_discover_eligible_user(client, 1)
    candidate = create_discover_eligible_user(client, 2)
    assert client.patch(
        "/me/profile",
        headers=auth_headers(candidate["access_token"]),
        json={"travel_style": ["city-break", None], "interests": ["food", None]},
    ).status_code == 200

    response = client.get("/discover/candidates", headers=auth_headers(actor["access_token"]))

    assert response.status_code == 200
    assert response.json() == [
        {
            "user_id": candidate["user"]["id"],
            "display_name": "Candidate 2",
            "age": None,
            "city": "Moscow",
            "bio": None,
            "travel_style": ["city-break"],
            "interests": ["food"],
            "budget_level": None,
            "comfort_level": None,
            "travel_intent": {
                "destination": "Tbilisi",
                "date_from": None,
                "date_to": None,
            },
        }
    ]


def test_discover_candidates_excludes_user_without_profile(client: TestClient) -> None:
    actor = create_discover_eligible_user(client, 1)
    login(client, 2)

    response = client.get("/discover/candidates", headers=auth_headers(actor["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


def test_discover_candidates_excludes_already_decided_target(client: TestClient) -> None:
    actor = create_discover_eligible_user(client, 1)
    candidate = create_discover_eligible_user(client, 2)
    assert decide(client, actor["access_token"], candidate["user"]["id"], "rejected").status_code == 200

    response = client.get("/discover/candidates", headers=auth_headers(actor["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


def test_discover_candidates_excludes_incomplete_onboarding(client: TestClient) -> None:
    actor = create_discover_eligible_user(client, 1)
    candidate = login(client, 2)
    create_profile(client, candidate["access_token"], "Incomplete")
    assert client.put("/me/travel-intent", headers=auth_headers(candidate["access_token"]), json={"destination": "Tbilisi"}).status_code == 200

    response = client.get("/discover/candidates", headers=auth_headers(actor["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


def test_discover_candidates_excludes_user_without_active_travel_intent(client: TestClient) -> None:
    actor = create_discover_eligible_user(client, 1)
    candidate = login(client, 2)
    create_profile(client, candidate["access_token"], "No intent")
    assert client.patch("/me/onboarding", headers=auth_headers(candidate["access_token"]), json={"status": "completed"}).status_code == 200

    response = client.get("/discover/candidates", headers=auth_headers(actor["access_token"]))

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("decision", ["interested", "rejected"])
def test_decision_is_saved(client: TestClient, database_url: str, decision: str) -> None:
    actor = login(client, 1)
    target = create_discover_eligible_user(client, 2)

    response = decide(client, actor["access_token"], target["user"]["id"], decision)

    assert response.status_code == 200
    assert response.json() == {"decision": decision, "match_created": False, "match_id": None}
    with psycopg.connect(database_url) as connection:
        row = connection.execute("SELECT decision FROM public.discover_interest_decisions").fetchone()
    assert row == (decision,)


def test_self_decision_is_rejected(client: TestClient) -> None:
    actor = login(client, 1)

    response = decide(client, actor["access_token"], actor["user"]["id"], "interested")

    assert response.status_code == 422


def test_one_way_interest_does_not_create_match(client: TestClient, database_url: str) -> None:
    actor = login(client, 1)
    target = create_discover_eligible_user(client, 2)

    response = decide(client, actor["access_token"], target["user"]["id"], "interested")

    assert response.status_code == 200
    assert response.json()["match_id"] is None
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.matches").fetchone() == (0,)


def test_reciprocal_interest_creates_match(client: TestClient) -> None:
    first = create_discover_eligible_user(client, 1)
    second = create_discover_eligible_user(client, 2)
    assert decide(client, first["access_token"], second["user"]["id"], "interested").json()["match_id"] is None

    response = decide(client, second["access_token"], first["user"]["id"], "interested")

    assert response.status_code == 200
    assert response.json()["match_created"] is True
    assert UUID(response.json()["match_id"])


def test_repeated_interested_is_idempotent_and_does_not_duplicate_match(client: TestClient, database_url: str) -> None:
    first = create_discover_eligible_user(client, 1)
    second = create_discover_eligible_user(client, 2)
    assert decide(client, first["access_token"], second["user"]["id"], "interested").status_code == 200
    matched = decide(client, second["access_token"], first["user"]["id"], "interested")

    repeated = decide(client, second["access_token"], first["user"]["id"], "interested")

    assert repeated.status_code == 200
    assert repeated.json() == {"decision": "interested", "match_created": False, "match_id": matched.json()["match_id"]}
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.matches").fetchone() == (1,)


def test_repeated_rejected_is_idempotent(client: TestClient) -> None:
    actor = login(client, 1)
    target = create_discover_eligible_user(client, 2)
    assert decide(client, actor["access_token"], target["user"]["id"], "rejected").status_code == 200

    repeated = decide(client, actor["access_token"], target["user"]["id"], "rejected")

    assert repeated.status_code == 200
    assert repeated.json() == {"decision": "rejected", "match_created": False, "match_id": None}


@pytest.mark.parametrize(
    ("first_decision", "second_decision"),
    [("interested", "rejected"), ("rejected", "interested")],
)
def test_conflicting_decision_is_rejected(client: TestClient, first_decision: str, second_decision: str) -> None:
    actor = login(client, 1)
    target = create_discover_eligible_user(client, 2)
    assert decide(client, actor["access_token"], target["user"]["id"], first_decision).status_code == 200

    response = decide(client, actor["access_token"], target["user"]["id"], second_decision)

    assert response.status_code == 409


def test_reversed_pair_returns_existing_match_without_duplicate(client: TestClient, database_url: str) -> None:
    first = create_discover_eligible_user(client, 1)
    second = create_discover_eligible_user(client, 2)
    assert decide(client, first["access_token"], second["user"]["id"], "interested").status_code == 200
    assert decide(client, second["access_token"], first["user"]["id"], "interested").status_code == 200

    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM public.matches").fetchone() == (1,)
        user_a_id, user_b_id = connection.execute("SELECT user_a_id, user_b_id FROM public.matches").fetchone()
    assert user_a_id < user_b_id


def test_decision_rejects_target_with_incomplete_onboarding(client: TestClient) -> None:
    actor = login(client, 1)
    target = login(client, 2)
    create_profile(client, target["access_token"], "Incomplete")
    assert client.put("/me/travel-intent", headers=auth_headers(target["access_token"]), json={"destination": "Tbilisi"}).status_code == 200

    response = decide(client, actor["access_token"], target["user"]["id"], "interested")

    assert response.status_code == 404
    assert response.json() == {"detail": "Discover target not found"}


def test_decision_rejects_target_without_active_travel_intent(client: TestClient) -> None:
    actor = login(client, 1)
    target = login(client, 2)
    create_profile(client, target["access_token"], "No intent")
    assert client.patch("/me/onboarding", headers=auth_headers(target["access_token"]), json={"status": "completed"}).status_code == 200

    response = decide(client, actor["access_token"], target["user"]["id"], "interested")

    assert response.status_code == 404
    assert response.json() == {"detail": "Discover target not found"}


def test_existing_decision_remains_idempotent_after_target_loses_eligibility(client: TestClient) -> None:
    actor = login(client, 1)
    target = create_discover_eligible_user(client, 2)
    assert decide(client, actor["access_token"], target["user"]["id"], "rejected").status_code == 200
    assert client.delete("/me/travel-intent", headers=auth_headers(target["access_token"])).status_code == 204

    repeated = decide(client, actor["access_token"], target["user"]["id"], "rejected")

    assert repeated.status_code == 200
    assert repeated.json() == {"decision": "rejected", "match_created": False, "match_id": None}


def test_discover_endpoints_require_authentication(client: TestClient) -> None:
    assert client.get("/discover/candidates").status_code == 401
    assert client.put("/discover/decisions/00000000-0000-0000-0000-000000000000", json={"decision": "interested"}).status_code == 401
