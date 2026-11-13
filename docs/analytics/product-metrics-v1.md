# Product metrics v1 (Pre-Beta)

**Status:** review-fixed event and metric contract based on `develop` at `beb29ef6fba32a2eee0ca69637fa00da40e44ed7` (2026-11-13). A disabled typed adapter/staging foundation exists; no SDK, credentials, live event call sites, PostHog project, schema, migration, or dashboard is enabled.

Event ownership, properties, consent gating and source gaps are specified in [event-taxonomy-v1.md](event-taxonomy-v1.md); future rollout and test sequence are in [implementation-plan.md](implementation-plan.md).

## Analytics principles

- PostHog is the product analytics UI/query surface. FastAPI/Supabase remain the source of business facts. FE emits explicit UX events only; BE emits committed business facts only.
- Manual capture only. Autocapture, automatic pageviews, exception autocapture, feature-flag polling and session replay are off. There is no event warehouse and no application DB sync.
- Analytics is best-effort and non-blocking. SDK absence/failure, denied or unknown consent, queue saturation, network failure, or disabled configuration cannot change screens, API results, business transactions, or user-facing errors.
- Collection is disabled in the application. There is no provider SDK, provider configuration, credential, or runtime enable switch in this slice.
- Product metrics are calculated on the consented/observable population only. Do not extrapolate to users who declined consent.

## Identity, consent, privacy, and time

**Identity.** For authenticated events, use the backend `users.id` UUID as `distinct_id` on FE and BE; it is a restricted pseudonymous identifier. Do not send Telegram IDs, names, usernames, contact details, auth/session tokens, or person properties. `app_opened` may use the SDK's anonymous distinct ID if the person has consented before authentication; link it after login to the same stable backend ID. Never identify or merge a session before consent.

**Consent is a separate rollout gate.** The same versioned user choice must govern FE capture and BE publication: only `granted` can permit the allowlist; denied, unknown, absent, expired or revoked suppresses all events. Consent is never required to use the Mini App: missing consent continues the normal flow with analytics off. The policy, shared server-verifiable state, and revocation handling are not implemented; until approved and implemented, both sides remain disabled. The FE adapter requires an explicit granted state; the BE staging foundation has no provider sender configured.

Registration-time consent is a separate gate: to observe `user_registered`, a future approved consent choice must be available before `/auth/telegram` creates the account. Decline/skip still proceeds with authentication and registration; that user's registration event is suppressed. Do not backfill it if consent is granted later. No consent UI or auth behavior is added in this slice.

Current code has no shared consent capability. Before any PostHog collection, approve and implement a server-verifiable, revocable consent receipt/state usable by both FE and BE. A client-only local flag is insufficient for BE publication and participant fan-out. Missing/invalid/expired consent means no capture, never an API error. This is a release gate, not a blocker to the user's flow.

**Entity references.** To count Trips across different participants/events, use deterministic domain-separated SHA-256 references from internal UUIDs (`trip_ref`, `proposal_ref`, `chat_ref`, `match_ref`). They are linkable pseudonyms, not anonymous data (`P1`); use only where required, never expose raw entity IDs or counterpart user IDs. Keep FE and BE canonicalization identical and test with fixed vectors. If privacy review disallows stable refs, omit same-Trip cross-event metrics rather than add a warehouse.

**Allowed data.** Closed enums, booleans, coarse buckets, and these pseudonymous IDs only. Never send message text, destinations/routes/dates/budgets, Draft JSON, itinerary or Proposal text/scopes/old-new values, profile/TravelIntent values, raw IDs, full URLs/referrers, DOM text, device fingerprints, IPs, tokens, request/response bodies, or exception text.

