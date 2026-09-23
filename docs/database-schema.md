# Database Schema

Этот документ — навигация по фактической physical schema и security boundary. SQL-источником истины являются migrations в `supabase/migrations/`; этот файл не заменяет их.

## Реализованная schema и RLS (`develop`, 2026-09-23)

Применяемые migrations:

- `20260826084844_core_identity.sql`: `users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states`, `travel_intents`;
- `20260826100000_user_sessions.sql`: `user_sessions`;
- `20260901120000_discover_interest_decisions_and_matches.sql`: `discover_interest_decisions`, `matches`;
- `20260901130000_chat_persistence.sql`: `chats`, `chat_participants`, `messages`, `chat_summaries` и `matches.chat_id`;
- `20260901140000_trip_persistence.sql`: `trips`, `trip_participants`;
- `20260901150000_trip_stops_persistence.sql`: `trip_stops`.
- `20260901160000`–`20260901280000`: authenticated DB context, bearer/login/onboarding capabilities и RLS slices для всех current application tables.

В current MVP новая Trip из existing direct или group Chat сразу получает всех активных `trip_participants`. Таблицы `trip_invitations`, membership lifecycle, `proposals`, transport segments, provider/AI и audit/moderation не созданы. Для Group Chat schema использует существующие `chats(type='group')` и `chat_participants`; persisted group title отдельной таблицей или полем не хранится.

RLS enabled на всех 17 application tables. FastAPI выполняет authenticated business SQL как non-owner `app_runtime` и устанавливает `app.user_id` transaction-local. Direct reads ограничены RLS/column grants; onboarding, Discover → Match → direct Chat, Group Chat, Messages и Trip creation используют узкие owner-owned `SECURITY DEFINER` capabilities. Точный runtime grants/policy surface проверяют production scripts в `apps/backend/scripts/`.

## Design references

Логическая модель и future physical design остаются полезными design references, но не являются перечнем уже мигрированных таблиц:

- [docs/backend/domain-model.md](./backend/domain-model.md)
- [docs/backend/er-diagram.md](./backend/er-diagram.md)
- [docs/backend/backend-architecture.md](./backend/backend-architecture.md)

Новые migrations должны быть производными от утверждённой logical model и отдельного решения для конкретного work item, а не от frontend view models.
