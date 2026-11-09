"""Pure readiness validation coverage for future Trip confirmation flows."""

from copy import deepcopy
from uuid import uuid4

from travel_friend_backend.schemas.trip_drafts import TripDraftContent
from travel_friend_backend.trip_draft_readiness import validate_trip_draft_fragment_for_confirmation


def test_blank_event_title_is_valid_draft_but_not_ready_for_confirmation() -> None:
    payload = {
        "days": [{
            "id": str(uuid4()),
            "events": [{"id": str(uuid4()), "kind": "activity"}],
        }],
    }
    draft = TripDraftContent.model_validate(payload)
    before = deepcopy(draft.model_dump(mode="json"))

    issues = validate_trip_draft_fragment_for_confirmation(draft)

    assert [issue.model_dump() for issue in issues] == [{
        "path": "days[0].events[0].title",
        "code": "event_title_required",
        "message": "У события должно быть название перед подтверждением.",
    }]
    assert draft.model_dump(mode="json") == before


def test_nonblank_event_title_has_no_confirmation_readiness_issues() -> None:
    draft = TripDraftContent.model_validate({
        "days": [{
            "id": str(uuid4()),
            "events": [{"id": str(uuid4()), "kind": "activity", "title": "  Музей  "}],
        }],
    })

    assert validate_trip_draft_fragment_for_confirmation(draft) == ()
