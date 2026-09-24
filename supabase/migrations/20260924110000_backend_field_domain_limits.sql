-- P0 4A: durable nonblank identity/destination invariants and scoped write limits.
-- Do not rewrite legacy data here. A legacy violation must be resolved explicitly
-- before this migration is applied.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE btrim(display_name) = '') THEN
    RAISE EXCEPTION 'cannot add profiles_display_name_not_blank: legacy blank display_name rows require an explicit backfill'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.travel_intents WHERE btrim(destination_label) = '') THEN
    RAISE EXCEPTION 'cannot add travel_intents_destination_label_not_blank: legacy blank destination_label rows require an explicit backfill'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_not_blank CHECK (btrim(display_name) <> '');

ALTER TABLE public.travel_intents
  ADD CONSTRAINT travel_intents_destination_label_not_blank CHECK (btrim(destination_label) <> '');

CREATE OR REPLACE FUNCTION public.create_current_group_chat(p_companion_user_ids uuid[])
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
  IF cardinality(p_companion_user_ids) > 20 THEN
    RAISE EXCEPTION 'group chats allow at most twenty companions' USING ERRCODE = '22023';
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
  IF char_length(v_text) > 4000 THEN
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
