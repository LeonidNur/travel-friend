-- Read-only verification for the app_runtime grants catalog.
-- Run after grant-production-app-runtime-privileges.sql using the approved
-- Supabase provisioning identity. Result columns prefixed `is_` must all be true.
\set ON_ERROR_STOP on

-- Schema surface: runtime may resolve names but cannot create objects.
SELECT
  has_schema_privilege('app_runtime', 'public', 'USAGE') AS is_public_usage_granted,
  NOT has_schema_privilege('app_runtime', 'public', 'CREATE') AS is_public_create_absent;

-- Exact effective table operation surface. Resolve every table to its catalog
-- OID before checking privileges: a text relation name combined with a column
-- name from information_schema can be evaluated before that view's filters.
-- has_any_column_privilege includes both table and column ACLs, so column-only,
-- inherited and PUBLIC-derived operations remain visible.
WITH application_tables (table_name) AS (
  VALUES ('users'), ('telegram_identities'), ('profiles'), ('profile_photos'),
    ('user_settings'), ('user_activity_states'), ('travel_intents'),
    ('user_sessions'), ('discover_interest_decisions'), ('matches'), ('chats'),
    ('chat_participants'), ('messages'), ('chat_summaries'), ('trips'),
    ('trip_participants'), ('trip_stops')
), expected (table_name, privilege_type) AS (
  VALUES
    ('profiles', 'SELECT'), ('profiles', 'INSERT'), ('profiles', 'UPDATE'),
    ('user_activity_states', 'SELECT'), ('user_activity_states', 'UPDATE'),
    ('travel_intents', 'SELECT'), ('travel_intents', 'INSERT'), ('travel_intents', 'UPDATE'),
    ('user_sessions', 'SELECT'), ('user_sessions', 'UPDATE'),
    ('discover_interest_decisions', 'SELECT'), ('discover_interest_decisions', 'INSERT'), ('discover_interest_decisions', 'UPDATE'),
    ('matches', 'SELECT'), ('matches', 'INSERT'), ('matches', 'UPDATE'),
    ('chats', 'SELECT'), ('chats', 'INSERT'), ('chats', 'UPDATE'),
    ('chat_participants', 'SELECT'), ('chat_participants', 'INSERT'), ('chat_participants', 'UPDATE'),
    ('messages', 'SELECT'), ('messages', 'INSERT'),
    ('trips', 'SELECT'), ('trips', 'INSERT'),
    ('trip_participants', 'SELECT'), ('trip_participants', 'INSERT'),
    ('trip_stops', 'SELECT')
), operations (privilege_type, supports_column_privileges) AS (
  VALUES
    ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', false),
    ('TRUNCATE', false), ('REFERENCES', true), ('TRIGGER', false)
), application_relations AS (
  SELECT tables.table_name, relations.oid AS relation_oid
  FROM application_tables AS tables
  LEFT JOIN pg_namespace AS namespaces ON namespaces.nspname = 'public'
  LEFT JOIN pg_class AS relations ON relations.relnamespace = namespaces.oid
    AND relations.relname = tables.table_name AND relations.relkind IN ('r', 'p')
), effective_operations AS (
  SELECT
    relations.table_name,
    operations.privilege_type,
    relations.relation_oid IS NOT NULL AS table_exists,
    EXISTS (
      SELECT 1 FROM expected
      WHERE expected.table_name = relations.table_name
        AND expected.privilege_type = operations.privilege_type
    ) AS expected,
    COALESCE(
      has_table_privilege('app_runtime', relations.relation_oid, operations.privilege_type)
      OR CASE WHEN operations.supports_column_privileges THEN has_any_column_privilege(
        'app_runtime', relations.relation_oid, operations.privilege_type
      ) ELSE false END,
      false
    ) AS actual_effective
  FROM application_relations AS relations
  CROSS JOIN operations
)
SELECT
  table_name,
  privilege_type,
  table_exists,
  expected,
  actual_effective,
  table_exists AND expected = actual_effective AS is_exact
FROM effective_operations
ORDER BY table_name, privilege_type;

