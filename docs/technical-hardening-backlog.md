# Technical hardening backlog

> Статус: current backlog. Это не roadmap и не specification нового продукта. Он фиксирует известные технические риски persisted backend-backed MVP в порядке их исполнения; completed checkpoint не является active TODO.

## Как использовать

- Текущее реализованное поведение проверяется по code, tests и migrations.
- HTTP-границы сверяются с [backend contracts](backend/backend-contracts.md), данные — с [database schema](database-schema.md) и migrations.
- Roadmap определяет направление; этот документ хранит детальные technical risks и контрольные условия перехода между этапами.
- Historical `CHANGELOG.md` и `dev-log.md` могут объяснять происхождение риска, но не меняют его актуальный статус.

## Current checkpoint / completed baseline (23.09.2026)

- TEAM E2E completed; mega-review / PRE-TEAM work completed.
- Systematic authorization / IDOR review completed.
- Discover requester eligibility completed.
- First-login concurrency completed.
- Least-privileged PostgreSQL role `app_runtime` и authenticated DB context completed: FastAPI устанавливает `app.user_id` только на время transaction.
- RLS/capability boundary completed для всех 17 application tables; основные write flows onboarding, Discover → Match → Direct Chat, Group Chat, Messages и Trip creation используют контролируемые DB capabilities.
- Production security cutover completed; production DB применена до `20260901280000`.
- Production grants verifier, runtime deployment gate, production `/health` и Telegram smoke passed; совместимый security backend deployed.
- Auto-Deploy remains Off pending отдельного deployment workflow.

## P0 — remaining security baseline

1. Telegram `initData` security.
2. Invariant `completed → DELETE active TravelIntent`.
3. Session lifecycle baseline.
4. Backend input/domain limits.
5. Minimal rate limiting.
6. Secrets/env/logging review.

## Reliability / UX before wider test

- Request/correlation ID.
- Frontend timeout/retry/loading/empty/error states.
- Chat → Profile navigation regression — **BEFORE WIDER TEST**.
- Controlled multi-user Trip Detail coverage remains required.
- Reciprocal Match feedback.
- Active TravelIntent view/edit.
- Health/readiness.
- Minimal error monitoring.

## Deployment / CI / reproducibility

- Safe production deployment workflow before Auto-Deploy is re-enabled.
- Deployment provenance/environments.
- Deployment smoke chain.
- CI with disposable PostgreSQL.
- Local test DB hygiene.
- Backend runbook/README.
- Backup/restore.
- Rollback/forward-fix procedure; after incompatible DB/grants changes старый backend не считается автоматически допустимым rollback target.

## Control exit

1. Repeat controlled multi-user E2E after hardening.
2. Fix only remaining BLOCKER / required **BEFORE WIDER TEST** issues.
3. Proceed to a small external user test.

## P1 — post-test backlog

### Chats: realtime / unread / pagination

- Incoming messages require refresh; это P1 realtime finding из TEAM E2E.
- Unread и pagination остаются отдельными P1 Chat work items.

### Group Chat membership lifecycle / invitations

- Group Chat has no invitation/accept lifecycle; это P1 finding из TEAM E2E.

### Data lifecycle / privacy

- Отдельный post-test backlog block для data lifecycle и privacy.

### Backend architecture / concurrency cleanup

- Отдельный post-test backlog block для architecture и concurrency cleanup.
- Stronger stolen-runtime-credential threat model — post-MVP; transaction-local `app.user_id` не предназначен для per-user containment при прямом произвольном SQL скомпрометированной credential `app_runtime`.

### Test architecture cleanup

- Отдельный post-test backlog block для test architecture cleanup.

### DB / performance

- Отдельный post-test backlog block для DB/performance.

### Trips lifecycle

- Trip write/lifecycle, stop editor, `start/complete/cancel/leave` и invitations остаются отдельным P1 work item.

### Operations / reproducibility

- Отдельный post-test backlog block для operations/reproducibility.

### Documentation cleanup

- Отдельный post-test backlog block для documentation cleanup.

## P2 — AI / Proposal

- AI/RAG boundary with second developer.
- Proposal persistence / decisions / version invariants.
- Atomic Proposal → Trip apply without AI.
- AI as Proposal producer/facilitator, never Trip owner.
- Later RAG/providers/background jobs/cost controls.
- Uploads/audit events only when justified by later scope.

## Consciously deferred / do not do now

Прематурная архитектура и post-MVP work остаются отдельно от active MVP hardening: сложный Group Chat membership lifecycle сверх P1 invitation/accept, расширенный Trip lifecycle, transport/external offers, full moderation, provider integrations, AI/RAG implementation и прочие product expansions. Их нельзя выводить из frontend view models, добавлять «заодно» при закрытии hardening work item или принимать за текущий HTTP/physical-data contract.
