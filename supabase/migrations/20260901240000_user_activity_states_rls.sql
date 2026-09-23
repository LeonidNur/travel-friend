-- Runtime may read only its own onboarding state. Persisted onboarding writes
-- remain confined to the bootstrap and completion SECURITY DEFINER capabilities.
ALTER TABLE public.user_activity_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_activity_states_select_own
  ON public.user_activity_states
  FOR SELECT
  TO app_runtime
  USING (user_id = public.current_authenticated_user_id());
