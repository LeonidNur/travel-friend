create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  membership_version integer not null default 1,
  last_sequence bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type in ('direct', 'group')),
  check (membership_version >= 1),
  check (last_sequence >= 0)
);

alter table public.matches
  add column chat_id uuid unique references public.chats (id) on delete restrict;

create table public.chat_participants (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  hidden_at timestamptz,
  last_read_sequence bigint not null default 0,
  last_visible_message_sequence bigint not null default 0,
  left_after_sequence bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, user_id),
  check (last_read_sequence >= 0),
  check (last_visible_message_sequence >= 0),
  check (left_after_sequence is null or left_after_sequence >= 0),
  check (last_read_sequence <= last_visible_message_sequence)
);

create index chat_participants_user_id_idx on public.chat_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete restrict,
  sender_user_id uuid references public.users (id) on delete restrict,
  recipient_user_id uuid references public.users (id) on delete restrict,
  sequence_number bigint not null,
  type text not null,
  content_text text,
  system_event text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (chat_id, sequence_number),
  check (sequence_number > 0),
  check (type in ('user', 'system')),
  check (
    (type = 'user' and sender_user_id is not null and recipient_user_id is null)
    or (type = 'system' and sender_user_id is null)
  )
);

create index messages_chat_id_sequence_number_desc_idx
  on public.messages (chat_id, sequence_number desc);

create table public.chat_summaries (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null unique references public.chats (id) on delete restrict,
  summary_text text not null,
  through_sequence bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (through_sequence >= 0)
);

create function public.enforce_direct_chat_participant_count()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_chat_id uuid;
  target_chat_ids uuid[];
  participant_count bigint;
begin
  if tg_table_name = 'chats' then
    target_chat_id := new.id;
    if new.type <> 'direct' then
      return null;
    end if;
  else
    if tg_op = 'INSERT' then
      target_chat_ids := array[new.chat_id];
    elsif tg_op = 'DELETE' then
      target_chat_ids := array[old.chat_id];
    else
      target_chat_ids := array[old.chat_id, new.chat_id];
    end if;

    foreach target_chat_id in array target_chat_ids
    loop
      continue when target_chat_id is null;

      if not exists (
        select 1
        from public.chats
        where id = target_chat_id
          and type = 'direct'
      ) then
        continue;
      end if;

      select count(*)
      into participant_count
      from public.chat_participants
      where chat_id = target_chat_id;

      if participant_count <> 2 then
        raise exception 'direct chats require exactly two participants'
          using errcode = 'check_violation';
      end if;
    end loop;

    return null;
  end if;

  select count(*)
  into participant_count
  from public.chat_participants
  where chat_id = target_chat_id;

  if participant_count <> 2 then
    raise exception 'direct chats require exactly two participants'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger chats_direct_participant_count
after insert or update of type on public.chats
deferrable initially deferred
for each row
execute function public.enforce_direct_chat_participant_count();

create constraint trigger chat_participants_direct_participant_count
after insert or update or delete on public.chat_participants
deferrable initially deferred
for each row
execute function public.enforce_direct_chat_participant_count();

create function public.enforce_chat_participant_read_sequences()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.last_read_sequence < old.last_read_sequence
    or new.last_visible_message_sequence < old.last_visible_message_sequence then
    raise exception 'read sequences can only move forward'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger chat_participants_read_sequences_only_move_forward
before update of last_read_sequence, last_visible_message_sequence
on public.chat_participants
for each row
execute function public.enforce_chat_participant_read_sequences();
