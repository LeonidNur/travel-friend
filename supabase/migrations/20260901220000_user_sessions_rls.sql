-- Authenticated runtime access exists solely for logout of the caller's session.
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_sessions_select_own
  ON public.user_sessions
  FOR SELECT
  TO app_runtime
  USING (user_id = public.current_authenticated_user_id());

CREATE POLICY user_sessions_update_own
  ON public.user_sessions
  FOR UPDATE
  TO app_runtime
  USING (user_id = public.current_authenticated_user_id())
  WITH CHECK (user_id = public.current_authenticated_user_id());
