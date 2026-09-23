# Security

## Назначение документа

Этот документ описывает security-контур Travel Friend на уровне архитектуры. Реализованы server-side проверка raw Telegram `initData`, Bearer sessions, least-privileged runtime role и RLS/capability boundary для всех 17 current application tables; block/report/audit, provider redirect и остальные capabilities ниже пока не реализованы. Он не заменяет SQL migrations, точные RLS policies, API или persistence-реализацию.

Важно: ниже `UserBlock`, `UserReport` и `Audit` описаны как обязательные backend-capabilities security-домена. Этот документ не фиксирует их physical schema и не расширяет утверждённую ER-модель в схему хранения.

## Trusted zones

В текущей архитектуре есть несколько зон доверия.

### 1. Telegram Mini App client

Клиент недоверенный по умолчанию.

Это означает:

- нельзя доверять `initDataUnsafe`;
- нельзя доверять membership/role/usage данным, пришедшим с клиента;
- нельзя принимать решения о доступе, блокировках, голосовании и premium только по frontend-состоянию.

### 2. Backend

Backend — единственная доверенная зона исполнения.

Он отвечает за:

- серверную проверку raw `initData`;
- контроль доступа к чатам, поездкам, proposal и usage;
- применение allowlist и redirect-политики;
- валидацию входных данных;
- аудит чувствительных действий.

### 3. AI и внешние provider-ы

AI provider и travel API — полудоверенные внешние зоны.

Им можно доверять как источнику полезных данных, но нельзя доверять как:

- источнику авторизации;
- источнику финального доменного решения;
- хранилищу секретов;
- исполнителю privileged действий.

### 4. PostgreSQL / Supabase

База данных — доверенное хранилище состояния, но доступ к ней должен идти через backend-контур и least-privilege-политику.

Локальный disposable PostgreSQL workflow проверяет эту политику: application objects принадлежат privileged migration/test owner, а FastAPI использует отдельную non-owner `app_runtime` с минимальными grants и enabled RLS на всех 17 current application tables. Role SQL намеренно не включён в обычные Supabase migrations, поскольку managed Supabase migration identity не считается доказанно способной создавать роли.

Для hosted Supabase production есть отдельные scripts `apps/backend/scripts/provision-production-app-runtime-role.sql` и `apps/backend/scripts/verify-production-app-runtime-role.sql`. Первый запускается только approved privileged provisioning identity и при первом запуске создаёт `app_runtime` сразу с требуемыми least-privilege attributes; он не выдаёт table/function grants, не меняет owners, RLS, стандартные Supabase-роли или `PUBLIC`. При повторном запуске script только проверяет attributes существующей роли: при любом несовпадении он fail closed и не пытается выполнять `ALTER ROLE`, который managed Supabase `postgres` может быть не вправе выполнить. Пароль не хранится в репозитории: script вызывает `psql \password app_runtime`, который запрашивает пароль скрыто и передаёт на сервер только encrypted hash, а не password literal в SQL. Запуск: `psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PROVISIONING_DSN" -f apps/backend/scripts/provision-production-app-runtime-role.sql`; пароль вводится только в интерактивном prompt. Connection DSN provisioning identity остаётся только в approved secret store/операторском окружении.

Production cutover `988aeb0` → `b25e08dce158b7fe7ea6d17b40d96c3e893330fa` завершён: production DB применена до `20260901280000`, final grants verifier и runtime deployment gate прошли, а совместимый backend deployed. Точный порядок, maintenance boundary и rollback limits остаются в [production security migrations runbook](production-security-migrations-runbook.md) как запись этого cutover. Production Render `DATABASE_URL` использует `app_runtime` Session Pooler DSN; Auto-Deploy остаётся выключенным до отдельной deployment-задачи. После несовместимых DB/grants изменений старый backend не является автоматически допустимым rollback target. Verification script только читает catalogs: он показывает effective role attributes, owner каждой current application table и memberships. `NOINHERIT` не удаляет существующие memberships и не запрещает возможный `SET ROLE`, поэтому любой результат в последнем query — finding для отдельного approved remediation, не повод менять memberships этим provisioning script.

После verifier и перед manual backend deploy обязательно запустить runtime gate через реальный Session Pooler DSN роли `app_runtime` (не provisioning/migrator DSN):

```bash
cd apps/backend
PRODUCTION_RUNTIME_DATABASE_URL='…' \
  uv run --python 3.12 scripts/production-runtime-deployment-gate.py
```

