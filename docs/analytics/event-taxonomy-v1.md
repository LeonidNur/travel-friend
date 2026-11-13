# Event taxonomy v1 (Pre-Beta)

**Status:** review-fixed contract against develop at SHA beb29ef6fba32a2eee0ca69637fa00da40e44ed7 (2026-11-13). Exactly the approved 17 event names are MVP. Current code has no analytics capture. This document changes no code, API, schema, migration, or provider setting.

## Shared contract

| Field | Rule |
|---|---|
| Names and owners | Use only the exact 17 names below. FE owns manual UX events app_opened, discover_candidate_viewed, trip_opened, trip_proposal_conflict. BE owns persisted/auth facts. |
| Identity | Authenticated distinct_id is backend users.id UUID shared by FE and BE, restricted pseudonymous P1. app_opened may use an anonymous SDK ID only after consent and link after auth. Never send Telegram IDs, contact/name, or tokens. |
| Timestamp | FE view = moment loaded content is visible; BE = persisted created_at or transition time. UTC. |
| Event ID | Stable valid PostHog event UUID per fact/view/action. BE UUIDv5 from event name + immutable fact ID (registration uses created user ID); FE creates one UUID per navigation/action lifecycle and retains it for delivery retries. Never place it in ordinary properties. |
| Repeat/dedupe | Source guards first: one per visible lifecycle, inserted fact, Draft version, immutable vote, or real transition. Same retry reuses UUID and timestamp. First chat message intentionally emits both first-message and all-message events with distinct names/UUIDs. PostHog deduplication is eventual, not strict ([event docs](https://posthog.com/docs/data/events), [JS UUID](https://posthog.com/docs/libraries/js/reference)). |
| Properties/privacy | Strict allowlist only; reject unknown properties. P0 = closed enum/boolean/bucket. P1 = restricted pseudonymous person/entity reference. Never serialize models, rows, props, error bodies, URLs, or DOM. |
| Consent | Same user-scoped, versioned, server-verifiable consent state gates FE and BE. Granted permits the allowlisted event; denied/unknown/missing/expired/revoked means no capture. Consent never gates the product flow. Current shared capability is missing; until approved and implemented, collection is disabled. |
| Commit | Stage BE facts and enqueue only after the outer database transaction commits. No event on rollback, commit failure, validation failure, or 409/422, except FE-owned trip_proposal_conflict after receiving the specific structured scope conflict. |

Common safe properties, only when applicable: app_surface=telegram_mini_app; environment=development|staging|production; release_channel=prebeta|beta; non-user-specific app version; chat_type=direct|group. Entity refs trip_ref, proposal_ref, chat_ref, match_ref, candidate_ref are SHA-256 of canonical UUID with a fixed domain prefix. They remain linkable pseudonyms (P1); never send raw entity IDs or counterpart IDs.

Never send message text, destinations/routes/dates/budgets, Draft JSON, accommodation/transport or itinerary values, Proposal title/scopes/old-new values, profile/TravelIntent values, Telegram initData/IDs, auth tokens, IP, full URL/query/referrer, fingerprint, DOM text, or arbitrary exception/request/response data.

## Exact 17 Pre-Beta events

| # | Exact event / owner | Verified source and moment | Allowed event properties | ID and repeat condition | Current capability / privacy |
|---:|---|---|---|---|---|
| 1 | user_registered — BE | /auth/telegram → auth.service.login() → bootstrap_telegram_login; only after a newly inserted account commits. | registration_method=telegram; app_surface. | UUIDv5(new user UUID); once per account. Repeated login is not registration. | Needs additive result: current bootstrap has no created_user flag; do not infer from first login. P1 person. |
| 2 | onboarding_completed — BE | /me/onboarding invokes complete_current_onboarding(); after actual transition to completed commits. | completion_path=profile_and_travel_intent; app_surface. | UUIDv5(user + immutable transition fact); no repeat completion. | Needs additive result: function returns completed for both first/repeated completion. P1 person. |
| 3 | app_opened — FE | App root/auth bootstrap: once Mini App shell is visible for a new launch/session. Not React render, route rerender, or refresh in same launch. | app_surface; entry_state=authenticated|unauthenticated only after consent. | Client UUID per launch lifecycle, guarded by a launch/session ref. A new launch is another event. | Exact FE point exists; only after consent; no automatic pageview. P0/P1. |
| 4 | discover_candidate_viewed — FE | apps/mini-app/app/page.tsx: candidate card loaded and visible from activeCandidate. Not fetch, skeleton, rerender, StrictMode replay, hidden state, or image load. | candidate_ref; position_bucket=first|later. | UUID per Discover navigation + candidate ref; rerender does not repeat. | Exact visible render point exists. P1 pseudonymous candidate ref. |
| 5 | discover_decision_saved — BE | routers/discover.py PUT /discover/decisions/{target_user_id}; committed final decision after outer commit. | decision=interested|rejected; candidate_ref. | UUIDv5(actor + target + persisted decision fact); same final-decision retry reuses ID. | Needs additive result or serialized comparison: current function lacks “new decision” flag. P1. |
| 6 | match_created — BE | record_current_discover_decision reports new reciprocal match; publish after commit. Attribute once per participant only when that participant's consent is active. | match_ref; chat_type=direct|group. | UUIDv5(match ID + participant ID); no event on match_created=false/retry. | Match ID/created flag exist; participant set can be read in transaction. Participant consent state is a gap. P1 refs. |
| 7 | chat_first_message_sent — BE | POST /chats/{chat_id}/messages: first durable type=user row in chat; publish after outer commit. System events do not count. | chat_ref; chat_type. | UUIDv5(message ID + event name); one per chat's first user-message fact. | Exact via prior-user-message query while chat lock remains held; test concurrent first sends/system message first. P1 chat ref. |
| 8 | chat_message_sent — BE | Same route: every durable user message after outer commit. First message also emits event #7. | chat_ref; chat_type. | UUIDv5(immutable message ID + event name). Idempotent client_request_id retry maps to same ID; each new durable row is a new event. | Message ID returned; legacy retry without idempotency key can insert a second row and is another durable message. No message content. P1. |
| 9 | group_chat_created — BE | routers/chats.py create_group_chat_route → create_current_group_chat; new group and participants commit, then publish. | chat_ref; participant_count_bucket=3|4_5|6_plus. | UUIDv5(new group chat ID); a separately inserted group is a separate fact. | Exact inserted chat ID returned; publish after outer commit. No title/participant IDs. P1. |
| 10 | trip_created — BE | routers/trips.py create_trip → create_current_trip_from_chat; newly inserted forming Trip and initial Draft commit. | trip_ref; chat_ref; chat_type; initial_state=empty. | UUIDv5(Trip ID); active-Trip conflict emits none. | Exact creation fact; after outer commit. P1 refs. |
| 11 | trip_opened — FE | apps/mini-app/app/trips/[id]/page.tsx: required Trip detail succeeds and page is visible. Draft/itinerary parallel requests do not gate it. | trip_ref; allowlisted trip_status. | Client UUID per navigation entry + trip_ref; API retry/rerender does not repeat. | Exact page point exists; not an active action. P1 trip ref. |
| 12 | trip_draft_updated — BE | PUT /trips/{trip_id}/draft increments version and inserts immutable history; publish after outer commit. | trip_ref; draft_version_bucket=1|2_5|6_plus; changed_scope_groups from route|dates|budget|accommodation|transport|itinerary|notes. | UUIDv5(Trip ID + committed Draft version); stale-base 409 emits none; next version is new. | Exact source fact exists; never send Draft JSON. P1. |
| 13 | trip_proposal_created — BE | POST /trips/{trip_id}/proposals persists Proposal; publish after outer commit, including initial blocked state. | trip_ref; proposal_ref; proposal_status; scope_group_count_bucket=1|2_5|6_plus; has_prerequisites. | UUIDv5(Proposal ID); repeat idempotency key returns same Proposal/event ID; validation/conflict before create emits none. | Current create capability returns Proposal ID and has idempotency key. No title/scopes/operations. P1. |
| 14 | trip_proposal_vote_cast — BE | cast_current_trip_proposal_vote inserts new immutable voter row; publish after outer commit. | trip_ref; proposal_ref; vote=accept|reject; voter_count_bucket=2|3_5|6_plus. | UUIDv5(Proposal ID + voter ID + event name); distinct users have distinct facts; same-vote retry emits none; opposite vote 409 emits none. | Needs additive result or serialized query: current return has no vote_inserted flag. P1. |
| 15 | trip_proposal_accepted — BE | Atomic vote capability calls apply_trip_proposal, then updates Proposal to accepted in same transaction; publish after commit. Thus accepted means applied. | trip_ref; proposal_ref; participant_count_bucket=2|3_5|6_plus. | UUIDv5(Proposal ID + event name); one per actual transition, not status read/retry. | Needs additive result: current result can return existing accepted on retry. SQL applies and accepts atomically; this is WCAT source. P1. |
| 16 | trip_proposal_rejected — BE | New reject vote changes pending Proposal to rejected; publish after commit. | trip_ref; proposal_ref; participant_count_bucket=2|3_5|6_plus. | UUIDv5(Proposal ID + event name); one per transition. | Needs additive result: same status-transition gap as accepted. P1. |
| 17 | trip_proposal_conflict — FE | After proposal create returns structured 409 detail.code=proposal_scope_busy and UI presents that scope conflict. Not generic error, 422, network failure, or rerender. | conflict_kind=scope_overlap; trip_ref. | Client UUID per submit attempt; one per handled conflict response; a new attempt is a new event. | Exact structured response exists; FE owns UX observation, not a persisted business fact. No raw scope/title. P1 trip ref. |

## Capability-gap matrix

| Capability | Status | Evidence / safe resolution |
|---|---|---|
| App/candidate/Trip views; structured scope conflict | **Exact now** | App root, activeCandidate, Trip detail page, proposal_scope_busy response exist; add lifecycle guards only. |
| Group chat, Trip, Draft version, Proposal creation | **Exact now** | New row/version IDs returned; stable source fact and post-commit publication. |
| Match creation | **Exact now** as a fact; **temporarily unavailable** for per-person fan-out until consent state exists | Current result returns created flag and match ID. Read participant set in transaction; emit only for each consenting participant. |
| First/all chat messages | **Exact now** | Message ID/sequence and chat serialization exist; check earlier user rows under lock. Regression-test concurrent sends and system messages. |
| user_registered | **Needs additive result** | Add reviewed/versioned created_user result; no login heuristic. Consent must be granted before account creation or the registration fact is uncollected; declining never blocks auth. |
| onboarding_completed | **Needs additive result** | Add transition boolean/fact; current result does not distinguish repeat. |
| discover_decision_saved | **Needs additive result or serialized comparison** | Prove a newly persisted decision; retries must not count twice. |
| Proposal vote/accepted/rejected | **Needs additive result** | Add vote_inserted and status_changed/transition fact, or prove query under same trip→proposal lock order; preserve current voting/apply rules. |
| Shared consent and revocation | **Temporarily unavailable** | Current code has no shared server-verifiable consent state. Until approved capability/receipt exists, disable all capture. Missing consent never blocks the flow. |
| Live PostHog calculation validation | **Temporarily unavailable** | No project is provisioned. HogQL below is a documented specification only, not live-tested. |

No gaps are implemented in this docs-only change. No API, DB, migration, runtime, business-flow, or PostHog setting changes are authorized here.

## Future-only catalog

Prior-draft additions not in the approved 17: login_succeeded, profile_saved, travel_intent_saved, chat_opened, message_sent, proposal_opened, proposal_status_changed. These are future candidates only, never emitted as aliases or duplicated alongside approved events. Preserve these future families without implementation now:

- **AI:** request/suggestion lifecycle, latency, provider/model enum, token/cost buckets; no prompts, outputs, or tool arguments.
- **Billing / monetization / LTV:** confirmed billing lifecycle, revenue/refund/currency aggregates, cohort LTV after separate source/privacy review; no payment details.
- **Referrals:** opaque campaign attribution, no invitee contact details.
- **Experiments:** explicit assignment/exposure facts, never inferred from rerenders.
- **Reliability:** bounded operation/status/error-code enums and aggregate delivery loss; no stack traces or raw IDs.
