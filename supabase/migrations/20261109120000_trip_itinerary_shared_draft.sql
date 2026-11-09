-- Add confirmed day-based itinerary reads and a separately versioned shared Draft.
-- Existing Trips and TripStops remain intact and runtime read-only.

CREATE TABLE public.trip_itinerary_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips (id) ON DELETE RESTRICT,
  position integer NOT NULL,
  day_date date,
  title text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, position),
  UNIQUE (trip_id, id),
  CHECK (position >= 1),
  CHECK (title IS NULL OR char_length(title) <= 120),
  CHECK (notes IS NULL OR char_length(notes) <= 4000)
);

CREATE TABLE public.trip_itinerary_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  day_id uuid NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  start_time time,
  duration_minutes integer,
  address text,
  estimated_cost numeric(12, 2),
  currency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_id, position),
  UNIQUE (trip_id, id),
  FOREIGN KEY (trip_id, day_id)
    REFERENCES public.trip_itinerary_days (trip_id, id) ON DELETE RESTRICT,
  CHECK (position >= 1),
  CHECK (kind IN ('activity', 'transport', 'accommodation', 'meal', 'note', 'other')),
  CHECK (char_length(title) BETWEEN 1 AND 200),
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  CHECK (currency IS NULL OR char_length(currency) = 3),
  CHECK (address IS NULL OR char_length(address) <= 240),
  CHECK (notes IS NULL OR char_length(notes) <= 2000)
);

CREATE TABLE public.trip_drafts (
  trip_id uuid PRIMARY KEY REFERENCES public.trips (id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (version >= 1),
  CHECK (jsonb_typeof(content) = 'object'),
  CHECK (pg_column_size(content) <= 262144)
);

CREATE TABLE public.trip_draft_versions (
  trip_id uuid NOT NULL REFERENCES public.trip_drafts (trip_id) ON DELETE RESTRICT,
  version integer NOT NULL,
  content jsonb NOT NULL,
  author_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, version),
  CHECK (version >= 1),
  CHECK (jsonb_typeof(content) = 'object'),
  CHECK (pg_column_size(content) <= 262144)
);

CREATE TABLE public.trip_draft_alternatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips (id) ON DELETE RESTRICT,
  title text NOT NULL,
  content jsonb NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(title) BETWEEN 1 AND 100),
  CHECK (jsonb_typeof(content) = 'object'),
  CHECK (pg_column_size(content) <= 262144),
  UNIQUE (trip_id, id)
);

CREATE INDEX trip_itinerary_days_trip_position_idx
  ON public.trip_itinerary_days (trip_id, position);
CREATE INDEX trip_itinerary_events_trip_day_position_idx
  ON public.trip_itinerary_events (trip_id, day_id, position);
CREATE INDEX trip_draft_versions_trip_created_idx
  ON public.trip_draft_versions (trip_id, version DESC);
CREATE INDEX trip_draft_alternatives_trip_created_idx
  ON public.trip_draft_alternatives (trip_id, created_at DESC, id DESC);

-- Keep the metadata list and saved snapshots bounded for the beta UI.
-- Existing rows are retained; the capability prevents additional snapshots
-- once a Trip already has twenty alternatives.

-- Pre-existing Trips receive an empty editable Draft. Confirmed state is not
-- copied or rewritten; legacy TripStops remain the confirmed route read model.
INSERT INTO public.trip_drafts (trip_id, content, updated_by_user_id)
SELECT trip.id,
  '{"route_stops":[],"date_from":null,"date_to":null,"accommodations":[],"transport":[],"budget":{"min":null,"max":null,"currency":null,"scope":null},"days":[],"notes":""}'::jsonb,
  trip.created_by_user_id
FROM public.trips AS trip;

INSERT INTO public.trip_draft_versions (trip_id, version, content, author_user_id)
SELECT draft.trip_id, draft.version, draft.content, draft.updated_by_user_id
FROM public.trip_drafts AS draft;

-- Keep the existing Trip creation capability and its authorization/locking
-- contract. The initial shared Draft is created in the same transaction.
CREATE OR REPLACE FUNCTION public.create_current_trip_from_chat(p_chat_id uuid)
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
  v_content jsonb := '{"route_stops":[],"date_from":null,"date_to":null,"accommodations":[],"transport":[],"budget":{"min":null,"max":null,"currency":null,"scope":null},"days":[],"notes":""}'::jsonb;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

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

  INSERT INTO public.trip_drafts (trip_id, version, content, updated_by_user_id)
  VALUES (v_trip_id, 1, v_content, v_actor_user_id);
  INSERT INTO public.trip_draft_versions (trip_id, version, content, author_user_id)
  VALUES (v_trip_id, 1, v_content, v_actor_user_id);

  RETURN QUERY
  SELECT v_trip_id, p_chat_id, v_actor_user_id, 'forming'::text, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_current_trip_from_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_current_trip_from_chat(uuid) TO app_runtime;

