create table public.trips (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete restrict,
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  status text not null,
  membership_version integer not null default 1,
  state_version integer not null default 1,
  destination_version integer not null default 0,
  dates_version integer not null default 0,
  budget_version integer not null default 0,
  transport_version integer not null default 0,
  destination_status text not null default 'empty',
  dates_status text not null default 'empty',
  budget_status text not null default 'empty',
  transport_status text not null default 'empty',
  date_from date,
  date_to date,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  budget_currency text,
  budget_scope text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('forming', 'active', 'completed', 'cancelled')),
  check (membership_version >= 1),
  check (state_version >= 1),
  check (destination_version >= 0),
  check (dates_version >= 0),
  check (budget_version >= 0),
  check (transport_version >= 0),
  check (destination_status in ('empty', 'confirmed', 'review_required', 'pending_analysis')),
  check (dates_status in ('empty', 'confirmed', 'review_required', 'pending_analysis')),
  check (budget_status in ('empty', 'confirmed', 'review_required', 'pending_analysis')),
  check (transport_status in ('empty', 'confirmed', 'review_required', 'pending_analysis')),
  check (date_from is null or date_to is null or date_to >= date_from),
  check (budget_min is null or budget_min >= 0),
  check (budget_max is null or budget_max >= 0),
  check (budget_min is null or budget_max is null or budget_max >= budget_min),
  check (budget_scope is null or budget_scope in ('per_person', 'group_total'))
);

create unique index trips_one_unfinished_per_chat_idx
  on public.trips (chat_id)
  where status in ('forming', 'active');

create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id)
);
