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
- ✅ Controlled TEAM E2E (до production rollout) и systematic authorization / IDOR review
- ✅ first-login concurrency и Discover requester eligibility
- ✅ production security baseline: DB до `20260901280000`, RLS на всех 17 application tables, least-privileged `app_runtime`, transaction-local `app.user_id`, grants verifier и runtime deployment gate
- ✅ совместимый security backend deployed в production; production infrastructure smoke пройден
- ✅ №15: manual production deployment workflow выполнен 29.10.2026; Auto-Deploy остаётся Off
- ✅ P0 security baseline: Telegram `initData`, completed-onboarding invariant, session lifecycle, backend input/domain limits, minimal rate limiting и secrets/env/logging hygiene
- ✅ P0.5 reliability/observability: request correlation, frontend read states, Chat → Profile navigation, controlled multi-user Trip Detail coverage, reciprocal Match feedback, active TravelIntent edit, readiness и correlated backend logging

## Текущий этап

### Production checkpoint и дальнейшая работа

Реализованный backend-backed vertical slice: `Telegram Auth → onboarding → Profile → TravelIntent → Discover → reciprocal Match → direct/group Chat → Messages → Trip creation → Trip List/Detail`. Group Chat создаётся из existing matched/direct-chat companions с фиксированным MVP-составом; Trips List/Detail читают persistence.

**Production rollout завершён 29.10.2026.** На дату rollout production Supabase ledger был 24; пять ожидавших migrations применены, runtime grants, privilege verifier и database deployment gate прошли. Render backend работал на SHA `67eae892886cabac7408857c8a1b24af1728d2cf`, Vercel Production был READY на snapshot `15c0d761fb54670b3987f743ebaca5df353f3972`; health/readiness и infrastructure smoke прошли. Это датированный checkpoint, а не утверждение о непрерывной доступности или неизменности production после 29.10. Подробности находятся в [production deployment runbook](backend/production-deployment-runbook.md).

PR #37 установил единую регистрацию любого пользователя с валидным Telegram `initData`; core/tester allowlists и tester pause удалены. Telegram identity binding и Bearer session checks сохранены; отдельной SQL migration для отмены admission-модели не потребовалось.

Controlled TEAM E2E и systematic authorization / IDOR checks завершены до rollout. Production infrastructure smoke после rollout проверил health/readiness, proxy и ожидаемые 401 для защищённых endpoints без Bearer. Полный авторизованный Telegram production E2E **не проводился**; он остаётся отдельным pending шагом. Внешнее пользовательское тестирование не начато и требует отдельного preflight/control gate: cost/abuse readiness, актуальная проверка deployment/schema и согласованный сценарий Telegram E2E. Открыты полный schema-drift/provenance audit, Supabase API-role grants шире нужного и default EXECUTE ACL hardening, provider billing/abuse и operational recovery/stop readiness. Детальные технические риски и gate status находятся в [technical hardening backlog](technical-hardening-backlog.md), operator procedure — в [production deployment runbook](backend/production-deployment-runbook.md).

Последующие самостоятельные work items:

- P1 из TEAM E2E: realtime incoming messages без refresh и Group Chat invitation/accept lifecycle;
- Trip write/lifecycle: изменение подтверждённого состояния, stop editor, `start/complete/cancel/leave` и правила версий;
- invitations, изменение состава, leave, roles/admin/permissions, invite links, сложный membership lifecycle Group Chat и расширенный Trip lifecycle — после отдельного решения.

Auto-Deploy остаётся Off. Будущие production rollout выполняются вручную после отдельного подтверждения оператора. После несовместимых DB/grants изменений старый backend не является автоматически допустимым rollback target.

AI/Proposal и provider integrations отложены до подключения второго разработчика. Это не блокер текущего direct-chat MVP и не должно реализовываться в рамках закрытия его persistence flow.

#### UX/UI refinement

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Завершить текущую ревизию и систематизацию документации.
2. Подготовить и провести отдельно согласованный авторизованный Telegram production E2E.
3. После необходимых preflight/control gates принять решение о первом внешнем пользовательском тестировании.
4. Дальнейшие продуктовые slices вести отдельными задачами.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Roadmap показывает направление; детальные technical risks ведутся в [technical hardening backlog](technical-hardening-backlog.md). `CHANGELOG` и `dev-log` — historical records, а не описание current state.
