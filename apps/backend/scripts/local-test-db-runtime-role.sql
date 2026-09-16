-- Local disposable-test setup only. This file is deliberately not a Supabase migration:
-- hosted Supabase migration identities are not assumed to have CREATE ROLE privileges.
-- The application tables remain owned by the privileged migration/test owner.

DROP ROLE IF EXISTS app_runtime;
CREATE ROLE app_runtime
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

GRANT SELECT, INSERT ON TABLE public.users TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.telegram_identities TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO app_runtime;
GRANT INSERT ON TABLE public.user_settings TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_activity_states TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.travel_intents TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_sessions TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.discover_interest_decisions TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.matches TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chats TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_participants TO app_runtime;
GRANT SELECT, INSERT ON TABLE public.messages TO app_runtime;
GRANT SELECT, INSERT ON TABLE public.trips TO app_runtime;
GRANT SELECT, INSERT ON TABLE public.trip_participants TO app_runtime;
GRANT SELECT ON TABLE public.trip_stops TO app_runtime;

-- Future objects created by this migration/test owner receive no runtime grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM app_runtime;
