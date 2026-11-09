"""Pure readiness checks for validating Draft data before confirmation."""

from travel_friend_backend.schemas.trip_drafts import TripDraftContent, TripDraftReadinessIssue


def validate_trip_draft_fragment_for_confirmation(
    content: TripDraftContent,
) -> tuple[TripDraftReadinessIssue, ...]:
    """Return structural blockers without changing Draft or confirmed Trip data."""
    issues: list[TripDraftReadinessIssue] = []
    for day_index, day in enumerate(content.days):
        for event_index, event in enumerate(day.events):
            if not event.title.strip():
                issues.append(TripDraftReadinessIssue(
                    path=f"days[{day_index}].events[{event_index}].title",
                    code="event_title_required",
                    message="У события должно быть название перед подтверждением.",
                ))
    return tuple(issues)