CREATE FUNCTION public.save_current_trip_draft(
  p_trip_id uuid,
  p_base_version integer,
  p_content jsonb
)
RETURNS TABLE (
  trip_id uuid,
  version integer,
  content jsonb,
  updated_by_user_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_current_version integer;
  v_next_version integer;
  v_updated_at timestamptz;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;
  IF p_base_version IS NULL OR p_base_version < 1 THEN
    RAISE EXCEPTION 'base version must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT draft.version INTO v_current_version
  FROM public.trip_drafts AS draft
  JOIN public.trip_participants AS participant
    ON participant.trip_id = draft.trip_id
   AND participant.user_id = v_actor_user_id
   AND participant.left_at IS NULL
  WHERE draft.trip_id = p_trip_id
  FOR UPDATE OF draft;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_base_version <> v_current_version THEN
    RAISE EXCEPTION 'trip draft version conflict' USING ERRCODE = '40001';
  END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'invalid trip draft content' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_content) > 262144 THEN
    RAISE EXCEPTION 'trip draft content exceeds 256 KiB' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_current_version + 1;
  UPDATE public.trip_drafts AS draft
  SET version = v_next_version,
      content = p_content,
      updated_by_user_id = v_actor_user_id,
      updated_at = now()
  WHERE draft.trip_id = p_trip_id
  RETURNING draft.updated_at INTO v_updated_at;

  INSERT INTO public.trip_draft_versions (trip_id, version, content, author_user_id)
  VALUES (p_trip_id, v_next_version, p_content, v_actor_user_id);

  RETURN QUERY
  SELECT p_trip_id, v_next_version, p_content, v_actor_user_id, v_updated_at;
END;
$$;

CREATE FUNCTION public.save_current_trip_draft_alternative(
  p_trip_id uuid,
  p_title text,
  p_content jsonb
)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  title text,
  content jsonb,
  created_by_user_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.trip_drafts AS draft
  JOIN public.trip_participants AS participant
    ON participant.trip_id = draft.trip_id
   AND participant.user_id = v_actor_user_id
   AND participant.left_at IS NULL
  WHERE draft.trip_id = p_trip_id
  FOR UPDATE OF draft;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip draft not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
    OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid trip draft alternative' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_content) > 262144 THEN
    RAISE EXCEPTION 'trip draft alternative content exceeds 256 KiB' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.trip_draft_alternatives AS alternative
      WHERE alternative.trip_id = p_trip_id) >= 20 THEN
    RAISE EXCEPTION 'trip draft alternative limit reached' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  INSERT INTO public.trip_draft_alternatives AS alternative
    (trip_id, title, content, created_by_user_id)
  VALUES (p_trip_id, btrim(p_title), p_content, v_actor_user_id)
  RETURNING alternative.id, alternative.trip_id, alternative.title,
    alternative.content, alternative.created_by_user_id, alternative.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.save_current_trip_draft(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_current_trip_draft(uuid, integer, jsonb) TO app_runtime;
REVOKE ALL ON FUNCTION public.save_current_trip_draft_alternative(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_current_trip_draft_alternative(uuid, text, jsonb) TO app_runtime;

ALTER TABLE public.trip_itinerary_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_itinerary_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_draft_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_draft_alternatives ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trip_itinerary_days,
  public.trip_itinerary_events, public.trip_drafts, public.trip_draft_versions,
  public.trip_draft_alternatives FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY trip_itinerary_days_select_active_participant
  ON public.trip_itinerary_days FOR SELECT TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_itinerary_events_select_active_participant
  ON public.trip_itinerary_events FOR SELECT TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_drafts_select_active_participant
  ON public.trip_drafts FOR SELECT TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_draft_versions_select_active_participant
  ON public.trip_draft_versions FOR SELECT TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_draft_alternatives_select_active_participant
  ON public.trip_draft_alternatives FOR SELECT TO app_runtime
  USING (public.is_current_active_trip_participant(trip_id));