Gate fail closed: подтверждает `current_user`/`session_user`, непривилегированные attributes роли, существование и `EXECUTE` нужных security capabilities, RLS и точные policy surfaces для всех 17 current application tables. Для `chats`, `chat_participants`, `messages`, `trips`, `trip_participants` и `trip_stops` он также проверяет минимальную column surface и отсутствие direct mutations. Для `users`, `telegram_identities`, `user_settings`, `profile_photos` и `chat_summaries` он требует enabled RLS, non-owner runtime, нулевые effective table/column privileges и пустой policy surface. Он проверяет transaction-local `app.user_id`, отсутствие утечки context в следующую transaction и fail-closed RLS без context. Отрицательные mutation probes выполняются с `WHERE false` и всегда завершаются rollback, поэтому не оставляют изменения. Только результат `passed` разрешает ручной deploy совместимого backend; сам script Render не изменяет.

Telegram `initData` по-прежнему проверяется только FastAPI: raw payload, freshness и HMAC не передаются в PostgreSQL. После проверки FastAPI нормализует metadata, генерирует raw session token, вычисляет SHA-256 и вызывает узкую owner-owned `SECURITY DEFINER` capability `public.bootstrap_telegram_login(...)`. Она атомарно resolve/create Telegram identity, обновляет verified metadata, при необходимости создаёт bootstrap defaults и session, но получает только token hash; raw token остаётся в FastAPI и HTTP response. First-login race сериализуется transaction-scoped PostgreSQL advisory lock по verified Telegram user ID до создания `users` row.

Bearer session resolution — отдельная pre-auth bootstrap capability. FastAPI извлекает raw Bearer token, вычисляет его hash и передаёт только hash в `public.resolve_bearer_session(text)`. Эта owner-owned `SECURITY DEFINER` capability возвращает только `session_id` и `user_id` активной, неотозванной, неистёкшей сессии не удалённого пользователя; raw token, `token_hash` и business/profile data она не возвращает. Lookup остаётся в отдельном bootstrap connection: authenticated business transaction с `app.user_id` ещё не существует в этот момент.

Для authenticated business request FastAPI после успешной Bearer authentication является единственным источником `app.user_id`: dependency открывает отдельный explicit outer transaction и выполняет параметризованный `set_config('app.user_id', <principal.user_id>, true)` до router/service SQL. Флаг `true` делает контекст transaction-local; при commit или rollback он больше не представляет identity запроса. Authenticated business UoW начинается только после authentication. Для условия текущего logout PostgreSQL также требует column-level `SELECT(id)` вместе с `UPDATE`; table-level `SELECT` и чтение `token_hash` отсутствуют, а Bearer resolution идёт только через capability. `profiles`, `travel_intents`, `user_activity_states` и `user_sessions` покрыты owner-scoped RLS. `users`, `telegram_identities`, `user_settings`, `profile_photos` и `chat_summaries` также имеют enabled RLS, но намеренно не имеют runtime policy или direct privilege: первые три доступны только существующим owner-owned `SECURITY DEFINER` bootstrap/resolver/projection paths, последние две не используются текущим MVP. Persisted onboarding changes остаются только в owner-owned `SECURITY DEFINER` paths `bootstrap_telegram_login()` и `complete_current_onboarding()`. Discover cross-user чтение проходит через отдельную owner-owned SECURITY DEFINER capability с server-derived context.

`public.current_authenticated_user_id()` — минимальный fail-closed accessor для RLS policies и DB tests: он возвращает `NULL` при отсутствующем, пустом или некорректном UUID setting. `user_activity_states` допускает runtime только SELECT собственных `user_id` и `onboarding_status`; INSERT/UPDATE/DELETE policies отсутствуют. `user_sessions` также защищена RLS: authenticated runtime может читать только `id` и отозвать через `revoked_at` только собственную session row; создание остаётся в pre-auth `SECURITY DEFINER` bootstrap path, resolution — в отдельной pre-auth capability. Принятое MVP-ограничение сохраняется: transaction-local context не предназначен для per-user containment при компрометации credential `app_runtime` с прямым произвольным SQL доступом.

Chat persistence защищён отдельным RLS slice. Runtime читает Chat, active roster и messages только при active membership (`left_at IS NULL`); recipient-only system message дополнительно виден только указанному recipient. Direct Chat продолжает создаваться только capability `record_current_discover_decision()`. Group Chat создаётся атомарно capability `create_current_group_chat(uuid[])`, а user message — capability `send_current_chat_message(uuid,text)`; actor, sender, type и sequence не поступают из runtime SQL. Узкий `is_current_active_chat_participant(uuid)` — owner-owned `SECURITY DEFINER` predicate для policy checks, с fail-closed authenticated context, `search_path=pg_catalog`, закрытым `PUBLIC EXECUTE` и grant только `app_runtime`.

