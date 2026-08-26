create table public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.telegram_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete no action,
  telegram_user_id bigint not null unique,
  username text,
  first_name text,
  last_name text,
  language_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete no action,
  display_name text not null,
  birth_date date,
  gender text,
  city text,
  bio text,
  travel_style text[] not null default '{}',
  interests text[] not null default '{}',
  budget_level text,
  comfort_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete no action,
  storage_key text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  unique (profile_id, position),
  check (position >= 0)
);

create table public.user_settings (
  user_id uuid primary key references public.users (id) on delete no action,
  ai_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_activity_states (
  user_id uuid primary key references public.users (id) on delete no action,
  onboarding_status text not null,
  last_app_activity_at timestamptz,
  last_discover_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (onboarding_status in ('not_started', 'in_progress', 'completed'))
);

create table public.travel_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete no action,
  destination_label text not null,
  destination_country_code text,
  destination_place_ref text,
  date_from date,
  date_to date,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status in ('active', 'archived')),
  check (date_from is null or date_to is null or date_to >= date_from)
);

create unique index travel_intents_one_active_per_user_idx
  on public.travel_intents (user_id)
  where status = 'active';
