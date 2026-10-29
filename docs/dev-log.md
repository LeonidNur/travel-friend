# Дневник разработки

## 2026-10-29 — Production rollout завершён

- Production Supabase rollout завершён: ledger 19 → 24, пять migrations применены по порядку, runtime grants, privilege verifier и deployment gate — PASS. Migration/grant повторный запуск не требуется.
- Render `travel-friend-api`: deployment `dep-dbhk59om7kps73f4e39g`, live SHA `67eae892886cabac7408857c8a1b24af1728d2cf`; `/health` и `/ready` = 200, startup errors нет, Auto-Deploy Off.
- Vercel Production deployment `dpl_DjcqzYmZQhDJS9FFzNSk2Scb7J41` READY на `travel-friend-mini-app.vercel.app`; snapshot SHA `15c0d761fb54670b3987f743ebaca5df353f3972`, `/api/backend/health` = 200 и связь с Render подтверждена.
- Инфраструктурный smoke дал ожидаемые 200 и 401. Авторизованный Telegram E2E не проводился; внешнее тестирование не завершено. Открыты риски API-role grants/default EXECUTE ACL, Free-tier ограничений, abuse/AI расходов и полного Supabase recovery. Render Suspend останавливает весь backend, а не отдельного пользователя.
- Обновлены [production deployment runbook](backend/production-deployment-runbook.md), [technical hardening backlog](technical-hardening-backlog.md) и [CHANGELOG](../CHANGELOG.md); исторические preflight записи оставлены как снимки своих дат.

## 2026-10-18 — Server-side tester admission

- Добавлен fail-closed admission policy с тремя server-only настройками: core Telegram IDs, tester Telegram IDs и tester pause. Проверка стоит до login bootstrap, а общая Bearer dependency перепроверяет Telegram ID каждой активной сессии, включая прямые API requests.
- Сохранён существующий `resolve_bearer_session(text)`; additive SECURITY DEFINER capability возвращает только session/user UUID и Telegram numeric ID за один DB round trip. Обновлены local/prod grants, read-only verifiers и local restore inventory; прямые runtime `SELECT` grants на identity/users и RLS не расширялись.
- Проверены локальные migration chain, auth/revoke/pause flows, runtime grants/RLS и regression tests. Production migrations, Render environment и deployment не выполнялись. Из-за четырёх unapplied migrations перед новым resolver подготовлен отдельный reviewed порядок; external testing остаётся STOP до approved rollout и других P0 gates.

## 2026-10-18 — FinOps и внешние тестовые guardrails

- Составлена единая карта production, development и operations: Vercel, Render, Supabase, Telegram, GitHub Actions, Docker Desktop/local Supabase/PostgreSQL, Homebrew/CLI, backup chain, Google Drive, Apple Keychain/Passwords, age, Codex, logging и DNS. Отдельно разделены счета, тарифные лимиты, Mac disk/CPU ресурсы и операционные последствия отказа.
- Read-only provider/local evidence: Supabase organization Free; Render API service использует Free compute; GitHub repo public; Vercel team plan и account charges не подтверждены. Docker Desktop 4.88.1 работает с четырьмя локальными Supabase dev containers; images занимают 11.71 GB, volumes 661 MB. Не выполнялись cleanup, paid actions, provider settings changes или production stop.
- Смоделированы типовые сценарии на 5/10/25/50/100 testers, включая повторные Discover reads, открытие чатов, полную историю, интенсивный поиск, login и public `/ready`. Это условная SQL/request модель, не реальные production usage/billing measurements.
- Зафиксировано **STOP перед внешним тестом**: серверного Telegram tester allowlist нет, public `/ready` создаёт DB probe без endpoint limit, billing controls неизвестны для ряда аккаунтов, актуальная deployment/schema compatibility требует повторного подтверждения. Детали и точные open questions находятся в [FinOps runbook](finops-external-test-guardrails.md); код и provider settings в рамках этой задачи не менялись.
- Локальный доступ к Docker daemon потребовал read-only разрешения и после него был успешно просмотрен; источниками лимитов служили официальные provider docs. Production stress tests и emergency stop не выполнялись.

## 2026-10-18 — №16 Production deployment provenance и compatibility

- Проведён read-only provider audit: Render deployed SHA и production migration ledger подтверждены; Vercel production deployment найден, но его Git SHA недоступен. Сопоставлены функции deployed backend и production DB, а также current repository call sites.
- Установлено, что production соответствует 19 migrations deployed Render revision, тогда как текущая repository source использует отсутствующие в production 6-аргументный bootstrap и `chat_participant_public_profile`; без отдельного DB migration/grants review это блокирует выпуск соответствующего source. Полный schema drift audit не завершён.
- Production `/health` smoke завершился сетевым timeout; `/ready` не запускался. Frontend/backend compatibility и фактический `BACKEND_API_ORIGIN` остались UNKNOWN. Runbook, backlog и roadmap обновлены; production migrations, writes, deployments и provider configuration не менялись.

