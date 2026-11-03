# Database Schema

Этот документ — навигация по фактической physical schema и security boundary. SQL-источником истины являются migrations в `supabase/migrations/`; этот файл не заменяет их.

## Schema, определённая tracked migrations

SQL-источник схемы в репозитории — tracked migrations в `supabase/migrations/`. Они описывают schema, ожидаемую этим checkout, но сами по себе не подтверждают применённый production ledger или production schema parity. Датированные rollout evidence находятся в [Production Deployment Runbook](backend/production-deployment-runbook.md) и [Roadmap](roadmap.md).

Текущая последовательность tracked SQL changes:

- `20260826084844_core_identity.sql`: `users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states`, `travel_intents`;
- `20260826100000_user_sessions.sql`: `user_sessions`;
- `20260901120000_discover_interest_decisions_and_matches.sql`: `discover_interest_decisions`, `matches`;
- `20260901130000_chat_persistence.sql`: `chats`, `chat_participants`, `messages`, `chat_summaries` и `matches.chat_id`;
- `20260901140000_trip_persistence.sql`: `trips`, `trip_participants`;
- `20260901150000_trip_stops_persistence.sql`: `trip_stops`;
- `20260901160000`–`20260901280000`: authenticated DB context, bearer/login/onboarding capabilities и RLS slices для всех current application tables;
- `20260924090000_completed_onboarding_active_travel_intent_invariant.sql`: archive capability не позволяет completed user архивировать существующий active TravelIntent; состояние onboarding и intent остаётся неизменным;
- `20260924100000_session_lifecycle_baseline.sql`: canonical login capability создаёт opaque session по времени PostgreSQL с absolute expiry через 30 days; legacy overload сохраняется только для deployment compatibility;
- `20260924110000_backend_field_domain_limits.sql`: nonblank constraints для `profiles.display_name` и `travel_intents.destination_label`; обновлены Group Chat и message capabilities с input limits;
- `20261003090000_chat_participant_public_profile.sql`: добавлена scoped capability чтения профиля другого активного участника Chat;
- `20261018090000_server_side_tester_admission_session_identity.sql`: добавлена `resolve_bearer_session_with_identity(text)`; имя файла сохраняет исторический контекст, оно не означает наличие текущей tester admission policy.

### Ключевые связи и ограничения

- `users` связан один-к-одному с `telegram_identities` и `profiles`; пользовательские настройки и activity state также keyed по `user_id`. У пользователя может быть несколько `travel_intents`, но partial unique index разрешает только один `active`; для дат сохраняется `date_to >= date_from`.
- `discover_interest_decisions` уникален для пары actor/target и запрещает self-decision. `matches` хранит упорядоченную пару пользователей с unique constraint; `matches.chat_id` связывает Match не более чем с одним Chat.
- `chat_participants` связывает пользователей и direct/group Chats и уникален по `(chat_id, user_id)`. Direct Chat ограничен двумя участниками trigger-ом. Group Chat создаётся capability из 2–20 eligible companions плюс инициатор; текущий состав не расширяется invitation lifecycle. `messages` принадлежат Chat и имеют уникальный sequence number внутри Chat.
- `trips` ссылается на Chat и создателя; partial unique index разрешает не более одного unfinished (`forming`/`active`) Trip на Chat. При создании Trip capability добавляет всех активных ChatParticipant в `trip_participants`; `trip_participants` уникален по `(trip_id, user_id)`, а `trip_stops` — по `(trip_id, position)`.

`chat_summaries` присутствует в tracked schema. В ней нет таблиц `trip_invitations`, Proposal/voting, transport segments, `ai_requests`, provider, audit или moderation domains. Group Chat использует существующие `chats(type='group')` и `chat_participants`; persisted group title отдельной таблицей или полем не хранится. Это описание migration-defined schema, не утверждение о включённом продуктовом flow.

## Security boundary, определённая репозиторием

Tracked migrations включают RLS на всех 17 application tables. Backend использует authenticated DB context и `app_runtime`; scoped `SECURITY DEFINER` capabilities применяются для onboarding, Discover → Match → direct Chat, Group Chat, Messages и Trip creation. `user_sessions` хранит token hash; resolver проверяет revoke, expiry и soft-deleted user. Production grant scripts и verifiers находятся в `apps/backend/scripts/`, но их наличие, как и локальные migrations, не подтверждает текущее состояние production.

## Design references

Логическая модель и [Physical Data Design](backend/physical-data-design.md) остаются design references. Physical Data Design — reviewed design input, а не реализованная SQL-схема; наличие сущности только в этих документах не означает, что для неё есть migration:

- [docs/backend/domain-model.md](./backend/domain-model.md)
- [docs/backend/er-diagram.md](./backend/er-diagram.md)
- [docs/backend/backend-architecture.md](./backend/backend-architecture.md)

Новые migrations должны быть производными от утверждённой logical model и отдельного решения для конкретного work item, а не от frontend view models.
