-- Fixed aggregate query. Parameters are Monday UTC week start and exclusive Monday end.
WITH params AS (
  SELECT %s::date AS start_week, %s::date AS end_exclusive
), weeks AS (
  SELECT generate_series(
    params.start_week::timestamp,
    (params.end_exclusive - 7)::timestamp,
    interval '1 week'
  )::date AS period_start
  FROM params
), weekly_counts AS (
  SELECT date_trunc('week', proposals.decided_at AT TIME ZONE 'UTC')::date AS period_start,
         count(DISTINCT proposals.trip_id)::bigint AS value
  FROM public.trip_proposals AS proposals CROSS JOIN params
  WHERE proposals.status = 'accepted'
    AND proposals.decided_at >= (params.start_week::timestamp AT TIME ZONE 'UTC')
    AND proposals.decided_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
)
SELECT 'week'::text AS period_type,
       weeks.period_start,
       'wcat'::text AS metric,
       coalesce(weekly_counts.value, 0)::bigint AS value
FROM weeks
LEFT JOIN weekly_counts USING (period_start)
ORDER BY weeks.period_start;