PostHog SDKs can attach default context beyond explicitly supplied properties. Before send, apply a strict property allowlist that removes `$current_url`, path/host/referrer, campaign parameters, browser/OS/device fields, IP and all `$geoip_*` values. Disable referrer/campaign persistence and configure the future project to discard client IP/disable GeoIP. This setting is a pre-collection gate; it is not changed here. PostHog documents `before_send` for removing captured URL values and project-level IP handling ([JS reference](https://posthog.com/docs/libraries/js/reference), [data storage](https://posthog.com/docs/privacy/data-storage)).

**Time.** All business event timestamps are persisted occurrence/transition times; FE view timestamps are visibility moments. Use UTC. Configure the PostHog project timezone as UTC. Calendar metrics use UTC calendar boundaries; rolling WAU/MAU use exact elapsed durations, not calendar weeks/months or the built-in “last 7/30 days” date picker if its boundary semantics differ.

**Cohorts.** Registration cohorts use `user_registered` and include only users whose registration was observed under an active consent grant. Existing accounts are left-censored; do not backfill. Exclude test accounts using a separate non-production project or server-controlled test flag, never names or Telegram IDs.

## North Star and activity metrics

### WCAT — Weekly Collaboratively Advanced Trips

**Definition:** count of unique Trips that have at least one Proposal accepted **and applied** during a UTC calendar week (Monday 00:00:00 through the next Monday 00:00:00). `trip_proposal_accepted` means the existing Proposal operation was applied to the Confirmed Trip and the Proposal reached `accepted` in the same transaction; publish only after commit. Count unique `trip_ref`, so multiple accepted Proposals on one Trip in one week contribute one WCAT. This is the North Star count; it has no denominator. Any secondary conversion rate must state its own cohort and denominator and cannot replace WCAT.

PostHog HogQL specification:

```sql
SELECT
    toStartOfWeek(timestamp, 1) AS week_start_utc,
    uniqExact(properties.trip_ref) AS wcat
FROM events
WHERE event = 'trip_proposal_accepted'
  AND properties.trip_ref IS NOT NULL
GROUP BY week_start_utc
ORDER BY week_start_utc
```

The PostHog project timezone must be UTC. Event source guarantees “accepted + applied”; the query counts unique Trip refs, not event rows or users. Since capture is consent-gated, this is WCAT in the consented/observable population. Do not label it a complete business total if consented coverage is incomplete.

### DAU / WAU / MAU

“Active” means at least one significant product action by a unique `distinct_id`; exclude app opens, candidate views, Trip opens, login, and technical errors. Use this exact action set:

- `onboarding_completed`
- `discover_decision_saved`
- `match_created`
- `chat_first_message_sent`, `chat_message_sent`
- `group_chat_created`
- `trip_created`, `trip_draft_updated`
- `trip_proposal_created`, `trip_proposal_vote_cast`, `trip_proposal_accepted`, `trip_proposal_rejected`

| Metric | Definition and window | PostHog calculation / denominator |
|---|---|---|
| DAU | Unique people with at least one action above on one UTC calendar date `[00:00, next 00:00)`. Attribute the event to the person who performed the action; a multi-party fact counts only for each independently consenting actor/recipient explicitly attributed by its source rule. | Trends: combine the listed events with OR and select Unique users; UTC timezone. Denominator: none; this is a count. |
| WAU | Unique people with at least one action in the rolling 7×24-hour interval `[as_of − 7 days, as_of)`. | HogQL unique `distinct_id` across the action set with `timestamp >= now() - INTERVAL 7 DAY AND timestamp < now()`. Not a Monday–Sunday week. Denominator: none. |
| MAU | Unique people with at least one action in the rolling 30×24-hour interval `[as_of − 30 days, as_of)`. | Same query shape with `INTERVAL 30 DAY`. Not a calendar month. Denominator: none. |

For rolling counts, use exact `uniqExact(distinct_id)` in HogQL; PostHog documents it as exact while `uniq` is approximate. The `events` table, property syntax, `INTERVAL`, and unique aggregation are documented by PostHog ([SQL access](https://posthog.com/docs/sql), [aggregations](https://posthog.com/docs/sql/aggregations)).

`app_opened`, `discover_candidate_viewed`, and `trip_opened` are reported separately as usage/view diagnostics. They never qualify a user as active. If showing a views-per-active-user ratio, denominator is the same period's DAU and the dashboard must label that ratio explicitly.

## Activation, retention, and product funnels

| Metric | Numerator / denominator and cohort | Source and PostHog method |
|---|---|---|
| Registered users | Unique consenting `distinct_id` with `user_registered`; no denominator. | BE committed user creation; never use `app_opened` or repeated auth as registration. Requires `created_user` fact. |
| Onboarding completion | Consenting registered users with `onboarding_completed` within 30 UTC calendar days of registration / consenting registered users whose full 30-day window elapsed. | BE status transition, not completion request count; PostHog person retention/funnel or HogQL join on `distinct_id`. |
| D1 retention | For each UTC registration-date cohort: users with any significant action on UTC date registration + 1 / cohort users whose D1 calendar date is complete. | Start=`user_registered`, return=significant-action set; fixed calendar daily periods, return criterion “On”, not cumulative “On or after”. |
| D7 retention | Same, on UTC registration date + 7. Denominator contains only cohorts whose D7 date is complete. | Same PostHog Retention insight, daily periods and exact-period return. |
| D30 retention | Same, on UTC registration date + 30. Denominator contains only cohorts whose D30 date is complete. | Same Retention insight; exclude immature cohorts. PostHog supports start/return events, unique-user cohorts, and exact vs cumulative return options ([Retention](https://posthog.com/docs/product-analytics/retention)). |
| Discover → Match → Chat | Ordered person funnel: candidate viewed → decision saved → match created for that participant → first message sent, within 30 days from the first step. Each step's conversion = unique consenting people at that step / unique consenting people reaching step 1. | PostHog Funnel, unique users, ordered steps, 30-day conversion window. `match_created` must fan out only to participants whose consent is active; do not attribute a counterpart's event without their consent. First message is the `chat_first_message_sent` event. |
| Trip → Proposal → Agreement | Cohort = Trips created in a UTC calendar week with a complete 30-day follow-up. Trip→Proposal = unique cohort Trips with ≥1 `trip_proposal_created` within 30 days / mature cohort Trips. Proposal→Agreement = unique cohort Trips with an applied accepted Proposal in 30 days / cohort Trips with ≥1 Proposal in 30 days. Overall agreement = accepted Trips / all mature cohort Trips. | HogQL by `trip_ref`, not a person funnel: creator, proposer and voter may differ. Query below counts unique Trip refs. All events are consent-observed; incomplete consent coverage limits the represented population. |

### Trip → Proposal → Agreement query specification

This query shape groups the same-Trip journey even when different participants create and accept the Proposal. It uses fields and aggregation functions documented by PostHog; it has **not** been executed against a live PostHog project. Validate syntax and output on a non-production project before saving the insight.

```sql
WITH mature_trips AS (
    SELECT
        properties.trip_ref AS trip_ref,
        min(timestamp) AS trip_at
    FROM events
    WHERE event = 'trip_created'
      AND properties.trip_ref IS NOT NULL
    GROUP BY properties.trip_ref
    HAVING trip_at <= now() - INTERVAL 30 DAY
)
SELECT
    toStartOfWeek(t.trip_at, 1) AS cohort_week_utc,
    uniqExact(t.trip_ref) AS mature_trips,
    uniqExactIf(t.trip_ref, e.event = 'trip_proposal_created') AS trips_with_proposal,
    uniqExactIf(t.trip_ref, e.event = 'trip_proposal_accepted') AS trips_with_agreement
FROM mature_trips AS t
LEFT JOIN events AS e
    ON e.properties.trip_ref = t.trip_ref
   AND e.event IN ('trip_proposal_created', 'trip_proposal_accepted')
   AND e.timestamp >= t.trip_at
   AND e.timestamp < t.trip_at + INTERVAL 30 DAY
GROUP BY cohort_week_utc
ORDER BY cohort_week_utc
```

Compute `trips_with_proposal / mature_trips`, `trips_with_agreement / trips_with_proposal`, and `trips_with_agreement / mature_trips` from the returned counts; return null for a zero denominator. Project/report timezone is UTC. Recent Trip cohorts are excluded until the full 30-day window passes. No warehouse or DB aggregate is required.

## Dashboard plan

Create dashboards only in a separate team-only PostHog Cloud project after separate approval; never inside the Mini App.

1. **Product Overview:** WCAT count by UTC calendar week; DAU, rolling WAU, rolling MAU; onboarding; D1/D7/D30; consented coverage and delivery health.
2. **Discover / Match:** candidate views (separate), decisions, matches, first messages and conversion by safe enum such as `chat_type`.
3. **Trips / Proposal:** Trip opens (separate), Draft updates, Proposals, votes, accepted/applied, rejected/conflict, and same-Trip conversion query.

Future dashboards: **AI** and **Financials / LTV** only after separate event, source, privacy, and billing review. No project/dashboard is created now.

## Delivery guarantees and overhead limits

- FE uses manual `capture()` without awaiting network delivery. Disable interaction autocapture and automatic pageview/pageleave separately, and disable session replay. PostHog documents that these are separate controls ([autocapture](https://posthog.com/docs/product-analytics/autocapture), [JS reference](https://posthog.com/docs/libraries/js/reference), [session replay](https://posthog.com/docs/session-replay/installation)).
- BE stages allowlisted facts inside the request but publishes to a bounded in-process queue only after the outer authenticated transaction commits. No network call, flush, or retry is awaited by a business handler or transaction. PostHog's Python SDK queues `capture()` asynchronously, but process exit can lose buffered events ([Python SDK](https://posthog.com/docs/libraries/python)).
- The backend foundation has a bounded in-process queue (default capacity 1,000), nonblocking enqueue, and no worker unless a sender is explicitly provided. The app provides no sender. There is no retry or network timeout configured in this slice. No outbox or DB write; queue/process loss is acceptable analytics loss, never business failure.
- Before any enablement, run real staging performance checks: 0 ms intentional analytics wait on user/API paths, enqueue p95 <1 ms, FE event payload p95 ≤1 KiB, and no measurable API latency regression. These are acceptance targets, not measured results. No performance claim is made by unit tests.
- Use app project ingestion tokens only through approved provider configuration; no PostHog credentials or settings in Git. The FE token is a public write-only project token; BE token is server-side. No personal API key in the app.

## Review gates and references

Before enabling capture, approve consent policy, shared FE/BE receipt/state, revocation semantics, team-only project access, region/retention, deletion handling, IP/GeoIP settings, SDK property stripping, event allowlist, and explicit disabled-mode tests. The app continues normally with no consent or if analytics is disabled.

References: [PostHog SQL/HogQL](https://posthog.com/docs/sql), [supported aggregations](https://posthog.com/docs/sql/aggregations), [Trends](https://posthog.com/docs/product-analytics/trends/overview), [Retention](https://posthog.com/docs/product-analytics/retention), [event deduplication](https://posthog.com/docs/data/events), [identify users](https://posthog.com/docs/getting-started/identify-users).
