-- Manual Trip Proposals with frozen voters and transactional confirmed-state apply.
-- Runtime writes are limited to narrow SECURITY DEFINER capabilities.

CREATE TABLE public.trip_confirmed_accommodations (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  name text NOT NULL,
  location text,
  date_from date,
  date_to date,
  notes text,
  PRIMARY KEY (trip_id, id),
  CHECK (char_length(name) <= 160),
  CHECK (location IS NULL OR char_length(location) <= 240),
  CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CHECK (date_from IS NULL OR date_to IS NULL OR date_to >= date_from)
);

CREATE TABLE public.trip_confirmed_transport (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  mode text NOT NULL,
  origin text,
  destination text,
  departure_at timestamptz,
  arrival_at timestamptz,
  notes text,
  PRIMARY KEY (trip_id, id),
  CHECK (char_length(mode) <= 80),
  CHECK (origin IS NULL OR char_length(origin) <= 160),
  CHECK (destination IS NULL OR char_length(destination) <= 160),
  CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CHECK (departure_at IS NULL OR arrival_at IS NULL OR arrival_at >= departure_at)
);

CREATE TABLE public.trip_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  creator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  status text NOT NULL,
  title text NOT NULL,
  draft_version integer NOT NULL,
  deadline timestamptz,
  blocked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (trip_id, id),
  UNIQUE (trip_id, creator_user_id, idempotency_key),
  CHECK (status IN ('pending','blocked','accepted','rejected','cancelled','expired','stale','needs_revision')),
  CHECK (char_length(title) BETWEEN 1 AND 120),
  CHECK (draft_version >= 1)
);