-- Exact column grants. The expected names are joined to the migrated catalog
-- before privilege inspection, so a stale schema assumption is a visible
-- failure instead of a silently omitted information_schema row.
WITH application_tables (table_name) AS (
  VALUES ('users'), ('telegram_identities'), ('profiles'), ('profile_photos'),
    ('user_settings'), ('user_activity_states'), ('travel_intents'),
    ('user_sessions'), ('discover_interest_decisions'), ('matches'), ('chats'),
    ('chat_participants'), ('messages'), ('chat_summaries'), ('trips'),
    ('trip_participants'), ('trip_stops')
), expected_column_privilege_groups (table_name, privilege_type, column_names) AS (
  VALUES
    ('profiles', 'SELECT', ARRAY['id', 'user_id', 'display_name', 'birth_date', 'gender', 'city', 'bio', 'travel_style', 'interests', 'budget_level', 'comfort_level', 'created_at', 'updated_at']),
    ('profiles', 'INSERT', ARRAY['user_id', 'display_name', 'birth_date', 'gender', 'city', 'bio', 'travel_style', 'interests', 'budget_level', 'comfort_level', 'updated_at']),
    ('profiles', 'UPDATE', ARRAY['display_name', 'birth_date', 'gender', 'city', 'bio', 'travel_style', 'interests', 'budget_level', 'comfort_level', 'updated_at']),
    ('user_activity_states', 'SELECT', ARRAY['user_id', 'onboarding_status', 'updated_at']),
    ('user_activity_states', 'UPDATE', ARRAY['onboarding_status', 'updated_at']),
    ('travel_intents', 'SELECT', ARRAY['id', 'user_id', 'destination_label', 'date_from', 'date_to', 'status', 'created_at', 'updated_at', 'archived_at']),
    ('travel_intents', 'INSERT', ARRAY['user_id', 'destination_label', 'date_from', 'date_to', 'status', 'updated_at']),
    ('travel_intents', 'UPDATE', ARRAY['destination_label', 'date_from', 'date_to', 'updated_at']),
    ('user_sessions', 'SELECT', ARRAY['id']),
    ('user_sessions', 'UPDATE', ARRAY['revoked_at']),
    ('discover_interest_decisions', 'SELECT', ARRAY['actor_user_id', 'target_user_id', 'decision']),
    ('discover_interest_decisions', 'INSERT', ARRAY['actor_user_id', 'target_user_id', 'decision']),
    ('discover_interest_decisions', 'UPDATE', ARRAY['id']),
    ('matches', 'SELECT', ARRAY['id', 'user_a_id', 'user_b_id', 'chat_id']),
    ('matches', 'INSERT', ARRAY['user_a_id', 'user_b_id']),
    ('matches', 'UPDATE', ARRAY['chat_id']),
    ('chats', 'SELECT', ARRAY['id', 'type', 'last_sequence', 'created_at']),
    ('chats', 'INSERT', ARRAY['type']),
    ('chats', 'UPDATE', ARRAY['last_sequence', 'updated_at']),
    ('chat_participants', 'SELECT', ARRAY['chat_id', 'user_id', 'left_at']),
    ('chat_participants', 'INSERT', ARRAY['chat_id', 'user_id']),
    ('chat_participants', 'UPDATE', ARRAY['id']),
    ('messages', 'SELECT', ARRAY['id', 'chat_id', 'sequence_number', 'type', 'sender_user_id', 'recipient_user_id', 'content_text', 'created_at']),
    ('messages', 'INSERT', ARRAY['chat_id', 'sender_user_id', 'recipient_user_id', 'sequence_number', 'type', 'content_text']),
    ('trips', 'SELECT', ARRAY['id', 'chat_id', 'created_by_user_id', 'status', 'membership_version', 'state_version', 'destination_version', 'dates_version', 'budget_version', 'transport_version', 'destination_status', 'dates_status', 'budget_status', 'transport_status', 'date_from', 'date_to', 'budget_min', 'budget_max', 'budget_currency', 'budget_scope', 'started_at', 'completed_at', 'cancelled_at', 'created_at', 'updated_at']),
    ('trips', 'INSERT', ARRAY['chat_id', 'created_by_user_id', 'status']),
    ('trip_participants', 'SELECT', ARRAY['trip_id', 'user_id', 'left_at']),
    ('trip_participants', 'INSERT', ARRAY['trip_id', 'user_id']),
    ('trip_stops', 'SELECT', ARRAY['id', 'trip_id', 'position', 'place_label', 'country_code', 'place_ref', 'stay_from', 'stay_to', 'notes', 'created_at', 'updated_at'])
), expected_column_privileges AS (
  SELECT table_name, privilege_type, unnest(column_names) AS column_name
  FROM expected_column_privilege_groups
), catalog_columns AS (
  SELECT tables.table_name, relations.oid AS relation_oid, attributes.attnum, attributes.attname AS column_name
  FROM application_tables AS tables
  LEFT JOIN pg_namespace AS namespaces ON namespaces.nspname = 'public'
  LEFT JOIN pg_class AS relations ON relations.relnamespace = namespaces.oid
    AND relations.relname = tables.table_name AND relations.relkind IN ('r', 'p')
  LEFT JOIN pg_attribute AS attributes ON attributes.attrelid = relations.oid
    AND attributes.attnum > 0 AND NOT attributes.attisdropped
), column_operations (privilege_type) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE')
), actual_column_operations AS (
  SELECT catalog_columns.table_name, catalog_columns.relation_oid, catalog_columns.attnum,
    catalog_columns.column_name, column_operations.privilege_type
  FROM catalog_columns
  CROSS JOIN column_operations
  WHERE catalog_columns.column_name IS NOT NULL
)
SELECT
  COALESCE(expected.table_name, actual.table_name) AS table_name,
  COALESCE(expected.column_name, actual.column_name) AS column_name,
  COALESCE(expected.privilege_type, actual.privilege_type) AS privilege_type,
  actual.column_name IS NOT NULL AS column_exists,
  COALESCE(has_column_privilege(
    'app_runtime', actual.relation_oid, actual.attnum, actual.privilege_type
  ), false) AS actual_granted,
  (
    (expected.column_name IS NOT NULL) =
    COALESCE(has_column_privilege(
      'app_runtime', actual.relation_oid, actual.attnum, actual.privilege_type
    ), false)
  ) AND (actual.column_name IS NOT NULL) AS is_exact
