# Manual production deployment runbook

> **Статус:** операторский порядок для текущего MVP. Runbook не выполняет и не разрешает production rollout сам по себе. Каждый production rollout требует отдельного подтверждения оператора непосредственно перед запуском.

## Границы и источники

Production состоит из backend-контура Render, frontend Mini App на Vercel и Supabase/PostgreSQL. Реальные project/service IDs, production URLs, provider settings, health-check configuration и точные команды ручного deploy в репозитории не заданы. Оператор сверяет target и использует поддерживаемый ручной механизм в текущем provider UI/CLI; не подставляет guessed IDs, URLs, команды или настройки.

Auto-Deploy остаётся **Off**. До rollout оператор проверяет в provider settings, что выбранные production services не начнут deploy автоматически от Git события. Не включать Auto-Deploy в рамках этого workflow. Фактическое состояние frontend deployment automation должно быть проверено в provider: репозиторий его не подтверждает.

Этот документ задаёт порядок для нового изменения и не является повтором [завершённого security cutover](production-security-migrations-runbook.md). Там зафиксированы exact исторические SHA, migration suffix, grants, preconditions и failure boundary; их нельзя переносить на новое изменение или повторять как универсальные команды. Источники истины: текущие migrations в `supabase/migrations/`, grants/verifier/gate в `apps/backend/scripts/`, backend HTTP contracts и выбранный target commit.

## 0. Release provenance record

Для каждого выпуска оператор сохраняет короткую запись до и после rollout. Запись должна связывать **intended revision** с **фактически deployed revision**; текущая ветка, локальный `HEAD`, имя deployment и время сами по себе не заменяют Git SHA.

До rollout заполнить intended Vercel/Render SHA, подтверждённые project/service/environment, ожидаемый production migration ledger и проверенный backend↔DB/frontend↔backend contract. После каждого provider deployment открыть детали именно выбранного production deployment и записать его фактический Git SHA (или отметить `UNKNOWN`, если provider его не показывает), deployment ID/URL и timestamp в UTC. Для DB записать Supabase project identity, observed PostgreSQL version и migration version/name inventory с временем наблюдения. Не включать secrets, DSN, пользовательские записи или PII.

Если provider не раскрывает SHA, release provenance для этого компонента остаётся `UNKNOWN`: остановить rollout или получить подтверждение из другого независимого deployment record, привязанного к тому же deployment ID. Не выводить SHA из даты, alias, текущего branch HEAD или соседнего компонента. Проверить, что после rollout production alias указывает на ожидаемый deployment. Сохранить запись в принятом operator release record; отдельное хранилище для MVP не вводится.

Минимальные поля записи:

| Поле | До rollout | После rollout |
|---|---|---|
| Target | provider, project/service, environment, подтверждённый production URL | фактически выбранный provider target и production alias |
| Frontend | intended Git SHA и contract expectations | deployed SHA либо `UNKNOWN`, deployment ID, timestamp |
| Backend | intended Git SHA и contract expectations | deployed SHA либо `UNKNOWN`, deployment ID, timestamp |
| Database | ожидаемые migration versions, schema/grants gates | observed project identity, PostgreSQL version, migration inventory и timestamp |
| Validation | CI/review, compatibility evidence, known-good candidate | HTTP smoke, ручные основные flows, verifier/gate results, решение и остаточные риски |

Release считается provenance-complete только когда intended и actual SHA каждого изменённого приложения совпадают с approved SHA, target подтверждён, а schema/API совместимость проверена. `UNKNOWN` нельзя трактовать как совпадение. Запись о прошлом успешном deployment — кандидат на known-good только после проверки его SHA, совместимости с **текущей** DB/API и доступности у провайдера; rollback не возвращает schema, grants, secrets или provider settings.

### Read-only production snapshot — 2026-10-18

Ниже зафиксированы наблюдения аудита на указанную дату. Это снимок, а не гарантия последующего состояния и не разрешение на rollout.

| Компонент | Подтверждённое наблюдение | Уверенность / ограничение |
|---|---|---|
| Vercel frontend | Project `travel-friend-mini-app`, production deployment `dpl_Di21ceCkxg4poxD2Udyfeanar4En`, READY, created `2026-09-02T17:26:08Z`; alias `travel-friend-mini-app.vercel.app`. | Environment и deployment identity — VERIFIED. Deployment record показывает source `cli`, не содержит Git SHA или Git source; фактический frontend SHA — **UNKNOWN**. |
| Render backend | Service `travel-friend-api`, branch `develop`, manual deployment, Auto-Deploy Off. Live deployment `dep-dapvgnlg1s2s73dicitg`, SHA `b25e08dce158b7fe7ea6d17b40d96c3e893330fa`, завершён `2026-09-23T16:04:41Z`. | Service settings и deployed SHA — VERIFIED по provider history. |
| Supabase | Project `travel-friend-dev` (`tlgprfsecdasloqnuyjo`), `ACTIVE_HEALTHY`; PostgreSQL `17.6.1.165`. Production ledger содержит 19 migrations. | Project identity/status/version/ledger — VERIFIED в read-only provider inventory на 2026-10-18. |

На commit Render `b25e08d…` находится 19 migration-файлов; эти 19 соответствуют production ledger, подтверждённому 2026-10-18. В текущем `develop` inventory находится 24 migration-файла. Пять последующих файлов, отсутствующих в подтверждённом ledger:

1. `20260924090000_completed_onboarding_active_travel_intent_invariant.sql`
2. `20260924100000_session_lifecycle_baseline.sql`
3. `20260924110000_backend_field_domain_limits.sql`
4. `20261003090000_chat_participant_public_profile.sql`
5. `20261018090000_server_side_tester_admission_session_identity.sql`

### Production preflight — 2026-10-19

**VERIFIED:** Supabase project `travel-friend-dev` (`tlgprfsecdasloqnuyjo`),
`ACTIVE_HEALTHY`, PostgreSQL 17.6; ledger содержит 19 versions. В `develop` —
24 migrations, перечисленные выше пять pending migrations. В `profiles` и
`travel_intents` обнаружено по 3 строки; NULL/blank `profiles.display_name` и
`travel_intents.destination_label` — по 0. Три текущие SQL capabilities —
legacy `bootstrap_telegram_login` (8 аргументов),
`resolve_bearer_session(text)` и
`chat_participant_profile_projection(uuid)` — принадлежат `postgres`; у
`app_runtime` есть `EXECUTE`, у `anon`, `authenticated` и `service_role` его нет.
Для функций в `public`, создаваемых как `postgres`, default ACL не выдаёт
`EXECUTE` API roles. Default ACL `supabase_admin` отличается и может выдавать
им `EXECUTE`; поэтому это подтверждение снимает риск только при условии, что
миграции действительно выполняются ролью `postgres`.

**UNKNOWN:** Полный production schema drift audit не завершён; безопасность и
влияние DDL locks не доказаны. Фактическое состояние может измениться после
этого preflight. Эффективные права новых функций после применения ещё не
проверены.

**BLOCKED:** Production rollout остаётся заблокированным. Непосредственно перед
любым migration apply повторно подтвердить target, ledger, данные, роль создания
функций и её default ACL. Если фактическая роль — `supabase_admin`, либо ACL
неоднозначен, остановиться до отдельного решения. После применения выполнить
effective-privilege проверку новых функций для `PUBLIC`, `anon`,
`authenticated`, `service_role` и `app_runtime`; существующий verifier отдельно
не проверяет API-role запрет для новых 6-аргументного login и Chat profile.
Этот preflight и локальная репетиция не подтверждают production readiness.

Это подтверждённый migration drift на дату наблюдения, а не подтверждение того, что все остальные schema objects совпадают. Перед rollout ledger нужно получить повторно; за время после read-only snapshot он мог измениться.

Read-only function/permission comparison подтверждает для Render SHA `b25e08d…` наличие и `app_runtime` EXECUTE для его 12 используемых public functions, включая восьмиаргументную `bootstrap_telegram_login` и `chat_participant_profile_projection(uuid)`. Следовательно, проверенная backend↔DB compatibility для этого SHA ограничена его наблюдаемым migration/function/runtime-permission surface; полный schema drift audit не завершён. На текущем repository source используются шестипараметрическая версия `bootstrap_telegram_login`, `chat_participant_public_profile(uuid,uuid)` и `resolve_bearer_session_with_identity(text)`, которых в production на дату проверки нет. Без применения соответствующих migrations текущий source **не совместим с production**: Telegram login, профиль участника чата и все authenticated Bearer requests затронуты. Перед выпуском такого source нужны отдельная migration review/preflight, grants verification и явное разрешение на production migration; migrations не применялись в этом аудите.

Frontend↔backend compatibility — **UNKNOWN**: frontend deployed SHA не раскрыт provider record, фактическое `BACKEND_API_ORIGIN` не проверялось/не раскрывалось, а source-level frontend tests не подтверждают deployed pair. Текущий read-only HTTP smoke Render URL завершился network timeout на `GET /health`; `GET /ready` не запускался, поскольку smoke останавливается на первой ошибке. Поэтому свежие live health/readiness и основные production flows этим аудитом не подтверждены.

Известный backend deployment SHA `b25e08d…` — reference для анализа совместимости, но не автоматическое разрешение rollback: перед выбором known-good нужно заново удостовериться, что deployment доступен в Render history и подходит текущим DB/API state. Более ранний SHA из истории предшествует security cutover и не считается безопасным rollback candidate без отдельного доказательства.