CREATE TABLE public.trip_proposal_operations (
  proposal_id uuid NOT NULL REFERENCES public.trip_proposals(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  expected_version integer NOT NULL,
  old_value jsonb NOT NULL,
  proposed_value jsonb NOT NULL,
  PRIMARY KEY (proposal_id, scope_key),
  CHECK (expected_version >= 0),
  CHECK (octet_length(old_value::text) <= 131072),
  CHECK (octet_length(proposed_value::text) <= 131072)
);

CREATE TABLE public.trip_proposal_voters (
  proposal_id uuid NOT NULL REFERENCES public.trip_proposals(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  vote text,
  voted_at timestamptz,
  PRIMARY KEY (proposal_id, user_id),
  CHECK (vote IS NULL OR vote IN ('accept','reject')),
  CHECK ((vote IS NULL AND voted_at IS NULL) OR (vote IS NOT NULL AND voted_at IS NOT NULL))
);

CREATE TABLE public.trip_proposal_prerequisites (
  proposal_id uuid NOT NULL REFERENCES public.trip_proposals(id) ON DELETE RESTRICT,
  prerequisite_proposal_id uuid NOT NULL REFERENCES public.trip_proposals(id) ON DELETE RESTRICT,
  PRIMARY KEY (proposal_id, prerequisite_proposal_id),
  CHECK (proposal_id <> prerequisite_proposal_id)
);

CREATE TABLE public.trip_proposal_scope_versions (
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (trip_id, scope_key),
  CHECK (version >= 0)
);

ALTER TABLE public.messages
  ADD COLUMN proposal_id uuid REFERENCES public.trip_proposals(id) ON DELETE RESTRICT,
  ADD COLUMN proposal_trip_id uuid REFERENCES public.trips(id) ON DELETE RESTRICT,
  ADD CONSTRAINT messages_proposal_reference_pair_check
    CHECK ((proposal_id IS NULL AND proposal_trip_id IS NULL) OR
      (proposal_id IS NOT NULL AND proposal_trip_id IS NOT NULL AND type='system'));

CREATE INDEX trip_proposals_trip_created_idx ON public.trip_proposals(trip_id, created_at DESC, id DESC);
CREATE INDEX trip_proposal_operations_scope_idx ON public.trip_proposal_operations(proposal_id, scope_key);
CREATE INDEX trip_proposal_voters_user_idx ON public.trip_proposal_voters(user_id, proposal_id);
CREATE INDEX trip_proposal_prerequisites_lookup_idx ON public.trip_proposal_prerequisites(prerequisite_proposal_id, proposal_id);

ALTER TABLE public.trip_confirmed_accommodations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_confirmed_transport ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_proposal_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_proposal_voters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_proposal_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_proposal_scope_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_confirmed_accommodations_select_member ON public.trip_confirmed_accommodations
  FOR SELECT TO app_runtime USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_confirmed_transport_select_member ON public.trip_confirmed_transport
  FOR SELECT TO app_runtime USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_proposals_select_member ON public.trip_proposals
  FOR SELECT TO app_runtime USING (public.is_current_active_trip_participant(trip_id));
CREATE POLICY trip_proposal_operations_select_member ON public.trip_proposal_operations
  FOR SELECT TO app_runtime USING (EXISTS (SELECT 1 FROM public.trip_proposals p WHERE p.id=proposal_id AND public.is_current_active_trip_participant(p.trip_id)));
CREATE POLICY trip_proposal_voters_select_member ON public.trip_proposal_voters
  FOR SELECT TO app_runtime USING (EXISTS (SELECT 1 FROM public.trip_proposals p WHERE p.id=proposal_id AND public.is_current_active_trip_participant(p.trip_id)));
CREATE POLICY trip_proposal_prerequisites_select_member ON public.trip_proposal_prerequisites
  FOR SELECT TO app_runtime USING (EXISTS (SELECT 1 FROM public.trip_proposals p WHERE p.id=proposal_id AND public.is_current_active_trip_participant(p.trip_id)));
CREATE POLICY trip_proposal_scope_versions_select_member ON public.trip_proposal_scope_versions
  FOR SELECT TO app_runtime USING (public.is_current_active_trip_participant(trip_id));

CREATE FUNCTION public.trip_proposal_scopes_overlap(p_left text, p_right text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT p_left=p_right
    OR (p_left='itinerary:all' AND (p_right LIKE 'itinerary:day:%' OR p_right LIKE 'itinerary:event:%'))
    OR (p_right='itinerary:all' AND (p_left LIKE 'itinerary:day:%' OR p_left LIKE 'itinerary:event:%'))
    OR (p_left LIKE 'itinerary:day:%' AND p_right LIKE 'itinerary:event:%'
        AND split_part(p_left,':',3)=split_part(p_right,':',3))
    OR (p_right LIKE 'itinerary:day:%' AND p_left LIKE 'itinerary:event:%'
        AND split_part(p_right,':',3)=split_part(p_left,':',3))
    OR (p_left LIKE 'itinerary:event:%' AND p_right LIKE 'itinerary:event:%'
        AND split_part(p_left,':',3)=split_part(p_right,':',3))
$$;

CREATE FUNCTION public.guard_trip_proposal_immutable_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.draft_version IS DISTINCT FROM OLD.draft_version
    OR NEW.deadline IS DISTINCT FROM OLD.deadline
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'proposal immutable fields cannot be changed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_proposals_immutable_fields BEFORE UPDATE ON public.trip_proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_trip_proposal_immutable_fields();

CREATE FUNCTION public.guard_trip_proposal_operation_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'proposal operations are immutable' USING ERRCODE='42501';
END $$;
CREATE TRIGGER trip_proposal_operations_immutable BEFORE UPDATE OR DELETE ON public.trip_proposal_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_trip_proposal_operation_immutable();
CREATE FUNCTION public.guard_trip_proposal_vote_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.vote IS NOT NULL OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'proposal vote is immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_proposal_votes_immutable BEFORE UPDATE ON public.trip_proposal_voters
  FOR EACH ROW EXECUTE FUNCTION public.guard_trip_proposal_vote_immutable();

CREATE FUNCTION public.append_trip_proposal_chat_event(p_trip_id uuid, p_chat_id uuid, p_proposal_id uuid, p_event text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_sequence bigint;
BEGIN
  UPDATE public.chats c SET last_sequence=c.last_sequence+1, updated_at=pg_catalog.now()
  WHERE c.id=p_chat_id RETURNING c.last_sequence INTO v_sequence;
  IF v_sequence IS NULL THEN RAISE EXCEPTION 'proposal chat unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.messages(chat_id, sequence_number, type, system_event, proposal_id, proposal_trip_id)
  VALUES (p_chat_id, v_sequence, 'system', p_event, p_proposal_id, p_trip_id);
  UPDATE public.chat_participants cp SET last_visible_message_sequence=GREATEST(cp.last_visible_message_sequence,v_sequence), updated_at=pg_catalog.now()
  WHERE cp.chat_id=p_chat_id AND cp.left_at IS NULL;
END $$;

CREATE FUNCTION public.trip_proposal_scope_version(p_trip_id uuid, p_scope text)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v integer; v_scope_key text;
BEGIN
  IF p_scope='route' THEN SELECT destination_version INTO v FROM public.trips WHERE id=p_trip_id;
  ELSIF p_scope='dates' THEN SELECT dates_version INTO v FROM public.trips WHERE id=p_trip_id;
  ELSIF p_scope='budget' THEN SELECT budget_version INTO v FROM public.trips WHERE id=p_trip_id;
  ELSIF p_scope='transport' THEN SELECT transport_version INTO v FROM public.trips WHERE id=p_trip_id;
  ELSIF p_scope='accommodation' THEN
    v_scope_key:=p_scope;
    INSERT INTO public.trip_proposal_scope_versions(trip_id,scope_key,version) VALUES(p_trip_id,v_scope_key,0)
    ON CONFLICT (trip_id,scope_key) DO NOTHING;
    SELECT version INTO v FROM public.trip_proposal_scope_versions WHERE trip_id=p_trip_id AND scope_key=v_scope_key;
  ELSE
    IF p_scope='itinerary:all' THEN
      v_scope_key:=p_scope;
    ELSIF p_scope LIKE 'itinerary:day:%' THEN
      v_scope_key:=p_scope;
    ELSIF p_scope ~ '^itinerary:event:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$' THEN
      v_scope_key:='itinerary:day:'||split_part(p_scope,':',3);
    ELSE
      RAISE EXCEPTION 'unsupported proposal scope' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.trip_proposal_scope_versions(trip_id,scope_key,version) VALUES(p_trip_id,v_scope_key,0)
    ON CONFLICT (trip_id,scope_key) DO NOTHING;
    SELECT version INTO v FROM public.trip_proposal_scope_versions WHERE trip_id=p_trip_id AND scope_key=v_scope_key;
  END IF;
  RETURN COALESCE(v,0);
END $$;

CREATE FUNCTION public.bump_trip_proposal_itinerary_versions(p_trip_id uuid,p_scope text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_day_id text;
BEGIN
  IF p_scope='itinerary:all' THEN
    UPDATE public.trip_proposal_scope_versions SET version=version+1
    WHERE trip_id=p_trip_id AND (scope_key='itinerary:all' OR scope_key LIKE 'itinerary:day:%');
    RETURN;
  END IF;
  IF p_scope LIKE 'itinerary:event:%' THEN
    v_day_id:=split_part(p_scope,':',3);
  ELSE
    v_day_id:=split_part(p_scope,':',3);
  END IF;
  INSERT INTO public.trip_proposal_scope_versions(trip_id,scope_key,version)
  VALUES (p_trip_id,'itinerary:all',1)
  ON CONFLICT (trip_id,scope_key) DO UPDATE
    SET version=public.trip_proposal_scope_versions.version+1;
  INSERT INTO public.trip_proposal_scope_versions(trip_id,scope_key,version)
  VALUES (p_trip_id,'itinerary:day:'||v_day_id,1)
  ON CONFLICT (trip_id,scope_key) DO UPDATE
    SET version=public.trip_proposal_scope_versions.version+1;
END $$;

CREATE FUNCTION public.capture_trip_proposal_value(p_trip_id uuid, p_scope text, p_content jsonb, p_old boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid; v_result jsonb;
BEGIN
  IF p_scope='route' THEN
    IF p_old THEN
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'place_label',s.place_label,'country_code',s.country_code,'place_ref',s.place_ref,'stay_from',s.stay_from,'stay_to',s.stay_to,'notes',s.notes) ORDER BY s.position),'[]'::jsonb) INTO v_result FROM public.trip_stops s WHERE s.trip_id=p_trip_id;
    ELSE v_result:=COALESCE(p_content->'route_stops','[]'::jsonb); END IF;
  ELSIF p_scope='dates' THEN
    IF p_old THEN SELECT pg_catalog.jsonb_build_object('date_from',date_from,'date_to',date_to) INTO v_result FROM public.trips WHERE id=p_trip_id;
    ELSE v_result:=pg_catalog.jsonb_build_object('date_from',p_content->'date_from','date_to',p_content->'date_to'); END IF;
  ELSIF p_scope='budget' THEN
    IF p_old THEN SELECT pg_catalog.jsonb_build_object('min',budget_min,'max',budget_max,'currency',budget_currency,'scope',budget_scope) INTO v_result FROM public.trips WHERE id=p_trip_id;
    ELSE v_result:=p_content->'budget'; END IF;
  ELSIF p_scope='transport' THEN
    IF p_old THEN SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'mode',mode,'origin',origin,'destination',destination,'departure_at',departure_at,'arrival_at',arrival_at,'notes',notes) ORDER BY id),'[]'::jsonb) INTO v_result FROM public.trip_confirmed_transport WHERE trip_id=p_trip_id;
    ELSE v_result:=COALESCE(p_content->'transport','[]'::jsonb); END IF;
  ELSIF p_scope='accommodation' THEN
    IF p_old THEN SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'name',name,'location',location,'date_from',date_from,'date_to',date_to,'notes',notes) ORDER BY id),'[]'::jsonb) INTO v_result FROM public.trip_confirmed_accommodations WHERE trip_id=p_trip_id;
    ELSE v_result:=COALESCE(p_content->'accommodations','[]'::jsonb); END IF;
  ELSIF p_scope='itinerary:all' THEN
    IF p_old THEN
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',d.id,'position',d.position,'date',d.day_date,'title',d.title,'notes',d.notes,'events',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'start_time',e.start_time,'duration_minutes',e.duration_minutes,'address',e.address,'estimated_cost',e.estimated_cost,'currency',e.currency,'notes',e.notes) ORDER BY e.position) FROM public.trip_itinerary_events e WHERE e.trip_id=d.trip_id AND e.day_id=d.id),'[]'::jsonb)) ORDER BY d.position),'[]'::jsonb) INTO v_result FROM public.trip_itinerary_days d WHERE d.trip_id=p_trip_id;
    ELSE v_result:=COALESCE(p_content->'days','[]'::jsonb); END IF;
  ELSIF p_scope LIKE 'itinerary:day:%' THEN
    v_id:=substring(p_scope from 15)::uuid;
    IF p_old THEN
      SELECT pg_catalog.jsonb_build_object('id',d.id,'position',d.position,'date',d.day_date,'title',d.title,'notes',d.notes,'events',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,'kind',e.kind,'title',e.title,'start_time',e.start_time,'duration_minutes',e.duration_minutes,'address',e.address,'estimated_cost',e.estimated_cost,'currency',e.currency,'notes',e.notes) ORDER BY e.position) FROM public.trip_itinerary_events e WHERE e.trip_id=d.trip_id AND e.day_id=d.id),'[]'::jsonb)) INTO v_result FROM public.trip_itinerary_days d WHERE d.trip_id=p_trip_id AND d.id=v_id;
    ELSE SELECT pg_catalog.jsonb_set(day.value,'{position}',day.ordinality::text::jsonb) INTO v_result FROM pg_catalog.jsonb_array_elements(COALESCE(p_content->'days','[]'::jsonb)) WITH ORDINALITY day(value,ordinality) WHERE day.value->>'id'=v_id::text; END IF;
  ELSIF p_scope LIKE 'itinerary:event:%' THEN
    v_id:=split_part(p_scope,':',4)::uuid;
    IF p_old THEN
      SELECT pg_catalog.jsonb_build_object('id',e.id,'day_id',e.day_id,'position',e.position,'kind',e.kind,'title',e.title,'start_time',e.start_time,'duration_minutes',e.duration_minutes,'address',e.address,'estimated_cost',e.estimated_cost,'currency',e.currency,'notes',e.notes)
        INTO v_result FROM public.trip_itinerary_events e
        WHERE e.trip_id=p_trip_id AND e.day_id=split_part(p_scope,':',3)::uuid AND e.id=v_id;
    ELSE
      SELECT event.value INTO v_result
      FROM pg_catalog.jsonb_array_elements(COALESCE(p_content->'days','[]'::jsonb)) day(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(day.value->'events','[]'::jsonb)) event(value)
      WHERE day.value->>'id'=split_part(p_scope,':',3) AND event.value->>'id'=v_id::text;
    END IF;
  ELSE RAISE EXCEPTION 'unsupported proposal scope' USING ERRCODE='22023';
  END IF;
  RETURN COALESCE(v_result,'null'::jsonb);
