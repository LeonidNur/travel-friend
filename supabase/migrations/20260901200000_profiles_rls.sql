-- A runtime user may manage only its own profile. Cross-user profile reads are
-- available only through the purpose-bound capabilities below.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO app_runtime
  USING (user_id = public.current_authenticated_user_id());

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO app_runtime
  WITH CHECK (user_id = public.current_authenticated_user_id());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO app_runtime
  USING (user_id = public.current_authenticated_user_id())
  WITH CHECK (user_id = public.current_authenticated_user_id());

CREATE FUNCTION public.discover_candidate_profile_projection()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  age integer,
  city text,
  bio text,
  travel_style text[],
  interests text[],
  budget_level text,
  comfort_level text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    p.user_id,
    p.display_name,
    EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, p.birth_date))::integer,
    p.city,
    p.bio,
    p.travel_style,
    p.interests,
    p.budget_level,
    p.comfort_level
  FROM public.profiles AS p
  JOIN public.users AS u ON u.id = p.user_id AND u.deleted_at IS NULL
  JOIN public.user_activity_states AS activity
    ON activity.user_id = p.user_id AND activity.onboarding_status = 'completed'
  JOIN public.travel_intents AS ti
    ON ti.user_id = p.user_id AND ti.status = 'active'
  WHERE public.current_authenticated_user_id() IS NOT NULL
    AND p.user_id <> public.current_authenticated_user_id()
    AND NOT EXISTS (
      SELECT 1
      FROM public.discover_interest_decisions AS decision
      WHERE decision.actor_user_id = public.current_authenticated_user_id()
        AND decision.target_user_id = p.user_id
    )
  ORDER BY p.created_at ASC, p.user_id ASC;
$$;

CREATE FUNCTION public.discover_target_is_eligible(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    public.current_authenticated_user_id() IS NOT NULL
    AND p_target_user_id <> public.current_authenticated_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.users AS u
      JOIN public.profiles AS p ON p.user_id = u.id
      JOIN public.user_activity_states AS activity
        ON activity.user_id = u.id AND activity.onboarding_status = 'completed'
      JOIN public.travel_intents AS ti
        ON ti.user_id = u.id AND ti.status = 'active'
      WHERE u.id = p_target_user_id AND u.deleted_at IS NULL
    ),
    false
  );
$$;

CREATE FUNCTION public.chat_participant_profile_projection(p_chat_id uuid)
RETURNS TABLE (user_id uuid, display_name text, age integer, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    participant.user_id,
    p.display_name,
    CASE WHEN c.type = 'direct'
      THEN EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, p.birth_date))::integer
      ELSE NULL::integer
    END,
    CASE WHEN c.type = 'direct' THEN p.city ELSE NULL::text END
  FROM public.chats AS c
  JOIN public.chat_participants AS participant
    ON participant.chat_id = c.id AND participant.left_at IS NULL
  LEFT JOIN public.profiles AS p ON p.user_id = participant.user_id
  WHERE c.id = p_chat_id
    AND public.current_authenticated_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants AS requester
      WHERE requester.chat_id = c.id
        AND requester.user_id = public.current_authenticated_user_id()
        AND requester.left_at IS NULL
    )
    AND (c.type = 'group' OR participant.user_id <> public.current_authenticated_user_id())
    AND (c.type = 'group' OR p.user_id IS NOT NULL)
  ORDER BY participant.joined_at ASC, participant.user_id ASC;
$$;

CREATE FUNCTION public.trip_participant_profile_projection(p_trip_id uuid)
RETURNS TABLE (user_id uuid, display_name text, age integer, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    participant.user_id,
    p.display_name,
    EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, p.birth_date))::integer,
    p.city
  FROM public.trip_participants AS participant
  LEFT JOIN public.profiles AS p ON p.user_id = participant.user_id
  WHERE participant.trip_id = p_trip_id
    AND participant.left_at IS NULL
    AND public.current_authenticated_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trip_participants AS requester
      WHERE requester.trip_id = p_trip_id
        AND requester.user_id = public.current_authenticated_user_id()
        AND requester.left_at IS NULL
    )
  ORDER BY participant.joined_at ASC, participant.user_id ASC;
$$;

REVOKE ALL ON FUNCTION public.discover_candidate_profile_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discover_target_is_eligible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_participant_profile_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_participant_profile_projection(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.discover_candidate_profile_projection() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.discover_target_is_eligible(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_participant_profile_projection(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.trip_participant_profile_projection(uuid) TO app_runtime;
