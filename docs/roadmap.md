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
- ✅ persisted direct Chats и Messages
- ✅ Trips persistence, server Trip creation API из direct Chat, `trip_stops`, Trips List и Trip Detail

## Текущий этап

### MVP mega-review и закрытие незавершённых direct-chat сценариев

Реализованный frontend vertical slice: `Telegram Auth → onboarding → Profile → TravelIntent → Discover → reciprocal Match → direct Chat → Messages`; Trips List/Detail читают persistence. Server-side Trip creation API уже существует, но UI ещё не вызывает его.

Следующие самостоятельные work items:

- UI для уже существующего `POST /chats/{chatId}/trips`, затем Trip write/lifecycle: изменение подтверждённого состояния, stop editor, `start/complete/cancel/leave` и правила версий;
- realtime, read state и pagination для сообщений;
- production backend deployment/configuration, RLS и операционный runbook;
- безопасность и moderation capabilities (block/report/audit);
- базовый Group Chat MVP: создание создателем с минимум тремя участниками из existing matched/direct-chat companions, persisted messages, отображение в Chats, фиксированный состав и создание Trip из direct/group Chat с переносом всех текущих участников;
- invitations, изменение состава, leave, roles/admin/permissions, invite links, сложный membership lifecycle Group Chat и расширенный Trip lifecycle — после отдельного решения.

AI/Proposal и provider integrations отложены до подключения второго разработчика. Это не блокер текущего direct-chat MVP и не должно реализовываться в рамках закрытия его persistence flow.

#### UX/UI refinement

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Провести MVP mega-review текущего backend-backed direct-chat flow.
2. Согласовать и реализовать следующий один Trip lifecycle/write slice.
3. Определить production backend deployment, RLS и наблюдаемость до внешнего запуска.
4. Вернуться к realtime chat flow после стабилизации базовых HTTP contracts.
5. Вернуться к AI только после подключения второго разработчика.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