END $$;

CREATE FUNCTION public.create_current_trip_proposal(
  p_trip_id uuid, p_draft_version integer, p_title text, p_idempotency_key uuid, p_scopes text[],
  p_prerequisite_ids uuid[] DEFAULT ARRAY[]::uuid[], p_deadline timestamptz DEFAULT NULL
)
RETURNS TABLE(proposal_id uuid, status text, blocked_reason text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid; v_chat uuid; v_content jsonb; v_scope text; v_current integer;
  v_proposal uuid; v_blocked boolean:=false; v_prereq uuid; v_existing public.trip_proposals%ROWTYPE;
  v_payload_bytes integer:=0; v_old jsonb; v_new jsonb; v_index integer; v_other text;
BEGIN
  v_actor:=public.current_authenticated_user_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE='42501'; END IF;
  IF p_title IS NULL OR pg_catalog.btrim(p_title)='' OR pg_catalog.char_length(p_title)>120
    OR p_draft_version IS NULL OR p_draft_version<1 OR p_scopes IS NULL OR pg_catalog.cardinality(p_scopes)<1
    OR pg_catalog.cardinality(p_scopes)>20 OR pg_catalog.cardinality(p_scopes)<> (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_scopes) x)
    OR pg_catalog.cardinality(COALESCE(p_prerequisite_ids,ARRAY[]::uuid[]))>10 THEN
    RAISE EXCEPTION 'invalid proposal request' USING ERRCODE='22023';
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline<=pg_catalog.now() THEN RAISE EXCEPTION 'proposal deadline must be in the future' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.trips t JOIN public.trip_participants tp ON tp.trip_id=t.id AND tp.user_id=v_actor AND tp.left_at IS NULL
  WHERE t.id=p_trip_id AND t.status IN ('forming','active') FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip not found' USING ERRCODE='P0002'; END IF;
  SELECT t.chat_id INTO v_chat FROM public.trips t WHERE t.id=p_trip_id;
  SELECT p.* INTO v_existing FROM public.trip_proposals p WHERE p.trip_id=p_trip_id
    AND p.creator_user_id=v_actor AND p.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.title<>p_title OR v_existing.draft_version<>p_draft_version OR
      v_existing.deadline IS DISTINCT FROM p_deadline OR
      (SELECT array_agg(o.scope_key ORDER BY o.scope_key) FROM public.trip_proposal_operations o WHERE o.proposal_id=v_existing.id)
       IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM pg_catalog.unnest(p_scopes) s) OR
      COALESCE((SELECT array_agg(link.prerequisite_proposal_id ORDER BY link.prerequisite_proposal_id)
        FROM public.trip_proposal_prerequisites link WHERE link.proposal_id=v_existing.id), ARRAY[]::uuid[])
       IS DISTINCT FROM COALESCE((SELECT array_agg(prerequisite_id ORDER BY prerequisite_id)
        FROM pg_catalog.unnest(COALESCE(p_prerequisite_ids,ARRAY[]::uuid[])) AS input(prerequisite_id)), ARRAY[]::uuid[]) THEN
      RAISE EXCEPTION 'proposal idempotency key reused for different request' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.status,v_existing.blocked_reason; RETURN;
  END IF;
  IF (SELECT count(*) FROM public.trip_proposals active_proposal
      WHERE active_proposal.trip_id=p_trip_id AND active_proposal.status IN ('pending','blocked'))>=50 THEN
    RAISE EXCEPTION 'active proposal limit reached' USING ERRCODE='P0001', DETAIL='proposal_limit';
  END IF;
  SELECT d.content INTO v_content FROM public.trip_drafts d WHERE d.trip_id=p_trip_id AND d.version=p_draft_version FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft version conflict' USING ERRCODE='40001'; END IF;
  FOREACH v_scope IN ARRAY p_scopes LOOP
    IF v_scope NOT IN ('route','dates','budget','transport','accommodation','itinerary:all')
      AND v_scope !~ '^itinerary:day:[0-9a-fA-F-]{36}$'
      AND v_scope !~ '^itinerary:event:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'unsupported proposal scope' USING ERRCODE='22023'; END IF;
    IF v_scope LIKE 'itinerary:day:%' AND public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,false)='null'::jsonb THEN
      IF public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,true)='null'::jsonb THEN
        RAISE EXCEPTION 'selected itinerary day is absent from Draft and Confirmed Trip' USING ERRCODE='22023';
      END IF;
    END IF;
    IF v_scope LIKE 'itinerary:event:%' AND
      public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,false)='null'::jsonb AND
      public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,true)='null'::jsonb THEN
      RAISE EXCEPTION 'selected itinerary event is absent from Draft and Confirmed Trip' USING ERRCODE='22023';
    END IF;
    IF v_scope LIKE 'itinerary:event:%' AND
      public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,false)<>'null'::jsonb AND
      NOT EXISTS (SELECT 1 FROM public.trip_itinerary_days d
        WHERE d.trip_id=p_trip_id AND d.id=split_part(v_scope,':',3)::uuid) THEN
      RAISE EXCEPTION 'event parent day must already be confirmed' USING ERRCODE='22023';
    END IF;
    IF v_scope LIKE 'itinerary:event:%' AND
      public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,false)<>'null'::jsonb AND
      EXISTS (SELECT 1 FROM public.trip_itinerary_events e WHERE e.trip_id=p_trip_id
        AND e.id=split_part(v_scope,':',4)::uuid AND e.day_id<>split_part(v_scope,':',3)::uuid) THEN
      RAISE EXCEPTION 'event cannot move between days through an event-level Proposal' USING ERRCODE='22023';
    END IF;
    IF v_scope='route' AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'route_stops','[]'::jsonb)) x WHERE COALESCE(pg_catalog.btrim(x.value->>'place_label'),'')='') THEN
      RAISE EXCEPTION 'route stop label is required' USING ERRCODE='22023';
    END IF;
    IF v_scope='accommodation' AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'accommodations','[]'::jsonb)) x WHERE COALESCE(pg_catalog.btrim(x.value->>'name'),'')='') THEN
      RAISE EXCEPTION 'accommodation name is required' USING ERRCODE='22023';
    END IF;
    IF v_scope='transport' AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'transport','[]'::jsonb)) x WHERE COALESCE(pg_catalog.btrim(x.value->>'mode'),'')='') THEN
      RAISE EXCEPTION 'transport mode is required' USING ERRCODE='22023';
    END IF;
    IF v_scope='itinerary:all' AND EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'days','[]'::jsonb)) d,
        LATERAL pg_catalog.jsonb_array_elements(COALESCE(d.value->'events','[]'::jsonb)) e
      WHERE COALESCE(pg_catalog.btrim(e.value->>'title'),'')='') THEN
      RAISE EXCEPTION 'itinerary event title is required' USING ERRCODE='22023';
    END IF;
    IF v_scope LIKE 'itinerary:day:%' AND EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'days','[]'::jsonb)) d,
        LATERAL pg_catalog.jsonb_array_elements(COALESCE(d.value->'events','[]'::jsonb)) e
      WHERE d.value->>'id'=substring(v_scope from 15) AND COALESCE(pg_catalog.btrim(e.value->>'title'),'')='') THEN
      RAISE EXCEPTION 'itinerary event title is required' USING ERRCODE='22023';
    END IF;
    IF v_scope LIKE 'itinerary:event:%' AND EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_content->'days','[]'::jsonb)) d,
        LATERAL pg_catalog.jsonb_array_elements(COALESCE(d.value->'events','[]'::jsonb)) e
      WHERE d.value->>'id'=split_part(v_scope,':',3)
        AND e.value->>'id'=split_part(v_scope,':',4)
        AND COALESCE(pg_catalog.btrim(e.value->>'title'),'')='') THEN
      RAISE EXCEPTION 'itinerary event title is required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOR v_index IN 1..pg_catalog.cardinality(p_scopes) LOOP
    FOR v_other IN SELECT p_scopes[i] FROM pg_catalog.generate_series(v_index+1,pg_catalog.cardinality(p_scopes)) i LOOP
      IF public.trip_proposal_scopes_overlap(p_scopes[v_index],v_other) THEN
        RAISE EXCEPTION 'proposal contains overlapping scopes' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_prereq IN ARRAY COALESCE(p_prerequisite_ids,ARRAY[]::uuid[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.trip_proposals p WHERE p.id=v_prereq AND p.trip_id=p_trip_id) THEN
      RAISE EXCEPTION 'proposal prerequisite not found' USING ERRCODE='P0002'; END IF;
  END LOOP;
  SELECT EXISTS (SELECT 1 FROM public.trip_proposals p WHERE p.id=ANY(COALESCE(p_prerequisite_ids,ARRAY[]::uuid[])) AND p.status<>'accepted') INTO v_blocked;
  IF NOT v_blocked THEN
    FOREACH v_scope IN ARRAY p_scopes LOOP
      IF EXISTS (SELECT 1 FROM public.trip_proposal_operations existing_op JOIN public.trip_proposals existing ON existing.id=existing_op.proposal_id
        WHERE existing.trip_id=p_trip_id AND existing.status='pending'
          AND public.trip_proposal_scopes_overlap(existing_op.scope_key,v_scope)) THEN
        RAISE EXCEPTION 'proposal scope is already pending' USING ERRCODE='P0001', DETAIL=v_scope;
      END IF;
    END LOOP;
  END IF;
  v_proposal:=pg_catalog.gen_random_uuid();
  INSERT INTO public.trip_proposals(id,trip_id,creator_user_id,idempotency_key,status,title,draft_version,deadline,blocked_reason)
  VALUES(v_proposal,p_trip_id,v_actor,p_idempotency_key,CASE WHEN v_blocked THEN 'blocked' ELSE 'pending' END,p_title,p_draft_version,p_deadline,CASE WHEN v_blocked THEN 'prerequisite_pending' END);
  INSERT INTO public.trip_proposal_voters(proposal_id,user_id)
  SELECT v_proposal,tp.user_id FROM public.trip_participants tp WHERE tp.trip_id=p_trip_id AND tp.left_at IS NULL;
  IF NOT EXISTS (SELECT 1 FROM public.trip_proposal_voters v WHERE v.proposal_id=v_proposal AND v.user_id=v_actor) THEN RAISE EXCEPTION 'active Trip membership required' USING ERRCODE='P0002'; END IF;
  FOREACH v_prereq IN ARRAY COALESCE(p_prerequisite_ids,ARRAY[]::uuid[]) LOOP
    INSERT INTO public.trip_proposal_prerequisites(proposal_id,prerequisite_proposal_id) VALUES(v_proposal,v_prereq);
  END LOOP;
  FOREACH v_scope IN ARRAY p_scopes LOOP
    v_current:=public.trip_proposal_scope_version(p_trip_id,v_scope);
    v_old:=public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,true);
    v_new:=public.capture_trip_proposal_value(p_trip_id,v_scope,v_content,false);
    IF v_old='null'::jsonb AND v_new='null'::jsonb THEN RAISE EXCEPTION 'selected scope has no confirmed or Draft data' USING ERRCODE='22023'; END IF;
    v_payload_bytes:=v_payload_bytes+pg_catalog.octet_length(v_old::text)+pg_catalog.octet_length(v_new::text);
    IF v_payload_bytes>262144 THEN RAISE EXCEPTION 'proposal payload exceeds 256 KiB' USING ERRCODE='22023'; END IF;
    INSERT INTO public.trip_proposal_operations(proposal_id,scope_key,expected_version,old_value,proposed_value)
    VALUES(v_proposal,v_scope,v_current,v_old,v_new);
  END LOOP;
  PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_proposal,'proposal_created');
  RETURN QUERY SELECT v_proposal,CASE WHEN v_blocked THEN 'blocked' ELSE 'pending' END,CASE WHEN v_blocked THEN 'prerequisite_pending' ELSE NULL END;
