create table public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  position integer not null,
  place_label text not null,
  country_code text,
  place_ref text,
  stay_from date,
  stay_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, position),
  unique (trip_id, id),
  check (position >= 1),
  check (stay_from is null or stay_to is null or stay_to >= stay_from)
);
