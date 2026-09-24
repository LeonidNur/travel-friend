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
GRANT SELECT (id, type, created_at) ON TABLE public.chats TO app_runtime;
GRANT SELECT (chat_id, user_id, left_at) ON TABLE public.chat_participants TO app_runtime;
GRANT SELECT (id, chat_id, sequence_number, type, sender_user_id,
  recipient_user_id, content_text, created_at) ON TABLE public.messages TO app_runtime;
GRANT SELECT ON TABLE public.trips TO app_runtime;
GRANT SELECT (trip_id, user_id, left_at) ON TABLE public.trip_participants TO app_runtime;
GRANT SELECT ON TABLE public.trip_stops TO app_runtime;
GRANT EXECUTE ON FUNCTION public.resolve_bearer_session(text) TO app_runtime;
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
GRANT EXECUTE ON FUNCTION public.trip_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_current_discover_decision(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.is_current_active_chat_participant(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_group_chat(uuid[]) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.is_current_active_trip_participant(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.create_current_trip_from_chat(uuid) TO app_runtime;

-- Future objects created by this migration/test owner receive no runtime grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM app_runtime;
