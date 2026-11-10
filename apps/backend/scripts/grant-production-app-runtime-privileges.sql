-- Production grants for the already-provisioned app_runtime role.
--
-- Run after the approved Chat RLS migration as the approved Supabase
-- provisioning identity. This script intentionally does not create or alter a
-- role, modify RLS/policies/ownership/default privileges, or grant to PUBLIC.
-- Function PUBLIC hardening belongs to the migrations; this script resets
-- app_runtime's direct table/function rights to the approved exact surface.
-- Each REVOKE/GRANT is idempotent and is limited to the current application
-- object catalog.
\set ON_ERROR_STOP on

REVOKE ALL PRIVILEGES ON SCHEMA public FROM app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- Reset explicit rights on the audited application tables before granting the
-- exact column surface required by the current backend.
REVOKE ALL PRIVILEGES ON TABLE public.users FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.telegram_identities FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.profile_photos FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.user_settings FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.user_activity_states FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.travel_intents FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.user_sessions FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.discover_interest_decisions FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.matches FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.chats FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.chat_participants FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.messages FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.chat_summaries FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trips FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_participants FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_stops FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_itinerary_days FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_itinerary_events FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_drafts FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_draft_versions FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_draft_alternatives FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_confirmed_accommodations FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_confirmed_transport FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_proposals FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_proposal_operations FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_proposal_voters FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_proposal_prerequisites FROM app_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.trip_proposal_scope_versions FROM app_runtime;

GRANT SELECT (id, user_id, display_name, birth_date, gender, city, bio,
  travel_style, interests, budget_level, comfort_level, created_at, updated_at)
  ON TABLE public.profiles TO app_runtime;
GRANT INSERT (user_id, display_name, birth_date, gender, city, bio,
  travel_style, interests, budget_level, comfort_level, updated_at)
  ON TABLE public.profiles TO app_runtime;
GRANT UPDATE (display_name, birth_date, gender, city, bio, travel_style,
  interests, budget_level, comfort_level, updated_at)
  ON TABLE public.profiles TO app_runtime;

GRANT SELECT (user_id, onboarding_status) ON TABLE public.user_activity_states TO app_runtime;

GRANT SELECT (id, user_id, destination_label, date_from, date_to, status,
  created_at, updated_at, archived_at) ON TABLE public.travel_intents TO app_runtime;
GRANT INSERT (user_id, destination_label, date_from, date_to, status, updated_at)
  ON TABLE public.travel_intents TO app_runtime;
GRANT UPDATE (destination_label, date_from, date_to, updated_at)
  ON TABLE public.travel_intents TO app_runtime;

-- Logout needs the predicate column and no readable session material.
GRANT SELECT (id) ON TABLE public.user_sessions TO app_runtime;
GRANT UPDATE (revoked_at) ON TABLE public.user_sessions TO app_runtime;

GRANT SELECT (actor_user_id, target_user_id, decision)
  ON TABLE public.discover_interest_decisions TO app_runtime;

GRANT SELECT (id, user_a_id, user_b_id, chat_id) ON TABLE public.matches TO app_runtime;

GRANT SELECT (id, type, created_at, last_sequence) ON TABLE public.chats TO app_runtime;

GRANT SELECT (chat_id, user_id, left_at) ON TABLE public.chat_participants TO app_runtime;

GRANT SELECT (id, chat_id, sequence_number, type, sender_user_id,
  recipient_user_id, content_text, created_at, system_event, proposal_id,
  proposal_trip_id) ON TABLE public.messages TO app_runtime;

GRANT SELECT (id, chat_id, created_by_user_id, status, membership_version,
  state_version, destination_version, dates_version, budget_version,
  transport_version, destination_status, dates_status, budget_status,
  transport_status, date_from, date_to, budget_min, budget_max,
  budget_currency, budget_scope, started_at, completed_at, cancelled_at,
  created_at, updated_at) ON TABLE public.trips TO app_runtime;

GRANT SELECT (trip_id, user_id, left_at) ON TABLE public.trip_participants TO app_runtime;

GRANT SELECT (id, trip_id, position, place_label, country_code, place_ref,
  stay_from, stay_to, notes, created_at, updated_at)
  ON TABLE public.trip_stops TO app_runtime;

GRANT SELECT (id, trip_id, position, day_date, title, notes, created_at, updated_at)
  ON TABLE public.trip_itinerary_days TO app_runtime;
