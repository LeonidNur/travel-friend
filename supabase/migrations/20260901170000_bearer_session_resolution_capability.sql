-- Pre-auth bootstrap capability for resolving a hashed active Bearer session.
-- The migration identity owns this SECURITY DEFINER function; app_runtime receives
-- EXECUTE only from the disposable runtime-role setup where that local role exists.
CREATE FUNCTION public.resolve_bearer_session(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.id AS session_id, s.user_id
  FROM public.user_sessions AS s
  JOIN public.users AS u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > pg_catalog.now()
    AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.resolve_bearer_session(text) FROM PUBLIC;
