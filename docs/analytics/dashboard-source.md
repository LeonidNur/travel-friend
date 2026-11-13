# Aggregate reporting source for PostHog

**Status:** additive source prepared for review. The migration is not applied to production, no PostHog source was created, and no credentials or network settings were changed.

## Database objects

The migration creates a private `analytics_reporting` schema and three fixed aggregate views:

| View | Output | Meaning |
|---|---|---|
| `analytics_reporting.daily_metrics` | `metric_date`, `new_users`, `matches_created`, `messages_all`, `messages_user`, `messages_system`, `trips_created`, `proposals_created`, `proposals_accepted_applied` | UTC daily counts. It emits dates with at least one fact; missing dates are filled with zero in chart queries below. |
| `analytics_reporting.user_totals` | `as_of_utc`, `registered_accounts_ever`, `registered_accounts_not_deleted` | Current aggregate snapshot. Lifetime registrations include soft-deleted users; the second count excludes them. |
| `analytics_reporting.weekly_wcat` | `week_start_utc`, `trips_with_accepted_proposal` | UTC calendar-week count of distinct Trips with an accepted-and-applied Proposal. Multiple accepted Proposals on one Trip count once per week. |

All view columns are dates/timestamps or counts. No user, chat, message, Trip, or Proposal identifiers; message text; route; title; budget; JSON; or participant attributes are exposed. These counts remain sensitive business information, especially where a daily count is small.

The views use owner permissions (`security_invoker = false`) so they can aggregate rows across application RLS policies. This is a deliberate privilege boundary: the view owner is trusted, its definitions are fixed, and the reporting role receives no `SELECT` on `public` tables. Keep these views aggregate-only in future edits and review every projection before applying a migration. `security_barrier = true` is also set.

The migration creates `analytics_reporting_reader` as a `NOLOGIN`, non-superuser, non-replicating role with no database/schema creation rights and no `BYPASSRLS`. It receives only `USAGE` on `analytics_reporting` and `SELECT` on the three named views. It receives no source-table access and no write privileges. It is not granted to `app_runtime`, `anon`, `authenticated`, or `service_role`.

## PostHog live-query format

The PostHog PostgreSQL source documentation describes a **Query live only** mode: SQL runs against the connected database rather than syncing source tables into the PostHog warehouse. Live queries are available in the SQL editor, and a date/datetime plus numeric result is suitable for a time-series visualization. See [PostgreSQL sources and live queries](https://posthog.com/docs/data-pipelines/sources/postgres) and [SQL query visualizations](https://posthog.com/docs/data-warehouse/query).

Use PostgreSQL SQL with schema-qualified view names. For a daily line chart, return one UTC `date` column and one `bigint` value column; this query fills inactive dates with zero:

```sql
WITH date_spine AS (
  SELECT generate_series(
    ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29)::timestamp,
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date::timestamp,
    interval '1 day'
  )::date AS metric_date
)
SELECT date_spine.metric_date AS date,
       coalesce(daily_metrics.new_users, 0)::bigint AS value
FROM date_spine
LEFT JOIN analytics_reporting.daily_metrics AS daily_metrics USING (metric_date)
ORDER BY date_spine.metric_date;
```

For other daily series, replace `new_users` with one of the aggregate columns in `daily_metrics`. For the weekly WCAT chart, generate Monday dates and join the weekly view:

```sql
WITH bounds AS (
  SELECT date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AS current_week
), week_spine AS (
  SELECT generate_series(
    (current_week - 77)::timestamp,
    current_week::timestamp,
    interval '1 week'
  )::date AS week_start_utc
  FROM bounds
)
SELECT week_spine.week_start_utc AS date,
       coalesce(weekly_wcat.trips_with_accepted_proposal, 0)::bigint AS value
FROM week_spine
LEFT JOIN analytics_reporting.weekly_wcat USING (week_start_utc)
ORDER BY week_spine.week_start_utc;
```

For a current account total, select only the number to display as a Big Number:

```sql
SELECT registered_accounts_ever AS value
FROM analytics_reporting.user_totals;
```

These are query templates, not results verified in a live PostHog project. PostgreSQL syntax, view grants, output shape, and zero-filled empty periods are exercised against the local disposable database. PostHog UI availability, chart configuration, source connectivity, and saved-query behavior require a later manual check in an approved non-production project.

## Manual setup after separate approval

1. Apply the additive migration to the approved database only after reviewing its full SQL and validating backups/release gates. The current task applies it only to the local disposable test database.
2. Create a dedicated `LOGIN` role per environment through the approved secret-management path. Do not store its password or connection string in this repository. Give it only membership in `analytics_reporting_reader`; keep it non-superuser, without `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, replication, or unrelated role memberships. Do not reuse `postgres`, `service_role`, or the application role.
3. Confirm `analytics_reporting` is not in Supabase's exposed Data API schemas. In PostHog, create a PostgreSQL source in **Query live only** mode if available for the chosen source/project. Restrict schema discovery to `analytics_reporting`, use the dedicated role, require TLS certificate verification, and do not enable table sync or CDC. No PostHog IP allowlist, Supabase networking, or pooler setting is changed by this change.
4. PostHog documents that source connections need an internet-reachable PostgreSQL host or an SSH tunnel, TLS, and its egress IP allowlist. Supabase's PostgreSQL source instructions specify using the Session pooler host for PostHog instead of the project REST URL or the direct database host. Confirm the actual host, region, reachability, IP allowlist, and TLS certificate in the approved project before connecting; these requirements can expose operational and cross-border processing risks.
5. Before connecting to production, check view query plans and realistic load in staging; the views are live aggregates over source tables, and production latency/overhead is not measured. Run the queries above in the PostHog SQL editor, verify UTC boundaries and chart types, restrict project and dashboard access to team members, and reconcile aggregate results with the reporting SQL. Keep PostHog collection disabled unless its separate consent/privacy gates are approved.

Live-query results are returned to PostHog for display, so this is still external processing even though source rows are not synchronized. Review provider terms, data location, access, retention, and small-cell disclosure risk before enabling a connection. The current audit makes no legal-compliance or residency claim.

## Local verification

The backend regression tests create soft-deleted and active user fixtures, multiple accepted Proposals on one Trip, a second Trip in the same UTC week, user/system messages, an empty date, and then query the views as the reporting role. They also assert that the role cannot read source tables or write to the views. Run `cd apps/backend && ./scripts/local-test-db.sh test` for the full disposable-database check; the script resets only its explicitly labeled localhost test container. Production was not queried or changed.
