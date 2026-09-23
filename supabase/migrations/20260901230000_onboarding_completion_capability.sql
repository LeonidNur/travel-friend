-- Completion is the only persisted onboarding transition available to the
-- non-owner runtime role. The caller identity comes exclusively from the
-- transaction-local authenticated context set by FastAPI.
CREATE FUNCTION public.complete_current_onboarding()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_onboarding_status text;
BEGIN
  v_user_id := public.current_authenticated_user_id();
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT activity.onboarding_status
  INTO v_onboarding_status
  FROM public.user_activity_states AS activity
  WHERE activity.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_onboarding_status = 'completed' THEN
    RETURN v_onboarding_status;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = v_user_id)
    OR NOT EXISTS (
      SELECT 1
      FROM public.travel_intents AS travel_intent
      WHERE travel_intent.user_id = v_user_id
        AND travel_intent.status = 'active'
    ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.user_activity_states
  SET onboarding_status = 'completed',
      updated_at = pg_catalog.now()
  WHERE user_id = v_user_id
    AND onboarding_status IN ('not_started', 'in_progress')
  RETURNING onboarding_status INTO v_onboarding_status;

  RETURN v_onboarding_status;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_current_onboarding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_current_onboarding() TO app_runtime;
