-- Production grants for the already-provisioned app_runtime role.
--
-- Run after migrations through 20260901200000 as the approved Supabase
-- provisioning identity. This script intentionally does not create or alter a
-- role, modify RLS/policies/ownership/default privileges, or grant to PUBLIC.
-- It only removes PostgreSQL's default PUBLIC EXECUTE from the two internal
-- trigger functions so app_runtime's effective capability surface is exact.
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

GRANT SELECT (id, type, last_sequence, created_at) ON TABLE public.chats TO app_runtime;
GRANT INSERT (type) ON TABLE public.chats TO app_runtime;
GRANT UPDATE (last_sequence, updated_at) ON TABLE public.chats TO app_runtime;

GRANT SELECT (chat_id, user_id, left_at) ON TABLE public.chat_participants TO app_runtime;
GRANT INSERT (chat_id, user_id) ON TABLE public.chat_participants TO app_runtime;
-- Trip creation locks current participants with SELECT ... FOR SHARE.
GRANT UPDATE (id) ON TABLE public.chat_participants TO app_runtime;

GRANT SELECT (id, chat_id, sequence_number, type, sender_user_id,
  recipient_user_id, content_text, created_at) ON TABLE public.messages TO app_runtime;
GRANT INSERT (chat_id, sender_user_id, recipient_user_id, sequence_number, type, content_text)
  ON TABLE public.messages TO app_runtime;

GRANT SELECT (id, chat_id, created_by_user_id, status, membership_version,
  state_version, destination_version, dates_version, budget_version,
  transport_version, destination_status, dates_status, budget_status,
  transport_status, date_from, date_to, budget_min, budget_max,
  budget_currency, budget_scope, started_at, completed_at, cancelled_at,
  created_at, updated_at) ON TABLE public.trips TO app_runtime;
GRANT INSERT (chat_id, created_by_user_id, status) ON TABLE public.trips TO app_runtime;

GRANT SELECT (trip_id, user_id, left_at) ON TABLE public.trip_participants TO app_runtime;
GRANT INSERT (trip_id, user_id) ON TABLE public.trip_participants TO app_runtime;

GRANT SELECT (id, trip_id, position, place_label, country_code, place_ref,
  stay_from, stay_to, notes, created_at, updated_at)
  ON TABLE public.trip_stops TO app_runtime;

-- UUID primary keys use gen_random_uuid(); current migrations define no
-- application sequence, so this script intentionally grants no sequence rights.

REVOKE ALL PRIVILEGES ON FUNCTION public.current_authenticated_user_id() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.resolve_bearer_session(text) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text, timestamptz, timestamptz
) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_eligible_travel_intents() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.archive_current_active_travel_intent() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_current_onboarding() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_candidate_profile_projection() FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.discover_target_is_eligible(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.chat_participant_profile_projection(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.trip_participant_profile_projection(uuid) FROM app_runtime;
REVOKE ALL PRIVILEGES ON FUNCTION public.record_current_discover_decision(uuid, text) FROM app_runtime;

GRANT EXECUTE ON FUNCTION public.current_authenticated_user_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.resolve_bearer_session(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text, timestamptz, timestamptz
) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_eligible_travel_intents() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.archive_current_active_travel_intent() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.complete_current_onboarding() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_candidate_profile_projection() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_target_is_eligible(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.trip_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_current_discover_decision(uuid, text) TO app_runtime;
