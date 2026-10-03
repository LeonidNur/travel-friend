# Дорожная карта

## Готово

- ✅ Vercel deployment
- ✅ Telegram Mini App environment
- ✅ Debug infrastructure
- ✅ Fixed Bottom Navigation
- ✅ Profile MVP
- ✅ Profile Edit Mode
- ✅ Discover MVP
- ✅ Public Buddy Profile
- ✅ Mock Interest / Match Flow
- ✅ Chats List MVP
- ✅ Chat Room MVP
- ✅ Frontend Data Models
- ✅ Trips frontend data model MVP
- ✅ Trips List MVP
- ✅ Trip Details MVP
- ✅ Chat ↔ Trip navigation MVP
- ✅ local session trip flow
- ✅ frontend verification loop
- ✅ Chats / Trips stabilisation
- ✅ Codex skills workflow docs
- ✅ logical domain model
- ✅ approved ER model
- ✅ backend architecture documentation package
- ✅ Backend Contracts
- ✅ Telegram Auth architecture
- ✅ FastAPI backend foundation + Telegram initData verifier
- ✅ Physical Data Design
- ✅ local Supabase CLI workflow и local PostgreSQL/Supabase environment
- ✅ Core Identity persistence (`users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states`, `travel_intents`)
- ✅ Telegram Auth backend: raw `initData` verification, `/auth/telegram`, `/auth/logout`, Bearer authentication и server-side sessions
- ✅ Profile + TravelIntent API и frontend onboarding / hydration
- ✅ Discover candidates + финальные interest decisions + Match → direct Chat
- ✅ persisted direct и group Chats/Messages
- ✅ Group Chat MVP: создание из existing matched/direct-chat companions, минимум три участника, фиксированный состав
- ✅ Trips persistence, server Trip creation API из direct/group Chat, frontend CTA и 409 → `GET /trips` navigation, `trip_stops`, Trips List и Trip Detail
- ✅ TEAM E2E и systematic authorization / IDOR review
- ✅ first-login concurrency и Discover requester eligibility
- ✅ production security baseline: DB до `20260901280000`, RLS на всех 17 application tables, least-privileged `app_runtime`, transaction-local `app.user_id`, grants verifier и runtime deployment gate
- ✅ совместимый security backend deployed в production; production `/health` и Telegram smoke пройдены
- ✅ P0 security baseline: Telegram `initData`, completed-onboarding invariant, session lifecycle, backend input/domain limits, minimal rate limiting и secrets/env/logging hygiene
- ✅ P0.5 reliability/observability: request correlation, frontend read states, Chat → Profile navigation, controlled multi-user Trip Detail coverage, reciprocal Match feedback, active TravelIntent edit, readiness и correlated backend logging

## Текущий этап

### Дальнейший Technical Hardening Backlog

Реализованный backend-backed vertical slice: `Telegram Auth → onboarding → Profile → TravelIntent → Discover → reciprocal Match → direct/group Chat → Messages → Trip creation → Trip List/Detail`. Group Chat создаётся из existing matched/direct-chat companions с фиксированным MVP-составом; Trips List/Detail читают persistence.

Ближайший технический этап — deployment / CI reproducibility из [technical hardening backlog](technical-hardening-backlog.md), начиная с №15 Production deployment workflow. External test остаётся после необходимых deployment и control gates; детальный порядок hardening остаётся в backlog и не дублируется здесь.

Последующие самостоятельные work items:

- P1 из TEAM E2E: realtime incoming messages без refresh и Group Chat invitation/accept lifecycle;
- Trip write/lifecycle: изменение подтверждённого состояния, stop editor, `start/complete/cancel/leave` и правила версий;
- invitations, изменение состава, leave, roles/admin/permissions, invite links, сложный membership lifecycle Group Chat и расширенный Trip lifecycle — после отдельного решения.

Auto-Deploy backend остаётся Off до отдельной задачи по deployment workflow. После несовместимых DB/grants изменений старый backend не является автоматически допустимым rollback target.

AI/Proposal и provider integrations отложены до подключения второго разработчика. Это не блокер текущего direct-chat MVP и не должно реализовываться в рамках закрытия его persistence flow.

#### UX/UI refinement

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Продолжить Technical Hardening Backlog с deployment / CI reproducibility, начиная с №15 Production deployment workflow.
2. Затем пройти required deployment/control gates перед решением об external test.
3. После этого согласовать и реализовать следующий один Trip lifecycle/write slice; к AI вернуться только после подключения второго разработчика и отдельного Pre-AI FinOps gate.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Roadmap показывает направление; детальные technical risks ведутся в [technical hardening backlog](technical-hardening-backlog.md). `CHANGELOG` и `dev-log` — historical records, а не описание current state.
