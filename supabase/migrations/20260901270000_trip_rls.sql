-- Trip reads are available only to active Trip participants. Creation remains
-- a narrowly-scoped capability which snapshots active Chat membership.

CREATE FUNCTION public.is_current_active_trip_participant(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    p_trip_id IS NOT NULL
    AND public.current_authenticated_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trip_participants AS participant
      WHERE participant.trip_id = p_trip_id
        AND participant.user_id = public.current_authenticated_user_id()
        AND participant.left_at IS NULL
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_current_active_trip_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_active_trip_participant(uuid) TO app_runtime;

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY trips_select_active_participant
  ON public.trips
  FOR SELECT
  TO app_runtime
  USING (public.is_current_active_trip_participant(id));

CREATE POLICY trip_participants_select_active_trip
  ON public.trip_participants
  FOR SELECT
  TO app_runtime
  USING (
    left_at IS NULL
    AND public.is_current_active_trip_participant(trip_id)
  );

CREATE POLICY trip_stops_select_active_participant
  ON public.trip_stops
  FOR SELECT
  TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));

CREATE FUNCTION public.create_current_trip_from_chat(p_chat_id uuid)
RETURNS TABLE (
  trip_id uuid,
  chat_id uuid,
  created_by_user_id uuid,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_trip_id uuid;
  v_created_at timestamptz;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  -- Keep the existing lock order: Chat, then its active participant rows.
  PERFORM 1
  FROM public.chats AS chat
  WHERE chat.id = p_chat_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.chat_participants AS participant
  WHERE participant.chat_id = p_chat_id
    AND participant.user_id = v_actor_user_id
    AND participant.left_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trips AS trip
    WHERE trip.chat_id = p_chat_id
      AND trip.status IN ('forming', 'active')
  ) THEN
    RAISE EXCEPTION 'unfinished trip already exists' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.chat_participants AS participant
  WHERE participant.chat_id = p_chat_id
    AND participant.left_at IS NULL
  FOR SHARE;

  INSERT INTO public.trips (chat_id, created_by_user_id, status)
  VALUES (p_chat_id, v_actor_user_id, 'forming')
  RETURNING public.trips.id, public.trips.created_at INTO v_trip_id, v_created_at;

  INSERT INTO public.trip_participants (trip_id, user_id)
  SELECT v_trip_id, participant.user_id
  FROM public.chat_participants AS participant
  WHERE participant.chat_id = p_chat_id
    AND participant.left_at IS NULL;

  RETURN QUERY
  SELECT v_trip_id, p_chat_id, v_actor_user_id, 'forming'::text, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_current_trip_from_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_current_trip_from_chat(uuid) TO app_runtime;

-- Trip creation now executes its locks in the owner-owned capability, so
-- app_runtime has no direct Chat UPDATE surface.
DROP POLICY chats_lock_active_participant ON public.chats;
DROP POLICY chat_participants_lock_active_chat ON public.chat_participants;