## 2026-10-18 — №16 Production migration readiness audit

- Сопоставлены подтверждённый ledger из 19 миграций и текущий `develop` из 24 файлов; выполнен SQL/security review пяти последующих migrations и матрица совместимости старого Render SHA, текущего backend и неизвестной frontend revision.
- В network-isolated disposable PostgreSQL 17.11 восстановлен production archive, локально replay-нуты пять migrations, затем успешно прошли 26 PUBLIC revokes, `app_runtime` grants и verifier. Проверены schema/data restore, 17 таблиц, структура, RLS/policies, совпадение counts по каждой таблице до/после replay и отсутствие effective EXECUTE у локальных API role stubs на три новые backend-only functions; неизвестные ACL roles не создавались.
- Regression validation: backend suite — 553 passed, 97.11% coverage; frontend unit tests — 168 passed; local restore smoke — exit 0; targeted smoke tests — 31 passed; Python syntax и `git diff --check` — PASS.
- Production не подключали. Ledger/schema parity, Vercel SHA и фактический `BACKEND_API_ORIGIN`, live health, production ACL и совместимость deployed frontend/backend остались UNKNOWN; rollout запрещён до нового preflight и отдельного разрешения.

## 2026-10-18 — №22 Rollback / forward-fix readiness

- Сверили manual deployment workflow, provider capabilities, migrations, backend health/readiness и backup restore boundaries. В runbook добавлены раздельные сценарии frontend rollback, backend rollback, failed migration и potential data corruption.
- Зафиксированы exact target и known-good SHA gates, обязательная проверка backend/DB compatibility, запрет автоматического migration rollback и production restore, отдельное разрешение опасных операций, post-recovery checks и записи результатов.
- Только локальный audit и documentation review: production deployment/rollback, migration, provider changes и restore не выполнялись. Vercel/Render deployment history/permissions, safe traffic quiesce, frontend E2E и full Supabase/production ACL recovery остаются UNKNOWN/unverified; migration drift сохранён как отдельный риск №16.

## 2026-10-18 — №21 Production backup scope audit

- Сверили backend/frontend source, contracts, migrations, role scripts и security docs: MVP использует собственные `public` данные, PostgreSQL functions/triggers, RLS и роль `app_runtime`; Telegram `initData` — текущая auth интеграция. В коде не найдено использования Supabase Auth API, Storage upload/download или Vault.
- Зафиксировали минимальный application scope — schema и все строки 17 `public` tables — и recovery dependencies по roles/grants, PostgreSQL/extensions, migration revision, credentials и provider state. Supabase CLI schema/data/roles exports описаны как частичные компоненты, не как полный backup проекта.
- Отдельно обозначили неизвестность production contents `auth`, `storage`, `vault`, `supabase_migrations` и других schemas, Storage objects, extensions, role state и consistency. Только документационные изменения; production не подключали, SQL/dump/restore не выполняли. №21 остаётся открытой до первого разрешённого production backup и проверки restore.

## 2026-10-18 — №21 Backup storage recovery проверен на synthetic данных

- Зафиксирован тестовый путь: age v1.3.2 encrypt/decrypt локально, ciphertext
  upload/download через Google Drive с побайтным сравнением; скачанная копия
  расшифрована. Recovery copy age identity находится в Apple «Пароли», sync с
  iPhone и расшифровка synthetic archive восстановленной identity подтверждены.
- Восстановительный временный файл удалён. Приватный ключ запрещено хранить в
  GitHub, Google Drive или передаваемых Codex материалах.
- Runbook и backlog уточнены. Использовались только synthetic data; production
  backup не создавался и production recovery не проверялся.

## 2026-10-18 — №21 Backup/restore, production procedure план

- Runbook обновлён операторским планом Supabase CLI для отдельных `roles.sql`,
  `schema.sql` и `data.sql`, включая preflight, credential/storage safeguards,
  coverage checks, STOP criteria и limitations managed schemas/RLS/Storage.
- Это только документация: production connection/dump/restore не выполнялись.
  Первый backup требует явного разрешения и нерешённых операторских решений по
  identity/coverage, consistency window, внешнему шифрованному хранению и
  disposable restore validation. №21 не закрыта.

## 2026-10-18 — №21 Backup/restore, локальный restore подтверждён

- Фактический Docker smoke прошёл с exit code 0: `pg_dump` создал archive,
  `pg_restore` восстановил его в отдельную disposable DB, schema и synthetic
  control data validation прошли, cleanup завершился успешно.
- Подтверждён только локальный сценарий; production backup, offsite storage и
  restore production data остаются непроверенными. №21 не закрыта.

## 2026-10-18 — №21 Backup/restore, локальная проверка

### Что сделали

