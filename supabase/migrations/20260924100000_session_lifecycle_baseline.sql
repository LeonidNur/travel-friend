-- Session lifecycle baseline: PostgreSQL owns the absolute session lifetime.
-- The six-argument function is canonical. The legacy overload remains only
-- during backend deployment compatibility and deliberately ignores timestamps.
CREATE FUNCTION public.bootstrap_telegram_login(
  p_telegram_user_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_token_hash text
)
RETURNS TABLE (
  user_id uuid,
  onboarding_status text,
  profile_exists boolean,
  travel_intent_exists boolean,
  is_deleted boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_deleted_at timestamptz;
  v_session_created_at timestamptz;
  v_session_expires_at timestamptz;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
    RAISE EXCEPTION 'telegram user id must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'token hash must be a SHA-256 hex digest' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(p_telegram_user_id);

  SELECT ti.user_id, u.deleted_at
  INTO v_user_id, v_deleted_at
  FROM public.telegram_identities AS ti
  JOIN public.users AS u ON u.id = ti.user_id
  WHERE ti.telegram_user_id = p_telegram_user_id;

  IF FOUND AND v_deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::boolean, NULL::boolean, true, NULL::timestamptz;
    RETURN;
  ELSIF FOUND THEN
    UPDATE public.telegram_identities
    SET username = p_username,
        first_name = p_first_name,
        last_name = p_last_name,
        language_code = p_language_code,
        updated_at = pg_catalog.now()
    WHERE telegram_user_id = p_telegram_user_id;
  ELSE
    INSERT INTO public.users DEFAULT VALUES
    RETURNING id INTO v_user_id;

    INSERT INTO public.telegram_identities (
      user_id,
      telegram_user_id,
      username,
      first_name,
      last_name,
      language_code
    ) VALUES (
      v_user_id,
      p_telegram_user_id,
      p_username,
      p_first_name,
      p_last_name,
      p_language_code
    );
  END IF;

  INSERT INTO public.user_settings (user_id)
  VALUES (v_user_id)
  ON CONFLICT ON CONSTRAINT user_settings_pkey DO NOTHING;

  INSERT INTO public.user_activity_states (user_id, onboarding_status)
  VALUES (v_user_id, 'not_started')
  ON CONFLICT ON CONSTRAINT user_activity_states_pkey DO NOTHING;

  v_session_created_at := pg_catalog.now();
  v_session_expires_at := v_session_created_at + INTERVAL '30 days';

  INSERT INTO public.user_sessions (user_id, token_hash, created_at, expires_at)
  VALUES (v_user_id, p_token_hash, v_session_created_at, v_session_expires_at);

  RETURN QUERY
  SELECT
    v_user_id,
    activity.onboarding_status,
    EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = v_user_id),
    EXISTS (
      SELECT 1
      FROM public.travel_intents AS travel_intent
      WHERE travel_intent.user_id = v_user_id
        AND travel_intent.status = 'active'
    ),
    false,
    v_session_expires_at
  FROM public.user_activity_states AS activity
  WHERE activity.user_id = v_user_id;
END;
$$;

-- Keep old production backends operating during expand/contract deployment.
-- p_created_at and p_expires_at are intentionally unused.
CREATE OR REPLACE FUNCTION public.bootstrap_telegram_login(
  p_telegram_user_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_token_hash text,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
RETURNS TABLE (
  user_id uuid,
  onboarding_status text,
  profile_exists boolean,
  travel_intent_exists boolean,
  is_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    canonical.user_id,
    canonical.onboarding_status,
    canonical.profile_exists,
    canonical.travel_intent_exists,
    canonical.is_deleted
  FROM public.bootstrap_telegram_login(
    p_telegram_user_id,
    p_username,
    p_first_name,
    p_last_name,
    p_language_code,
    p_token_hash
  ) AS canonical;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_telegram_login(bigint, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_telegram_login(
  bigint, text, text, text, text, text, timestamptz, timestamptz
) FROM PUBLIC;
