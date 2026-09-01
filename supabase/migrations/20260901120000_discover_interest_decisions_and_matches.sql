create table public.discover_interest_decisions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users (id) on delete no action,
  target_user_id uuid not null references public.users (id) on delete no action,
  decision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (actor_user_id <> target_user_id),
  check (decision in ('interested', 'rejected')),
  unique (actor_user_id, target_user_id)
);

create index discover_interest_decisions_reverse_interested_idx
  on public.discover_interest_decisions (target_user_id, actor_user_id)
  where decision = 'interested';

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users (id) on delete no action,
  user_b_id uuid not null references public.users (id) on delete no action,
  created_at timestamptz not null default now(),
  check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);