- Добавили локальный smoke сценарий с отдельными `travel_friend_test` и `travel_friend_backup_restore_test`: synthetic контрольные данные, custom `pg_dump`, `pg_restore`, сравнение схемы и контрольных значений. Он использует существующий guard и прекращает работу при заданных DB URL переменных или существующем restore target.
- Обновили [backup/restore runbook](backend/backup-restore-runbook.md) и статус №21: локальная реализация подготовлена, production backup/restore остаётся непроверенным.

### Что проверили

- 14 smoke regression cases с Docker CLI stubs и 51 тест вместе с существующими DB guard/workflow tests прошли; они не запускали PostgreSQL и не создавали backup.
- Docker Engine недоступен (`docker info` не подключился к локальному socket), поэтому фактический dump/restore на disposable PostgreSQL не выполнялся. Настоящий backup-файл не создавался.
- Shell syntax checks и `git diff --check` прошли.

### Что осталось

- Повторить локальный smoke при доступном Docker Engine. Для production отдельно остаются backup identity/scope, external encrypted storage, cadence/retention, restore на подходящей disposable среде, RPO/RTO и explicit operator authorization перед любыми production DB operations.

## 2026-10-18 — №21 Backup/restore audit and plan

### Что сделали

- Проверили migrations, DB scripts, production deployment runbook и backlog на существующие backup/restore механизмы. Migrations восстанавливают schema objects, но не текущие application data; production dump/restore tooling и процедура в репозитории не найдены.
- Зафиксировали операторское подтверждение Supabase Free Plan, отсутствия scheduled backup/PITR и восстановимого backup, а также выбранный план ручного logical backup с внешним хранением и restore-проверкой на отдельной disposable БД.
- Добавили [backup/restore audit and operator plan](backend/backup-restore-runbook.md) и отметили №21 как `AUDIT/PLAN`. Backup/restore не выполнялись; №22 не затрагивалась.

### Что проверили

- Выполнен read-only просмотр документации, migrations, DB scripts и CI. Production DB connection, dump, restore и DDL не выполнялись.
- Проверили относительные links и выполнили `git diff --check`.

### Что осталось

- Оператору нужно подтвердить внешнее зашифрованное хранилище, cadence/retention, backup identity/scope, disposable restore environment, проверки и RPO/RTO. Отдельное явное разрешение обязательно перед любым production DB connection/query/dump.

## 2026-10-18 — №20 Backend runbook/README

### Что сделали

- Сверили backend README с текущими скриптами, CI и security/deployment runbooks; уточнили проверки disposable DB контейнера и добавили диагностику local/test/runtime readiness проблем с безопасными действиями оператора.
- Добавили ссылку на существующий manual deployment runbook, отметили №20 как implemented; application code, scripts, CI и production configuration не менялись.

### Что проверили

- Сверили описанные команды с `local-test-db.sh`, порядок CI cleanup и контракт `/health` / `/ready`.
- Проверили относительные markdown links и выполнили `git diff --check`.

## 2026-10-18 — №19 Local test DB hygiene

### Что сделали

- Усилили `local-test-db.sh`: перед reset и stop проверяются container name, disposable label, ожидаемые database/user settings и loopback port binding; при несовпадении destructive команды не выполняются.
- Сохранили команды lifecycle и локальные DSN для `test`; CI, migrations и runtime-role SQL не менялись. №19 отмечен implemented в backlog.

### Что проверили

- Regression tests запускают script с Docker CLI stub для ожидаемого контейнера и несовпадений name, label, database/user и port binding.
- Реальный Docker/PostgreSQL и destructive tests против БД не использовались.

## 2026-10-18 — №18 CI cleanup disposable PostgreSQL

### Что сделали

- Добавили после backend tests отдельный cleanup step с `if: always()`, который вызывает существующий `./scripts/local-test-db.sh stop`. Локальный DB lifecycle и frontend CI не менялись.
- Отметили №18 как implemented в [technical hardening backlog](technical-hardening-backlog.md); CI job не задаёт production DB credentials или secrets, а integration database guards ограничивают destructive tests локальной disposable БД.

### Что проверили

- Добавили статический regression test на порядок test/cleanup шагов, `if: always()`, отсутствие `continue-on-error` у tests и DB/secrets references в backend job.
- `uv run --group dev pytest tests/test_local_test_database_workflow.py tests/test_integration_database.py` — 23 passed; tests проверяют disposable URL safety и CI wiring без запуска PostgreSQL.
- `git diff --check` прошёл. Hosted Actions и Docker cleanup при forced runner loss не запускались.

### Что осталось

- Реальный GitHub Actions run и forced runner-loss cleanup не симулировались; `if: always()` не может гарантировать cleanup после уничтожения/потери runner.

## 2026-10-18 — №17 deployment smoke chain

### Что сделали

