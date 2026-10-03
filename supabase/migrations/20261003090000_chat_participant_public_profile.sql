-- A purpose-bound public-profile read for another active participant in the
-- same Chat. This does not widen owner-scoped profile or TravelIntent RLS.
CREATE FUNCTION public.chat_participant_public_profile(
  p_chat_id uuid,
  p_target_user_id uuid
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  age integer,
  city text,
  bio text,
  travel_style text[],
  interests text[],
  budget_level text,
  comfort_level text,
  destination text,
  date_from date,
  date_to date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    profile.user_id,
    profile.display_name,
    EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, profile.birth_date))::integer,
    profile.city,
    profile.bio,
    profile.travel_style,
    profile.interests,
    profile.budget_level,
    profile.comfort_level,
    intent.destination_label,
    intent.date_from,
    intent.date_to
  FROM public.chat_participants AS target
  JOIN public.profiles AS profile ON profile.user_id = target.user_id
  JOIN public.travel_intents AS intent
    ON intent.user_id = target.user_id AND intent.status = 'active'
  JOIN public.users AS target_user
    ON target_user.id = target.user_id AND target_user.deleted_at IS NULL
  WHERE target.chat_id = p_chat_id
    AND target.user_id = p_target_user_id
    AND target.left_at IS NULL
    AND p_target_user_id <> public.current_authenticated_user_id()
    AND public.current_authenticated_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants AS requester
      WHERE requester.chat_id = p_chat_id
        AND requester.user_id = public.current_authenticated_user_id()
        AND requester.left_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.chat_participant_public_profile(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_participant_public_profile(uuid, uuid) TO app_runtime;
