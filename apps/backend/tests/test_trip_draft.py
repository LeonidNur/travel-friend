"""PostgreSQL integration coverage for shared Trip Draft editing."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier
from uuid import UUID, uuid4

import psycopg
import pytest

from test_discover import auth_headers, client, create_discover_eligible_user, create_reciprocal_match, database_url
from test_trips import clean_database, direct_chat_id, create_trip

pytestmark = pytest.mark.usefixtures("clean_database")


def create_trip_context(client, database_url: str):
    first, second, match = create_reciprocal_match(client)
    chat_id = direct_chat_id(database_url, match["match_id"])
    trip = create_trip(client, first["access_token"], chat_id).json()
    return first, second, chat_id, trip


def content_with_one_event() -> dict[str, object]:
    return {
        "route_stops": [{"id": str(uuid4()), "place_label": "Казань", "country_code": None, "place_ref": None, "stay_from": None, "stay_to": None, "notes": None}],
        "date_from": None,
        "date_to": None,
        "accommodations": [],
        "transport": [],
        "budget": {"min": None, "max": None, "currency": None, "scope": None},
        "days": [{
            "id": str(uuid4()),
            "date": None,
            "title": "Первый день",
            "notes": None,
            "events": [{
                "id": str(uuid4()),
                "kind": "activity",
                "title": "Прогулка",
                "start_time": None,
                "duration_minutes": None,
                "address": None,
                "estimated_cost": None,
                "currency": None,
                "notes": None,
            }],
        }],
        "notes": "Черновой план",
    }


def content_at_database_jsonb_limit(database_url: str) -> dict[str, object]:
    content = {
        "route_stops": [], "date_from": None, "date_to": None,
        "accommodations": [], "transport": [],
        "budget": {"min": None, "max": None, "currency": None, "scope": None},
        "days": [
            {
                "id": str(uuid4()), "date": None, "title": None, "notes": None,
                "events": [
                    {
                        "id": str(uuid4()), "kind": "activity", "title": "t" * 100,
                        "start_time": None, "duration_minutes": None, "address": None,
                        "estimated_cost": None, "currency": None, "notes": "",
                    }
                    for _ in range(65)
                ],
            }
            for _ in range(2)
        ],
        "notes": "",
    }
    notes = [event for day in content["days"] for event in day["events"]]
    with psycopg.connect(database_url) as connection:
        low, high = 0, 2000
        while low < high:
            middle = (low + high + 1) // 2
            for event in notes:
                event["notes"] = "x" * middle
            size = connection.execute(
                "SELECT pg_column_size(%s::jsonb)", (json.dumps(content),)
            ).fetchone()[0]
            if size <= 262144:
                low = middle
            else:
                high = middle - 1
        for event in notes:
            event["notes"] = "x" * low
        size = connection.execute(
            "SELECT pg_column_size(%s::jsonb)", (json.dumps(content),)
        ).fetchone()[0]
        remainder = 262144 - size
        assert 0 <= remainder <= 2000
        title_remainder = min(remainder, 100)
        notes[0]["title"] += "x" * title_remainder
        remainder -= title_remainder
        content["notes"] = "x" * remainder
        assert connection.execute(
            "SELECT pg_column_size(%s::jsonb)", (json.dumps(content),)
        ).fetchone()[0] == 262144
    return content


def test_trip_draft_is_initialized_and_active_members_can_edit_with_version_history(
    client, database_url: str
) -> None:
    first, second, _, trip = create_trip_context(client, database_url)

    initial = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert initial.status_code == 200
    assert initial.json()["draft"]["version"] == 1
    assert initial.json()["draft"]["content"]["days"] == []
    assert "history" not in initial.json()
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT author_user_id FROM public.trip_draft_versions WHERE trip_id=%s AND version=1",
            (UUID(trip["trip_id"]),),
        ).fetchone()[0] == UUID(first["user"]["id"])

    content = content_with_one_event()
    saved = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(second["access_token"]),
        json={"base_version": 1, "content": content},
    )

    assert saved.status_code == 200
    assert saved.json()["version"] == 2
    assert saved.json()["updated_by_user_id"] == second["user"]["id"]
    assert saved.json()["content"] == content

    refreshed = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert refreshed.json()["draft"]["version"] == 2
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT version, author_user_id FROM public.trip_draft_versions WHERE trip_id=%s ORDER BY version",
            (UUID(trip["trip_id"]),),
        ).fetchall() == [(1, UUID(first["user"]["id"])), (2, UUID(second["user"]["id"]))]


def test_draft_save_rejects_stale_version_without_overwriting_current_content(
    client, database_url: str
) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    content = content_with_one_event()
    assert client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    ).status_code == 200

    stale = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(second["access_token"]),
        json={"base_version": 1, "content": content_with_one_event()},
    )

    assert stale.status_code == 409
    current = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert current.json()["draft"]["version"] == 2
    assert current.json()["draft"]["content"] == content


def test_trip_draft_and_itinerary_are_hidden_from_outsiders(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    outsider = create_discover_eligible_user(client, 3)

    assert client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(outsider["access_token"])).status_code == 404
    assert client.get(f"/trips/{trip['trip_id']}/itinerary", headers=auth_headers(outsider["access_token"])).status_code == 404
    assert client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(outsider["access_token"]),
        json={"base_version": 1, "content": content_with_one_event()},
    ).status_code == 404


def test_draft_alternatives_are_saved_and_readable_by_trip_members(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    content = content_with_one_event()
    response = client.post(
        f"/trips/{trip['trip_id']}/draft/alternatives",
        headers=auth_headers(first["access_token"]),
        json={"title": "Вариант с ночёвкой", "content": content},
    )

    assert response.status_code == 201
    alternative_id = response.json()["id"]
    assert "content" not in response.json()
    read = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(second["access_token"]))
    assert read.status_code == 200
    assert read.json()["alternatives"][0]["id"] == alternative_id
    assert read.json()["alternatives"][0]["title"] == "Вариант с ночёвкой"
    assert "content" not in read.json()["alternatives"][0]
    opened = client.get(
        f"/trips/{trip['trip_id']}/draft/alternatives/{alternative_id}",
        headers=auth_headers(second["access_token"]),
    )
    assert opened.status_code == 200
    assert opened.json()["content"] == content


def test_concurrent_draft_saves_return_one_success_and_one_conflict(client, database_url: str) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    barrier = Barrier(3)

    def save(token: str, notes: str):
        barrier.wait()
        return client.put(
            f"/trips/{trip['trip_id']}/draft",
            headers=auth_headers(token),
            json={"base_version": 1, "content": {**content_with_one_event(), "notes": notes}},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_save = executor.submit(save, first["access_token"], "Первый автор")
        second_save = executor.submit(save, second["access_token"], "Второй автор")
        barrier.wait()
        responses = [first_save.result(), second_save.result()]

    assert sorted(response.status_code for response in responses) == [200, 409]
    current = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert current.json()["draft"]["version"] == 2
    assert "history" not in current.json()
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_versions WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 2


def test_draft_validation_requires_stable_ids_and_rejects_unknown_fields(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    invalid_content = {**content_with_one_event(), "unapproved_mutation": True}

    response = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": invalid_content},
    )

    assert response.status_code == 422
    current = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert current.json()["draft"]["version"] == 1


def test_event_ids_must_be_unique_across_days(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    content = content_with_one_event()
    event_id = content["days"][0]["events"][0]["id"]
    content["days"].append({
        "id": str(uuid4()), "date": None, "title": None, "notes": None,
        "events": [{
            "id": event_id, "kind": "activity", "title": "Дубликат", "start_time": None,
            "duration_minutes": None, "address": None, "estimated_cost": None,
            "currency": None, "notes": None,
        }],
    })

    response = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )

    assert response.status_code == 422
    current = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert current.json()["draft"]["version"] == 1


def test_shared_draft_accepts_partially_filled_items(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    partial = {
        **content_with_one_event(),
        "route_stops": [{"id": str(uuid4()), "place_label": "", "stay_from": None, "stay_to": None}],
        "accommodations": [{"id": str(uuid4()), "location": "Рядом с центром"}],
        "transport": [{"id": str(uuid4()), "origin": "Казань", "destination": None}],
        "days": [{
            "id": str(uuid4()), "date": None,
            "events": [{"id": str(uuid4()), "kind": "activity"}]
        }],
    }

    response = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": partial},
    )

    assert response.status_code == 200
    assert response.json()["version"] == 2
    assert response.json()["content"]["days"][0]["events"][0]["title"] == ""


def test_database_capability_rejects_null_base_version(client, database_url: str, runtime_database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    with psycopg.connect(runtime_database_url) as runtime:
        runtime.execute("SELECT set_config('app.user_id', %s, true)", (first["user"]["id"],))
        with pytest.raises(psycopg.Error) as error:
            runtime.execute(
                "SELECT * FROM public.save_current_trip_draft(%s, NULL, '{}'::jsonb)",
                (UUID(trip["trip_id"]),),
            )
        assert error.value.sqlstate == "22023"


def test_manual_draft_save_does_not_change_confirmed_trip_or_legacy_stops(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    with psycopg.connect(database_url) as owner:
        owner.execute(
            "INSERT INTO public.trip_stops (trip_id, position, place_label) VALUES (%s, 1, 'Москва')",
            (UUID(trip["trip_id"]),),
        )
        before = owner.execute(
            "SELECT status, state_version, date_from, date_to FROM public.trips WHERE id=%s",
            (UUID(trip["trip_id"]),),
        ).fetchone()

    assert client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content_with_one_event()},
    ).status_code == 200

    with psycopg.connect(database_url) as owner:
        after = owner.execute(
            "SELECT status, state_version, date_from, date_to FROM public.trips WHERE id=%s",
            (UUID(trip["trip_id"]),),
        ).fetchone()
        stops = owner.execute("SELECT place_label FROM public.trip_stops WHERE trip_id=%s", (UUID(trip["trip_id"]),)).fetchall()
    assert after == before
    assert stops == [("Москва",)]


def test_draft_and_alternative_accept_exact_database_jsonb_limit_and_use_bounded_reads(
    client, database_url: str
) -> None:
    first, second, _, trip = create_trip_context(client, database_url)
    content = content_at_database_jsonb_limit(database_url)

    saved = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": content},
    )
    assert saved.status_code == 200
    assert saved.json()["version"] == 2

    alternative = client.post(
        f"/trips/{trip['trip_id']}/draft/alternatives",
        headers=auth_headers(second["access_token"]),
        json={"title": "Большой вариант", "content": content},
    )
    assert alternative.status_code == 201
    assert "content" not in alternative.json()

    detail = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert detail.status_code == 200
    assert "history" not in detail.json()
    assert "content" not in detail.json()["alternatives"][0]
    alternative_id = detail.json()["alternatives"][0]["id"]

    opened = client.get(
        f"/trips/{trip['trip_id']}/draft/alternatives/{alternative_id}",
        headers=auth_headers(first["access_token"]),
    )
    assert opened.status_code == 200
    assert opened.json()["content"] == content
    assert client.get(
        f"/trips/{trip['trip_id']}/draft/alternatives/{alternative_id}",
        headers=auth_headers(create_discover_eligible_user(client, 3)["access_token"]),
    ).status_code == 404

    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_versions WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 2
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_alternatives WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 1


def test_oversized_draft_and_alternative_return_422_without_partial_records(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    oversized = content_at_database_jsonb_limit(database_url)
    oversized["days"][0]["events"][0]["notes"] += "x"

    draft_response = client.put(
        f"/trips/{trip['trip_id']}/draft",
        headers=auth_headers(first["access_token"]),
        json={"base_version": 1, "content": oversized},
    )
    assert draft_response.status_code == 422
    assert "256" in draft_response.json()["detail"]
    assert "SQLSTATE" not in draft_response.text

    alternative_response = client.post(
        f"/trips/{trip['trip_id']}/draft/alternatives",
        headers=auth_headers(first["access_token"]),
        json={"title": "Переполненный вариант", "content": oversized},
    )
    assert alternative_response.status_code == 422
    assert "256" in alternative_response.json()["detail"]
    assert "SQLSTATE" not in alternative_response.text

    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT version FROM public.trip_drafts WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 1
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_versions WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 1
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_alternatives WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 0


def test_alternative_limit_is_enforced_without_deleting_existing_snapshots(client, database_url: str) -> None:
    first, _, _, trip = create_trip_context(client, database_url)
    for index in range(19):
        response = client.post(
            f"/trips/{trip['trip_id']}/draft/alternatives",
            headers=auth_headers(first["access_token"]),
            json={"title": f"Вариант {index + 1}", "content": content_with_one_event()},
        )
        assert response.status_code == 201

    barrier = Barrier(3)

    def save_alternative(index: int):
        barrier.wait()
        return client.post(
            f"/trips/{trip['trip_id']}/draft/alternatives",
            headers=auth_headers(first["access_token"]),
            json={"title": f"Гонка {index}", "content": content_with_one_event()},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_save = executor.submit(save_alternative, 1)
        second_save = executor.submit(save_alternative, 2)
        barrier.wait()
        responses = [first_save.result(), second_save.result()]

    assert sorted(response.status_code for response in responses) == [201, 409]
    limited = client.get(f"/trips/{trip['trip_id']}/draft", headers=auth_headers(first["access_token"]))
    assert len(limited.json()["alternatives"]) == 20
    assert all("content" not in item for item in limited.json()["alternatives"])
    with psycopg.connect(database_url) as owner:
        assert owner.execute(
            "SELECT count(*) FROM public.trip_draft_alternatives WHERE trip_id=%s", (UUID(trip["trip_id"]),)
        ).fetchone()[0] == 20
