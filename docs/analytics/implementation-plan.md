# Product Analytics v1 implementation plan

**Scope:** design for the exact 17 approved events in [event-taxonomy-v1.md](event-taxonomy-v1.md) and metrics in [product-metrics-v1.md](product-metrics-v1.md). Reviewed against develop SHA beb29ef6fba32a2eee0ca69637fa00da40e44ed7 (2026-11-13).

**Foundation state:** FE and BE have typed, fail-closed adapters/staging boundaries. No PostHog SDK, provider configuration, sender, business-flow event call sites, consent storage/UI, API behavior, database capability, migration, project/dashboard, or credential is added. The approved shared consent policy and registration-time consent remain separate rollout gates.

## Current source map and ownership

| Product area | Current code point | Analytics owner |
|---|---|---|
| Registration/onboarding | main.py auth route and auth/service.py call bootstrap_telegram_login; routers/me.py calls complete_current_onboarding. | BE user_registered/onboarding_completed only after explicit insertion/transition evidence. |
| App/discover | Mini App app shell and apps/mini-app/app/page.tsx visible activeCandidate; routers/discover.py writes decisions and returns match_created/match_id. | FE app_opened/discover_candidate_viewed; BE discover_decision_saved/match_created. |
| Chat | components/ChatRoom.tsx loads conversation and polling; routers/chats.py sends persisted messages and creates groups. | BE chat_first_message_sent/chat_message_sent/group_chat_created; no FE message fact. |
| Trip | routers/trips.py creates Trip and saves Draft; apps/mini-app/app/trips/[id]/page.tsx loads Trip/Draft/itinerary independently. | BE trip_created/trip_draft_updated; FE trip_opened after required Trip detail succeeds. |
| Proposal | routers/trips.py validates and creates/votes/cancels; TripProposalPanel.tsx displays Proposal and handles conflicts; SQL migration owns immutable votes and atomic apply/status. | BE created/vote/accepted/rejected facts; FE only structured scope-conflict UX. A read/refresh is not itself a Proposal event. |
| Existing analytics | No PostHog SDK or manual capture on current source. | No existing emitters or event contract to preserve. |

The Proposal SQL contract applies proposed operations before setting status accepted, within the same transaction. Publish trip_proposal_accepted only after that transaction commits; it means accepted and applied. A nested connection.transaction() returning is not proof that the authenticated outer transaction committed.

## Consent and privacy design

1. Product/legal approves one versioned consent policy, copy, default and revocation behavior before collection. To collect user_registered, offer the choice before auth bootstrap; decline/skip continues auth but suppresses the registration event. Until then analytics stays disabled by default.
2. FE and BE use one user-scoped consent state. Grant permits only the event allowlist; denied, unknown, absent, stale or revoked suppresses all capture. A person can decline or skip and continue the full product flow. No SDK init or FE queue before grant.
3. Current code has no shared server-verifiable consent capability. Recommended future capability: server-owned consent state/receipt that FE can read and BE can verify on every business request; on revoke, stop FE capture, discard FE queue, and reject unsent BE facts. Do not trust a local-only boolean for backend sends or participant fan-out.
4. Alternatives for later review: (A) persisted server-side consent/version gives immediate revocation and enables per-participant checks but requires an additive schema/API capability; (B) short-lived signed consent receipt avoids a table but revocation is delayed until expiry or needs a denylist/capability. No option is implemented or selected by this doc.
5. Consent state is not an authentication/authorization input. Missing/invalid state yields no event, never API failure. For group/match facts, emit a person-attributed event only for each participant whose own consent is active.
6. Event properties remain as in taxonomy; consent choice, text, exact time, and legal basis are not analytics properties. Retention/deletion covers pseudonymous IDs and entity refs.

## Frontend integration

