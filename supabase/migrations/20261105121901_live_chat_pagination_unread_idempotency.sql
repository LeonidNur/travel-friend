-- Additive Live Chats support. Existing message endpoints and capabilities remain
-- available for clients that have not adopted cursors or request identifiers.

ALTER TABLE public.messages
  ADD COLUMN client_request_id uuid;

CREATE UNIQUE INDEX messages_sender_client_request_unique_idx
  ON public.messages (chat_id, sender_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.send_current_chat_message(
  p_chat_id uuid,
  p_text text,
  p_client_request_id uuid
)
RETURNS TABLE (
  message_id uuid,
  chat_id uuid,
  sequence_number bigint,
  type text,
  sender_user_id uuid,
  content_text text,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_text text;
  v_sequence_number bigint;
  v_existing public.messages%ROWTYPE;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  v_text := pg_catalog.btrim(p_text);
  IF v_text IS NULL OR v_text = '' THEN
    RAISE EXCEPTION 'content_text must not be blank' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_text) > 4000 THEN
    RAISE EXCEPTION 'content_text must not exceed 4000 characters' USING ERRCODE = '22023';
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

  IF p_client_request_id IS NOT NULL THEN
    SELECT message.* INTO v_existing
    FROM public.messages AS message
    WHERE message.chat_id = p_chat_id
      AND message.sender_user_id = v_actor_user_id
      AND message.client_request_id = p_client_request_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.content_text <> v_text THEN
        RAISE EXCEPTION 'client_request_id was already used for another message'
          USING ERRCODE = '23505';
      END IF;
      RETURN QUERY SELECT v_existing.id, v_existing.chat_id, v_existing.sequence_number,
        v_existing.type, v_existing.sender_user_id, v_existing.content_text, v_existing.created_at;
      RETURN;
    END IF;
  END IF;

  UPDATE public.chats AS chat
  SET last_sequence = chat.last_sequence + 1,
      updated_at = pg_catalog.now()
  WHERE chat.id = p_chat_id
  RETURNING chat.last_sequence INTO v_sequence_number;

  RETURN QUERY
  INSERT INTO public.messages (
    chat_id, sender_user_id, recipient_user_id, sequence_number, type,
    content_text, client_request_id
  )
  VALUES (
    p_chat_id, v_actor_user_id, NULL, v_sequence_number, 'user',
    v_text, p_client_request_id
  )
  RETURNING public.messages.id, public.messages.chat_id, public.messages.sequence_number,
    public.messages.type, public.messages.sender_user_id, public.messages.content_text,
    public.messages.created_at;

  UPDATE public.chat_participants AS participant
  SET last_visible_message_sequence = GREATEST(
        participant.last_visible_message_sequence, v_sequence_number
      ),
      updated_at = pg_catalog.now()
  WHERE participant.chat_id = p_chat_id AND participant.left_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_current_chat_message(p_chat_id uuid, p_text text)
RETURNS TABLE (
  message_id uuid,
  chat_id uuid,
  sequence_number bigint,
  type text,
  sender_user_id uuid,
  content_text text,
  created_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT * FROM public.send_current_chat_message(p_chat_id, p_text, NULL::uuid)
$$;

CREATE FUNCTION public.chat_list_projection()
RETURNS TABLE (
  chat_id uuid,
  chat_type text,
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

CREATE FUNCTION public.mark_current_chat_read(p_chat_id uuid, p_sequence_number bigint)
RETURNS TABLE (chat_id uuid, last_read_sequence bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_user_id uuid;
  v_max_visible_sequence bigint;
  v_last_read_sequence bigint;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.chats AS chat WHERE chat.id = p_chat_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.chat_participants AS participant
  WHERE participant.chat_id = p_chat_id
    AND participant.user_id = v_actor_user_id
    AND participant.left_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(pg_catalog.max(message.sequence_number), 0)
  INTO v_max_visible_sequence
  FROM public.messages AS message
  WHERE message.chat_id = p_chat_id
    AND (message.recipient_user_id IS NULL OR message.recipient_user_id = v_actor_user_id);

  UPDATE public.chat_participants AS participant
  SET last_visible_message_sequence = GREATEST(
        participant.last_visible_message_sequence, v_max_visible_sequence
      ),
      last_read_sequence = GREATEST(
        participant.last_read_sequence,
        LEAST(COALESCE(p_sequence_number, 0), v_max_visible_sequence)
      ),
      updated_at = pg_catalog.now()
  WHERE participant.chat_id = p_chat_id AND participant.user_id = v_actor_user_id
  RETURNING participant.last_read_sequence INTO v_last_read_sequence;

  RETURN QUERY SELECT p_chat_id, v_last_read_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.send_current_chat_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_current_chat_message(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_current_chat_read(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_list_projection() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.mark_current_chat_read(uuid, bigint) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.chat_list_projection() TO app_runtime;
