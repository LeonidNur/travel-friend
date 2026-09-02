# Database Schema

Этот документ — навигация по фактической physical schema. SQL-источником истины являются migrations в `supabase/migrations/`; этот файл не заменяет их и не описывает RLS.

## Реализованная schema (`develop`, 2026-09-02)

Применяемые migrations:

- `20260826084844_core_identity.sql`: `users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states`, `travel_intents`;
- `20260826100000_user_sessions.sql`: `user_sessions`;
- `20260901120000_discover_interest_decisions_and_matches.sql`: `discover_interest_decisions`, `matches`;
- `20260901130000_chat_persistence.sql`: `chats`, `chat_participants`, `messages`, `chat_summaries` и `matches.chat_id`;
- `20260901140000_trip_persistence.sql`: `trips`, `trip_participants`;
- `20260901150000_trip_stops_persistence.sql`: `trip_stops`.

В current MVP новая Trip из existing direct или group Chat сразу получает всех активных `trip_participants`. Таблицы `trip_invitations`, membership lifecycle, `proposals`, transport segments, provider/AI, audit/moderation и RLS policies не созданы. Для Group Chat schema использует существующие `chats(type='group')` и `chat_participants`; persisted group title отдельной таблицей или полем не хранится.

## Design references

Логическая модель и future physical design остаются полезными design references, но не являются перечнем уже мигрированных таблиц:

- [docs/backend/domain-model.md](./backend/domain-model.md)
- [docs/backend/er-diagram.md](./backend/er-diagram.md)
- [docs/backend/backend-architecture.md](./backend/backend-architecture.md)

Новые migrations должны быть производными от утверждённой logical model и отдельного решения для конкретного work item, а не от frontend view models.