- `apps/mini-app/lib/analytics.ts` exposes the typed manual adapter. FE may capture only app_opened, discover_candidate_viewed, trip_opened and trip_proposal_conflict. No call sites are connected; the application singleton is disabled, has no transport, and reads no provider config. No generic click/error logger.
- Initialize PostHog only after consent grant. Use the backend UUID after auth; an app_opened event before auth may use the SDK anonymous ID only after consent, then identify after auth. On account change/logout, reset identity.
- Disable interaction autocapture, automatic pageview/pageleave, exception capture, session replay, feature-flag polling and surveys. Pageviews/views use explicit events only; these controls are separate in PostHog configuration ([autocapture](https://posthog.com/docs/product-analytics/autocapture), [JS config](https://posthog.com/docs/libraries/js/reference), [replay](https://posthog.com/docs/session-replay/installation)).
- Apply a strict before_send property allowlist so SDK-added current URL/path/host/referrer, campaign, browser/OS/device, IP and GeoIP properties cannot leave the Mini App. Disable referrer/campaign persistence; require project IP discard and GeoIP off before project activation ([before_send](https://posthog.com/docs/libraries/js/reference), [IP data handling](https://posthog.com/docs/privacy/data-storage)).
- Capture view only after loaded content is visible. Use navigation/session/entity refs to suppress React StrictMode effects, repeated renders, retries and polls. A new app launch/navigation is a new occurrence.
- Capture proposal conflict only after structured 409 code proposal_scope_busy is handled and shown. Do not turn a generic error, 422, network failure, or rerender into this event.
- `capture()` is synchronous and best-effort. Missing transport, disabled state, missing/unknown/denied consent, invalid payload, or transport exception causes no product error. No PostHog SDK queue is initialized in this foundation.

## Backend integration

1. `travel_friend_backend.analytics` has a typed event builder that accepts only names and properties in the taxonomy. Build `distinct_id` from AuthenticatedPrincipal, never a request field or analytics header. Set event timestamp from committed business occurrence.
2. `get_authenticated_database_connection` provides a request-local collector. It publishes staged facts to an in-process bounded queue only after the outer `authenticated_transaction` exits successfully. If SQL or commit fails, discard all staged facts. Auth registration/login facts must stage after the auth service's own transaction closes; they are not connected in this foundation.
3. For Proposal list/detail routes, _refresh_trip_proposals can persist expiry/stale/dependency status changes. These statuses are outside the exact 17; never relabel them accepted/rejected. If a future event is approved, stage only an actual transition and publish after outer commit.
4. The queue capacity defaults to 1,000. Enqueue uses `put_nowait`; full queues drop facts. No delivery worker starts without an explicitly injected sender; the application configures neither sender nor worker. No retry, timeout, SDK, or HTTP call is included yet.
5. No outbox, event table, new DB write, data warehouse or durable-delivery promise. Queue/process loss can lose analytics. This is acceptable because analytics is never the business record.
6. No provider configuration or credentials means zero PostHog network requests. Missing transport, disabled FE state, invalid payload, or analytics exception cannot change API/UI behavior. Do not log event payloads.

## Properties, identity and calculations

- Use backend users.id as the stable authenticated distinct_id in FE/BE; no user traits. PostHog documents stable authentication IDs as a way to align client/server events ([identify users](https://posthog.com/docs/getting-started/identify-users)).
- Use fixed domain-separated SHA-256 entity refs only where required. FE Web Crypto and BE hashlib must share canonical UUID encoding and fixed test vectors. Hashing remains pseudonymization, not anonymization.
- Event UUID is source idempotency aid; keep event name, timestamp, distinct_id and UUID stable on retransmission. PostHog describes event dedupe as eventual, so source transition checks are still required ([event model](https://posthog.com/docs/data/events)).
- Metrics are defined in [product-metrics-v1.md](product-metrics-v1.md). DAU/WAU/MAU count unique people with significant-action event set only; opening/view events are separate. WCAT is distinct trip_ref with committed accepted-and-applied Proposal during each UTC calendar week. Rolling WAU/MAU use 7×24 / 30×24 hour bounds. Trip agreement groups by trip_ref in HogQL; it is not a person funnel.
- HogQL has not been live-tested: no PostHog project exists. Official docs describe SQL Insights, event properties, intervals, toStartOfWeek, and exact uniqExact aggregations ([SQL](https://posthog.com/docs/sql), [aggregations](https://posthog.com/docs/sql/aggregations)). Verify the saved query and result on a non-production project before dashboard use.

## Dashboard and configuration

- Project: separate PostHog Cloud project; team members only; do not put dashboards in Mini App. Do not create a project, choose a paid plan, configure a provider, or obtain credentials in this task.
- Future dashboards: Product Overview (WCAT, active users, onboarding and retention); Discover / Match (candidate views separate, decisions, match, first message); Trips / Proposal (Trip opens separate, Draft changes, Proposal/vote/accepted/applied/rejected/conflict). AI and Financials/LTV are future-only.
- A future provider configuration/enable switch requires separate approval and must fail closed when absent or invalid. No runtime switch is present in this foundation. Any future FE ingestion token/host and BE write-only token/host must come from provider configuration, never Git; do not put a personal PostHog API key in the application.

## Short capability-gap matrix

| Status | Items | Next safe step |
|---|---|---|
| Exact now | app_opened, discover_candidate_viewed, trip_opened, group_chat_created, trip_created, trip_draft_updated, trip_proposal_created, structured trip_proposal_conflict; message IDs and lock support first-message derivation; match ID/created flag. | Add manual lifecycle guards and regression tests in a future implementation. Publish BE facts after outer commit. |
| Needs additive result or equivalent serialized proof | user_registered created_user; onboarding_completed transitioned; discover_decision_saved newly persisted flag; trip_proposal_vote_cast vote_inserted; accepted/rejected status_changed transition fact. | Review a versioned capability or locked before/after query. Preserve current auth serialization, immutable votes, unanimous acceptance, and atomic apply. |
| Temporarily unavailable | Any PostHog collection before shared consent/revocation capability and consent policy approval; per-participant event attribution without consent state; live HogQL syntax/output validation. | Fail closed; app remains fully usable. Approve and implement consent separately, then validate query in non-production PostHog. |

## Future implementation tests

- Contract/unit: exact 17 names/owners/properties; reject unknown keys, text/PII/raw IDs; fixed FE/BE entity hash vectors; repeated event fact retains event UUID; extra prior-draft event names are not emitted.
- Consent/non-blocking: missing/unknown/denied consent and absent transport cause zero captures while app actions succeed; provider throws and queue-full drops do not alter API/UI result. Network timeout/5xx behavior remains for a later sender implementation.
- Frontend views: React StrictMode, rerender, refresh, tab visibility, slow/failed requests, launch/navigation ref guards, no event on hidden or failed content; structured scope 409 creates exactly one conflict UX event.
- Transaction: inject rollback/commit failure after SQL function returns; no send before commit and no staged event after rollback. Successful commit queues once. Nested transaction success alone is insufficient.
- Business facts: concurrent registration and repeated auth; onboarding repeat; decision retry/conflict; match per consenting participant; direct/group chat with 2–3 participants, system message before first user message, first-message race, idempotent and legacy message retry; empty Trip/create, Draft version changes and stale 409; Proposal idempotency, distinct immutable votes, same/opposite retry, unanimous applied acceptance, rejection, conflict, and concurrent voters.
- E2E staging only: consenting and non-consenting accounts; direct/group flows; 2–3 participants; first message; Trip → Draft → Proposal → accepted/applied and rejection; network/refresh retries. Assert business data independently of analytics; use fake capture sink; never production write smoke.
- Performance acceptance before enablement: measure 0 ms intentional analytics wait on user/API paths, enqueue p95 <1 ms, FE payload p95 ≤1 KiB and no measurable API latency regression in a real staging runtime. These remain unmeasured targets; unit tests do not establish them.

## Implementation gates

1. Review exact event names, North Star, metric denominators, consent model, pseudonymous refs, and capability gaps.
2. Approve and implement shared consent/revocation capability separately; until then no analytics collection.
3. Foundation implemented: disabled typed FE adapter, typed BE contract, request-local post-commit staging, bounded nonblocking queue and failure tests. No events are connected to business flow.
4. Add only approved additive result capabilities and test concurrency/idempotency.
5. Verify payloads and HogQL in non-production PostHog; validate counts against fixtures; keep project team-only.
6. Enable production only under a separate explicit project/retention/provider approval. Rollback is disable analytics; no DB rollback needed.

No API, schema, migration, PostHog project/setting/credential, dashboard, consent UI/state, or business-flow event connection was added in this foundation.

## Self-review

- [x] The MVP catalog has exactly the 17 approved names; no name was substituted or independently renamed.
- [x] WCAT means unique Trips with at least one accepted-and-applied Proposal per UTC calendar week; distinct Trip refs are counted and consent coverage is disclosed.
- [x] Backend staged facts are offered to the bounded queue only after outer commit; rollback and commit failure discard them. Queue delivery is best-effort and no sender is configured.
- [x] FE capture requires explicit grant, explicit enablement and a transport. BE provider delivery is absent, so shared consent remains a separate gate and collection is fully disabled. Adapter payloads use the approved property allowlists and exclude direct identifiers, text and business payloads.
- [x] DAU attribution follows the person who performed the qualifying action. Registration consent must be available before account creation to observe `user_registered`; neither consent gate changes product flow.
- [x] Actual staging performance checks are required before enabling collection; no performance results are claimed here.
- [x] Extra events are future-only; no runtime feature, schema/API behavior, migration, project, dashboard, credential, or unapproved business behavior was added.
- [x] HogQL specifications are documented but explicitly not verified against a live PostHog project.
