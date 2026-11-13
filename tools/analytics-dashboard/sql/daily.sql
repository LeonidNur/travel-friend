-- Fixed aggregate query. Parameters are UTC start date and exclusive UTC end date.
WITH params AS (
  SELECT %s::date AS start_date, %s::date AS end_exclusive
), days AS (
  SELECT generate_series(
    params.start_date::timestamp,
    (params.end_exclusive - 1)::timestamp,
    interval '1 day'
  )::date AS period_start
  FROM params
), metric_names(metric) AS (
  VALUES
    ('new_users'::text),
    ('matches_created'::text),
    ('messages_all'::text),
    ('messages_user'::text),
    ('messages_system'::text),
    ('trips_created'::text),
    ('proposals_created'::text),
    ('proposals_accepted_applied'::text)
), daily_counts AS (
  SELECT (users.created_at AT TIME ZONE 'UTC')::date AS period_start,
         'new_users'::text AS metric, count(*)::bigint AS value
  FROM public.users AS users CROSS JOIN params
  WHERE users.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND users.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (matches.created_at AT TIME ZONE 'UTC')::date,
         'matches_created'::text, count(*)::bigint
  FROM public.matches AS matches CROSS JOIN params
  WHERE matches.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND matches.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (messages.created_at AT TIME ZONE 'UTC')::date,
         'messages_all'::text, count(*)::bigint
  FROM public.messages AS messages CROSS JOIN params
  WHERE messages.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND messages.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (messages.created_at AT TIME ZONE 'UTC')::date,
         'messages_user'::text, count(*)::bigint
  FROM public.messages AS messages CROSS JOIN params
  WHERE messages.type = 'user'
    AND messages.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND messages.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (messages.created_at AT TIME ZONE 'UTC')::date,
         'messages_system'::text, count(*)::bigint
  FROM public.messages AS messages CROSS JOIN params
  WHERE messages.type = 'system'
    AND messages.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND messages.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (trips.created_at AT TIME ZONE 'UTC')::date,
         'trips_created'::text, count(*)::bigint
  FROM public.trips AS trips CROSS JOIN params
  WHERE trips.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND trips.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (proposals.created_at AT TIME ZONE 'UTC')::date,
         'proposals_created'::text, count(*)::bigint
  FROM public.trip_proposals AS proposals CROSS JOIN params
  WHERE proposals.created_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND proposals.created_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
  UNION ALL
  SELECT (proposals.decided_at AT TIME ZONE 'UTC')::date,
         'proposals_accepted_applied'::text, count(*)::bigint
  FROM public.trip_proposals AS proposals CROSS JOIN params
  WHERE proposals.status = 'accepted'
    AND proposals.decided_at >= (params.start_date::timestamp AT TIME ZONE 'UTC')
    AND proposals.decided_at < (params.end_exclusive::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
)
SELECT 'day'::text AS period_type,
       days.period_start,
       metric_names.metric,
       coalesce(daily_counts.value, 0)::bigint AS value
FROM days
CROSS JOIN metric_names
LEFT JOIN daily_counts
  ON daily_counts.period_start = days.period_start
 AND daily_counts.metric = metric_names.metric
ORDER BY days.period_start, metric_names.metric;
