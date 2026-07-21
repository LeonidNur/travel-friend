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

## Текущий этап

### Backend foundation / persistence

#### Backend

- backend contracts
- Supabase schema
- Telegram Auth через raw `initData`
- persistence профиля, интересов, чатов и поездок

#### Realtime

- подготовка realtime chat flow после базовой persistence

#### AI

- AI только после рабочего backend-контура

#### Product

- групповой flow остаётся отдельным открытым вопросом

#### UX/UI

- дизайн-система
- wireframes
- UX/UI refinement существующих Profile / Discover / Chats / Trips сценариев совместно с дизайнером

## Дальше

1. Подготовить backend contracts и Supabase schema.
2. Реализовать Telegram Auth через raw `initData`.
3. Подключить persistence для профиля, интересов, чатов и поездок.
4. Вернуться к realtime chat flow после базовой persistence.
5. Подключить AI только после рабочего backend-контура.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
