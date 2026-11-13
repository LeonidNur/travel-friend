-- Curated aggregate-only source for authorized internal reporting.
-- The schema is intentionally not exposed through Supabase's public Data API.

CREATE ROLE analytics_reporting_reader
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

CREATE SCHEMA analytics_reporting;
REVOKE ALL ON SCHEMA analytics_reporting
  FROM PUBLIC, anon, authenticated, service_role, app_runtime;
GRANT USAGE ON SCHEMA analytics_reporting TO analytics_reporting_reader;

-- These views deliberately use owner permissions to aggregate across the
-- application RLS boundary. Their fixed projections contain aggregate values
-- and time buckets only; the reporting role receives no source-table access.
CREATE VIEW analytics_reporting.daily_metrics
WITH (security_barrier = true, security_invoker = false)
AS
WITH
users_by_day AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS new_users
  FROM public.users
  GROUP BY 1
),
matches_by_day AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS matches_created
  FROM public.matches
  GROUP BY 1
),
messages_by_day AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS messages_all,
         count(*) FILTER (WHERE type = 'user')::bigint AS messages_user,
         count(*) FILTER (WHERE type = 'system')::bigint AS messages_system
  FROM public.messages
  GROUP BY 1
),
trips_by_day AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS trips_created
  FROM public.trips
  GROUP BY 1
),
proposals_created_by_day AS (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS proposals_created
  FROM public.trip_proposals
  GROUP BY 1
),
proposals_accepted_by_day AS (
  SELECT (decided_at AT TIME ZONE 'UTC')::date AS metric_date,
         count(*)::bigint AS proposals_accepted_applied
  FROM public.trip_proposals
  WHERE status = 'accepted'
    AND decided_at IS NOT NULL
  GROUP BY 1
),
active_dates AS (
  SELECT metric_date FROM users_by_day
  UNION SELECT metric_date FROM matches_by_day
  UNION SELECT metric_date FROM messages_by_day
  UNION SELECT metric_date FROM trips_by_day
  UNION SELECT metric_date FROM proposals_created_by_day
  UNION SELECT metric_date FROM proposals_accepted_by_day
)
SELECT active_dates.metric_date,
       coalesce(users_by_day.new_users, 0)::bigint AS new_users,
       coalesce(matches_by_day.matches_created, 0)::bigint AS matches_created,
       coalesce(messages_by_day.messages_all, 0)::bigint AS messages_all,
       coalesce(messages_by_day.messages_user, 0)::bigint AS messages_user,
       coalesce(messages_by_day.messages_system, 0)::bigint AS messages_system,
       coalesce(trips_by_day.trips_created, 0)::bigint AS trips_created,
       coalesce(proposals_created_by_day.proposals_created, 0)::bigint AS proposals_created,
       coalesce(proposals_accepted_by_day.proposals_accepted_applied, 0)::bigint
         AS proposals_accepted_applied
FROM active_dates
LEFT JOIN users_by_day USING (metric_date)
LEFT JOIN matches_by_day USING (metric_date)
LEFT JOIN messages_by_day USING (metric_date)
LEFT JOIN trips_by_day USING (metric_date)
LEFT JOIN proposals_created_by_day USING (metric_date)
LEFT JOIN proposals_accepted_by_day USING (metric_date);

CREATE VIEW analytics_reporting.user_totals
WITH (security_barrier = true, security_invoker = false)
AS
SELECT (statement_timestamp() AT TIME ZONE 'UTC') AS as_of_utc,
       count(*)::bigint AS registered_accounts_ever,
       count(*) FILTER (WHERE deleted_at IS NULL)::bigint AS registered_accounts_not_deleted
FROM public.users;

CREATE VIEW analytics_reporting.weekly_wcat
WITH (security_barrier = true, security_invoker = false)
AS
SELECT date_trunc('week', decided_at AT TIME ZONE 'UTC')::date AS week_start_utc,
       count(DISTINCT trip_id)::bigint AS trips_with_accepted_proposal
FROM public.trip_proposals
WHERE status = 'accepted'
  AND decided_at IS NOT NULL
GROUP BY 1;

COMMENT ON SCHEMA analytics_reporting IS
  'Restricted schema containing only aggregate reporting views.';
COMMENT ON VIEW analytics_reporting.daily_metrics IS
  'UTC daily counts; contains no identifiers or row-level fields. Days without facts have no row.';
COMMENT ON VIEW analytics_reporting.user_totals IS
  'Current account totals; lifetime count includes soft-deleted registrations.';
COMMENT ON VIEW analytics_reporting.weekly_wcat IS
  'UTC calendar-week count of distinct Trips with an accepted-and-applied Proposal.';

REVOKE ALL ON ALL TABLES IN SCHEMA analytics_reporting
  FROM PUBLIC, anon, authenticated, service_role, app_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM analytics_reporting_reader;
GRANT SELECT ON
  analytics_reporting.daily_metrics,
  analytics_reporting.user_totals,
  analytics_reporting.weekly_wcat
TO analytics_reporting_reader;
