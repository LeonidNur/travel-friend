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

## Текущий этап

### Supabase/PostgreSQL migrations по небольшим persistence slices

#### Backend

- начать с Core Identity;
- после Core Identity завершить `/auth/telegram`;
- затем продолжить persistence профиля, интересов, чатов и поездок.

#### Realtime

- подготовка realtime chat flow после базовой persistence

#### AI

- AI только после рабочего backend-контура

#### UX/UI

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Реализовать Supabase/PostgreSQL migrations небольшими persistence slices, начиная с Core Identity.
2. Завершить `/auth/telegram` после Core Identity.
3. Подключить persistence для профиля, интересов, чатов и поездок.
4. Вернуться к realtime chat flow после базовой persistence.
5. Подключить AI только после рабочего backend-контура.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