END $$;

CREATE FUNCTION public.apply_trip_proposal(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_trip uuid; v_scope text; v_value jsonb; v_old jsonb; v_item jsonb; v_id uuid; v_position integer; v_version integer; v_chat uuid;
BEGIN
  SELECT p.trip_id INTO v_trip FROM public.trip_proposals p WHERE p.id=p_proposal_id;
  FOR v_scope,v_value IN SELECT o.scope_key,o.proposed_value FROM public.trip_proposal_operations o WHERE o.proposal_id=p_proposal_id ORDER BY o.scope_key LOOP
    SELECT old_value INTO v_old FROM public.trip_proposal_operations WHERE proposal_id=p_proposal_id AND scope_key=v_scope;
    IF public.trip_proposal_scope_version(v_trip,v_scope)<>(SELECT o.expected_version FROM public.trip_proposal_operations o WHERE o.proposal_id=p_proposal_id AND o.scope_key=v_scope) THEN
      RAISE EXCEPTION 'proposal scope version conflict' USING ERRCODE='40001', DETAIL=v_scope; END IF;
    IF v_scope='route' THEN
      DELETE FROM public.trip_stops WHERE trip_id=v_trip;
      v_position:=0;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_value) LOOP
        v_position:=v_position+1;
        INSERT INTO public.trip_stops(id,trip_id,position,place_label,country_code,place_ref,stay_from,stay_to,notes)
        VALUES((v_item->>'id')::uuid,v_trip,v_position,COALESCE(v_item->>'place_label',''),v_item->>'country_code',v_item->>'place_ref',NULLIF(v_item->>'stay_from','')::date,NULLIF(v_item->>'stay_to','')::date,v_item->>'notes');
      END LOOP;
      UPDATE public.trips SET destination_version=destination_version+1,destination_status='confirmed' WHERE id=v_trip;
    ELSIF v_scope='dates' THEN
      UPDATE public.trips SET date_from=NULLIF(v_value->>'date_from','')::date,date_to=NULLIF(v_value->>'date_to','')::date,dates_version=dates_version+1,dates_status='confirmed' WHERE id=v_trip;
    ELSIF v_scope='budget' THEN
      UPDATE public.trips SET budget_min=NULLIF(v_value->>'min','')::numeric,budget_max=NULLIF(v_value->>'max','')::numeric,budget_currency=v_value->>'currency',budget_scope=v_value->>'scope',budget_version=budget_version+1,budget_status='confirmed' WHERE id=v_trip;
    ELSIF v_scope='transport' THEN
      DELETE FROM public.trip_confirmed_transport WHERE trip_id=v_trip;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_value) LOOP
        INSERT INTO public.trip_confirmed_transport(trip_id,id,mode,origin,destination,departure_at,arrival_at,notes)
        VALUES(v_trip,(v_item->>'id')::uuid,COALESCE(v_item->>'mode',''),v_item->>'origin',v_item->>'destination',NULLIF(v_item->>'departure_at','')::timestamptz,NULLIF(v_item->>'arrival_at','')::timestamptz,v_item->>'notes');
      END LOOP;
      UPDATE public.trips SET transport_version=transport_version+1,transport_status='confirmed' WHERE id=v_trip;
    ELSIF v_scope='accommodation' THEN
      DELETE FROM public.trip_confirmed_accommodations WHERE trip_id=v_trip;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_value) LOOP
        INSERT INTO public.trip_confirmed_accommodations(trip_id,id,name,location,date_from,date_to,notes)
        VALUES(v_trip,(v_item->>'id')::uuid,COALESCE(v_item->>'name',''),v_item->>'location',NULLIF(v_item->>'date_from','')::date,NULLIF(v_item->>'date_to','')::date,v_item->>'notes');
      END LOOP;
      INSERT INTO public.trip_proposal_scope_versions(trip_id,scope_key,version) VALUES(v_trip,v_scope,1)
      ON CONFLICT (trip_id,scope_key) DO UPDATE SET version=public.trip_proposal_scope_versions.version+1;
    ELSIF v_scope='itinerary:all' THEN
      DELETE FROM public.trip_itinerary_events WHERE trip_id=v_trip;
      DELETE FROM public.trip_itinerary_days WHERE trip_id=v_trip;
      v_position:=0;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_value) LOOP
        v_position:=v_position+1; v_id:=(v_item->>'id')::uuid;
        INSERT INTO public.trip_itinerary_days(id,trip_id,position,day_date,title,notes) VALUES(v_id,v_trip,v_position,NULLIF(v_item->>'date','')::date,v_item->>'title',v_item->>'notes');
        FOR v_version,v_value IN SELECT ordinality::integer,value FROM pg_catalog.jsonb_array_elements(COALESCE(v_item->'events','[]'::jsonb)) WITH ORDINALITY LOOP
          INSERT INTO public.trip_itinerary_events(id,trip_id,day_id,position,kind,title,start_time,duration_minutes,address,estimated_cost,currency,notes)
          VALUES((v_value->>'id')::uuid,v_trip,v_id,v_version,v_value->>'kind',COALESCE(v_value->>'title',''),NULLIF(v_value->>'start_time','')::time,NULLIF(v_value->>'duration_minutes','')::integer,v_value->>'address',NULLIF(v_value->>'estimated_cost','')::numeric,v_value->>'currency',v_value->>'notes');
        END LOOP;
      END LOOP;
      PERFORM public.bump_trip_proposal_itinerary_versions(v_trip,v_scope);
    ELSIF v_scope LIKE 'itinerary:day:%' THEN
      v_id:=substring(v_scope from 15)::uuid;
      DELETE FROM public.trip_itinerary_events WHERE trip_id=v_trip AND day_id=v_id;
      DELETE FROM public.trip_itinerary_days WHERE trip_id=v_trip AND id=v_id;
      IF v_value<>'null'::jsonb THEN
        INSERT INTO public.trip_itinerary_days(id,trip_id,position,day_date,title,notes)
        VALUES(v_id,v_trip,COALESCE(NULLIF(v_old->>'position','')::integer,(SELECT max(position)+1 FROM public.trip_itinerary_days WHERE trip_id=v_trip),1),NULLIF(v_value->>'date','')::date,v_value->>'title',v_value->>'notes');
        FOR v_version,v_item IN SELECT ordinality::integer,value FROM pg_catalog.jsonb_array_elements(COALESCE(v_value->'events','[]'::jsonb)) WITH ORDINALITY LOOP
          INSERT INTO public.trip_itinerary_events(id,trip_id,day_id,position,kind,title,start_time,duration_minutes,address,estimated_cost,currency,notes)
          VALUES((v_item->>'id')::uuid,v_trip,v_id,v_version,v_item->>'kind',COALESCE(v_item->>'title',''),NULLIF(v_item->>'start_time','')::time,NULLIF(v_item->>'duration_minutes','')::integer,v_item->>'address',NULLIF(v_item->>'estimated_cost','')::numeric,v_item->>'currency',v_item->>'notes');
        END LOOP;
      ELSE
        UPDATE public.trip_itinerary_days SET position=position+100000 WHERE trip_id=v_trip;
        WITH ordered AS (SELECT id,row_number() OVER (ORDER BY position,id)::integer AS new_position FROM public.trip_itinerary_days WHERE trip_id=v_trip)
        UPDATE public.trip_itinerary_days d SET position=ordered.new_position FROM ordered WHERE d.trip_id=v_trip AND d.id=ordered.id;
      END IF;
      PERFORM public.bump_trip_proposal_itinerary_versions(v_trip,v_scope);
    ELSIF v_scope LIKE 'itinerary:event:%' THEN
      v_id:=split_part(v_scope,':',4)::uuid;
      IF v_value='null'::jsonb THEN
        DELETE FROM public.trip_itinerary_events
        WHERE trip_id=v_trip AND day_id=split_part(v_scope,':',3)::uuid AND id=v_id;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM public.trip_itinerary_days
          WHERE trip_id=v_trip AND id=split_part(v_scope,':',3)::uuid) THEN
          RAISE EXCEPTION 'event parent day is not confirmed' USING ERRCODE='22023';
        END IF;
        v_position:=NULLIF(v_old->>'position','')::integer;
        DELETE FROM public.trip_itinerary_events
        WHERE trip_id=v_trip AND day_id=split_part(v_scope,':',3)::uuid AND id=v_id;
        IF v_position IS NULL THEN
          SELECT COALESCE(max(position),0)+1 INTO v_position FROM public.trip_itinerary_events
          WHERE trip_id=v_trip AND day_id=split_part(v_scope,':',3)::uuid;
        END IF;
        INSERT INTO public.trip_itinerary_events(
          id,trip_id,day_id,position,kind,title,start_time,duration_minutes,address,estimated_cost,currency,notes
        ) VALUES (
          v_id,v_trip,split_part(v_scope,':',3)::uuid,v_position,v_value->>'kind',
          COALESCE(v_value->>'title',''),NULLIF(v_value->>'start_time','')::time,
          NULLIF(v_value->>'duration_minutes','')::integer,v_value->>'address',
          NULLIF(v_value->>'estimated_cost','')::numeric,v_value->>'currency',v_value->>'notes'
        );
      END IF;
      PERFORM public.bump_trip_proposal_itinerary_versions(v_trip,v_scope);
    END IF;
  END LOOP;
  UPDATE public.trips SET state_version=state_version+1,updated_at=pg_catalog.now() WHERE id=v_trip RETURNING chat_id INTO v_chat;
  PERFORM public.append_trip_proposal_chat_event(v_trip,v_chat,p_proposal_id,'proposal_accepted');
