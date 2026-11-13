# Analytics dashboard rollout — Pre-Beta

**Status:** planning only. No PostHog project, collection, dashboard, credentials, or production setting was created or changed in the reporting audit.

The proposed aggregate-only PostgreSQL live-query source, output contract, local verification, and manual setup gates are documented in [dashboard-source.md](dashboard-source.md). Its migration is not applied to production and no PostHog source is connected.

## Proposed team-only dashboards

| Dashboard | Intended metrics | Source and caveats |
|---|---|---|
| **Product Overview** | WCAT by UTC week; significant-action DAU and rolling WAU/MAU; onboarding and D1/D7/D30 retention; opens/views shown separately. | PostHog approved events for consent-observed activity. Use `reporting-queries.sql` as the database source-of-truth check for registration totals and WCAT. PostHog counts will be consent-limited and may not equal complete database totals. No automated SQL-to-PostHog feed is approved. |
| **Discover / Match** | Candidate views; saved decisions; match creation; Discover → Match → first-message funnel. | FE manual `discover_candidate_viewed`; BE committed decision/match/message facts. Actor attribution is the action performer. Denominators include only consent-observed people; avoid implying the database-wide conversion rate. Current event emission is not connected. |
| **Trips / Proposal** | Trips created/opened; Draft updates; Proposal creation and votes; accepted/applied, rejected and scope conflicts; same-Trip Proposal-to-agreement funnel. | Database aggregates for exact Trip/Proposal totals; future post-commit events for consent-observed activity. WCAT groups by unique Trip, not user or Proposal row. Accepted means applied under the existing atomic transaction. Current event emission is not connected. |

AI and Financials/LTV remain future extensions requiring separate event, data-source, privacy, and billing review. Do not add dashboards for them during this rollout.

## Rollout gates

1. Product/legal approves one consent policy, notice, scope, retention, and revocation behavior. Decide how registration consent can occur before `/auth/telegram` creates an account. Consent absence must leave the user flow unchanged.
2. Implement and review shared server-verifiable consent/revocation for FE and BE. The current analytics adapters remain disabled; there are no business-flow call sites or provider sender.
3. Complete event-source gaps from [event-taxonomy-v1.md](event-taxonomy-v1.md), including transition/idempotency evidence where required. Preserve database facts as the business source of truth.
4. Provision a separate non-production PostHog Cloud project with team-only access. Configure IP discard/GeoIP off, property stripping, retention, deletion handling, and manual capture only. Keep autocapture, automatic pageviews, replay, and exception capture disabled.
5. Validate the exact allowlist and aggregate dashboards using synthetic/test data. Reconcile DB-backed totals against read-only SQL snapshots. Validate HogQL and time boundaries in that project; no live PostHog calculation has been verified in this audit.
6. Measure real staging overhead and delivery failure behavior before any production collection. These checks are not replaced by unit tests or this SQL validation.
7. Production project, credentials, settings, deployment, and collection each require separate review and explicit approval. Dashboards remain accessible only to team members; they are not embedded in the Mini App.

## Privacy and legal release-readiness TODO

These are open review tasks, not legal conclusions. No infrastructure or processing has been declared compliant with any law.

- [ ] Confirm which user populations and jurisdictions are served, and obtain privacy/legal review of purpose, lawful basis, notice, consent, withdrawal, and age-related requirements.
- [ ] Review cross-border processing and transfers with provider contracts and subprocessors. Current provider metadata reports Supabase region `eu-central-1` and Render region `frankfurt`; Vercel's project metadata did not establish a single execution region. Confirm the relevant data path and contractual commitments before collection.
- [ ] Approve PostHog project region, retention, deletion, access membership, DPA/subprocessor terms, and incident/contact process before creating a production project.
- [ ] Confirm identifiers and pseudonymous references are necessary and proportionate. Hashed Trip/Proposal refs remain linkable pseudonyms; never send Telegram IDs, names, message text, routes, dates, budgets, titles, raw IDs, IP, or arbitrary request/error payloads.
- [ ] Verify PostHog IP/GeoIP discard, FE SDK default-property stripping, no autocapture/replay/pageviews/exception capture, and FE/BE event non-duplication before any collection.
- [ ] Confirm access to SQL aggregates is least-privilege and team-only. These counts are business-sensitive even though results contain no user-level rows.
- [ ] Reconfirm live provider targets, regions, and deployment provenance at release time; this audit is a dated snapshot and does not establish current legal residency or a complete data-flow inventory.

Until these gates are closed, keep PostHog collection disabled and use only authorized aggregate SQL reporting when needed.
