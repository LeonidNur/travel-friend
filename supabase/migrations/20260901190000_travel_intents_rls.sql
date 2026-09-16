-- The first RLS slice: a runtime user may manage only its own active intent.
ALTER TABLE public.travel_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY travel_intents_select_own_active
  ON public.travel_intents
  FOR SELECT
  TO app_runtime
  USING (
    user_id = public.current_authenticated_user_id()
    AND status = 'active'
  );

CREATE POLICY travel_intents_insert_own_active
  ON public.travel_intents
  FOR INSERT
  TO app_runtime
  WITH CHECK (
    user_id = public.current_authenticated_user_id()
    AND status = 'active'
  );

CREATE POLICY travel_intents_update_own_active
  ON public.travel_intents
  FOR UPDATE
  TO app_runtime
  USING (
    user_id = public.current_authenticated_user_id()
    AND status = 'active'
  )
  WITH CHECK (
    user_id = public.current_authenticated_user_id()
    AND status IN ('active', 'archived')
  );

-- Discover needs the intentionally narrow exception to owner-only intent reads.
-- The requester identity is derived from the transaction-local authenticated context;
-- callers cannot supply it. Discover eligibility remains in the application query.
CREATE FUNCTION public.discover_eligible_travel_intents()
RETURNS TABLE (
  user_id uuid,
  destination_label text,
  date_from date,
  date_to date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT ti.user_id, ti.destination_label, ti.date_from, ti.date_to
  FROM public.travel_intents AS ti
  WHERE ti.status = 'active'
    AND public.current_authenticated_user_id() IS NOT NULL
    AND ti.user_id <> public.current_authenticated_user_id();
$$;

REVOKE ALL ON FUNCTION public.discover_eligible_travel_intents() FROM PUBLIC;

-- PostgreSQL evaluates SELECT policies against an UPDATE's new row. A narrow
-- owner-owned capability preserves active-to-archived API semantics without
-- allowing app_runtime to select archived rows directly.
CREATE FUNCTION public.archive_current_active_travel_intent()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH archived AS (
    UPDATE public.travel_intents
    SET status = 'archived',
        archived_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE user_id = public.current_authenticated_user_id()
      AND status = 'active'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM archived);
$$;

REVOKE ALL ON FUNCTION public.archive_current_active_travel_intent() FROM PUBLIC;
