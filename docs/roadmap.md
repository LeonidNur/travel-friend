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

## Текущий этап

### Backend foundation на основе утверждённой логической модели

#### Backend

- backend architecture docs
- backend contracts
- Telegram Auth через raw `initData`
- physical data design и Supabase schema
- persistence профиля, интересов, чатов и поездок

#### Realtime

- подготовка realtime chat flow после базовой persistence

#### AI

- AI только после рабочего backend-контура

#### UX/UI

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Подготовить backend contracts на основе утверждённой логической модели.
2. Реализовать Telegram Auth через raw `initData`.
3. Спроектировать physical data design и Supabase schema как следующий отдельный этап.
4. Подключить persistence для профиля, интересов, чатов и поездок.
5. Вернуться к realtime chat flow после базовой persistence.
6. Подключить AI только после рабочего backend-контура.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