GRANT SELECT (id, trip_id, day_id, position, kind, title, start_time,
  duration_minutes, address, estimated_cost, currency, notes, created_at, updated_at)
  ON TABLE public.trip_itinerary_events TO app_runtime;
GRANT SELECT (trip_id, version, content, updated_by_user_id, created_at, updated_at)
  ON TABLE public.trip_drafts TO app_runtime;
GRANT SELECT (trip_id, version, content, author_user_id, created_at)
  ON TABLE public.trip_draft_versions TO app_runtime;
GRANT SELECT (id, trip_id, title, content, created_by_user_id, created_at)
  ON TABLE public.trip_draft_alternatives TO app_runtime;
GRANT SELECT (trip_id, id, name, location, date_from, date_to, notes)
  ON TABLE public.trip_confirmed_accommodations TO app_runtime;
GRANT SELECT (trip_id, id, mode, origin, destination, departure_at, arrival_at, notes)
  ON TABLE public.trip_confirmed_transport TO app_runtime;
GRANT SELECT (id, trip_id, creator_user_id, status, title, draft_version, deadline,
  blocked_reason, created_at, decided_at) ON TABLE public.trip_proposals TO app_runtime;
GRANT SELECT (proposal_id, scope_key, expected_version, old_value, proposed_value)
  ON TABLE public.trip_proposal_operations TO app_runtime;
GRANT SELECT (proposal_id, user_id, vote, voted_at) ON TABLE public.trip_proposal_voters TO app_runtime;
GRANT SELECT (proposal_id, prerequisite_proposal_id) ON TABLE public.trip_proposal_prerequisites TO app_runtime;
GRANT SELECT (trip_id, scope_key, version) ON TABLE public.trip_proposal_scope_versions TO app_runtime;

-- UUID primary keys use gen_random_uuid(); current migrations define no
-- application sequence, so this script intentionally grants no sequence rights.

REVOKE ALL PRIVILEGES ON FUNCTION public.current_authenticated_user_id() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_bearer_session(text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_bearer_session_with_identity(text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_bearer_session_with_identity(text) FROM anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text
) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text, timestamptz, timestamptz
) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_eligible_travel_intents() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.archive_current_active_travel_intent() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_current_onboarding() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_candidate_profile_projection() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_target_is_eligible(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.chat_participant_profile_projection(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.chat_participant_public_profile(uuid,uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.trip_participant_profile_projection(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.record_current_discover_decision(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_current_active_chat_participant(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_current_group_chat(uuid[]) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_current_group_chat(uuid[], text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.rename_current_group_chat(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.send_current_chat_message(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.send_current_chat_message(uuid, text, uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.mark_current_chat_read(uuid, bigint) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.chat_list_projection() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_current_active_trip_participant(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_current_trip_from_chat(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.save_current_trip_draft(uuid, integer, jsonb) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.save_current_trip_draft_alternative(uuid, text, jsonb) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_current_trip_proposal(uuid, integer, text, uuid, text[], uuid[], timestamptz) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.cast_current_trip_proposal_vote(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_current_trip_proposal(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.refresh_current_trip_proposals(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.trip_proposal_scopes_overlap(text, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_trip_proposal_immutable_fields() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_trip_proposal_operation_immutable() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_trip_proposal_vote_immutable() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.append_trip_proposal_chat_event(uuid, uuid, uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.trip_proposal_scope_version(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_trip_proposal_itinerary_versions(uuid, text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.capture_trip_proposal_value(uuid, text, jsonb, boolean) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.apply_trip_proposal(uuid) FROM app_runtime;

GRANT EXECUTE ON FUNCTION public.current_authenticated_user_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.resolve_bearer_session(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.resolve_bearer_session_with_identity(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text
) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text, timestamptz, timestamptz
) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_eligible_travel_intents() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.archive_current_active_travel_intent() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.complete_current_onboarding() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_candidate_profile_projection() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_target_is_eligible(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_participant_public_profile(uuid,uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.trip_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_current_discover_decision(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.is_current_active_chat_participant(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_group_chat(uuid[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_group_chat(uuid[], text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.rename_current_group_chat(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.mark_current_chat_read(uuid, bigint) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_list_projection() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.is_current_active_trip_participant(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_trip_from_chat(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.save_current_trip_draft(uuid, integer, jsonb) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.save_current_trip_draft_alternative(uuid, text, jsonb) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_trip_proposal(uuid, integer, text, uuid, text[], uuid[], timestamptz) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cast_current_trip_proposal_vote(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_current_trip_proposal(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.refresh_current_trip_proposals(uuid) TO app_runtime;