- Добавили read-only CLI smoke, который требует явный HTTP(S) origin без path/query/fragment, и последовательно выполняет `GET /health` и `GET /ready` с timeout 5 секунд, без переходов по redirects.
- Принимаются только HTTP 200 с контрактными телами `{"status":"ok"}` и `{"status":"ready"}`; transport errors, некорректные ответы и неуспешные status codes приводят к non-zero exit code.
- Обновили [production deployment runbook](backend/production-deployment-runbook.md): preflight, порядок запуска, ожидаемые результаты, STOP criteria и отдельная ручная граница Telegram E2E. Smoke не создаёт и не изменяет пользовательские данные.
- Отметили №17 как implemented в [technical hardening backlog](technical-hardening-backlog.md); `CHANGELOG` и roadmap синхронизированы.

### Что проверили

- Добавили mock-only HTTP tests для успешной последовательности, статусов/тел, malformed JSON, сетевой ошибки, явного URL, bounded timeout и запрета redirects.
- `uv run --group dev pytest tests/test_deployment_smoke.py` — 21 passed; ни один реальный backend/production запрос не выполнялся.
- `git diff --check` прошёл.

### Что осталось

- Автоматический smoke не проверяет Telegram auth, бизнес-flow, schema parity или grants/RLS; эти проверки остаются в своих отдельных gates, а Telegram E2E — ручной.

## 2026-10-18 — №16 deployment provenance / environments

### Что сделали