**Текущий итог №16: PARTIALLY VERIFIED / OPEN.** Для закрытия остаются: получение frontend deployed SHA, подтверждение фактического backend origin без раскрытия credentials, повторяемая полная сверка production schema drift, live health/readiness и проверка основных flows после устранения timeout, а также явное решение о порядке миграций и grants для текущего repository source. Не объявлять полную frontend/backend/DB совместимость или полную production provenance.

## 1. Preflight и Git SHA

1. Получить отдельное подтверждение оператора на конкретный production rollout. Зафиксировать, какие backend/frontend изменения и DB изменения входят в него.
2. В чистом deployment checkout проверить repository, branch, commit и рабочее дерево. Зафиксировать полный target Git SHA; он должен совпадать с reviewed/approved revision. Не деплоить локальные незакоммиченные изменения.
3. Проверить GitHub Actions CI/review результата именно для этого SHA и наличие требуемых lockfiles. Текущий `.github/workflows/ci.yml` запускает frontend `npm run check` и backend tests с disposable PostgreSQL на `push`/`pull_request`; это проверка кода, не production deployment. Не считать локальный build заменой CI результата. Настроенные branch-protection/required-check rules из репозитория не подтверждаются и проверяются оператором отдельно.
4. В provider вручную выбрать подтверждённые production project/service/environment и тот же SHA. До подтверждения target ничего не запускать.
5. Проверить Auto-Deploy Off и доступность заранее согласованного способа quiesce/maintenance, если он требуется матрицей ниже. Репозиторий не задаёт универсальный maintenance toggle или его команду.

**STOP:** неизвестный target, dirty checkout, несовпадающий SHA, failed CI или незавершённый review, который обязателен по release policy, включённый или непроверенный Auto-Deploy, неподтверждённая production environment, либо отсутствие нужного quiesce/restore способа.

## 2. Проверить production schema и grants

До выбора порядка deployment сравнить фактическую production migration history и effective runtime contract с состоянием, нужным target SHA:

- определить применённый migration version и точный набор ожидаемых pending migrations; пропуски, неожиданные версии или history drift требуют остановки и отдельного разбора;
- для изменений grants/RLS подтвердить ожидаемую схему, ownership, policies, capability functions и privileges read-only verifier-ами из `apps/backend/scripts/`;
- когда изменён runtime contract, использовать production runtime gate с подтверждённой runtime identity и только после того, как DB contract/grants подготовлены;
- если DB не меняется, подтвердить, что существующая schema/grants совместимы с target backend.

Любое подключение выполняет оператор к независимо проверенному production target и с соответствующей least-privileged/provisioning identity. Не передавать DSN/keys в Git, shell history или отчёт. Имена переменных и примерный порядок из исторического cutover не означают, что его privileged команды подходят новой миграции.

**STOP:** production identity/target не подтверждены; migration history неожиданна; verifier или runtime gate не прошёл; или нужный schema/grants state невозможно проверить. Не исправлять drift через `migration repair`, ручное редактирование migration history, ad-hoc SQL или возврат broad grants.

### Операторский preflight для следующего rollout

Этот checklist готовит будущую отдельную операцию; в ходе подготовки 2026-10-19
ни один production query, write, migration, deploy или provider change не
выполнялся. Все результаты ниже нужно обновить непосредственно перед rollout.
Исторический preflight не является approval и не заменяет новый снимок.

| Проверка | Точное действие | Ожидается | STOP / доступ / состояние |
|---|---|---|---|
| Supabase target и права | В Supabase Dashboard открыть проект `travel-friend-dev`, сверить ref `tlgprfsecdasloqnuyjo`, статус и Database → Settings → Database. Убедиться, что у назначенного оператора есть отдельно одобренный доступ к read-only preflight и migration role; Dashboard membership сама по себе не доказывает DB privileges. В read-only SQL Editor выполнить `SELECT current_database(), current_user, session_user, current_setting('server_version');`. | `postgres`, ожидаемый ref, база `postgres`, PostgreSQL major 17; роль выполнения migration должна быть отдельно подтверждена как `postgres`. | При другом target, роли, версии или неясной принадлежности **STOP**. Запрос читает metadata и не меняет состояние. Для ledger/migration нужен privileged operator access; реальный credential не записывать в заметки. |
| Ledger | В доверенном terminal выполнить `npx --yes supabase@2.114.0 migration list --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN"`, сверить все remote versions, затем выполнить pinned `db push --dry-run` из раздела execution ниже. Не добавлять `--include-all`, `--include-roles`, `--include-seed` или `migration repair`. Команды перечислены в [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-migration-list). | До apply — remote ledger ровно 19 версий без пропусков/лишних записей, а dry-run показывает ровно пять перечисленных pending migrations по порядку. | Любой extra/missing/out-of-order version — **STOP**. Оба действия читают migration history; dry-run не применяет SQL, но требует доступа к production migration endpoint. `--db-url` передаёт DSN процессу через argv; если локальная security policy не допускает этого, не обходить ограничение shell history/временным plaintext-файлом: согласовать защищённый путь либо остановиться. |
| Legacy values | В Supabase SQL Editor выполнить только агрегаты, не возвращающие строки: `SELECT count(*) FILTER (WHERE display_name IS NULL OR btrim(display_name) = '') AS blank_display_names FROM public.profiles;` и отдельно `SELECT count(*) FILTER (WHERE destination_label IS NULL OR btrim(destination_label) = '') AS blank_destinations FROM public.travel_intents;`. | Оба результата `0`; 2026-10-19 такие агрегаты дали ноль на снимке из трёх строк каждой таблицы. | Ненулевое значение — **STOP**. Не показывать строки, не backfill-ить и не редактировать данные в рамках rollout preparation. Read-only aggregate. |
| Schema drift | Для текущих пяти migrations сверить затрагиваемые таблицы/колонки/constraints/indexes, функции/dependencies, RLS/policies/triggers и роли с approved migration plan по reviewed read-only процедуре. | Зафиксировать targeted review result для этого suffix; не называть его полным schema audit. | Targeted review для указанных migrations сообщён как **GO**. Неожиданный drift на затронутом объекте — **STOP**. Более широкий production schema drift остаётся отдельным риском; счётчики и backup manifest не доказывают полного совпадения. |
| Creator role / default ACL | Запустить описанный в [backup runbook](backup-restore-runbook.md) `--preflight-only` только после отдельного разрешения на read-only connection; безопасная сводка сверяет target, RLS/read coverage, ACL principal inventory и расширения. Для apply использовать прямой `--db-url`, не linked target; перед ним проверить точный DSN read-only способом по процедуре ниже. | Reviewed ACL допускает apply только при `postgres`; CLI 2.114.0 передаёт direct URL в DB resolver и использует полученную сессию для migrations. Production verifier после apply проверит effective grants. | Ошибка read-only проверки identity/timeout или любое изменение CLI version/connection target — **STOP**. Если apply будет под `supabase_admin`/другой ролью, default ACL требуют нового review. Preflight-only и описанная проверка читают production, не создают artifacts и не пишут в DB. |
| Backup и local restore | Сверить дату/target/checksum актуального production archive и encrypted offsite copy по [backup runbook](backup-restore-runbook.md); убедиться, что последний isolated restore result доступен и относится к текущей процедуре. | Есть проверяемый checksum, восстановимый локальный архив и успешный локальный schema/data + application grants restore; эти проверки не означают production recovery/ACL verification. | Нет актуального архива, manifest/ciphertext checksum, recovery key access или последнего restore evidence — **STOP**. Не запускать production backup/restore без отдельного разрешения; не раскрывать и не копировать ключ. |
| Render SHA и controls | В Render Dashboard открыть service `travel-friend-api` → Deploys и Settings. Записать полный live SHA и service branch; проверить Auto-Deploy `Off`, права оператора и ручную возможность deploy конкретного commit. | Текущий SHA известен, целевой SHA существует и review/CI для него прошли; Auto-Deploy Off. | Старый известный live SHA `b25e08dce158b7fe7ea6d17b40d96c3e893330fa` — только исторический baseline, не автоматический rollback target. Выбранный rollout не использует Suspend/Maintenance Mode; API errors в коротком окне явно приняты оператором. Только чтение Dashboard. |
| Vercel project, revision, API origin | В Vercel Dashboard выбрать правильную team и project `travel-friend-mini-app`, Production environment; сверить production alias/deployment ID и Git SHA в deployment details. В project Settings → Environment Variables проверить фактический production `BACKEND_API_ORIGIN` приватно и сравнить с независимо подтверждённым Render origin; значение не копировать в shell history, отчёт или issue. | Известны точный deployed frontend SHA, ожидаемый target и соответствие `BACKEND_API_ORIGIN` backend target. | На preflight SHA frontend и фактический `BACKEND_API_ORIGIN` были `UNKNOWN`. Пока оба не подтверждены, backend/frontend compatibility остаётся `UNKNOWN`, rollout **STOP**. Dashboard inspection не меняет состояние; env value не включать в release record. |
| Telegram accounts / admission | Ответственный оператор вне репозитория подтверждает доступность 3 core и планируемых tester Telegram accounts; сверяет `TELEGRAM_CORE_USER_IDS`, `TELEGRAM_TESTER_USER_IDS`, `TELEGRAM_TESTERS_PAUSED` непосредственно в закрытой Render Environment, не записывая ID. | Все три настройки присутствуют и допустимы; для первого cutover testers paused (`true`), команда остаётся в core allowlist. | Не выводить IDs в screenshots/logs/Codex/tickets. Недоступный account или некорректная конфигурация — **STOP**. Environment change и его применение — отдельное разрешённое production действие; при этой проверке ничего не менять. |

