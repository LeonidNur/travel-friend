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

## Текущий этап

### Profile + TravelIntent API

#### Backend

- authenticated Profile read/write;
- authenticated active TravelIntent read/write/archive;
- все операции только для текущего authenticated User;
- onboarding state transitions;
- backend contract для будущего frontend onboarding.

#### Следом: frontend onboarding

- первый полный flow: Telegram Auth → User → onboarding → Profile → TravelIntent → onboarding completed → основной интерфейс;
- повторный запуск с восстановлением того же пользователя и данных.

#### Последующие этапы

- persistence slices для интересов, чатов и поездок;
- realtime chat flow после базовой persistence;
- AI только после рабочего backend-контура.

#### UX/UI refinement

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Реализовать Profile + TravelIntent API для текущего authenticated User.
2. Реализовать frontend onboarding и сквозное восстановление существующего пользователя и данных.
3. Продолжить persistence slices для интересов, чатов и поездок.
4. Вернуться к realtime chat flow после базовой persistence.
5. Подключить AI только после рабочего backend-контура.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
