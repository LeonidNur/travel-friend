-- Chat RLS keeps runtime reads scoped to the caller's active membership.
-- Writes are purpose-bound capabilities, except for the temporary Trip lock bridge.

CREATE FUNCTION public.is_current_active_chat_participant(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    p_chat_id IS NOT NULL
    AND public.current_authenticated_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_participants AS participant
      WHERE participant.chat_id = p_chat_id
        AND participant.user_id = public.current_authenticated_user_id()
        AND participant.left_at IS NULL
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_current_active_chat_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_active_chat_participant(uuid) TO app_runtime;

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chats_select_active_participant
  ON public.chats
  FOR SELECT
  TO app_runtime
  USING (public.is_current_active_chat_participant(id));

-- Temporary Trip compatibility bridge. SELECT ... FOR UPDATE in the current
-- Trip creation flow needs UPDATE privilege and an UPDATE policy's USING
-- predicate. WITH CHECK (false) rejects every actual UPDATE.
CREATE POLICY chats_lock_active_participant
  ON public.chats
  FOR UPDATE
  TO app_runtime
  USING (public.is_current_active_chat_participant(id))
  WITH CHECK (false);

CREATE POLICY chat_participants_select_active_chat
  ON public.chat_participants
  FOR SELECT
  TO app_runtime
  USING (
    left_at IS NULL
    AND public.is_current_active_chat_participant(chat_id)
  );

-- Temporary Trip compatibility bridge for SELECT ... FOR SHARE.
CREATE POLICY chat_participants_lock_active_chat
  ON public.chat_participants
  FOR UPDATE
  TO app_runtime
  USING (
    left_at IS NULL
    AND public.is_current_active_chat_participant(chat_id)
  )
  WITH CHECK (false);

CREATE POLICY messages_select_active_participant
  ON public.messages
  FOR SELECT
  TO app_runtime
  USING (
    public.is_current_active_chat_participant(chat_id)
    AND (
      recipient_user_id IS NULL
      OR recipient_user_id = public.current_authenticated_user_id()
    )
  );

CREATE FUNCTION public.create_current_group_chat(p_companion_user_ids uuid[])
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
  v_actor_user_id uuid;
  v_chat_id uuid;
  v_created_at timestamptz;
  v_eligible_count integer := 0;
  v_companion_user_id uuid;
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  IF p_companion_user_ids IS NULL THEN
    RAISE EXCEPTION 'group companions are required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_companion_user_ids) < 2 THEN
    RAISE EXCEPTION 'group chats require at least two companions' USING ERRCODE = '22023';
  END IF;
  IF array_position(p_companion_user_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'group companions cannot contain null' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_companion_user_ids) AS companion(user_id)
    GROUP BY companion.user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'group companions must be unique' USING ERRCODE = '22023';
  END IF;
  IF v_actor_user_id = ANY (p_companion_user_ids) THEN
    RAISE EXCEPTION 'group members cannot include the initiator' USING ERRCODE = '22023';
  END IF;

  -- The ordered row locks establish a stable future lock order: direct Chat,
  -- then its active participant rows. The current MVP has immutable membership.
  FOR v_companion_user_id IN
    SELECT companion.user_id
    FROM unnest(p_companion_user_ids) AS requested(user_id)
    JOIN public.chats AS direct_chat ON direct_chat.type = 'direct'
    JOIN public.matches AS matched_flow
      ON matched_flow.chat_id = direct_chat.id
      AND (
        (matched_flow.user_a_id = v_actor_user_id AND matched_flow.user_b_id = requested.user_id)
        OR (matched_flow.user_a_id = requested.user_id AND matched_flow.user_b_id = v_actor_user_id)
      )
    JOIN public.chat_participants AS actor_participant
      ON actor_participant.chat_id = direct_chat.id
      AND actor_participant.user_id = v_actor_user_id
      AND actor_participant.left_at IS NULL
    JOIN public.chat_participants AS companion
      ON companion.chat_id = direct_chat.id
      AND companion.user_id = requested.user_id
      AND companion.left_at IS NULL
    ORDER BY direct_chat.id, actor_participant.user_id, companion.user_id
    FOR SHARE OF direct_chat, matched_flow, actor_participant, companion
  LOOP
    v_eligible_count := v_eligible_count + 1;
  END LOOP;

  IF v_eligible_count <> cardinality(p_companion_user_ids) THEN
    RAISE EXCEPTION 'Every group member must have a matched direct Chat with the initiator'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.chats (type)
  VALUES ('group')
  RETURNING id, public.chats.created_at INTO v_chat_id, v_created_at;

  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT v_chat_id, participant.user_id
  FROM unnest(ARRAY[v_actor_user_id] || p_companion_user_ids) AS participant(user_id);

  RETURN QUERY
  SELECT v_chat_id, 'group'::text, ARRAY[v_actor_user_id] || p_companion_user_ids, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_current_group_chat(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_current_group_chat(uuid[]) TO app_runtime;

CREATE FUNCTION public.send_current_chat_message(p_chat_id uuid, p_text text)
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
BEGIN
  v_actor_user_id := public.current_authenticated_user_id();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE = '42501';
  END IF;

  v_text := btrim(p_text);
  IF v_text IS NULL OR v_text = '' THEN
    RAISE EXCEPTION 'content_text must not be blank' USING ERRCODE = '22023';
  END IF;

  -- Keep a single lock order with the Trip bridge and future membership flows.
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

  UPDATE public.chats AS chat
  SET last_sequence = chat.last_sequence + 1,
      updated_at = pg_catalog.now()
  WHERE chat.id = p_chat_id
  RETURNING chat.last_sequence INTO v_sequence_number;

  RETURN QUERY
  INSERT INTO public.messages (
    chat_id,
    sender_user_id,
    recipient_user_id,
    sequence_number,
    type,
    content_text
  )
  VALUES (
    p_chat_id,
    v_actor_user_id,
    NULL,
    v_sequence_number,
    'user',
    v_text
  )
  RETURNING
    public.messages.id,
    public.messages.chat_id,
    public.messages.sequence_number,
    public.messages.type,
    public.messages.sender_user_id,
    public.messages.content_text,
    public.messages.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.send_current_chat_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_current_chat_message(uuid, text) TO app_runtime;

CREATE OR REPLACE FUNCTION public.enforce_direct_chat_participant_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_chat_id uuid;
  target_chat_ids uuid[];
  participant_count bigint;
BEGIN
  IF tg_table_name = 'chats' THEN
    target_chat_id := new.id;
    IF new.type <> 'direct' THEN
      RETURN NULL;
    END IF;
  ELSE
    IF tg_op = 'INSERT' THEN
      target_chat_ids := ARRAY[new.chat_id];
    ELSIF tg_op = 'DELETE' THEN
      target_chat_ids := ARRAY[old.chat_id];
    ELSE
      target_chat_ids := ARRAY[old.chat_id, new.chat_id];
    END IF;

    FOREACH target_chat_id IN ARRAY target_chat_ids
    LOOP
      CONTINUE WHEN target_chat_id IS NULL;

      IF NOT EXISTS (
        SELECT 1
        FROM public.chats
        WHERE id = target_chat_id
          AND type = 'direct'
      ) THEN
        CONTINUE;
      END IF;

      SELECT count(*)
      INTO participant_count
      FROM public.chat_participants
      WHERE chat_id = target_chat_id;

      IF participant_count <> 2 THEN
        RAISE EXCEPTION 'direct chats require exactly two participants'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    RETURN NULL;
  END IF;

  SELECT count(*)
  INTO participant_count
  FROM public.chat_participants
  WHERE chat_id = target_chat_id;

  IF participant_count <> 2 THEN
    RAISE EXCEPTION 'direct chats require exactly two participants'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_direct_chat_participant_count() FROM PUBLIC;
