-- Local disposable-test setup only. This file is deliberately not a Supabase migration:
-- hosted Supabase migration identities are not assumed to have CREATE ROLE privileges.
-- The application tables remain owned by the privileged migration/test owner.

ALTER ROLE app_runtime
  LOGIN
  PASSWORD 'app_runtime_local_only'
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_runtime;

GRANT USAGE ON SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO app_runtime;
GRANT SELECT (user_id, onboarding_status) ON TABLE public.user_activity_states TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.travel_intents TO app_runtime;
GRANT EXECUTE ON FUNCTION public.current_authenticated_user_id() TO app_runtime;
-- UPDATE supports logout.
-- PostgreSQL requires SELECT(id) for logout's UPDATE ... WHERE id=%s, but this
-- is not table-level session reads. Their further narrowing is a separate slice.
-- Bearer resolution uses the function below.
GRANT UPDATE ON TABLE public.user_sessions TO app_runtime;
GRANT SELECT (id) ON TABLE public.user_sessions TO app_runtime;
GRANT SELECT (actor_user_id, target_user_id, decision) ON TABLE public.discover_interest_decisions TO app_runtime;
GRANT SELECT (id, user_a_id, user_b_id, chat_id) ON TABLE public.matches TO app_runtime;
GRANT SELECT (id, type, created_at, last_sequence) ON TABLE public.chats TO app_runtime;
GRANT SELECT (chat_id, user_id, left_at) ON TABLE public.chat_participants TO app_runtime;
GRANT SELECT (id, chat_id, sequence_number, type, sender_user_id,
  recipient_user_id, content_text, created_at) ON TABLE public.messages TO app_runtime;
GRANT SELECT ON TABLE public.trips TO app_runtime;
GRANT SELECT (trip_id, user_id, left_at) ON TABLE public.trip_participants TO app_runtime;
GRANT SELECT ON TABLE public.trip_stops TO app_runtime;
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
GRANT SELECT (system_event, proposal_id, proposal_trip_id) ON TABLE public.messages TO app_runtime;
GRANT SELECT (trip_id,id,name,location,date_from,date_to,notes) ON TABLE public.trip_confirmed_accommodations TO app_runtime;
GRANT SELECT (trip_id,id,mode,origin,destination,departure_at,arrival_at,notes) ON TABLE public.trip_confirmed_transport TO app_runtime;
GRANT SELECT (id,trip_id,creator_user_id,status,title,draft_version,deadline,blocked_reason,created_at,decided_at) ON TABLE public.trip_proposals TO app_runtime;
GRANT SELECT (proposal_id,scope_key,expected_version,old_value,proposed_value) ON TABLE public.trip_proposal_operations TO app_runtime;
GRANT SELECT (proposal_id,user_id,vote,voted_at) ON TABLE public.trip_proposal_voters TO app_runtime;
GRANT SELECT (proposal_id,prerequisite_proposal_id) ON TABLE public.trip_proposal_prerequisites TO app_runtime;
GRANT SELECT (trip_id,scope_key,version) ON TABLE public.trip_proposal_scope_versions TO app_runtime;
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

-- Future objects created by this migration/test owner receive no runtime grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM app_runtime;