FROM expected_column_privileges AS expected
FULL JOIN actual_column_operations AS actual ON actual.table_name = expected.table_name
  AND actual.column_name = expected.column_name
  AND actual.privilege_type = expected.privilege_type
ORDER BY table_name, privilege_type, column_name;

-- No project-created sequences exist in the approved migrations. This catches
-- any effective sequence privilege should one appear later.
SELECT
  sequences.relname AS sequence_name,
  privilege_type,
  has_sequence_privilege('app_runtime', sequences.oid, privilege_type) AS unexpected_effective_privilege,
  NOT has_sequence_privilege('app_runtime', sequences.oid, privilege_type) AS is_absent
FROM pg_class AS sequences
JOIN pg_namespace AS namespaces ON namespaces.oid = sequences.relnamespace
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS operations(privilege_type)
WHERE namespaces.nspname = 'public' AND sequences.relkind = 'S'
ORDER BY sequences.relname, privilege_type;

-- All required bootstrap, resolver and RLS projection capabilities are usable.
WITH capability_signatures (function_signature) AS (
  VALUES
    ('public.current_authenticated_user_id()'),
    ('public.resolve_bearer_session(text)'),
    ('public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
    ('public.discover_eligible_travel_intents()'),
    ('public.archive_current_active_travel_intent()'),
    ('public.discover_candidate_profile_projection()'),
    ('public.discover_target_is_eligible(uuid)'),
    ('public.chat_participant_profile_projection(uuid)'),
    ('public.trip_participant_profile_projection(uuid)')
), required_capabilities AS (
  SELECT function_signature, to_regprocedure(function_signature) AS function_oid
  FROM capability_signatures
)
SELECT
  function_signature,
  has_function_privilege('app_runtime', function_oid, 'EXECUTE') AS execute_granted,
  has_function_privilege('app_runtime', function_oid, 'EXECUTE') AS is_expected
FROM required_capabilities
ORDER BY function_signature;

-- This is an effective-rights check, not merely a direct ACL inspection. Any
-- row is a failure: a PUBLIC grant or role membership is still executable by
-- app_runtime and must be resolved separately before production cutover.
WITH capability_signatures (function_signature) AS (
  VALUES
    ('public.current_authenticated_user_id()'),
    ('public.resolve_bearer_session(text)'),
    ('public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)'),
    ('public.discover_eligible_travel_intents()'),
    ('public.archive_current_active_travel_intent()'),
    ('public.discover_candidate_profile_projection()'),
    ('public.discover_target_is_eligible(uuid)'),
    ('public.chat_participant_profile_projection(uuid)'),
    ('public.trip_participant_profile_projection(uuid)')
), required_capabilities AS (
  SELECT function_signature, to_regprocedure(function_signature) AS function_oid
  FROM capability_signatures
)
SELECT
  format('public.%I(%s)', procedures.proname, pg_get_function_identity_arguments(procedures.oid)) AS unexpected_function_signature,
  has_function_privilege('app_runtime', procedures.oid, 'EXECUTE') AS unexpected_execute
FROM pg_proc AS procedures
JOIN pg_namespace AS namespaces ON namespaces.oid = procedures.pronamespace
WHERE namespaces.nspname = 'public'
  AND procedures.prokind = 'f'
  AND has_function_privilege('app_runtime', procedures.oid, 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM required_capabilities
    WHERE required_capabilities.function_oid = procedures.oid
  )
ORDER BY unexpected_function_signature;

-- app_runtime must remain a non-owner without RLS bypass capability.
WITH application_tables (table_name) AS (
  VALUES ('users'), ('telegram_identities'), ('profiles'), ('profile_photos'),
    ('user_settings'), ('user_activity_states'), ('travel_intents'),
    ('user_sessions'), ('discover_interest_decisions'), ('matches'), ('chats'),
    ('chat_participants'), ('messages'), ('chat_summaries'), ('trips'),
    ('trip_participants'), ('trip_stops')
)
SELECT
  tables.table_name,
  roles.rolname AS owner_role,
  COALESCE(roles.rolname <> 'app_runtime', false) AS is_not_owned_by_app_runtime
FROM application_tables AS tables
LEFT JOIN pg_namespace AS namespaces ON namespaces.nspname = 'public'
LEFT JOIN pg_class AS relations ON relations.relnamespace = namespaces.oid
  AND relations.relname = tables.table_name AND relations.relkind IN ('r', 'p')
LEFT JOIN pg_roles AS roles ON roles.oid = relations.relowner
ORDER BY tables.table_name;

SELECT
  NOT roles.rolbypassrls AS is_nobypassrls,
  NOT roles.rolsuper AS is_nosuperuser,
  NOT roles.rolcreaterole AS is_nocreaterole,
  NOT roles.rolcreatedb AS is_nocreatedb,
  NOT roles.rolreplication AS is_noreplication
FROM pg_roles AS roles
WHERE roles.rolname = 'app_runtime';
