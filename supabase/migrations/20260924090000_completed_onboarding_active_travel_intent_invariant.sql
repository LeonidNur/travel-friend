-- Completed onboarding requires an active TravelIntent. Both this archive
-- capability and completion serialize through the same activity-state row.
CREATE OR REPLACE FUNCTION public.archive_current_active_travel_intent()
RETURNS boolean
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
    RETURN false;
  END IF;

  SELECT activity.onboarding_status
  INTO v_onboarding_status
  FROM public.user_activity_states AS activity
  WHERE activity.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_onboarding_status = 'completed'
    AND EXISTS (
      SELECT 1
      FROM public.travel_intents AS travel_intent
      WHERE travel_intent.user_id = v_user_id
        AND travel_intent.status = 'active'
    ) THEN
    RAISE EXCEPTION 'completed onboarding requires an active travel intent'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.travel_intents
  SET status = 'archived',
      archived_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE user_id = v_user_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_current_active_travel_intent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_current_active_travel_intent() TO app_runtime;
