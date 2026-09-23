-- Internal and dormant MVP tables have no direct runtime surface. Required
-- access remains confined to existing owner-owned SECURITY DEFINER capabilities.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
