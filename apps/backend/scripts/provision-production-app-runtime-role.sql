-- Hosted Supabase production provisioning only. Run as an approved privileged
-- provisioning identity; this is not a Supabase migration and grants no runtime access.
--
-- psql prompts for the password with \password below. It sends an encrypted hash,
-- rather than embedding a password literal in this script or the SQL command text.
\set ON_ERROR_STOP on

BEGIN;

DO $provision$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'app_runtime'
      AND NOT (
        rolcanlogin
        AND NOT rolsuper
        AND NOT rolbypassrls
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolinherit
        AND NOT rolreplication
      )
  ) THEN
    RAISE EXCEPTION
      'app_runtime attributes do not match the required least-privilege configuration; refusing to alter the existing role on hosted Supabase'
      USING ERRCODE = '42501',
            HINT = 'Use an approved privileged remediation process; this script never modifies an existing app_runtime role.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION;
  END IF;
END
$provision$;

\password app_runtime

COMMIT;
