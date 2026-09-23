ALTER TABLE public.discover_interest_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY discover_interest_decisions_select_own
  ON public.discover_interest_decisions
  FOR SELECT
  TO app_runtime
  USING (actor_user_id = public.current_authenticated_user_id());

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY matches_select_participant
  ON public.matches
  FOR SELECT
  TO app_runtime
  USING (
    user_a_id = public.current_authenticated_user_id()
    OR user_b_id = public.current_authenticated_user_id()
  );

CREATE FUNCTION public.record_current_discover_decision(
  p_target_user_id uuid,
  p_decision text
)
RETURNS TABLE (decision text, match_created boolean, match_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_user_a_id uuid;
  v_user_b_id uuid;
  v_existing_decision text;
  v_match_id uuid;
  v_match_chat_id uuid;
  v_chat_id uuid;
  v_match_created boolean := false;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL OR p_target_user_id = v_actor_user_id THEN
    RAISE EXCEPTION 'cannot decide about the current user' USING ERRCODE = '22023';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('interested', 'rejected') THEN
    RAISE EXCEPTION 'invalid discover decision' USING ERRCODE = '22023';
  END IF;

  SELECT LEAST(v_actor_user_id, p_target_user_id), GREATEST(v_actor_user_id, p_target_user_id)
    INTO v_user_a_id, v_user_b_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_a_id::text || ':' || v_user_b_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_activity_states AS activity
    JOIN public.profiles AS profile ON profile.user_id = activity.user_id
    JOIN public.travel_intents AS intent
      ON intent.user_id = activity.user_id AND intent.status = 'active'
    WHERE activity.user_id = v_actor_user_id AND activity.onboarding_status = 'completed'
  ) THEN
    RAISE EXCEPTION 'discover requester is ineligible' USING ERRCODE = '42501';
  END IF;

  SELECT existing.decision
    INTO v_existing_decision
  FROM public.discover_interest_decisions AS existing
  WHERE existing.actor_user_id = v_actor_user_id AND existing.target_user_id = p_target_user_id
  FOR UPDATE;

  IF v_existing_decision IS NOT NULL AND v_existing_decision <> p_decision THEN
    RAISE EXCEPTION 'discover decision is final' USING ERRCODE = '23505';
  END IF;

  IF v_existing_decision IS NULL THEN
    IF NOT public.discover_target_is_eligible(p_target_user_id) THEN
      RAISE EXCEPTION 'discover target not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.discover_interest_decisions (actor_user_id, target_user_id, decision)
    VALUES (v_actor_user_id, p_target_user_id, p_decision);
  END IF;

  IF p_decision = 'interested' THEN
    SELECT matched.id, matched.chat_id
      INTO v_match_id, v_match_chat_id
    FROM public.matches AS matched
    WHERE matched.user_a_id = v_user_a_id AND matched.user_b_id = v_user_b_id;

    IF v_match_id IS NULL AND EXISTS (
      SELECT 1
      FROM public.discover_interest_decisions AS reciprocal
      WHERE reciprocal.actor_user_id = p_target_user_id
        AND reciprocal.target_user_id = v_actor_user_id
        AND reciprocal.decision = 'interested'
    ) THEN
      INSERT INTO public.matches (user_a_id, user_b_id)
      VALUES (v_user_a_id, v_user_b_id)
      ON CONFLICT (user_a_id, user_b_id) DO NOTHING
      RETURNING id, chat_id INTO v_match_id, v_match_chat_id;
      v_match_created := FOUND;
      IF v_match_id IS NULL THEN
        SELECT matched.id, matched.chat_id
          INTO v_match_id, v_match_chat_id
        FROM public.matches AS matched
        WHERE matched.user_a_id = v_user_a_id AND matched.user_b_id = v_user_b_id;
      END IF;
    END IF;

    IF v_match_id IS NOT NULL THEN
      SELECT matched.id, matched.chat_id
        INTO v_match_id, v_match_chat_id
      FROM public.matches AS matched
      WHERE matched.id = v_match_id
      FOR UPDATE;

      IF v_match_chat_id IS NULL THEN
        INSERT INTO public.chats (type) VALUES ('direct') RETURNING id INTO v_chat_id;
        INSERT INTO public.chat_participants (chat_id, user_id)
        VALUES (v_chat_id, v_user_a_id), (v_chat_id, v_user_b_id);
        UPDATE public.matches
        SET chat_id = v_chat_id
        WHERE id = v_match_id AND chat_id IS NULL;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT p_decision, v_match_created, v_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_current_discover_decision(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_current_discover_decision(uuid, text) TO app_runtime;