- Зафиксировали подтверждённую topology: Vercel `travel-friend-mini-app`; Render `travel-friend-api` на `develop` с ручным deployment и Auto-Deploy Off; Supabase `travel-friend-dev` (`tlgprfsecdasloqnuyjo`).
- Записали read-only snapshot Supabase: `ACTIVE_HEALTHY`, 19 production migrations сопоставлены с SQL в `develop`, 17 application tables с RLS, 17 policies, 18 functions; `app_runtime` — `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, имеет доступ к 16 функциям, `PUBLIC EXECUTE` отсутствует.
- Обновили №16 в [technical hardening backlog](technical-hardening-backlog.md) как частично подтверждённую задачу; это аудит-документация, provider и production actions не выполнялись.

### Что проверили

- Сверили результаты аудита с deployment runbook и текущими правилами документации. Полный schema drift audit не заявляли.
- Фактический `BACKEND_API_ORIGIN` не раскрывался; дополнительные migrations в репозитории не исключены исчерпывающей проверкой. Поэтому schema parity и полная provenance не объявлены подтверждёнными.
- Выполнена документальная проверка `git diff --check`.

### Что осталось

- Завершить полный schema drift audit и исчерпывающую сверку repository migrations; отдельно подтвердить provenance, необходимую для закрытия №16.
- `BACKEND_API_ORIGIN` остаётся нераскрытым в записи аудита.

## 2026-10-14 — №15 manual production deployment workflow

### Что сделали

- Подготовили [операторский runbook](backend/production-deployment-runbook.md) для ручного production rollout текущего MVP: Git SHA preflight, schema/grants compatibility, выбор DB-first/backend-first, maintenance/quiesce, ручной rollout, smoke gates и stop criteria.
- Зафиксировали decision matrix для совместимых, additive и breaking DB/API/grants изменений и expand/contract; отдельно связали workflow с №16 provenance, №17 smoke, №21 backup/restore и №22 rollback/forward-fix.
- Отметили №15 как docs-ready. Auto-Deploy остаётся Off, а rollout требует отдельного подтверждения оператора.

### Что проверили

- Сверили runbook с историческим security cutover, текущими migrations, production grants/verifier/runtime gate, backend contracts, deployment описаниями и `.github/workflows/ci.yml`.
- Выполнена документальная проверка `git diff --check`; production, provider settings и production DB не использовались.

### Что осталось

- №16, №17, №21 и №22 остаются отдельными work items. Production provider targets/settings, точные deploy commands, smoke account/procedure и backup/recovery readiness требуют отдельного operator confirmation/implementation.
- Auto-Deploy не включён.

## 2026-10-03 — P0.5 reliability/observability completion и cost-safety gates

### Что сделали

- Закрыли P0.5 №7–14.1: request/correlation ID, GET/read timeout, user-initiated Retry из recoverable error states и explicit read states, Chat → Profile navigation, controlled multi-user Trip Detail coverage, reciprocal Match feedback, active TravelIntent view/edit, readiness и minimal error monitoring.
- Backend выдаёт `X-Request-ID`; correlated application logging связывает request completion и unexpected backend errors в Render Service Logs. Внешний error-monitoring provider на этом этапе намеренно не подключали.
- `/ready` проверяет database readiness, а `/health` остаётся liveness endpoint.
- Закрыли №14.1 как FinOps audit/plan без production code: External Test Cost Guardrails выделен в обязательный самостоятельный gate.

### Что проверили

- В `develop` сверены commits и добавленные targeted backend tests для request correlation, readiness, application logging и controlled multi-user Trip Detail, а также frontend tests для read reliability, reciprocal feedback, participant profile navigation и active TravelIntent edit.
- Постоянная документация синхронизирована с текущим кодом, tests и migrations; external test parameters из audit recommendations не приняты как решения.

### Что осталось

- Следующий этап — deployment / CI reproducibility, начиная с №15 Production deployment workflow.
- External test возможен только после deployment/control gates; Pre-AI FinOps gate обязателен до любого включения AI.

## 2026-09-29 — P0 security baseline и provider-side verification

### Что сделали

- Закрыли P0 security baseline реализованного MVP: server-side Telegram `initData`, invariant `completed → active TravelIntent`, canonical lifecycle opaque sessions, backend input/domain limits, minimal in-process rate limiting и secrets/logging hygiene.
- Усилили repository-controlled boundary: local env-файлы игнорируются на всех уровнях repository, frontend template не содержит Telegram token, а runtime deployment gate не раскрывает детали connection errors.

### Что проверили

- Production `/health` и Telegram authentication smoke успешны.
- Vercel остаётся только frontend boundary: project env содержит только `BACKEND_API_ORIGIN`, Shared env отсутствуют, system env включены; просмотр request logs не выявил дополнительного application logging.
- Render остаётся backend boundary: `DATABASE_URL` использует runtime role `app_runtime`, `TELEGRAM_BOT_TOKEN` находится только на backend; branch — `develop`, Root Directory — `apps/backend`, Auto-Deploy — Off. Build command — `uv sync --frozen`, start command — `uv run uvicorn travel_friend_backend.main:app --host 0.0.0.0 --port $PORT`.
- В Supabase существует отдельная runtime role `app_runtime`; сохраняется least-privilege architecture. GitHub Actions secrets и variables отсутствуют.

### Что осталось

- P1 TEAM E2E, controlled multi-user coverage для Trip Detail и следующий отдельный Trip lifecycle/write slice остаются следующими work items.
- Подробный [technical hardening backlog](technical-hardening-backlog.md) намеренно не обновлялся этим changeset.

## 2026-09-16 — Entry-point documentation sync

### Что сделали

- Сверили текущие FastAPI routes, tests и Supabase migrations с README, roadmap и обязательными Codex-инструкциями.
- Зафиксировали hierarchy current source-of-truth; `CHANGELOG` и `dev-log` остаются historical records и не переопределяют current implementation.
- Добавили отдельный current technical hardening backlog и связали с ним entry-point документы.

### Что проверили

- Код, migrations, tests и runtime behavior не менялись; выполнена документальная проверка `git diff --check`.

## 2026-09-02 — Backend-backed Chat MVP и pre-mega-review sync

### Что сделали

- Завершили frontend integration Profile/TravelIntent и onboarding: backend session определяет текущего пользователя, а UI восстанавливает профиль и active TravelIntent.
- Завершили persisted Discover: candidates доступны только при completed onboarding и active TravelIntent; `interested` / `rejected` final, reciprocal interest создаёт Match и direct Chat.
- Завершили persisted direct и group Chats/Messages: Group Chat создаётся из existing matched/direct-chat companions, включает минимум трёх участников, виден в Chats, а его MVP-состав фиксирован.
- Добавили Trips persistence, server API создания Trip из existing direct/group Chat, `trip_stops` persistence, `GET /trips` и `GET /trips/{tripId}`; Trips List и Detail используют read contracts, а Chat Room вызывает Trip creation API.
- Зафиксировали current MVP rule: при создании Trip все активные ChatParticipant сразу создаются как TripParticipant. `TripInvitation` не используется; при `409` Mini App читает `GET /trips` и открывает existing unfinished Trip того же Chat.
- Провели docs-only sync перед MVP mega-review: historical/logical design отделён от already implemented HTTP/persistence slices; AI/Proposal явно отложен до подключения второго разработчика.

### Что проверили

- Сверили migrations, FastAPI routes/schemas, contract tests, Next.js API client и integration commits `2026-08-31` — `2026-09-02`.
- Проверки документационного прохода фиксируются в текущем changeset: `git diff --check` и review ссылок/статусов; код, migrations и tests не менялись.

### Оставшиеся риски и TODO

- Нет documented production deployment backend, RLS policies и production `BACKEND_API_ORIGIN`; Vercel покрывает Mini App, но не весь backend stack.
- Trip сейчас read/create-only: нет write/lifecycle endpoints, stop editor, invitation или Proposal.
- Group membership фиксирован: invitations, add/remove/leave, roles/admin/permissions и invite links требуют отдельного work item.
- Messages пока без realtime, pagination, read/unread и UI logout; session token живёт только в runtime state frontend.
- Current Discover не включает impressions, filters/ranking или отдельный match list.
- Existing logical ER/AI docs описывают future architecture. Перед реализацией invitation/group membership lifecycle нужно отдельное решение, а не перенос этой design-модели в current MVP.

## 2026-08-26 — Core Identity + Telegram Auth backend checkpoint

### Что сделали

- Настроили local Supabase CLI workflow и local PostgreSQL/Supabase environment.
- Реализовали Core Identity persistence: `users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states` и `travel_intents` с необходимыми constraints и indexes.
- Реализовали server-side Telegram Auth: проверку raw `initData`, `POST /auth/telegram`, `POST /auth/logout` и Bearer authentication.
- Добавили server-side `user_sessions` с multiple sessions, opaque session token, хранением только SHA-256 hash в БД и TTL 30 дней.
- Зафиксировали сценарии first login (создание User, TelegramIdentity, UserSettings и UserActivityState) и repeat login (использование существующего User), а также отклонение revoked, expired и deleted-user sessions.
- Ограничили `DATABASE_URL` server environment и добавили его валидацию при запуске backend.
- Закрыли Core Identity + Telegram Auth как отдельный backend slice без реализации следующих Profile + TravelIntent API или frontend onboarding.

### Что проверили

- Финальная backend-проверка: 40 passed, 0 failed, 0 skipped, coverage 96.82%.
- `compileall` завершился успешно.
- `git diff --check` завершился успешно.

### Что осталось

- Следующий этап — Profile + TravelIntent API: authenticated read/write профиля, read/write/archive active TravelIntent и onboarding state transitions только для текущего authenticated User.
- Затем нужен frontend onboarding и первый полный flow: Telegram Auth → User → onboarding → Profile → TravelIntent → onboarding completed → основной интерфейс, с восстановлением того же пользователя и данных при повторном запуске.
- Concurrent first-login одной Telegram identity может потребовать отдельной обработки unique-conflict/race.
- Warning FastAPI TestClient/httpx2 не блокирует MVP и остаётся dependency TODO.
- Frontend onboarding, persistence интересов, чатов и поездок, realtime и AI ещё не реализованы.

## 2026-08-06 — Логическая доменная модель и backend-документация

### Что сделали

- Зафиксировали завершение этапа проектирования логической доменной модели Travel Friend.
- Перенесли утверждённую ER-модель в новый backend-раздел документации без изменения архитектуры, связей и ограничений.
- Создали пакет документов `docs/backend/` для domain model, ER, backend architecture, AI architecture, integrations и security.
- Обновили `README.md`, чтобы он отражал новый текущий статус проекта и ссылался на backend-документацию.
- Синхронизировали обзорные документы `docs/ai-copilot.md`, `docs/safety-and-trust.md`, `docs/roadmap.md` и обезвредили преждевременный `docs/database-schema.md`, чтобы они не спорили с новой ER-моделью.

### Что проверили

- Перечитали утверждённую ER-модель как единственный источник истины перед правками.
- Сверили новые документы с текущими проектными ограничениями: без schema, таблиц, миграций, API, RLS, persistence и realtime.
- Прогнали документальную проверку `git diff --check` после завершения правок.

### Что осталось

- Backend-контур, Telegram Auth, physical schema, persistence, realtime и AI-реализация остаются следующими отдельными этапами.
- Новая backend-документация описывает логическую архитектуру, но не заменяет будущие schema- и API-документы.

## 2026-07-21 — Завершение super-review frontend-блока

### Что сделали

- Закрыли super-review по frontend-блоку Trips.
- Финально согласовали Chat ↔ Trip navigation, где Chat Room ведёт в конкретный Trip, а Trip Details ведёт в конкретный Chat.
- Зафиксировали session-aware participants и active / historical trip flow.
- Довели финальные navigation fixes до стабильного состояния.
- Добавили дополнительные unit-тесты под Trips frontend-flow.
- Зафиксировали, что frontend checkpoint остаётся mock/local-state, а не backend-ready состоянием.

### Что проверили

- Прогнали `npm test`, `npm run check`, ESLint и dependency/security audit на актуальном frontend-потоке.
- Проверили profile validation и сценарий local session trip creation из matched Chat.
- Сверили, что новые unit-тесты покрывают Trips data model, Trip Details, navigation и session-aware participants.

### Что закрыли

- Закрыли замечания review по active / historical navigation, session-aware participants и согласованию Trip Details с Chat.
- Зафиксировали завершение frontend-блока как стабилизированного mock/local-state checkpoint.
- Сохранили следующий фокус на backend foundation / persistence.

## 2026-07-20 — Trips frontend-функции и проверки

### Что сделали

- Довели Trips frontend data model, Trips List и read-only Trip Details до согласованного состояния.
- Зафиксировали единый порядок категорий и текстовые состояния категорий в Trip Details.
- Добавили двустороннюю навигацию Chat ↔ Trip и local session trip flow из matched Chat.

### Что проверили

- Прогнали profile validation, единый `npm test`, ESLint и `npm run check` на frontend-блоке.
- Выполнили dependency/security audit и убрали неиспользуемый Telegram SDK.
- Пересмотрели сценарии навигации между Chat Room и Trip Details после локальной стабилизации.

## 2026-07-10 — Chat Room MVP и предварительная модель Chats / Trips

### Что сделали

- Зафиксировали в документации, что Chat Room MVP уже реализован на динамическом маршруте `/chats/[id]`.
- Обновили описание входа в чат из Chats List, mock-истории сообщений, local-only отправки, fallback для неизвестного `chat id`, перехода в публичный профиль собеседника, перехода в конкретный связанный Trip и скрытия Bottom Navigation внутри chat room.
- Уточнили предварительную продуктовую модель: `Chats` как живое общение и будущая работа с AI, `Trips` как структурированное актуальное состояние поездок, а связь `Trip ↔ Chat` пока остаётся продуктовой договорённостью, а не backend-реализацией.
- Синхронизировали README, roadmap, CHANGELOG и AI Travel Copilot doc, чтобы они описывали текущий frontend-flow честно и без намёка на готовый backend, Supabase или persistence.

### Что проверили

- Сверили текущий код `develop` с документацией и убедились, что Chat Room описан как local-only MVP, а не как backend-чат.
- Проверили, что документальные формулировки не обещают real-time, Supabase, persistence или AI как уже реализованные части продукта.
- Подтвердили, что решения по Trips и Chat остаются предварительными и могут быть пересмотрены после обсуждения с командой и дизайнером.

### Что осталось

- Backend/API, persistence, realtime, Supabase и AI не реализованы.
- Chat Room и остальные новые MVP-сценарии пока живут на mock-data и локальном state.
- Trip ↔ Chat модель, групповой flow и финальная UI-структура Trips требуют отдельного согласования.

## 2026-07-08 — Синхронизация документации и Codex rules

### Что сделали

- Синхронизировали README, CHANGELOG и roadmap с фактическим состоянием продукта на конец дня.
- Зафиксировали в документации новые MVP-сценарии: Profile MVP, profile edit mode, Discover MVP, public buddy profile, mock interest/match flow, Chats List MVP и единый frontend data model слой.
- Уточнили инструкции для Codex: явное перечисление прочитанных инструкций, выбранных и неиспользуемых skills/workflows, планируемых файлов и границ скоупа.
- Добавили правило про integration awareness, чтобы при изменении существующего flow проверялись соседние сценарии вроде Discover → buddy profile → interest flow → chats.
- Зафиксировали, что docs-only задачи не должны трогать код приложения и должны завершаться одним документальным заходом на основе дневника разработки.

### Что проверили

- Перечитали и сверили `AGENTS.md`, `docs/engineering-handbook/codex-rules.md`, `docs/engineering-handbook/codex-skills-workflow.md`, `README.md`, `CHANGELOG.md` и `docs/roadmap.md`.
- Использовали дневник разработки как основной источник фактов, без выдумывания новых функций.
- Сохранили границы скоупа: документация обновляется, код приложения и `apps/mini-app` не меняются.

### Что осталось

- Реальные backend/API, Supabase, persistence и chat room flow на тот момент ещё не были готовы.
- Discover, profile и chats пока живут на mock-data и локальном state.
- Следующий документальный проход должен снова опираться на дневник разработки и не смешивать docs-only работу с продуктовой реализацией.

## 2026-06-30 — День 3

### Почему сначала строили инженерную систему

Команда сознательно сначала собрала инженерный контур, потому что без него любая продуктовая работа быстро превращается в набор разрозненных изменений. Когда нет понятного процесса, веток, проверки окружения и согласованной документации, сложно понять, что именно уже готово, что сломалось и кто отвечает за следующий шаг.

Инженерная система нужна была как основа для дальнейшей разработки:

- чтобы у команды был стабильный `main` и рабочий `develop`;
- чтобы можно было проверять изменения в понятном процессе;
- чтобы новому участнику было проще войти в проект;
- чтобы продуктовые задачи не смешивались с задачами по инфраструктуре и диагностике;
- чтобы документация отражала реальное состояние проекта, а не устные договорённости.

### Почему сегодня главным было планирование

Сегодняшний день был посвящён не добавлению пользовательских функций, а согласованию следующих шагов. Это нужно было, чтобы команда не начала писать экраны и API раньше, чем договорится о порядке, зависимостях и ролях.

Планирование было важнее реализации, потому что:

- необходимо было зафиксировать порядок MVP-работ;
- нужно было разложить фронтенд, бэкенд и UX/UI на понятные этапы;
- важно было не распылить усилия между несколькими направлениями одновременно;
- команде требовалось единое понимание того, что идёт первым, а что позже.

### Какие решения приняла команда

- Первый инфраструктурный этап считается завершённым.
- `develop` зафиксирован как интеграционная ветка и объединён в `main` как первый стабильный checkpoint.
- Команда переходит от инженерной настройки к продуктовой разработке.
- MVP будет строиться по заранее согласованному порядку, а не хаотично.
- Документация и инженерные правила остаются обязательной частью работы.

### Что переходит на следующий этап

- Profile MVP.
- Поиск попутчиков.
- Экран карточки пользователя.
- Чаты.
- AI внутри чатов.
- Trips / поездки.

## 2026-06-30 — День 2

### Какие проблемы встретились

- Telegram Mini App нужно было проверять не только локально, но и в реальном Telegram-контексте.
- Поведение WebApp отличалось между локальным запуском, браузером и публичным URL.
- Часть симптомов выглядела как проблема React или рендера, но это оказалось слишком ранним выводом.
- Требовалось вернуть стабильный рабочий контур разработки без постоянной ручной перенастройки внешнего адреса.

### Какие гипотезы проверялись

Сначала команда смотрела в сторону клиентской части:

- возможно, проблема в React-компонентах;
- возможно, ломается гидратация;
- возможно, состояние Telegram SDK и браузерного fallback расходятся;
- возможно, ошибка в layout или навигации.

Параллельно проверяли сценарий окружения:

- как ведёт себя Mini App на публичном URL;
- что меняется при запуске через Vercel;
- одинаково ли воспроизводится ошибка вне Telegram и внутри Telegram WebView;
- помогает ли минимальный пример отделить продуктовую проблему от инфраструктурной.

### Почему проблема оказалась не в React, а в окружении

Ключевой вывод был такой: сначала приложение выглядело как источник ошибки, но потом стало понятно, что симптом зависит от среды запуска.

Если проблема воспроизводится только в Telegram-контексте или только на конкретном публичном адресе, это уже не похоже на чистую проблему React-компонента. В таком случае нужно смотреть на:

- WebApp-окружение;
- внешний URL;
- поведение Telegram SDK;
- разницу между локальным браузером и Telegram WebView.

Именно поэтому был полезен MRE для Telegram WebApp: он показал, что сначала надо изолировать среду, а уже потом трогать код.

### Чему научилась команда

- Не начинать с исправления кода, пока не проверена гипотеза.
- Если после нескольких разумных попыток причина не находится, нужен MRE.
- Telegram Mini App лучше проверять на стабильном публичном URL, а не на временном туннеле.
- Диагностика и исправление должны идти по порядку: сначала понять среду, потом чинить поведение.
- Документация должна обновляться в тот же день, когда команда пришла к новому инженерному выводу.

## 2026-06-29 — Документальный этап

### Что было сделано

- Создан новый `docs/engineering-handbook/` с правилами рабочего процесса, роли Codex, документации и принятия технических решений.
- Добавлен `docs/engineering-principles.md` как краткая точка входа в инженерные правила проекта.
- Упрощён `AGENTS.md`, чтобы он оставался короткой инструкцией для Codex и ссылался на Handbook вместо дублирования правил.

### Технические решения

- Подробные правила вынесены в отдельный Handbook, чтобы `AGENTS.md` не разрастался и оставался рабочей инструкцией, а не полноценным регламентом.
- Документация сохранена на русском языке, чтобы соответствовать текущим правилам проекта.

### Что дальше

- Использовать новый Handbook как основной ориентир для будущих инженерных и документальных изменений.

## 2026-06-28 — День 1

### Что было сделано

- Настроен первый каркас Mini App на Next.js в `apps/mini-app`.
- Добавлена мобильная нижняя навигация и маршруты `/`, `/chats`, `/trips` и `/profile`.
- Подключено определение окружения Telegram SDK, чтобы приложение могло понимать, запущено ли оно внутри Telegram.
- Добавлен резервный режим браузера, чтобы проект можно было открывать и развивать вне Telegram во время локальной разработки.
- Исправлен путь с hydration mismatch: Telegram state хранится на клиенте, а состояния загрузки, Telegram и браузера разделены.

### Технические решения

- Telegram Mini App выбран как основная MVP-платформа вместо отдельного мобильного приложения.
- AI-помощник будет встроен в чаты и поездки, а не вынесен в отдельный экран.
- Локальная разработка в браузере сохранена, чтобы не зависеть от Telegram на каждом шаге.
- Текущая сборка намеренно является каркасом: сначала маршруты, layout, навигация и определение окружения, затем продуктовая логика.

### Что дальше

- Настройка Telegram bot и публичного URL.
- Telegram-аутентификация и серверная проверка `initData`.
- Схема Supabase для пользователей, поездок, чатов и членства в группах.
- MVP профиля, MVP поездок и чатовый поток.
- Встроенный AI-помощник внутри контекста поездки и чата.