END $$;

CREATE FUNCTION public.refresh_trip_blocked_proposals(p_trip_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_child uuid; v_chat uuid; v_conflict boolean;
BEGIN
  SELECT chat_id INTO v_chat FROM public.trips WHERE id=p_trip_id;
  FOR v_child IN SELECT id FROM public.trip_proposals WHERE trip_id=p_trip_id
    AND status IN ('pending','blocked') AND deadline IS NOT NULL AND deadline<=pg_catalog.now()
    ORDER BY created_at,id LOOP
    UPDATE public.trip_proposals SET status='expired',decided_at=pg_catalog.now(),blocked_reason='deadline_elapsed' WHERE id=v_child;
    PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_child,'proposal_expired');
  END LOOP;
  FOR v_child IN SELECT id FROM public.trip_proposals WHERE trip_id=p_trip_id AND status='blocked' ORDER BY created_at,id LOOP
    IF EXISTS (SELECT 1 FROM public.trip_proposals WHERE id=v_child AND deadline IS NOT NULL AND deadline<=pg_catalog.now()) THEN
      UPDATE public.trip_proposals SET status='expired',decided_at=pg_catalog.now(),blocked_reason='deadline_elapsed' WHERE id=v_child;
      PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_child,'proposal_expired');
    ELSIF EXISTS (
      SELECT 1 FROM public.trip_proposal_prerequisites link JOIN public.trip_proposals prerequisite ON prerequisite.id=link.prerequisite_proposal_id
      WHERE link.proposal_id=v_child AND prerequisite.status IN ('rejected','cancelled','expired','stale','needs_revision')) THEN
      UPDATE public.trip_proposals SET status='needs_revision',decided_at=pg_catalog.now(),blocked_reason='prerequisite_not_accepted' WHERE id=v_child;
      PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_child,'proposal_needs_revision');
    ELSIF EXISTS (
      SELECT 1 FROM public.trip_proposal_prerequisites link JOIN public.trip_proposals prerequisite ON prerequisite.id=link.prerequisite_proposal_id
      WHERE link.proposal_id=v_child AND prerequisite.status<>'accepted') THEN
      CONTINUE;
    ELSIF EXISTS (SELECT 1 FROM public.trip_proposal_operations o WHERE o.proposal_id=v_child
      AND public.trip_proposal_scope_version(p_trip_id,o.scope_key)<>o.expected_version) THEN
      UPDATE public.trip_proposals SET status='needs_revision',decided_at=pg_catalog.now(),blocked_reason='scope_version_changed' WHERE id=v_child;
      PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_child,'proposal_needs_revision');
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.trip_proposal_operations child_op
        JOIN public.trip_proposal_operations other_op ON public.trip_proposal_scopes_overlap(child_op.scope_key,other_op.scope_key)
        JOIN public.trip_proposals other ON other.id=other_op.proposal_id AND other.status='pending'
        WHERE child_op.proposal_id=v_child AND other.id<>v_child
      ) INTO v_conflict;
      IF NOT v_conflict THEN
        UPDATE public.trip_proposals SET status='pending',blocked_reason=NULL WHERE id=v_child;
        PERFORM public.append_trip_proposal_chat_event(p_trip_id,v_chat,v_child,'proposal_unblocked');
      ELSE
        UPDATE public.trip_proposals SET blocked_reason='scope_busy' WHERE id=v_child;
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.refresh_current_trip_proposals(p_trip_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=public.current_authenticated_user_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.trips t JOIN public.trip_participants tp ON tp.trip_id=t.id AND tp.user_id=v_actor AND tp.left_at IS NULL
    WHERE t.id=p_trip_id FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.refresh_trip_blocked_proposals(p_trip_id);
END $$;

CREATE FUNCTION public.cast_current_trip_proposal_vote(p_proposal_id uuid,p_vote text)
RETURNS TABLE(proposal_id uuid,status text,own_vote text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid; v_trip uuid; v_status text; v_chat uuid; v_pending integer; v_rejected integer; v_deadline timestamptz;
  v_saved_vote text;
BEGIN
  v_actor:=public.current_authenticated_user_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE='42501'; END IF;
  SELECT p.trip_id INTO v_trip FROM public.trip_proposals p WHERE p.id=p_proposal_id;
  IF NOT FOUND OR NOT public.is_current_active_trip_participant(v_trip) THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.trips WHERE id=v_trip FOR UPDATE;
  SELECT p.status,p.deadline INTO v_status,v_deadline FROM public.trip_proposals p
    WHERE p.id=p_proposal_id AND p.trip_id=v_trip FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
  SELECT voter.vote INTO v_saved_vote FROM public.trip_proposal_voters voter
    WHERE voter.proposal_id=p_proposal_id AND voter.user_id=v_actor;
  IF FOUND AND v_saved_vote IS NOT NULL THEN
    IF v_saved_vote=p_vote THEN RETURN QUERY SELECT p_proposal_id,v_status,v_saved_vote; RETURN; END IF;
    RAISE EXCEPTION 'vote is immutable' USING ERRCODE='P0001', DETAIL='vote_already_cast';
  END IF;
  IF v_status<>'pending' THEN RAISE EXCEPTION 'proposal is not pending' USING ERRCODE='P0001', DETAIL=v_status; END IF;
  IF v_deadline IS NOT NULL AND v_deadline<=pg_catalog.now() THEN
    UPDATE public.trip_proposals SET status='expired',decided_at=pg_catalog.now() WHERE id=p_proposal_id;
    SELECT t.chat_id INTO v_chat FROM public.trips t WHERE t.id=v_trip;
    PERFORM public.append_trip_proposal_chat_event(v_trip,v_chat,p_proposal_id,'proposal_expired');
    PERFORM public.refresh_trip_blocked_proposals(v_trip);
    RETURN QUERY SELECT p_proposal_id,'expired'::text,NULL::text; RETURN;
  END IF;
  IF p_vote IS NULL OR p_vote NOT IN ('accept','reject') THEN RAISE EXCEPTION 'vote must be accept or reject' USING ERRCODE='22023'; END IF;
  UPDATE public.trip_proposal_voters AS voter SET vote=p_vote,voted_at=pg_catalog.now()
  WHERE voter.proposal_id=p_proposal_id AND voter.user_id=v_actor AND voter.vote IS NULL;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.trip_proposal_voters voter
      WHERE voter.proposal_id=p_proposal_id AND voter.user_id=v_actor AND voter.vote=p_vote) THEN
      RETURN QUERY SELECT p_proposal_id,v_status,p_vote; RETURN;
    END IF;
    RAISE EXCEPTION 'voter unavailable or vote already cast' USING ERRCODE='P0001';
  END IF;
  SELECT count(*) FILTER (WHERE voter.vote IS NULL),count(*) FILTER (WHERE voter.vote='reject')
    INTO v_pending,v_rejected FROM public.trip_proposal_voters voter WHERE voter.proposal_id=p_proposal_id;
  IF v_rejected>0 THEN
    UPDATE public.trip_proposals SET status='rejected',decided_at=pg_catalog.now() WHERE id=p_proposal_id;
  ELSIF v_pending=0 THEN
    IF EXISTS (SELECT 1 FROM public.trip_proposal_operations o WHERE o.proposal_id=p_proposal_id
      AND public.trip_proposal_scope_version(v_trip,o.scope_key)<>o.expected_version) THEN
      UPDATE public.trip_proposals SET status='stale',blocked_reason='scope_version_changed',decided_at=pg_catalog.now() WHERE id=p_proposal_id;
      SELECT t.chat_id INTO v_chat FROM public.trips t WHERE t.id=v_trip;
      PERFORM public.append_trip_proposal_chat_event(v_trip,v_chat,p_proposal_id,'proposal_stale');
    ELSE
      PERFORM public.apply_trip_proposal(p_proposal_id);
      UPDATE public.trip_proposals SET status='accepted',decided_at=pg_catalog.now() WHERE id=p_proposal_id;
    END IF;
  END IF;
  SELECT p.status INTO v_status FROM public.trip_proposals p WHERE p.id=p_proposal_id;
    IF v_status IN ('accepted','rejected','stale') THEN
    SELECT t.chat_id INTO v_chat FROM public.trips t WHERE t.id=v_trip;
    IF v_status='rejected' THEN PERFORM public.append_trip_proposal_chat_event(v_trip,v_chat,p_proposal_id,'proposal_rejected'); END IF;
    PERFORM public.refresh_trip_blocked_proposals(v_trip);
  END IF;
  RETURN QUERY SELECT p_proposal_id,v_status,p_vote;
END $$;

CREATE FUNCTION public.cancel_current_trip_proposal(p_proposal_id uuid)
RETURNS TABLE(proposal_id uuid,status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid; v_trip uuid; v_status text; v_chat uuid;
BEGIN
  v_actor:=public.current_authenticated_user_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authenticated user context is required' USING ERRCODE='42501'; END IF;
  SELECT p.trip_id INTO v_trip FROM public.trip_proposals p WHERE p.id=p_proposal_id AND p.creator_user_id=v_actor;
  IF NOT FOUND OR NOT public.is_current_active_trip_participant(v_trip) THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.trips WHERE id=v_trip FOR UPDATE;
  SELECT p.status INTO v_status FROM public.trip_proposals p
    WHERE p.id=p_proposal_id AND p.trip_id=v_trip AND p.creator_user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE='P0002'; END IF;
  IF v_status NOT IN ('pending','blocked') THEN RAISE EXCEPTION 'proposal is not cancellable' USING ERRCODE='P0001',DETAIL=v_status; END IF;
  UPDATE public.trip_proposals SET status='cancelled',decided_at=pg_catalog.now() WHERE id=p_proposal_id;
  SELECT chat_id INTO v_chat FROM public.trips WHERE id=v_trip;
  PERFORM public.append_trip_proposal_chat_event(v_trip,v_chat,p_proposal_id,'proposal_cancelled');
  PERFORM public.refresh_trip_blocked_proposals(v_trip);
  RETURN QUERY SELECT p_proposal_id,'cancelled'::text;
END $$;

REVOKE ALL ON TABLE public.trip_confirmed_accommodations,public.trip_confirmed_transport,public.trip_proposals,public.trip_proposal_operations,public.trip_proposal_voters,public.trip_proposal_prerequisites,public.trip_proposal_scope_versions FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.trip_proposal_scopes_overlap(text,text) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.guard_trip_proposal_immutable_fields() FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.guard_trip_proposal_operation_immutable() FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.guard_trip_proposal_vote_immutable() FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.append_trip_proposal_chat_event(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.trip_proposal_scope_version(uuid,text) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.bump_trip_proposal_itinerary_versions(uuid,text) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.capture_trip_proposal_value(uuid,text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.apply_trip_proposal(uuid) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.refresh_trip_blocked_proposals(uuid) FROM PUBLIC,anon,authenticated,service_role,app_runtime;
REVOKE ALL ON FUNCTION public.refresh_current_trip_proposals(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_current_trip_proposal(uuid,integer,text,uuid,text[],uuid[],timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cast_current_trip_proposal_vote(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_current_trip_proposal(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_current_trip_proposal(uuid,integer,text,uuid,text[],uuid[],timestamptz) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cast_current_trip_proposal_vote(uuid,text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_current_trip_proposal(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.refresh_current_trip_proposals(uuid) TO app_runtime;
