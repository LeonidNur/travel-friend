-- Group Chat titles are presentation data only. Membership stays immutable,
-- and every title read/write remains behind a narrowly scoped capability.
ALTER TABLE public.chats
  ADD COLUMN title text;

ALTER TABLE public.chats
  ADD CONSTRAINT chats_title_group_only
    CHECK (title IS NULL OR type = 'group'),
  ADD CONSTRAINT chats_title_nonblank
    CHECK (title IS NULL OR length(btrim(title)) > 0),
  ADD CONSTRAINT chats_title_max_length
    CHECK (title IS NULL OR char_length(title) <= 80);

CREATE FUNCTION public.create_current_group_chat(
  p_companion_user_ids uuid[],
  p_title text
)
RETURNS TABLE (
  chat_id uuid,
  type text,
  participant_user_ids uuid[],
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_chat record;
  v_title text;
BEGIN
  v_title := NULLIF(
    pg_catalog.regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    ''
  );
  IF v_title IS NOT NULL AND pg_catalog.char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'title must not exceed 80 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_chat
  FROM public.create_current_group_chat(p_companion_user_ids);

  IF v_title IS NOT NULL THEN
    UPDATE public.chats AS chat SET title = v_title WHERE chat.id = v_chat.chat_id;
  END IF;

  RETURN QUERY SELECT v_chat.chat_id, v_chat.type, v_chat.participant_user_ids, v_chat.created_at;
END;
$$;

CREATE FUNCTION public.rename_current_group_chat(p_chat_id uuid, p_title text)
RETURNS TABLE (chat_id uuid, title text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_title text;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  v_title := NULLIF(
    pg_catalog.regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    ''
  );
  IF v_title IS NOT NULL AND pg_catalog.char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'title must not exceed 80 characters' USING ERRCODE = '22023';
  END IF;

  -- Serialize competing renames on the Chat row; the last committed update wins.
  PERFORM 1 FROM public.chats AS chat
  WHERE chat.id = p_chat_id AND chat.type = 'group'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.chat_participants AS participant
  WHERE participant.chat_id = p_chat_id
    AND participant.user_id = v_actor_user_id
    AND participant.left_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.chats AS chat SET title = v_title
  WHERE chat.id = p_chat_id
  RETURNING chat.id, chat.title INTO chat_id, title;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_current_group_chat(uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_current_group_chat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_current_group_chat(uuid[], text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.rename_current_group_chat(uuid, text) TO app_runtime;

-- RETURNS TABLE cannot change its result shape with CREATE OR REPLACE, so
-- replace the read capability while preserving its exact authorization scope.
DROP FUNCTION public.chat_list_projection();
CREATE FUNCTION public.chat_list_projection()
RETURNS TABLE (
  chat_id uuid,
  chat_type text,
  title text,
  created_at timestamptz,
  participants jsonb,
  participant_count bigint,
  last_message jsonb,
  unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    chat.id,
    chat.type::text,
    chat.title,
    chat.created_at,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'user_id', participant.user_id,
          'display_name', profile.display_name,
          'age', CASE WHEN chat.type = 'direct'
            THEN EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, profile.birth_date))::integer
            ELSE NULL::integer
          END,
          'city', CASE WHEN chat.type = 'direct' THEN profile.city ELSE NULL::text END
        ) ORDER BY participant.joined_at ASC, participant.user_id ASC
      )
      FROM public.chat_participants AS participant
      LEFT JOIN public.profiles AS profile ON profile.user_id = participant.user_id
      WHERE participant.chat_id = chat.id
        AND participant.left_at IS NULL
        AND (chat.type = 'group' OR participant.user_id <> actor.user_id)
        AND (chat.type = 'group' OR profile.user_id IS NOT NULL)
    ), '[]'::jsonb),
    (
      SELECT pg_catalog.count(*)
      FROM public.chat_participants AS participant
      WHERE participant.chat_id = chat.id AND participant.left_at IS NULL
    ),
    (
      SELECT pg_catalog.jsonb_build_object(
        'sequence_number', message.sequence_number,
        'type', message.type,
        'sender_user_id', message.sender_user_id,
        'content_text', message.content_text,
        'created_at', message.created_at
      )
      FROM public.messages AS message
      WHERE message.chat_id = chat.id
        AND (message.recipient_user_id IS NULL OR message.recipient_user_id = actor.user_id)
      ORDER BY message.sequence_number DESC
      LIMIT 1
    ),
    (
      SELECT pg_catalog.count(*)
      FROM public.messages AS message
      WHERE message.chat_id = chat.id
        AND message.sequence_number > actor.last_read_sequence
        AND message.sender_user_id IS DISTINCT FROM actor.user_id
        AND (message.recipient_user_id IS NULL OR message.recipient_user_id = actor.user_id)
    )
  FROM public.chats AS chat
  JOIN public.chat_participants AS actor
    ON actor.chat_id = chat.id
    AND actor.user_id = public.current_authenticated_user_id()
    AND actor.left_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.chat_list_projection() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_list_projection() TO app_runtime;
