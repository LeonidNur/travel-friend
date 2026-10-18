-- Additive pre-auth capability for resolving a session with its verified
-- Telegram numeric identity. Keep resolve_bearer_session(text) unchanged for
-- existing callers and rollback compatibility.
CREATE FUNCTION public.resolve_bearer_session_with_identity(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, telegram_user_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.id AS session_id, s.user_id, identity.telegram_user_id
  FROM public.user_sessions AS s
  JOIN public.users AS u ON u.id = s.user_id
  JOIN public.telegram_identities AS identity ON identity.user_id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > pg_catalog.now()
    AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.resolve_bearer_session_with_identity(text) FROM PUBLIC;

-- Supabase API roles must not call this backend admission capability directly.
DO $do$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION public.resolve_bearer_session_with_identity(text) FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$do$;