Trip persistence защищён отдельным RLS slice. Runtime видит `trips` и `trip_stops` только как active Trip participant; `trip_participants` дополнительно возвращает только active roster rows. Узкий `is_current_active_trip_participant(uuid)` — owner-owned `SECURITY DEFINER` predicate с actor только из authenticated DB context, fail-closed логикой, `search_path=pg_catalog`, закрытым `PUBLIC EXECUTE` и grant только `app_runtime`. Создание Trip из Direct или Group Chat выполняется атомарно только capability `create_current_trip_from_chat(uuid)`: она получает actor из DB context, lock-ит Chat и active roster в прежнем порядке, создаёт одну `forming` Trip и snapshot только active Chat participants. Client не передаёт `user_id` или roster; partial unique invariant одной unfinished Trip на Chat сохраняется. У runtime нет direct INSERT/UPDATE/DELETE на Trip tables и нет direct UPDATE на `chats`/`chat_participants`: temporary Chat lock bridge и его policies удалены. В MVP нет stop mutation capability или policy.

## UserBlock

`UserBlock` нужен как серверная safety-граница между двумя пользователями.

На архитектурном уровне это означает:

- блокировка обрабатывается на backend, а не только на UI;
- blocked relationship должна влиять на discover, like, match, chat visibility и новые взаимодействия;
- frontend не должен иметь возможности обойти block локальным состоянием;
- block-события должны учитываться при будущих moderation и audit-процессах.

Этот документ не задаёт структуру хранения block-связей, но задаёт требование: блокировка — это доверенное серверное ограничение.

## UserReport

`UserReport` — это канал для жалоб и эскалации abuse-сценариев.

Он должен позволять backend:

- зафиксировать reporter, target и контекст события;
- сохранить причину и приложенные evidence, если они есть;
- связать report с chat/trip/message-контекстом, когда это уместно;
- передать кейс в ручную модерацию на MVP;
- оставлять audit trail решений модерации.

На текущем этапе важно само архитектурное правило: жалобы не живут только как UI-элемент, а попадают в доверенный backend-контур.

## Audit

`Audit` нужен для чувствительных и спорных операций.

Архитектурно audit должен покрывать:

- проверку Telegram auth;
- security-значимые backend redirect;
- block/report/moderation действия;
- privileged AI-запуски и usage-решения;
- обращения к внешним provider-ам, если они влияют на пользовательский выбор или monetization.

Audit должен быть append-only по смыслу: это журнал доверенных фактов, а не редактируемая пользовательская история.

## Backend redirect

Все внешние переходы пользователя на provider или affiliate-страницы должны идти через backend redirect-контур.

Это нужно для:

- allowlist-проверки целевого домена;
- контроля партнёрских ссылок;
- защиты от произвольных или подменённых URL;
- аудита outbound-переходов;
- безопасного истечения или замены устаревших ссылок.

Принцип: клиент не должен открывать произвольный внешний URL как якобы подтверждённый offer.

## Allowlist

Allowlist — это серверный список разрешённых provider-ов, доменов и redirect-targets.

Он нужен, чтобы:

- ограничить набор внешних адресов;
- разделить проверенные и непроверенные provider-ы;
- не допускать подмены ссылок через AI, frontend или внешние данные;
- поддерживать predictable affiliate и outbound policy.

Allowlist должен применяться и к прямым provider-ссылкам, и к affiliate-ссылкам.

## Безопасность внешних API

Для внешних API действуют такие правила:

- вызовы идут только с backend;
- ключи provider-ов не попадают на клиент;
- ответы валидируются и нормализуются;
- внешние цены и availability считаются snapshot, а не обещанием;
- timeout, retry и rate limiting настраиваются в backend-контуре;
- небезопасные или неизвестные provider-ответы не должны напрямую формировать пользовательский redirect.

AI может использовать результаты provider-ов только как материал для предложения, но не как автоматическое решение.

## Хранение секретов

Секреты включают:

- Telegram bot token;
- ключи AI provider-ов;
- travel/affiliate API credentials;
- Supabase service credentials и другие privileged tokens.

Общие правила:

- секреты хранятся только в server-side env или secret manager;
- секреты не коммитятся в репозиторий;
- секреты не передаются в frontend;
- секреты не попадают в AI prompt-контекст;
- доступ к секретам ограничивается по принципу least privilege.

## Общие принципы безопасности

- Сервер доверяет только raw `initData`, проверенному на backend.
- Frontend считается удобным интерфейсом, а не trusted boundary.
- Доменные инварианты применяются на backend.
- Внешние provider-ы рассматриваются как недоверенные источники данных.
- Любое изменение подтверждённого состояния поездки требует доменного правила и согласия участников, а не одного AI-ответа.
- Security и moderation должны быть встроены в backend-контур, а не добавлены позже как косметический слой.
