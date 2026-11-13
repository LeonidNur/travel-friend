-- Read-only aggregate reporting for the current public schema.
-- Run with psql variables period_start, period_end and week_start_utc as ISO-8601
-- timestamptz values including Z, e.g. 2026-11-01T00:00:00Z.
-- period_start is inclusive; period_end is exclusive. week_start_utc must be
-- Monday 00:00:00 UTC. Results contain aggregates and periods only.
-- Execute only from an already authorized read-only operator/reporting session.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- Registered accounts as of period_end. The first metric includes soft-deleted
-- accounts because it counts committed registrations ever; the second is the
-- current non-deleted account count as of the same snapshot.
WITH period AS (
  SELECT :'period_end'::timestamptz AS period_end
)
SELECT
  'registered_accounts_ever'::text AS metric,
  NULL::timestamptz AS period_start,
  period.period_end,
  count(users.id) AS value
FROM period
LEFT JOIN public.users AS users
  ON users.created_at < period.period_end
GROUP BY period.period_end
UNION ALL
SELECT
  'registered_accounts_not_deleted'::text,
  NULL::timestamptz,
  period.period_end,
  count(users.id) FILTER (WHERE users.deleted_at IS NULL) AS value
FROM period
LEFT JOIN public.users AS users
  ON users.created_at < period.period_end
GROUP BY period.period_end;

-- Newly created accounts in the selected interval; repeated logins do not add
-- rows to public.users and therefore do not count as new users.
WITH period AS (
  SELECT
    :'period_start'::timestamptz AS period_start,
    :'period_end'::timestamptz AS period_end
)
SELECT
  'new_users'::text AS metric,
  period.period_start,
  period.period_end,
  count(users.id) AS value
FROM period
LEFT JOIN public.users AS users
  ON users.created_at >= period.period_start
 AND users.created_at < period.period_end
GROUP BY period.period_start, period.period_end;

-- Persisted mutual matches created in the selected interval.
WITH period AS (
  SELECT
    :'period_start'::timestamptz AS period_start,
    :'period_end'::timestamptz AS period_end
)
SELECT
  'matches_created'::text AS metric,
  period.period_start,
  period.period_end,
  count(matches.id) AS value
FROM period
LEFT JOIN public.matches AS matches
  ON matches.created_at >= period.period_start
 AND matches.created_at < period.period_end
GROUP BY period.period_start, period.period_end;

-- Message rows in the interval, split so product messaging can exclude system
-- events when desired. No content, sender, recipient, or chat identifiers return.
WITH period AS (
  SELECT
    :'period_start'::timestamptz AS period_start,
    :'period_end'::timestamptz AS period_end
)
SELECT
  period.period_start,
  period.period_end,
  count(messages.id) AS messages_all,
  count(messages.id) FILTER (WHERE messages.type = 'user') AS messages_user,
  count(messages.id) FILTER (WHERE messages.type = 'system') AS messages_system
FROM period
LEFT JOIN public.messages AS messages
  ON messages.created_at >= period.period_start
 AND messages.created_at < period.period_end
GROUP BY period.period_start, period.period_end;

-- Trips created in the selected interval, regardless of their current status.
WITH period AS (
  SELECT
    :'period_start'::timestamptz AS period_start,
    :'period_end'::timestamptz AS period_end
)
SELECT
  'trips_created'::text AS metric,
  period.period_start,
  period.period_end,
  count(trips.id) AS value
FROM period
LEFT JOIN public.trips AS trips
  ON trips.created_at >= period.period_start
 AND trips.created_at < period.period_end
GROUP BY period.period_start, period.period_end;

-- Proposal rows created (including initially blocked Proposals) and Proposals
-- accepted in the interval. The atomic DB capability applies operations and
-- sets status=accepted in the same transaction, so accepted means applied.
WITH period AS (
  SELECT
    :'period_start'::timestamptz AS period_start,
    :'period_end'::timestamptz AS period_end
)
SELECT
  period.period_start,
  period.period_end,
  count(proposals.id) FILTER (
    WHERE proposals.created_at >= period.period_start
      AND proposals.created_at < period.period_end
  ) AS proposals_created,
  count(proposals.id) FILTER (
    WHERE proposals.status = 'accepted'
      AND proposals.decided_at >= period.period_start
      AND proposals.decided_at < period.period_end
  ) AS proposals_accepted_applied
FROM period
LEFT JOIN public.trip_proposals AS proposals
  ON (
    proposals.created_at >= period.period_start
    AND proposals.created_at < period.period_end
  )
  OR (
    proposals.status = 'accepted'
    AND proposals.decided_at >= period.period_start
    AND proposals.decided_at < period.period_end
  )
GROUP BY period.period_start, period.period_end;

-- WCAT: unique Trips with at least one accepted-and-applied Proposal in a UTC
-- calendar week. Do not sum accepted Proposal rows; count distinct trip_id.
WITH period AS (
  SELECT
    :'week_start_utc'::timestamptz AS period_start,
    :'week_start_utc'::timestamptz + interval '1 week' AS period_end
)
SELECT
  'wcat'::text AS metric,
  period.period_start,
  period.period_end,
  count(DISTINCT proposals.trip_id) FILTER (WHERE proposals.id IS NOT NULL) AS value
FROM period
LEFT JOIN public.trip_proposals AS proposals
  ON proposals.status = 'accepted'
 AND proposals.decided_at >= period.period_start
 AND proposals.decided_at < period.period_end
GROUP BY period.period_start, period.period_end;

ROLLBACK;