Для проверки migration connection использовать прямой `--db-url` с тем же
закрытым DSN, который будет передан `db push`; не выбирать `--linked` и не
опускать target flag. В CLI 2.114.0 явный `--db-url` идёт через прямой resolver
(он не запускает Management API mint временной login-role). Для удалённой роли с
именем `postgres.<project-ref>` CLI применяет `SET SESSION ROLE postgres`; это
меняет `current_user`, но не `session_user`. Поэтому отдельная read-only проверка
должна подтвердить оба значения как `postgres`, а не только ожидаемый `current_user`.
Это подтверждается [исходным кодом CLI 2.114.0](https://github.com/supabase/cli/tree/v2.114.0/apps/cli/src/legacy).

Перед применением выполнить read-only проверку с тем же DSN-переменным
значением, которое будет использовано для dry-run и apply. DSN должен включать
ожидаемые host/ref, port, database, username, `sslmode=require` и `options` из
раздела timeouts. Не вставлять DSN literal в shell history:

```sh
psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN_WITH_TIMEOUTS" \
  -c "RESET ALL; SELECT current_database(), current_user, session_user, current_setting('server_version'), current_setting('lock_timeout'), current_setting('statement_timeout'), current_setting('lock_timeout')::interval = interval '5 seconds' AS lock_timeout_ok, current_setting('statement_timeout')::interval = interval '120 seconds' AS statement_timeout_ok;"
```

Ожидаются database `postgres`, `current_user=session_user=postgres`, server
major 17 и обе колонки `*_ok=true`. `RESET ALL` намеренно повторяет сброс CLI
перед migration: PostgreSQL определяет RESET default по session startup
configuration, включая startup options. CLI 2.114.0 подтверждает, что query
параметры `--db-url` сохраняются resolver-ом и передаются драйвером как startup
options; одна физическая `psql` session сама по себе не доказывает состояние
другого backend.

Source-backed assurance для `db push` состоит из неизменённого exact DSN,
прямого `--db-url` target, передачи resolved connection в push core и одной
DB session для чтения ledger и применения migrations. Перед каждой migration
CLI выполняет `RESET ALL`, затем применяет SQL в этой же сессии. См. [resolver](https://github.com/supabase/cli/blob/v2.114.0/apps/cli/src/legacy/shared/legacy-db-config.layer.ts), [PostgreSQL driver connection setup](https://github.com/supabase/cli/blob/v2.114.0/apps/cli/src/legacy/shared/legacy-db-connection.sql-pg.layer.ts), [migration apply path](https://github.com/supabase/cli/blob/v2.114.0/apps/cli/src/legacy/shared/legacy-migration-apply.ts) и описание PostgreSQL [`RESET`](https://www.postgresql.org/docs/17/sql-reset.html).

Затем выполнить `db push --dry-run` с тем же exact DSN и сверить пять
миграций и их порядок. Для отдельно разрешённого apply использовать DSN
неизменным. Это гарантирует параметры по source-reviewed connection path, но
не является SQL-отчётом из физической migration session: если release policy
требует именно такой runtime-отчёт, а не source-backed гарантию подключения,
**STOP** — CLI не предоставляет pre-migration SQL hook. Если process-list
protection для DSN не подтверждена, остановиться до подключения.

Команда ограниченного read-only backup preflight (запускается в будущем только
после отдельного разрешения на production read-only connection; во время этой
подготовки не запускалась):

```sh
cd apps/backend
uv run --group dev python scripts/production-backup-runner.py --preflight-only
```

Runner должен запросить интерактивное подтверждение
`PREFLIGHT travel-friend-dev`; затем выводит безопасную summary и ничего не
экспортирует/не записывает. Не путать с `--export`. Этот preflight проверяет
ожидаемый inventory, но не заменяет отдельную проверку полного migration ledger
и exhaustive schema drift.

### Обновление подготовки rollout — 2026-10-21

Этот dated update supersedes для планируемого rollout отдельные historical
dispositions из preflight 2026-10-19; он не переписывает тогдашние наблюдения.

По предоставленным результатам оператора локальная репетиция пяти migrations
пройдена; targeted production schema-drift review и production ACL review имеют
статус **GO** при подтверждённой migration identity `postgres`. Verifier gap
закрыт локально; production verifier всё равно должен пройти после apply. Это
не заменяет повторный production preflight, свежую резервную копию, проверку
live SHA или отдельное разрешение на rollout.

Для текущего Render Free service запланировано короткое техническое окно;
временные API errors во время последовательности DB → grants/verifier/runtime
gate → Render deploy приняты оператором. Длительность окна не гарантируется.
Maintenance Mode и Suspend не используются. Старый backend может обслуживать запросы до
завершения нового deploy, поэтому ошибки в этом окне являются известным риском.
Если окно, target или согласованные проверки не укладываются в план, **STOP**;
не считать Render rollback откатом схемы БД.

**Текущие STOP gates:** непосредственно перед apply заново проверить project/ref,
ledger, data invariants, backup и checksum, exact CLI/timeout configuration,
фактическую Render revision и согласованный target SHA. Способ подтвердить
`current_user=session_user=postgres` и оба timeout на том же exact DSN через
read-only precheck ниже; применить только pinned CLI 2.114.0 с явным
`--db-url`. CLI source подтверждает, как этот DSN превращается в migration
session и как per-migration `RESET ALL` обрабатывает startup settings. Отдельный
`psql` connection не является самостоятельным доказательством о другом
backend; если release policy требует именно runtime-отчёт из физической
migration session, а не source-backed гарантию, **STOP**. Frontend SHA/API origin и live
health/readiness остаются отдельными проверками, если затрагивается frontend
или они требуются release record.

### Production migration readiness audit: pending migrations и rollout gate

Аудит SQL пяти файлов выше выполнен статически по Git и локально повторён на
копии production archive в disposable PostgreSQL 17.11. Это подтверждает
поведение проверенного Git checkout в обычном PostgreSQL, но не устраняет
production schema drift и не доказывает идентичность Supabase production.

| Migration | Объекты / поведение | Data, RLS и privilege effects | Совместимость и риск |
|---|---|---|---|
| `20260924090000_completed_onboarding_active_travel_intent_invariant.sql` | `CREATE OR REPLACE` для `archive_current_active_travel_intent()`; serializes with completion through `user_activity_states` row. | DML выполняется только при вызове capability; migration сам не backfill-ит данные, не меняет таблицы/policies. Function `SECURITY DEFINER`, `search_path=pg_catalog`, `PUBLIC` revoked, `app_runtime` execute. | Сигнатура сохранена; приложение должно продолжать передавать активный TravelIntent при завершённом onboarding. Production rows/behavior не перепроверялись. |
| `20260924100000_session_lifecycle_baseline.sql` | Добавляет canonical шестипараметрический `bootstrap_telegram_login(...)`; заменяет legacy восьмипараметрический overload wrapper-ом в canonical function. | Login capability создаёт/обновляет identity и session только при вызове. Оба overload `SECURITY DEFINER`, `search_path=pg_catalog`, `PUBLIC` revoked; grants применяются отдельным runtime grant step. RLS/table definitions не меняются. | Legacy 8-arg signature сохраняет старый Render backend call contract; `created_at`/`expires_at` от старого backend игнорируются, TTL задаёт DB. Новая версия backend требует canonical 6-arg capability. Для нового 6-arg object SQL не отзывает явно `anon`/`authenticated`/`service_role`; preflight 2026-10-19 подтвердил отсутствие их default EXECUTE при создании функцией `postgres`, но не при `supabase_admin`. До apply подтвердить фактическую creator role; после — сверить effective EXECUTE. |
| `20260924110000_backend_field_domain_limits.sql` | Проверяет legacy blank `profiles.display_name` и `travel_intents.destination_label`, затем добавляет два `CHECK` constraints; заменяет `create_current_group_chat(uuid[])` и `send_current_chat_message(uuid,text)`. | Нет data backfill. При blank legacy values migration останавливается до добавления constraints. Изменённые functions `SECURITY DEFINER`, `search_path=pg_catalog`, `PUBLIC` revoked, execute — `app_runtime`; RLS/policies не изменяются. | Behavior становится строже: пустые значения / невалидные group-chat inputs и сообщения будут отклоняться. Два `ALTER TABLE ... ADD CONSTRAINT` требуют таблицевых lock и проверки существующих строк; точная длительность/ожидание production неизвестны. Подготовить maintenance window и STOP при legacy rows или неприемлемом lock-рискe. См. [PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html) и [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html). |
| `20261003090000_chat_participant_public_profile.sql` | Добавляет `chat_participant_public_profile(uuid,uuid)` для чтения профиля активного участника общего чата. | Нет table/policy changes. Function `SECURITY DEFINER`, `search_path=pg_catalog`, `PUBLIC` revoked, execute — `app_runtime`. | Это нужная новая backend capability; архив и production snapshot её не содержали. Старый `chat_participant_profile_projection(uuid)` не удаляется, что поддерживает старый backend contract. Как и для canonical login capability, явного revoke названных API roles в migration нет; preflight подтвердил отсутствие default EXECUTE при создании функцией `postgres`, но не при `supabase_admin`; creator role проверить перед apply и effective EXECUTE после. |
| `20261018090000_server_side_tester_admission_session_identity.sql` | Аддитивно добавляет `resolve_bearer_session_with_identity(text)` с `session_id`, `user_id`, Telegram numeric identity. Старый `resolve_bearer_session(text)` оставлен неизменным. | Нет table/policy changes и прямых `app_runtime` SELECT grants на `users`/`telegram_identities`. Function `SECURITY DEFINER`, `search_path=pg_catalog`; `PUBLIC`, `anon`, `authenticated`, `service_role` EXECUTE отзывается если роль есть; runtime grant задаётся существующим grant script. | Новому backend нужна эта capability при каждом Bearer request. Существующие старые sessions сохраняются, однако admission env и runtime behavior должны быть проверены до внешнего допуска. |

Dependency chain: migration 1 использует уже созданные `user_activity_states`,
`travel_intents` и `current_authenticated_user_id()`; migration 2 добавляет
login overload поверх существующих identity/session/profile/activity objects;
migration 3 опирается на существующие `profiles`, `travel_intents` и chat
capabilities; migration 4 требует `chat_participants`, `profiles`, active
`travel_intents`, `users` и authenticated-user context; migration 5 требует
`user_sessions`, `users` и `telegram_identities`. Все пять — одна последовательная
ветка после migration 19, в timestamp order. Grant script/verifier и runtime
gate идут после полного SQL chain. Ни `resolve_bearer_session(text)`, ни старые
`bootstrap_telegram_login` и `chat_participant_profile_projection(uuid)` не
удаляются этим набором.

Общие выводы SQL review: ни одна из пяти миграций не удаляет таблицу или столбец;
нет массового data migration/backfill; явные функции работают с `SECURITY
DEFINER` и фиксированным `search_path=pg_catalog`; новые capabilities запрещают
`PUBLIC EXECUTE` и доступны через `app_runtime`. Локальная проверка подтвердила
применение 26 явных migration-declared `PUBLIC EXECUTE` revokes. Проверка Git SQL
не исключает production drift, нестандартные ACL, дополнительные объекты или
операторские зависимости Supabase.

**Production ACL — операторский review 2026-10-21: GO условно.** Принятое
заключение относится к reviewed privilege inventory и требует выполнения
migrations под `postgres`. После apply обязательны production verifier и runtime
gate для всех новых backend-only capabilities. Если фактическая migration role
не подтверждена как `postgres`, privileges отличаются от reviewed inventory
или verifier/gate не проходят — **STOP**; не деплоить backend.

#### Применение pending migrations: execution, timeouts и проверки

Для migration apply закреплён Supabase CLI **2.114.0**: `db push` применяет
локальные pending migrations в migration-history order и после успешного файла
добавляет запись в `supabase_migrations.schema_migrations`; `--dry-run` только
показывает список. Эта версия и процедура прошли локальную rehearsal, но это не
production verification. Использовать точный repository checkout, без
`--include-all`, role/seed флагов, `migration repair` или remote reset. См.
[CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push).

В защищённом operator terminal использовать только pinned CLI и DSN с timeout
options из подраздела ниже. Ожидаются ровно пять pending migrations в порядке
§2:

```zsh
npx --yes supabase@2.114.0 db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN_WITH_TIMEOUTS" --dry-run
```

Любой иной список, target или CLI version — **STOP**. Будущая apply-команда
та же без `--dry-run`, с `--yes`, только после отдельного approval и закрытия
всех STOP gates; в рамках этой задачи она не запускалась. Значение DSN не
вставлять literal в shell history, logs или отчёт. `--db-url` раскрывает DSN в
process arguments: если process-list/history/log exposure нельзя исключить,
**STOP**; не подменять его guessed env var, plaintext-файлом или `--password`.

Один `db push` обрабатывает найденный pending suffix последовательно; он не
предоставляет здесь подтверждённого operator checkpoint для ручной проверки
между каждой migration. По завершении сравнить фактический ledger с полным
ожидаемым списком и независимо проверить каталог/privileges. При ошибке
команды, неполном suffix или сомнении в транзакционной границе остановиться:
прочитать текущий ledger и фактические объекты read-only способом. Не повторять
blind push, не редактировать ledger и не считать отсутствие новой ledger row
доказательством, что migration не оставила частичный schema effect.

Плановые пределы: `lock_timeout=5s`, `statement_timeout=120s`. Миграции не
задают эти параметры; передать их как connection-startup `options` в exact DSN
для CLI, а не через отдельный `SET` в SQL Editor/сессии:

```text
options=-c%20lock_timeout%3D5s%20-c%20statement_timeout%3D120s
```

Добавить encoded parameter к существующему URI query (`&options=...`, если
query уже есть; иначе `?options=...`), сохранив подтверждённые target и
`sslmode=require`. Локальная rehearsal через CLI 2.114.0 подтвердила значения
из migration session. Исходный код версии 2.114.0 подтверждает production-capable
путь: parser сохраняет connection-string `options`, driver передаёт их как
PostgreSQL startup options, а перед каждой migration CLI выполняет `RESET ALL`.
Оператор подтверждает значения через read-only проверку выше с тем же DSN,
затем использует только explicit `--db-url`; это source-backed assurance,
а не наблюдение внутри той же физической сессии. При изменении URI, версии CLI
или target — **STOP** и повторить preflight. Параметры не меняют роль, grants
или владельца функций. `lock_timeout` ограничивает ожидание lock,
`statement_timeout` — отдельный statement, а не весь `db push`. Для двух
`ALTER TABLE ... ADD CONSTRAINT` в migration 3 при lock wait, timeout,
неожиданной длительности или ошибке — STOP; не увеличивать значения наугад.

| Порядок / migration | До исполнения и роль | Ожидаемый результат и проверка после полного `db push` | Backend overlap / STOP |
|---|---|---|---|
| 1. `20260924090000_completed_onboarding_active_travel_intent_invariant.sql` | Ledger ровно 19 + базовые objects для `user_activity_states`, `travel_intents` и `current_authenticated_user_id()`; проверить `current_user=session_user=postgres` в migration session. | Ledger содержит версию; `archive_current_active_travel_intent()` существует, `SECURITY DEFINER`, `search_path=pg_catalog`, нет `PUBLIC EXECUTE`, у `app_runtime` есть `EXECUTE`. | Сигнатура сохраняется для текущего backend; меняется поведение archive/completion при завершённом onboarding. Остановиться, если prereq/metadata/grant не совпал или production data behavior не оценён. |
| 2. `20260924100000_session_lifecycle_baseline.sql` | Успешно проверена migration 1 и базовые identity/session/profile/activity tables; creator role `postgres`. | Оба overload `bootstrap_telegram_login` существуют: 6-arg canonical и legacy 8-arg wrapper; оба `SECURITY DEFINER`, фиксированный `search_path`; ledger row есть. Effective `EXECUTE` должен быть только app_runtime для backend contract, без `PUBLIC`/API roles. | Legacy 8-arg сохранён для старого Render backend; новый backend вызывает 6-arg. Неожиданный API-role EXECUTE — STOP; production verifier после apply обязателен. |
| 3. `20260924110000_backend_field_domain_limits.sql` | Повторить агрегаты blank/null перед apply: обе должны оставаться `0`; миграции 1–2 и `profiles`/`travel_intents` существуют; creator `postgres`. | В ledger есть версия; constraints `profiles_display_name_not_blank` и `travel_intents_destination_label_not_blank` существуют и `convalidated=true`; обновлённые функции доступны только по проверенной privilege matrix. | Добавляет два CHECK и заменяет group-chat/message capabilities; старый backend сохраняет сигнатуры, но пустые значения/невалидные inputs начнут отклоняться. Ненулевой legacy count, lock wait, timeout или неизвестное число активных writers — STOP, без backfill/автоматического отката. |
| 4. `20261003090000_chat_participant_public_profile.sql` | Предыдущие миграции успешны; проверить `chat_participants`, `profiles`, `travel_intents`, `users` и authenticated-user capability; creator `postgres`. | Ledger row есть; `chat_participant_public_profile(uuid,uuid)` существует с `SECURITY DEFINER`, `search_path=pg_catalog`; `PUBLIC` и API roles не executable, `app_runtime` executable. | Старый backend использует сохранённую прежнюю projection function; новый backend требует новую. Production verifier после apply должен подтвердить effective API-role denial. |
| 5. `20261018090000_server_side_tester_admission_session_identity.sql` | Предыдущие четыре успешно применены; `user_sessions`, `users`, `telegram_identities` присутствуют; creator `postgres`. | Ledger row есть; `resolve_bearer_session_with_identity(text)` существует с `SECURITY DEFINER`, `search_path=pg_catalog`; app_runtime EXECUTE, `PUBLIC`/`anon`/`authenticated`/`service_role` effective EXECUTE отсутствует; прямых runtime SELECT grants на `users`/`telegram_identities` нет. | Старый resolver не меняется; новая версия backend использует новый resolver на каждом bearer request. Неожиданные ACL или прямые grants — STOP; не добавлять их для «быстрого» прохождения. |

После полного suffix считать миграционную часть успешной только если пять новых
версий присутствуют по порядку, ожидаемые объекты и constraints существуют,
targeted schema-drift review для затронутых объектов подтверждён, grants/verifier
проходят, и compatibility review для фактических deployed SHA завершён. Более
широкий schema-drift audit остаётся отдельным риском и не считается выполненным
этим rollout review.
Production ledger на 2026-10-19 был 19, Git `develop` содержал 24 files;
эти значения — дата-связанный ориентир, не текущая гарантия.

### Grant apply и статус verifier gap

После миграций и только по отдельному разрешению применить существующий
`apps/backend/scripts/grant-production-app-runtime-privileges.sql` с approved
privileged identity; это меняет production ACL. Затем выполнить
`verify-production-app-runtime-privileges.sql` тем же целевым project/ref и
зафиксировать результаты без DSN/пользовательских данных. Скрипты не менять
через Dashboard ручными ACL-командами.

Из корня репозитория, в том же защищённом operator terminal и только после
отдельного grants approval, существующая команда имеет вид:

```sh
psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" \
  -f apps/backend/scripts/grant-production-app-runtime-privileges.sql
psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" \
  -f apps/backend/scripts/verify-production-app-runtime-privileges.sql
```

Первая команда меняет ACL; вторая читает каталог. Не запускать grant скрипт
повторно после частичной/неясной ошибки до выяснения текущего состояния.

Перед deployment отдельно подтвердить эффективные права на весь backend-only
набор: `public.bootstrap_telegram_login(bigint,text,text,text,text,text)`,
`public.chat_participant_public_profile(uuid,uuid)` и
`public.resolve_bearer_session_with_identity(text)`. Для каждой функции нужны
`app_runtime EXECUTE=true`, `PUBLIC EXECUTE=false` и
`anon`/`authenticated`/`service_role EXECUTE=false`; вместе с этим проверить,
что `app_runtime` не имеет прямого `SELECT` на `public.users` и
`public.telegram_identities`.

**Статус verifier gap: закрыт локально, production verification pending.**
Обновлённый `verify-production-app-runtime-privileges.sql` проверяет точные
сигнатуры трёх backend-only функций, effective EXECUTE для `app_runtime`,
`PUBLIC`, `anon`, `authenticated`, `service_role` и отсутствие прямого runtime
`SELECT` на `public.users`/`public.telegram_identities`. Перед backend deploy
production verifier и runtime gate должны пройти на точном project/ref; любое
расхождение — **STOP**. Локальный результат не доказывает production ACL.

После verifier запустить
`apps/backend/scripts/production-runtime-deployment-gate.py` через
подтверждённый `PRODUCTION_RUNTIME_DATABASE_URL` роли `app_runtime` из
`apps/backend` (`uv run --python 3.12 scripts/production-runtime-deployment-gate.py`).
Gate включает отрицательные mutation probes в транзакции, которые завершаются
rollback; это не deployment и не оставляет таких изменений, но подключение к
production и его probes требуют отдельного approval. Проверить полный PASS до
backend cutover. Он подтверждает runtime contract, не frontend SHA/origin и не
полный production schema parity.

#### Compatibility matrix

| Состояние | Вывод | Основание / предел |
|---|---|---|
| A. Deployed backend `b25e08d…` с БД после каждой migration | Его прежние 8-arg login, старый session resolver и `chat_participant_profile_projection(uuid)` сохраняются; статически call contracts совместимы. Migration 1/3 могут изменить поведение и отклонять ранее принимавшиеся данные. | Сигнатуры старого backend и migration SQL сверены из локального Git SHA. Полный интеграционный прогон старого бинарного deployment на мигрированном snapshot не выполнялся; production drift/legacy rows неизвестны. |
| B. Backend из текущего `develop` до migrations | **Несовместим**: login вызывает 6-arg bootstrap, Chats — `chat_participant_public_profile(uuid,uuid)`, каждый Bearer request — новый resolver; этих объектов нет в archive ledger schema. | Локальное восстановление 19-migration archive подтвердило отсутствие capabilities до replay. Не деплоить новый backend раньше полного DB/grants gate. |
| C. Backend из `develop` после пяти migrations и grants | **Локально VERIFIED для schema/runtime contract** на disposable restore. Production readiness остаётся условной до повторного ledger/schema/ACL preflight, grant verifier, deployment gate и корректной серверной admission config. | Локальный smoke: 17 tables, 21 functions, RLS/policies, row counts до/после replay, app_runtime grant script/verifier и effective API-role denial на трёх новых функциях — PASS. Локальные default ACL не доказывают production ACL. |
| D. Existing production frontend с новым backend | **UNKNOWN**. | Production frontend Git SHA и фактический `BACKEND_API_ORIGIN` неизвестны; source-level API tests не доказывают deployed pair. До rollout найти независимое evidence SHA/origin и выполнить разрешённый HTTP + Telegram flow smoke. |

В local rehearsal проверены также неизменность агрегированного row count каждой из
17 application tables между restore и replay пяти migrations. Это исключает
изменение числа строк в данной disposable DB во время replay, но не сравнивает
production snapshot с архивом и не доказывает полноту production data.

Подробный migration order и admission-specific checklist приведены ниже. Новый
backend нельзя выкатывать до всех пяти migrations, grants, verifier и runtime
gate. Старый backend имеет сохранённые SQL overloads, но это не доказывает
безрисковый rollout: миграция ограничений меняет допустимое поведение, а старый
artifact нужно заново подтвердить в provider history. Миграции не откатывать
автоматически; при ошибке остановиться, сохранить фактическое состояние и
подготовить forward-fix.

### Отдельный dependency/order plan: server-side tester admission

Новая migration `20261018090000_server_side_tester_admission_session_identity.sql`
аддитивно добавляет `public.resolve_bearer_session_with_identity(text)` и не
меняет return contract существующей `resolve_bearer_session(text)`. Backend
использует только новую capability для authenticated requests. Она возвращает
`session_id`, `user_id` и Telegram numeric ID; прямые `SELECT` grants на
`users`/`telegram_identities`, новые RLS policies и таблицы admission не нужны.

На дату read-only inventory production ledger содержит 19 записей; перед этой
migration в Git есть ещё пять отсутствующих в production migration. Из-за
известного drift нельзя применять «последнюю migration» отдельно или считать
этот список доказательством совместимости. Оператор должен сначала повторно
сверить exact production ledger и объекты, затем review/apply возможные pending
migrations строго в repository order:

1. `20260924090000_completed_onboarding_active_travel_intent_invariant.sql` —
   обновляет onboarding/TravelIntent capability.
2. `20260924100000_session_lifecycle_baseline.sql` — добавляет canonical
   шестипараметрический login capability и сохраняет legacy overload для
   overlap compatibility.
3. `20260924110000_backend_field_domain_limits.sql` — проверяет legacy blank
   values и завершится ошибкой, если найдёт их; не backfill-ить автоматически.
4. `20261003090000_chat_participant_public_profile.sql` — добавляет capability
   чтения профиля участника Chat.
5. `20261018090000_server_side_tester_admission_session_identity.sql` — добавляет
   versioned Bearer resolver после появления базовых identity/session objects.

Это dependency order, а не разрешение на production DDL. Перед любым apply
нужны отдельное explicit operator approval, успешный backup/preflight по
[backup/restore runbook](backup-restore-runbook.md), review каждой pending
migration и решение по возможным legacy data blockers. Не редактировать ledger,
не пропускать migration и не переносить только пятую migration поверх drift.

После отдельно разрешённого migration этапа выполнить approved
`grant-production-app-runtime-privileges.sql`, затем
`verify-production-app-runtime-privileges.sql` и
`production-runtime-deployment-gate.py` через подтверждённый runtime identity.
Новая функция должна иметь `SECURITY DEFINER`, фиксированный `search_path`, не
иметь `PUBLIC EXECUTE`, быть executable для `app_runtime`; `anon`,
`authenticated` и `service_role` не должны иметь effective EXECUTE. `app_runtime`
не должен получать прямой доступ к `users` или `telegram_identities`. Grant
verifier и gate должны пройти до backend deployment.

Перед ручным backend deployment оператор отдельно настраивает в защищённой
server environment Render `TELEGRAM_CORE_USER_IDS`,
`TELEGRAM_TESTER_USER_IDS` и `TELEGRAM_TESTERS_PAUSED`; все три переменные
должны быть заданы и валидируются при startup. Tester list может быть явно
пустым, чтобы закрыть доступ всем внешним тестировщикам без блокировки core.
Реальные IDs не помещать в Git,
frontend, tickets или Codex материалы. Сначала оставить testers paused, затем
deploy approved backend SHA, проверить core login и отказ tester/direct API,
после чего оператор отдельным config change может открыть tester cohort.
Удаление ID из списка или pause влияет только после процесса с новой
конфигурацией; Auto-Deploy Off означает, что нельзя считать изменение
мгновенным. Повторно проверить tester pause при сохранении core access,
revoke уже выданной сессии и Profile/Discover/Chats/Trips flows.

**STOP:** любой migration drift/legacy-data finding, неуспешные grants/verifier/
runtime gate, отсутствующие или ошибочные server environment settings,
неизвестная deployed revision, несовместимость с текущими backend/frontend или
недоступный проверенный rollback candidate. Provider rollback не отменяет
migrations. Никакая production migration, environment change или deployment
этим кодовым изменением не выполнялись.

## 3. Оценить DB/API compatibility и выбрать порядок

Для каждой migration и backend/API change определить, могут ли одновременно работать текущие и целевые backend instances на старой/новой schema, и может ли текущий frontend работать с целевым backend API (и наоборот на время переключения). Проверить SQL, migration comments, backend contracts и реальные call sites; слово «additive» само по себе не доказывает совместимость.

| Класс изменения | Предпочтительный порядок | Maintenance/quiesce и условие остановки |
|---|---|---|
| Только backend/frontend или полностью backward-compatible DB/API изменение | Deploy backend, затем frontend, если frontend требует новый API; иначе frontend/backend в порядке, проверенном совместимостью. | Обычно можно без quiesce только после подтверждения overlap compatibility и provider rollout behavior. Остановиться при несовпадении SHA или несовместимом ответе/ошибке health/smoke. |
| Additive DB migration, совместимая со старым и новым backend | DB-first: применить и проверить расширенную schema, затем deploy backend и при необходимости frontend. | Quiesce не нужен только если доказано, что миграция не ломает активные старые instances и apply не требует остановки. Любая неопределённость, lock/latency concern или недоказанная совместимость требует maintenance-плана/операторского решения до apply. |
| Breaking DB contract, API contract или grants/RLS change | Не делать одноступенчатый rollout. Сначала спроектировать expand/contract либо согласованный coordinated cutover; определить совместимые промежуточные версии и точный recovery path. | Quiesce/maintenance требуется, если старый и новый runtime не могут безопасно сосуществовать или это требует migration. Если его безопасный способ не подтверждён, rollout не начинать. Grants/RLS failure означает STOP; не ослаблять ограничения как workaround. |
| Change, требующий expand/contract | Expand schema/capability backward-compatibly → deploy backend, работающий со старым и расширенным контрактом → deploy frontend/API callers → подтвердить, что старые instances/callers больше не используют legacy contract → отдельно согласовать contract migration/removal. | Contract phase — отдельный rollout с повторным preflight и явным подтверждением. Не удалять legacy overload/column/policy в том же шаге, что впервые переключает callers, если coexistence не доказана. |

**DB-first или backend-first не является постоянным правилом.** DB-first допустим лишь для проверенной additive/backward-compatible миграции. Backend-first допустим только если target backend работает на текущей production schema и rollout не направит requests на несовместимую смешанную версию. API и frontend sequencing определяется проверенным контрактом и фактическим переключением instances.

## 4. Выполнить ручной rollout

1. Непосредственно перед изменением production оператор повторно подтверждает target service/environment, Git SHA, schema/grants preconditions, порядок из decision matrix, Auto-Deploy Off и необходимость quiesce. Это отдельный approval gate; наличие этого runbook или прохождение CI не является разрешением.
2. Если требуется quiesce, применить заранее проверенный оператором механизм и подтвердить прекращение соответствующего traffic до DB/API несовместимого шага. Runbook не выдумывает provider-specific maintenance command.
3. Применить только согласованные migrations/grants в выбранном порядке по отдельной проверенной инструкции для конкретного изменения. Для migration apply сверить точный pending suffix до применения. Не использовать исторические one-off команды как общий шаблон.
4. Ручным provider механизмом развернуть backend SHA и затем frontend SHA в порядке, установленном выше. Подтвердить фактически deployed SHA после каждого service rollout. Не менять secrets, DATABASE_URL, network rules, providers или Auto-Deploy как часть этого шага без отдельного scoped approval.
5. Проверить readiness/smoke. Traffic восстанавливать только после выполнения критериев ниже.

Подтверждены Render Dashboard actions для ручного deployment exact SHA и Render
Environment; сами project settings, user permissions, Vercel deployment path,
target URLs и production env values не подтверждены в репозитории и должны быть
сверены оператором для выбранного проекта перед фактическим rollout. Не
угадывать target или Vercel sequence.

### Порядок именно для текущего pending suffix

Эта последовательность применима только после снятия всех BLOCKED gates из §2.
Каждый шаг — отдельная production operation с собственным approval; этот
документ не даёт такого approval.

1. Зафиксировать release record: target backend SHA
   `2183708cb86d965cb395f1d6855b4ee038851abc`, CI/review status,
   production project/ref, current ledger, Render live SHA, Vercel live SHA и
   frontend API-origin compatibility. Сейчас Vercel SHA и origin `UNKNOWN`, так
   что начинать rollout нельзя.
2. Создать запланированную дополнительную production backup по [№21](backup-restore-runbook.md),
   проверить archive/manifest checksum и доступность зашифрованной offsite copy;
   не считать старый backup достаточным автоматически. Подтвердить последний
   isolated restore evidence и отсутствие неизвестных targeted schema/ACL/
   extension findings. Затем выполнить pinned CLI dry-run из предыдущего раздела;
   ожидаются ровно пять versioned migrations в repository order.
3. Отдельно получить разрешение на DB apply. Убедиться, что CLI `2.114.0`,
   `lock_timeout=5s` и `statement_timeout=120s` заданы в URI для migration
   connection. До dry-run выполнить read-only проверку того же DSN по процедуре
   выше: `current_user=session_user=postgres`, PostgreSQL 17, `lock_timeout=5s`,
   `statement_timeout=120s`. Затем передать неизменённое значение только через
   явный `--db-url` в pinned CLI. Источники подтверждают этот путь для migration
   connection; если требуется прямая runtime attestation из её физической
   сессии — **STOP до apply**, поскольку CLI не предоставляет pre-migration SQL
   hook.
   Оператор принимает короткое техническое окно и возможные временные API errors;
   Maintenance Mode/Suspend не включать в этот план.
4. Применить только согласованный pending suffix через Supabase migration
   workflow. Зафиксировать вывод по каждой migration; после завершения проверить
   полный ledger, объекты/constraints и отсутствие unexpected partial state.
   При первой ошибке не запускать повторно и не восстанавливать ledger вручную.
5. Отдельно получить approval на ACL изменения, применить runtime grant script,
   затем выполнить production privilege verifier и runtime deployment gate.
   Проверить effective API-role denial для всех трёх функций. До каждого PASS
   backend не deploy-ить.
6. В закрытой Render Environment установить/сверить server-side admission:
   все три variables заданы и валидны, tester cohort paused (`true`). Не
   включать testers. Для планового cutover выбрать **Save only**, затем сразу
   выполнить точный manual deploy approved SHA из следующего шага: saved values
   попадут в этот deploy, но не перезапустят старый backend отдельно. До
   завершения target deploy считать новую policy неактивной. Проверить names и
   допустимость значений privately, не раскрывать IDs. Изменение настроек
   требует отдельного approval.
7. В Render Dashboard открыть ровно service `travel-friend-api` → Deploys →
   Manual Deploy → **Deploy a specific commit**, ввести approved full SHA и
   подтвердить запуск. Для этого плана approved full SHA —
   `2183708cb86d965cb395f1d6855b4ee038851abc`; перед нажатием сверить его с
   release approval. Не выбирать `Deploy latest commit`. Auto-Deploy оставить
   Off. После завершения проверить, что фактический live SHA точно совпал,
   deployment status успешен и logs не показывают ошибки.
   Render Dashboard при specific-commit deployment отключает auto-deploy, но
   оператор всё равно повторно проверяет `Off` в Settings.
8. Выполнить `/health` и `/ready` smoke по exact Render origin, затем
   permission-approved admission smoke: core login allowed, tester и unknown
   identity denied при tester pause, direct Render API не обходит deny,
   core bearer продолжает работать, revoked tester bearer denied. Login может
   создавать session/user state; использовать только согласованные test
   accounts, заранее определить судьбу synthetic/test rows. Если это
   невозможно, не заявлять эти сценарии verified и держать external testing STOP.
9. Если target Vercel SHA отличается, deploy только после доказанной
   frontend/backend compatibility через отдельно подтверждённый Vercel
   production workflow и exact SHA. Сейчас этот workflow/revision неизвестны;
   не выполнять guessed CLI/UI sequence и не менять `BACKEND_API_ORIGIN` без
   отдельного scope/approval.
10. Проверить Render logs, Vercel runtime/deployment, readiness, direct API и
    согласованные core flows; зафиксировать post-deploy SHA, timestamps, ledger,
    grants/verifier, tester pause и residual risks. External testing остаётся
    STOP до отдельного go/no-go решения и полной ручной E2E.

Обычный Render deployment заявлен provider-ом zero-downtime для service без
persistent disk, но конкретная текущая конфигурация и provider execution не
проверялись; это не гарантия для данного rollout. Изменение DB schema само по
себе не откатывается при failed deploy. Подробности [Render deploy flow](https://render.com/docs/deploys).

## 5. Smoke и критерии остановки

### Автоматический read-only HTTP smoke

Перед запуском оператор должен:

1. Убедиться, что deployment завершён для подтверждённого backend service/environment, а его фактически deployed SHA совпадает с approved SHA.
2. Проверить CI/review, Auto-Deploy Off и все применимые к изменению migration, schema, grants и runtime gates из разделов выше.
3. Независимо подтвердить backend base URL выбранного target. Не брать URL из непроверенного deployment output и не сохранять секретные значения в команде или отчёте.
4. Запустить из корня репозитория, подставив только подтверждённый backend base URL:

   ```sh
   cd apps/backend
   uv run --group dev python scripts/deployment_smoke.py --base-url "$CONFIRMED_BACKEND_BASE_URL"
   ```

`deployment_smoke.py` последовательно выполняет только `GET /health` и `GET /ready`, с timeout 5 секунд на каждый запрос и без перехода по redirects. Ожидаются HTTP 200 и точные тела `{"status":"ok"}` и `{"status":"ready"}`; при успехе команда завершается с кодом 0. Любая ошибка соединения/timeout, redirect, иной HTTP status или тело ответа даёт `FAIL` и non-zero exit code; цепочка останавливается на первой ошибке. Запросы не создают и не меняют пользовательские данные.

`/health` подтверждает только liveness процесса. `/ready` подтверждает доступность минимальной DB dependency через `SELECT 1`; этот smoke не проверяет deployed schema parity, grants/RLS, Telegram authentication или бизнес-сценарии. Schema/grants проверяются отдельными verifier-ами; HTTP health их не заменяет.

**STOP:** не запускать smoke при неподтверждённых target/base URL/SHA или незавершённых обязательных preflight gates. При любом non-zero результате, неожиданном redirect/ответе или transport error остановить rollout, оставить traffic quiesced, если он был quiesced, и расследовать причину. Не продолжать traffic restore до успешных обязательных проверок.

### Ручной Telegram E2E

Полный сценарий Telegram Auth → Profile/TravelIntent → Discover/Match → Chat/Messages → Trips остаётся отдельной ручной проверкой. Его выполняют только по отдельно согласованному сценарию, с разрешённым test account и определёнными правилами тестовых данных. Автоматический read-only smoke не аутентифицируется, не создаёт пользователей/сообщения/чаты/поездки и не заменяет Telegram E2E.

Зафиксировать observed SHA, migration version, результаты verifier/gate, HTTP smoke и решение о traffic restore в operator deployment record. Provenance самого deployment относится к №16.

Немедленно остановиться и оставить traffic quiesced, если target SHA не совпал, migration history/schema/grants не соответствуют плану, любой verifier/gate/health/readiness/smoke падает, появляются неожиданные ошибки или выясняется, что старая и новая версии несовместимы. Не переключать сервис обратно на старый backend после breaking DB/API/grants change без доказанной совместимости; использовать отдельно согласованный rollback/forward-fix procedure задачи №22. Если миграция изменила данные/схему, допустимость восстановления зависит от заранее проверенного backup/restore плана №21. Не импровизировать с ручным SQL, `migration repair`, credential changes или provider settings.

## 6. Recovery после неудачного deployment или DB change (№22)

Этот раздел готовит operator procedure, но сам не выполняет и не разрешает
production action. Перед rollback, traffic isolation, migration или restore
оператор получает отдельное явное подтверждение на выбранное действие.

### 6.1 Общий recovery preflight

Сначала зафиксировать время инцидента (UTC), симптомы, затронутые компоненты,
последний успешный и текущий deployment IDs/SHA, фактические migration records,
выполненные operator actions и результаты проверок. Не помещать в запись
credentials, пользовательские сообщения или PII.

Перед любым действием независимо сверить target в provider dashboard:

- Vercel project `travel-friend-mini-app`, Production environment и домен,
  фактически назначенный production deployment;
- Render service `travel-friend-api`, ветку `develop`, текущий и целевой deploy
  SHA; Auto-Deploy должен оставаться Off;
- при DB-проверке — Supabase project `travel-friend-dev`
  (`tlgprfsecdasloqnuyjo`) и ожидаемую базу `postgres`.

Имена подтверждены, но точные provider IDs, production URLs, history/retention
доступных deploys, frontend automation и доступные operator permissions в Git не
зафиксированы. Сверить их в provider UI для конкретного инцидента; при
неоднозначности — **STOP**. Не считать rollback приложения возвратом DB schema,
DB data, secrets, environment variables, domains или provider configuration.
Известный migration drift production↔Git остаётся отдельным риском задачи №16;
rollback приложения или новый forward-fix сам по себе этот drift не разрешает.

### Emergency stop controls

Применять только в incident/по отдельному разрешению и после проверки exact
provider target. Во время подготовки rollout эти действия не выполнялись.

**A. Закрыть только tester cohort.** В Render Dashboard открыть подтверждённый
`travel-friend-api` → Environment → проверить exact service → установить
`TELEGRAM_TESTERS_PAUSED=true`, не менять core IDs/list. Выбрать **Save and
deploy**, дождаться завершения deploy и проверить, что новый процесс использует
tester pause: tester login и существующий tester bearer к прямому Render origin
получают отказ, core account/token остаётся разрешён. Повторить проверку через
Vercel origin только если он точно подтверждён. До подтверждения нового runtime
считать старую admission policy активной. Реакция требует запуска новой версии
процесса; точная задержка для этого service не измерена, поэтому фиксированного
времени срабатывания нет. Render различает `Save and deploy` и `Save only`:
последнее не применяет значения до следующего deploy ([Environment Variables](https://render.com/docs/configure-environment-variables)).

**B. Остановить весь backend.** В Render Dashboard подтвердить workspace,
service name `travel-friend-api`, live deployment и `onrender.com` target;
только после explicit incident approval использовать доступное на service
действие **Suspend**. Не использовать API/service ID из старых заметок или
неподтверждённый CLI. Проверить в Dashboard, что service перешёл в suspended
state, затем независимо проверить public backend `/health`/`/ready` с
подтверждённого origin: обслуживание должно прекратиться (ошибка соединения или
provider error ожидаемы). Render API документирует ответ `202 accepted`, а не
время фактической сетевой блокировки; propagation time для конкретного target
не подтверждён, поэтому продолжать считать API доступным до проверки эффекта
([Render suspend API](https://api-docs.render.com/reference/suspend-service-1)).
Чтобы восстановить, снова подтвердить тот же service и использовать доступное
в Dashboard **Resume** действие; дождаться active/healthy state, проверить
фактический SHA, `/health`, `/ready`, logs и только затем согласованные flows.
Точный resume latency для этого service неизвестен. Не подменять suspend
изменением Supabase.

**C. Остановить Mini App через Vercel, если нужно.** В Vercel Dashboard
подтвердить team и project `travel-friend-mini-app` → Settings → General →
Pause Project; прочитать impact и подтвердить project name перед действием.
Проверить, что production alias отдаёт `503 DEPLOYMENT_PAUSED`. Resume: тот же
project → Settings → General → Resume Project; Vercel сообщает, что production
service возобновляется в течение нескольких минут. Pause Vercel не блокирует
прямой public Render origin, поэтому это не полный service stop.
[Official Vercel project pause/resume procedure](https://vercel.com/docs/projects/managing-projects).

Render suspend и Vercel pause не удаляют DB и не отменяют уже accrued usage,
workspace/team fees, build/pipeline usage, оплачиваемые add-ons или расходы
других ресурсов. До и после stop проверить фактические billing/usage pages,
payment method, spend limits/alerts и pause controls; не считать alert hard cap
и не менять plan. Практическая карта billing и расходов —
[FinOps guardrails](../finops-external-test-guardrails.md). Неподтверждённое
действие, цель, доступ оператора, состояние billing или проверка остановки —
**STOP**, не выполнять действие вслепую.

«Известная рабочая версия» — это конкретный успешный deployment, для которого
можно независимо подтвердить deployment ID, полный Git SHA и соответствующую
DB/API compatibility. Последний по времени deploy сам по себе не является
известным рабочим. Проверить, что SHA доступен в repository и deployment history,
а настройки/окружение target остаются ожидаемыми. Не создавать платный plan и не
менять provider settings, чтобы расширить доступную историю rollback.

Применимость и ограничения механизмов сверены с официальной документацией:
[Vercel production rollback](https://vercel.com/docs/deployments/rollback-production-deployment),
[Vercel rollback CLI](https://vercel.com/docs/cli/rollback) и
[Render rollback](https://render.com/docs/rollbacks). Их наличие не подтверждает
настройки или разрешения конкретного project/service. Для Mini App автоматической
проверки основных UI flows в репозитории нет; существующий
[`deployment_smoke.py`](../../apps/backend/scripts/deployment_smoke.py) проверяет
только backend HTTP health/readiness.

Rollback Vercel/Render возвращает deployment artifact или переключает traffic на
другой artifact и в общем случае повторяем как provider operation, но не откатывает
DB schema/data, migration ledger, environment variables или secrets. DB DDL и
изменения данных считать необратимыми, пока обратимость конкретной операции не
доказана. Forward-fix предпочтительнее слепого reverse SQL; restore может удалить
корректные более новые данные и всегда требует отдельного решения.

### A. Неудачный frontend deployment (Vercel)

**Признаки:** production build/deployment завершился ошибкой; Mini App не
открывается или отдает явную ошибку; после нового frontend SHA нарушился ранее
работавший flow при здоровом backend.

1. В Vercel проверить правильные project, Production environment/domain, failed
   deployment ID/SHA, build/runtime logs и назначенный сейчас production
   deployment. Уточнить, затронут только frontend ли это: проверить backend
   `/health` и `/ready` по независимо подтверждённому base URL.
2. Найти предыдущий успешный production deployment. Сверить его полный SHA,
   frontend API contract и build-time environment requirements с текущим backend.
   Rollback UI/routing может вернуть только frontend artifact; он не возвращает
   environment variables или backend deployment.
3. Если кандидат доступен текущему плану/проекту и совместим с текущим backend,
   оператор отдельно подтверждает rollback и выполняет его через Vercel
   deployment UI/доступный аккаунту механизм. Vercel ограничивает rollback
   доступной deployment history и plan; если предыдущий подходящий deployment
   недоступен без upgrade — **STOP**, не менять тариф. Не выполнять guessed CLI
   command или выбирать deployment только по времени.
4. Дождаться завершения и проверить, что production domain назначен ожидаемому
   deployment ID/SHA. Убедиться, что environment/configuration не менялись.
5. Проверить загрузку Mini App, доступность статических ресурсов и вызовы
   backend. Запустить backend read-only smoke из §5. Telegram Auth/профиль и
   основные пользовательские flows проверять только вручную с разрешённой
   тестовой учётной записью; auth и часть flow создают/изменяют DB state, поэтому
   без отдельного разрешения и согласованных тестовых данных их не выполнять.

**Успех:** ожидаемый frontend deployment активен, Mini App открывается, backend
health/readiness проходят, разрешённые проверки интерфейса проходят и нет новых
связанных ошибок. **STOP:** нет точного известного рабочего deployment; frontend
SHA не совместим с текущим backend; rollback entitlement/history не позволяет
выбрать target; domain/environment изменились; smoke/UI проверка не проходит.
При неуспехе не переключаться вслепую на другой deployment; сохранить состояние
и подготовить reviewed fix/forward deployment.

### B. Неудачный backend deployment (Render)

**Признаки:** deploy failed/canceled, экземпляр не становится healthy, `/health`
или `/ready` падает после rollout, либо коррелированные ошибки показывают
несовместимость backend/API.

1. В Render подтвердить `travel-friend-api`, production service, branch `develop`,
   фактический deploy SHA/status и logs. Сверить `/health` и `/ready` с exact
   operator-confirmed backend URL. Не менять `DATABASE_URL`, secrets или service
   configuration для «починки» rollback.
2. До выбора старой версии установить, менялась ли production DB, migration
   ledger, grants/RLS, functions или API contract после версии-кандидата.
   Сопоставить конкретные call sites старого backend с текущими tables, columns,
   functions, policies и grants. Проверить migration SQL и runtime verifier/gate
   по применимости. Совместимость не выводить только из того, что миграция
   называлась additive.
3. Если DB contract не менялся либо доказана обратная совместимость текущей DB
   со старым SHA, выбрать exact ранее успешный Render deployment/SHA из history.
   Render Dashboard предоставляет rollback к предыдущему успешному deploy; также
   допускается manual deploy конкретного commit, если target SHA и deployment
   method подтверждены в текущем service. Отдельно подтвердить действие, затем
   проверить фактический active SHA. Auto-Deploy оставить Off.
4. После возврата запустить `deployment_smoke.py` по подтверждённому backend
   origin. При успехе проверить только согласованные основные flows с разрешённой
   тестовой учётной записью; smoke не доказывает schema parity и Telegram
   business-flow correctness.

Пользовательский checklist для разрешённой ручной проверки: запуск Mini App и
Telegram Auth → Profile/TravelIntent → Discover → Chats/Messages → Trips
List/Detail. Auth создаёт session state; interest decisions, сообщения и создание
Trip меняют production data. Их выполнять только при наличии отдельно
разрешённой тестовой учётной записи и согласованного порядка очистки/сохранения
test data; иначе ограничиться запуском и read-only экранами и отметить write flows
как непроверенные.

**Успех:** Render показывает ожидаемый known-good SHA, `/health`=`ok`,
`/ready`=`ready`, применимые verifier checks проходят; разрешённые flow checks
успешны. **STOP:** текущая DB schema/grants появились после rollback target и
совместимость не доказана; migration ledger неясен; нужных deploy artifacts/SHA
нет; readiness/verifier падает. В этом случае оставить deployment как есть или
остановить traffic только подтверждённым способом и перейти к forward-fix
разбору; не применять обратные миграции.

### C. Неудачная database migration

**Признаки:** migration command завершился ошибкой, появился неизвестный
ledger/schema state, verifier/grants gate не проходит, либо backend после DB
change видит отсутствующие объекты/ошибки запросов.

1. **STOP: автоматический rollback migrations запрещён.** Не запускать reverse
   SQL, `db reset`, `migration repair`, ручные правки `supabase_migrations` или
   повторный blind `db push`. Не предполагать, что весь batch был атомарным:
   установить фактический результат и транзакционные границы конкретной
   migration по логам и read-only состоянию.
2. Подтвердить project/database identity и ограничить дальнейшие deployment и
   DB changes. Способ остановки/изоляции traffic для текущего Render service
   отдельно не подтверждён; использовать его только если оператор заранее
   проверил способ и дал отдельное разрешение. Сохранить sanitized logs и exact
   failed migration version.
3. Read-only проверками определить: какие migration records записаны; какие
   ожидаемые tables/columns/functions/policies/grants присутствуют; затронуты ли
   data или только schema; работают ли текущий и target backend с этим состоянием.
   При migration drift, частично применённой migration или неизвестных data
   effects — **STOP** и эскалировать review.
4. Проверить применимый verified backup по [№21](backup-restore-runbook.md), его
   timestamp/data window, checksum и проверенный локальный restore путь. Это
   входные данные оценки, а не разрешение на production restore. Full Supabase
   recovery и production ACL не подтверждены; production restore автоматически
   не выполнять.
5. Подготовить минимальный новый forward-fix migration на отдельной reviewed
   revision. Воспроизвести состояние и fix только в disposable PostgreSQL;
   проверить migration order, повторное чтение из исходной/target schema,
   `app_runtime` grants verifier и backend tests. Не менять уже применённый SQL
   migration и не редактировать production ledger для прохождения проверки.
6. До production apply получить отдельное разрешение на точный migration SHA,
   target, SQL scope, backup decision и maintenance plan. Применять только по
   проверенной для данного change инструкции из §1–4; после — сверить migration
   history, schema/grants verifier, `/health`, `/ready` и разрешённые flow checks.

**Успех:** согласованный forward-fix завершён без неожиданных schema/data
effects, ledger соответствует фактическому применению, verifier/gate и smoke
проходят, operator record содержит итог и residual risks. **STOP:** невозможно
доказать target, состояние миграции или совместимость; fix требует неутверждённых
DDL/grants, данных, credentials/provider changes; или требуется automatic
rollback/production restore. Если forward-fix не проходит, не импровизировать
следующий SQL: оставить изменения и traffic в безопасном подтверждённом состоянии
и запросить отдельный recovery decision.

### D. Потенциальное повреждение данных

**Признаки:** некорректные/пропавшие записи, неожиданный массовый update/delete,
нарушенные инварианты, несоответствие данных в пользовательских flows или
инцидентная метрика/жалоба.

1. Немедленно прекратить новые deployment и DB changes. Оценить, продолжают ли
   приложение или job писать данные. Quiesce/maintenance механизм не
   подтверждён в проектной конфигурации: не изобретать toggle или команду;
   применить только заранее проверенный оператором способ с отдельным
   разрешением. Не останавливать service способом, последствия которого
   неизвестны.
2. Сохранить временной интервал, affected tables/операции, deployment/migration
   SHA и sanitized logs. Оценить масштаб и границу данных только безопасными
   read-only средствами; не собирать PII в incident report и не выполнять
   корректирующие SQL-записи наугад.
3. Сравнить предполагаемый affected window с verified backup/offsite copy и
   текущей политикой №21. Еженедельная копия не гарантирует отсутствие потери
   данных за прошедший интервал; точное сравнение counts без общего snapshot не
   является доказательством. Проверить отдельно зависимости схемы, runtime
   grants и production ACL; последние не полностью проверены.
4. Предпочесть минимальный reviewed forward-fix/repair, если он безопасно
   восстанавливает инварианты без потери корректных новых данных. Если обсуждается
   restore, сначала потребовать отдельный анализ data loss, проверенный restore
   на disposable target и явное отдельное утверждение recovery procedure.
   **Автоматический production restore запрещён.** Ни backup runner, ни local
   restore smoke не выполняют его.

**Успех:** scope инцидента установлен; согласованная repair/recovery операция
завершена; integrity/constraints, migration ledger, runtime grants/verifier,
health/readiness и разрешённые flows проверены; остаточная потеря и риски
зафиксированы. **STOP:** scope неясен, есть продолжающиеся writes без безопасного
quiesce, backup может перезаписать корректные данные, отсутствует разрешение или
не доказана возможность восстановления. Не выполнять production restore для
«проверки».

### Post-recovery record и обязательные проверки

После любого recovery записать incident UTC time, environment/target, исходный и
итоговый deployment IDs/SHA, migration records, действия/подтверждения,
результаты `/health`, `/ready`, применимых schema/grants checks и разрешённых
flow checks, а также UNKNOWN/BLOCKED items. Не отмечать recovery успешным, если
обязательная для изменения проверка не выполнялась; указать, почему.

Общий **STOP** действует при любой неопределённости target, известной рабочей
версии, backend/DB compatibility или data effects; при необходимости платного
upgrade; при запросе provider/secrets changes; либо если действие необратимо и
для него нет отдельного разрешения и проверенной процедуры.

## Связанные задачи

- **№16 — provenance/environments:** фиксирует/автоматизирует доказательство environment, commit/deployed SHA и schema parity; этот runbook требует сверять их вручную.
- **№17 — deployment smoke:** read-only HTTP chain `/health` → `/ready` документирован в этом разделе и реализован скриптом `apps/backend/scripts/deployment_smoke.py`; Telegram E2E остаётся ручным.
- **№21 — backup/restore:** MVP backup policy, production archive/encrypted offsite copy и локальный schema/data + application-grants restore smoke зафиксированы в [backup/restore runbook](backup-restore-runbook.md). Full Supabase recovery и production ACL не подтверждены.
- **№22 — rollback/forward-fix:** operator procedure описана в этом документе, §6. Она не является автоматизацией или разрешением на production action; старый backend не считается допустимым rollback target без проверки compatibility с текущей DB.

Завершение №15 как docs-ready не закрывает №16, №17 или №21, не подтверждает текущие provider settings и не означает, что следующий production deployment уже одобрен. №22 описывает процедуру, но не подтверждает, что реальные rollback или recovery уже выполнялись.
