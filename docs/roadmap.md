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
- ✅ Codex skills workflow docs

## Текущий этап

### Следующий продуктовый этап

#### Продукт

- согласование Trips MVP
- уточнение Trip ↔ Chat модели
- согласование статусов полей Trips и порядка категорий в карточках
- уточнение перехода от interest/match к чату
- групповой flow как отдельный открытый вопрос

#### Инфраструктура

- подготовка Supabase/API и backend contracts после завершения frontend-flow
- Telegram Auth на сервере через raw `initData`
- базовая схема данных для профилей, интереса и чатов

#### AI

- AI внутри чатов позже, после закрепления чатов, поездок и backend-контура

#### UX/UI

- дизайн-система
- wireframes
- уточнение Trips как следующего отдельного сценария

## Текущий документальный этап

- Обновляется и уточняется инженерная документация по итогам Chat Room MVP и предварительной модели Chats / Trips.
- Поддерживается единый процесс: код, диагностика, выводы и документы должны совпадать между собой.

## Дальше

1. Согласовать Trips MVP.
2. Уточнить Trip ↔ Chat модель.
3. Подготовить Supabase/API и backend contracts.
4. Вернуться к AI внутри чатов после стабилизации чатов, поездок и backend-контура.

## Примечания

- AI-помощник должен быть встроен в сценарий чатов и поездок, а не существовать как отдельная вкладка.
- Для командной синхронизации важно держать `roadmap`, `dev-log`, `CHANGELOG` и README в согласованном состоянии.
