-- Current aggregate-only account snapshot; period filters do not apply to totals.
SELECT 'snapshot'::text AS period_type,
       (statement_timestamp() AT TIME ZONE 'UTC')::date AS period_start,
       'registered_accounts_ever'::text AS metric,
       count(*)::bigint AS value
FROM public.users AS users
UNION ALL
SELECT 'snapshot'::text,
       (statement_timestamp() AT TIME ZONE 'UTC')::date,
       'registered_accounts_not_deleted'::text,
       count(*)::bigint
FROM public.users AS users
WHERE users.deleted_at IS NULL;
