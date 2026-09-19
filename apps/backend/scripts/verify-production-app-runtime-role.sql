-- Read-only hosted Supabase production verification for app_runtime.
-- Run as the same approved provisioning identity after role provisioning, migrations,
-- and the separately approved grants step.
\set ON_ERROR_STOP on

SELECT current_user, session_user;

SELECT
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') AS app_runtime_exists,
  COALESCE((SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_runtime'), false) AS login,
  COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = 'app_runtime'), false) AS superuser,
  COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'), false) AS bypassrls,
  COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname = 'app_runtime'), false) AS createrole,
  COALESCE((SELECT rolcreatedb FROM pg_roles WHERE rolname = 'app_runtime'), false) AS createdb,
  COALESCE((SELECT rolinherit FROM pg_roles WHERE rolname = 'app_runtime'), false) AS inherit,
  COALESCE((SELECT rolreplication FROM pg_roles WHERE rolname = 'app_runtime'), false) AS replication;

WITH application_tables (table_name) AS (
  VALUES
    ('users'),
    ('telegram_identities'),
    ('profiles'),
    ('profile_photos'),
    ('user_settings'),
    ('user_activity_states'),
    ('travel_intents'),
    ('user_sessions'),
    ('discover_interest_decisions'),
    ('matches'),
    ('chats'),
    ('chat_participants'),
    ('messages'),
    ('chat_summaries'),
    ('trips'),
    ('trip_participants'),
    ('trip_stops')
)
SELECT
  application_tables.table_name,
  COALESCE(owner_role.rolname, '<missing>') AS owner,
  COALESCE(owner_role.rolname = 'app_runtime', false) AS owned_by_app_runtime
FROM application_tables
LEFT JOIN pg_namespace AS namespace
  ON namespace.nspname = 'public'
LEFT JOIN pg_class AS relation
  ON relation.relnamespace = namespace.oid
  AND relation.relname = application_tables.table_name
  AND relation.relkind IN ('r', 'p')
LEFT JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
ORDER BY application_tables.table_name;

SELECT
  member_role.rolname AS app_runtime_can_set_role_to
FROM pg_auth_members AS membership
JOIN pg_roles AS member_role ON member_role.oid = membership.roleid
JOIN pg_roles AS runtime_role ON runtime_role.oid = membership.member
WHERE runtime_role.rolname = 'app_runtime'
ORDER BY member_role.rolname;
