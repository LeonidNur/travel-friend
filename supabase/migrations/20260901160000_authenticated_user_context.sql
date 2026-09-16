-- Future RLS policies can read the transaction-local identity set by FastAPI.
-- No RLS or policy is enabled in this migration.
CREATE OR REPLACE FUNCTION public.current_authenticated_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  configured_user_id text;
BEGIN
  configured_user_id := current_setting('app.user_id', true);
  IF configured_user_id IS NULL OR btrim(configured_user_id) = '' THEN
    RETURN NULL;
  END IF;

  RETURN configured_user_id::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.current_authenticated_user_id() FROM PUBLIC;
