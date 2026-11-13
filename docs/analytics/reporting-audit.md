# Pre-Beta reporting audit

**Observed:** 2026-11-13. Read-only review of repository migrations, live Supabase metadata, Render service metadata, and the linked Vercel project. No application, schema, permissions, provider settings, or migrations were changed. No PostHog collection was enabled.

## Sources and placement

| Component | Current evidence | Location and limitation |
|---|---|---|
| Supabase | Live project `travel-friend-dev`, ref `tlgprfsecdasloqnuyjo`, status `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.165`; region `eu-central-1`. Live public-table metadata and migration ledger were read with the connected read-only provider tools. Ledger has 28 versions and matches the 28 migration files in this checkout through `20261109130000_trip_proposals_voting_atomic_apply`. | Region code is provider-reported. This is the currently linked project; its `-dev` name does not establish a legal or operational environment classification. `supabase/config.toml` project_id `travel-friend` is local CLI configuration, not the hosted project identity. No database row data was queried from this project. |
| Render | Live service `travel-friend-api`, service ID `srv-daaneiajnfac7392ljqg`, URL `https://travel-friend-api.onrender.com`, current service metadata updated 2026-11-10; service region `frankfurt`; Auto-Deploy Off. | Region is provider-reported. Repository has no `render.yaml`; the runbook records deployment snapshots, not current source provenance. Public service reachability is expected; this audit did not probe user-facing endpoints. |
| Vercel | Linked project `travel-friend-mini-app` (`prj_zimptKAWnKbGwpI7gMI73Wecfszc`); provider metadata reports latest production deployment READY. The repository links this project in `apps/mini-app/.vercel/project.json`; production alias is recorded in the deployment runbook. | Vercel does not report a single physical location for the project in the metadata inspected. Edge delivery is distributed; the current function execution region was not established. No `vercel.json` or project region setting is present in this checkout. |

Provider metadata is an observation at the timestamp above, not a residency, contractual, or regulatory assessment. The production runbook contains historical deployment and smoke records; those records do not prove current SHA, current traffic routing, or provider location beyond current metadata returned here.

## Metric availability from committed database facts

Live Supabase metadata confirms `public.users`, `matches`, `messages`, `trips`, and `trip_proposals` exist, with row-level security enabled. Their relevant columns match the current migrations. The queries in [reporting-queries.sql](reporting-queries.sql) return periods and aggregate counts only.

| Metric | Source and formula | Availability / limits | How to check exactness |
|---|---|---|---|
| Registered accounts | `users.created_at`; count rows created before the selected end time. Also report current non-deleted accounts using `deleted_at IS NULL`. | Exact persisted account creations. “Ever registered” includes soft-deleted accounts; do not interpret that as current active accounts. Repeated login does not create another row. | Compare aggregate counts with a read-only count over the same snapshot and verify that registration writes `users` in the same successful auth transaction. |
| New users | `users.created_at` in `[period_start, period_end)`. | Exact creation count for the interval; includes accounts later soft-deleted. Timestamp bounds must be UTC `timestamptz` values. | Re-run with the same bounds and snapshot; compare period counts against the cumulative account count at adjacent boundaries. |
| Matches | `matches.created_at` in the interval; one row is one unique reciprocal pair. | Exact persisted match creations. `UNIQUE(user_a_id,user_b_id)` prevents duplicate pairs. It is not a count of likes/decisions. | Compare against `count(*)` over the same interval and confirm the unique pair constraint in the migration. |
| Messages | `messages.created_at` in the interval; count all rows and split `type='user'` from `type='system'`. | Exact retained message rows. Use `messages_user` for user-authored message volume; system messages are a separate operational category. Query returns no content or participant IDs. | Check that the split sums to the total and that every row satisfies the schema's user/system type constraint. |
| Trips created | `trips.created_at` in the interval, independent of current Trip status. | Exact persisted Trip creations. Does not measure later edits, opens, or Trip completion. | Compare with the same-period row count and the unique unfinished-per-chat constraint for active-state sanity, not as a substitute count. |
| Proposals created | `trip_proposals.created_at` in the interval; all inserted statuses count, including initially `blocked`. | Exact Proposal rows. Idempotent retries return an existing row and do not create another Proposal. | Compare with same-period Proposal row counts; inspect the unique `(trip_id, creator_user_id, idempotency_key)` constraint. |
| Proposals accepted/applied | `status='accepted'` and `decided_at` in the interval. Count Proposal rows. | Exact accepted transitions under the current atomic SQL capability: it applies operations and sets `accepted` in the same transaction. This relies on that database contract remaining intact. | Verify the current capability calls `apply_trip_proposal` before setting `accepted`, in the same transaction; compare accepted rows to the accepted status and decision-time aggregate. |
| WCAT | For a UTC calendar week, count distinct `trip_proposals.trip_id` with `status='accepted'` and `decided_at` in that week. | Exact from current persisted facts. Multiple accepted Proposals on one Trip in the week count as one Trip. This is a database total, not a consent-observed PostHog estimate. | Compare with a second `count(DISTINCT trip_id)` over the same UTC half-open interval. Confirm accepted and applied remain atomic. |

Every interval uses inclusive start and exclusive end. “New” means a database creation timestamp in that interval. The SQL is written for `psql` variables and wraps all statements in `BEGIN TRANSACTION READ ONLY` / `ROLLBACK`.

## Validation and access limits

- Queried live Supabase metadata only: project location/status, relevant table columns and RLS state, and migration names/versions. No production SQL aggregation or user record query was run.
- Ran the reporting SQL against the already-running disposable local PostgreSQL test database. It completed successfully inside the read-only transaction; only aggregate columns were returned. This validates SQL against the local migrated schema, not production data or production query plans.
- No Postgres CLI or `TEST_DATABASE_URL` is configured on the host; the local test container was already running and was accessed read-only. The queries were not run against production.
- `app_runtime` is RLS-scoped for application operations and is not a whole-product reporting identity. Use an already authorized read-only operator/reporting session; do not alter grants or use an application token. If such access is unavailable, these metrics cannot be retrieved until access is separately reviewed.
- Aggregate results contain no user ID, chat/Trip/Proposal ID, message content, route, title, or other row-level value. Counts can still be sensitive business information and should have team-only access.

## Facts that need additional capabilities for future analytics

The requested database totals above are available without new business facts. Some event-level product analytics are not:

| Future question/event | Current limitation |
|---|---|
| Onboarding completion time / retention from registration | `user_activity_states` stores the current onboarding status, not an immutable completion timestamp/history. A transition fact or additive transition timestamp is needed. |
| Changed Discover decisions | `discover_interest_decisions` stores the current decision and a mutable `updated_at`; it is not an immutable decision-change history. |
| `user_registered` event emission | The `users` table can count persisted registrations, but the auth result currently does not expose a created-user fact. Do not infer registration from repeated login. |
| Proposal event delivery | Proposal rows, votes, and accepted state are queryable, but safe PostHog emission still needs source transition/idempotency evidence and shared consent. The analytics adapter is disabled and has no connected business events. |
| DAU/WAU/MAU from meaningful actions and views | `last_app_activity_at` is not a history of named significant actions. Exact action-based active-user metrics require the approved consented event stream and source guards; aggregate SQL counts alone cannot reconstruct them. |

These gaps do not prevent the SQL totals in this report. Do not add facts, permissions, schema, or collection as part of this audit.
