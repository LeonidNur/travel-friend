# Backup / restore — audit, local validation and operator plan

**Статус: LOCAL RESTORE VERIFIED (2026-10-18). Production backup/restore
остаётся AUDIT/PLAN.** В локальном Docker smoke `pg_dump` создал custom archive,
`pg_restore` восстановил его в отдельную disposable DB, сравнение public schema
и проверка synthetic control data прошли, cleanup завершился успешно; exit code
был 0. Оператор подтвердил, что восстановимого production backup нет.
Production-процедура ниже не запускалась и не является разрешением на production
DB operation.

## Подтверждённые факты и текущие границы

- Оператор проверил Supabase Dashboard 18.10.2026: проект на Free Plan,
  scheduled backups недоступны, Point-in-Time Recovery недоступен и требует
  платного дополнения к Pro.
- Оператор подтвердил, что восстановимого backup сейчас нет. Для MVP выбран
  ручной logical backup с внешним хранением и проверкой restore на отдельной
  disposable БД. Production-подход не реализован и не проверен.
- Migrations в `supabase/migrations/` позволяют заново создать версионируемые объекты
  схемы — таблицы, constraints, indexes, functions, triggers и RLS policies.
  Найденные в них прикладные `INSERT`/`UPDATE` находятся в телах функций и
  исполняются при вызовах приложения; это не экспорт текущих данных или seed
  snapshot.
- Migrations не восстанавливают текущие application rows: учётные записи и
  Telegram identities, profiles, settings, sessions, travel intents,
  decisions/matches, chats/messages, trips и связанные записи. Содержимое
  файлов/объектов за пределами PostgreSQL также требует отдельного backup;
  `profile_photos.storage_key` хранит ссылку/ключ, а не файл.
- `local-test-db.sh` управляет только локальным disposable PostgreSQL и его
  destructive `reset` пересоздаёт схему. `local-db-backup-restore-smoke.sh`
  прошёл фактический локальный Docker запуск с `pg_dump`/`pg_restore` и
  synthetic контрольными данными.
  Production `app_runtime` provisioning/grants scripts, read-only verifier и
  runtime deployment gate решают задачи ролей и security checks, а не сохраняют
  данные. CI запускает local test workflow и cleanup; production backup/restore
  tooling в репозитории не найдено.
- Supabase CLI export ниже создаёт раздельные schema, data и roles SQL files.
  CLI исключает Supabase-managed schemas (в частности `auth`, `storage` и
  schemas расширений) и reserved roles; этот export не является образом всего
  Supabase project. Обычный schema/data dump не включает cluster globals,
  project settings/secrets или Storage objects.
- Logical dump будет содержать персональные данные и содержимое сообщений и
  должен обрабатываться как чувствительная пользовательская информация.

## Production dependency audit и минимальный scope

Аудит выполнен по backend/frontend source, contracts, migrations, runtime-role
scripts и документации; production preflight facts ниже предоставлены оператором.
К production в рамках этого аудита не подключались. Репозиторий подтверждает
зависимости приложения, но не фактическое содержимое production schemas.

| Компонент | Используется текущим MVP | Подтверждение | Нужен в backup | Восстановление из Git | Что неизвестно |
|---|---|---|---|---|---|
| `public` tables и строки | Да: `users`, `telegram_identities`, `user_settings` и остальные активные данные используются backend напрямую или capability functions. `profile_photos` и `chat_summaries` есть в схеме, но security docs указывают, что MVP их не использует. | `docs/database-schema.md`; `apps/backend/src/travel_friend_backend/{auth/service.py,routers/me.py,routers/discover.py,routers/chats.py,routers/trips.py}`; `docs/backend/security.md`; operator preflight подтвердил 17 таблиц, RLS и ownership `postgres`. | Да: schema и все строки всех 17 таблиц, включая dormant tables, пока production inventory не докажет иное. | DDL — из `supabase/migrations/`; текущие строки не восстанавливаются из Git. | Фактические row counts, полнота чтения и согласованность снимка не перепроверялись в этом аудите. |
| Functions, triggers, constraints, indexes | Да: auth/session bootstrap, projections, onboarding, Discover, chat/message и trip capabilities; триггеры поддерживают chat invariants. | `auth/service.py`; backend routers; `supabase/migrations/20260901130000_chat_persistence.sql`; остальные migrations. | Да: все требуемые application definitions и их зависимости. | Определения находятся в migrations; применение и соответствие production должны быть проверены отдельно. | Полный production catalog drift и все runtime dependencies не подтверждены. |
| RLS policies, grants, ownership | Да: RLS и точные права — часть runtime security boundary. | `docs/backend/security.md`; migrations; `apps/backend/scripts/grant-production-app-runtime-privileges.sql`; supplied preflight: RLS на 17/17, `app_runtime` без BYPASSRLS, `postgres` владеет таблицами и имеет SELECT. | Да: сохранить policies, ownership/grants и минимальные role attributes как отдельную recovery dependency. | Policies и часть grants есть в migrations; role provisioning/grants scripts в Git. Реальные пароли, membership, owners и полное ACL состояние нельзя считать восстановленными из Git. | Preflight не устанавливал полный grants/ownership catalog вне 17 таблиц или безопасный restore всех ролей. |
| PostgreSQL roles | Да: backend подключается как `app_runtime`; operator backup identity — `postgres`. | `db.py`, `config.py`; production role scripts; supplied preflight. | Зафиксировать необходимые custom role definitions, attributes, memberships и grants. Пароли хранить/выпускать отдельно через approved secret store. | Частично: provisioning/grants scripts описывают `app_runtime`; production role state и credentials из Git не восстанавливаются. | Полный список custom roles, memberships, role passwords и права CLI role export неизвестны. Supabase reserved roles не следует считать переносимыми. |
| Extensions / PostgreSQL version | Явных `CREATE EXTENSION` / `ALTER EXTENSION` в app migrations не найдено; PostgreSQL runtime — зависимость. | Поиск в `supabase/migrations/`; supplied preflight: PostgreSQL 17.6. | Включить inventory имён/версий и нужных расширений в recovery manifest; обеспечить совместимую версию на target. | Приложенческие migrations не задают extensions. | Production extension inventory и зависимости объектов на extensions не проверены. |
| Supabase Auth (`auth`) | Кодовой зависимости не найдено: MVP проверяет Telegram `initData` и хранит собственные identities/sessions в `public`. | `apps/backend/src/travel_friend_backend/auth/telegram.py`, `auth/service.py`; searches по app code/contracts/migrations; supplied preflight подтвердил наличие schema. | Не включать содержимое managed schema в app logical dump без отдельного решения. Перед исключением проверить dashboard users/providers и интеграции. | Не восстанавливается приложенческими migrations. Provider configuration и credentials отдельно от DB backup. | Фактические Auth users, provider settings и возможные ручные/внешние зависимости не инвентаризированы. |
| Supabase Storage / внешние файлы | Upload/download не реализованы в текущем MVP; `profile_photos` есть как dormant table, поле `storage_key` не доказывает наличие файлов. | `docs/backend/backend-contracts.md` (storage mechanism undecided), `docs/feature-list.md`, migration `20260826084844_core_identity.sql`; app-code search без upload/download/storage API. | Включать object backup только если инвентарь подтвердит используемые production objects. Если объекты нужны, нужен отдельный object export и mapping к `profile_photos`; SQL dump файлы не содержит. | Нет: объекты и buckets не восстанавливаются из Git migrations. | Bucket/object inventory, содержимое `profile_photos`, внешние URL/файлы и связи не проверялись. |
| Supabase Vault (`vault`) | Кодовой или migration зависимости не найдено. | Search по app code/migrations/config; supplied preflight сообщил о schema `vault`. | Не включать managed schema в обычный CLI dump. До исключения проверить, не хранятся ли там используемые проектом secrets/keys. | Не восстанавливается приложенческими migrations; секреты нельзя класть в backup artifact. | Наличие секретов, их consumers и отдельный provider recovery путь неизвестны. |
| `supabase_migrations` history | Backend не читает migration ledger; операционная история нужна для provenance/повторного применения миграций. | Search по backend code; `supabase/migrations/`; production security migration runbook предписывает не менять ledger вручную. | Сохранить зафиксированный список применённых production migration versions и соответствие Git revision; решение об отдельном history export принять до полного recovery plan. | SQL definitions восстанавливаются из Git, но фактическая production applied-history и соответствие версии из Git не гарантируются. | Полный production ledger не проверялся в этой задаче; нельзя вручную редактировать его для восстановления. |
| Остальные schemas / provider state | Приложенческой зависимости в найденных исходниках нет. | Supplied preflight сообщил о `auth`, `storage`, `supabase_migrations`, `vault` и других schemas; CLI docs/runbook описывают исключения managed schemas. | До первого backup составить inventory user-managed objects вне `public`; явно включить нужные custom schemas или записать обоснованное исключение. Provider settings, secrets и Storage objects — отдельные recovery dependencies. | Не полностью: application migrations охватывают только проектные definitions, а не hosted/provider state. | Имена, owners, объекты, данные и consumers прочих schemas неизвестны. |

### Минимальный достаточный backup для текущей application data

После разрешённого read-only preflight рекомендуемый минимум — полный логический
экспорт schema и всех строк `public` (включая все 17 таблиц), поддерживаемые
object definitions и явный inventory PostgreSQL version/extensions; отдельный
role/grant recovery record для `app_runtime` и других необходимых custom roles;
manifest с exact project/database, timestamp/window, CLI/PG versions, scope,
Git revision миграций и checksums. Roles export не доказывает переносимость
Supabase reserved roles, безопасное восстановление LOGIN passwords или полный
provider state. Секреты и connection credentials в dump/manifest не помещать.

Считать этот набор достаточным для приложения можно только после разрешения
открытых проверок по non-public schemas, Storage buckets/objects, Vault usage,
Auth configuration/users, migration ledger и extensions. Если inventory находит
нужные файлы или custom objects вне `public`, scope расширяется отдельной
зашифрованной копией и проверенным restore шагом до запуска backup. Нельзя
объявлять обычные Supabase CLI schema/data/roles exports полным backup проекта.

Recovery также зависит от доступного `supabase/migrations/` revision,
совместимого PostgreSQL/extension environment, отдельно восстановленных role
attributes/grants и выданного runtime credential, Telegram bot secret и
provider configuration, защищённого age recovery identity, внешнего зашифрованного
backup storage, а при подтверждённой необходимости — Storage objects и Auth/Vault
provider state. Эти конфигурационные secrets не должны попадать в SQL artifacts.

## Уже существующие процедуры и инструменты

- Version-controlled Supabase migrations восстанавливают schema structure,
  application functions и RLS policies, но не application rows.
- `apps/backend/scripts/local-test-db.sh` создаёт, reset-ит и останавливает
  локальный disposable PostgreSQL; `reset` уничтожает прежнее содержимое этой
  тестовой схемы. Это средство интеграционных тестов, не источник backup.
- Production `app_runtime` provisioning/grants scripts и read-only verifier / a
  runtime deployment gate подтверждают role/grants security state. Они не
  создают backup и не выполняют restore.
- Production deployment runbook упоминает №21 как recovery prerequisite, но
  backup/restore команды и storage/retention procedure там не определены.
- Production backup/restore scripts, CI steps или существующий recoverable
  artifact в репозитории не обнаружены. Локальный smoke не создаёт сохраняемый
  production backup и не интегрирован в CI.

## Проверки, которых пока нет

- Не получены или не сверены полнота `pg_dump` для всех application rows,
  identity read coverage и поведение RLS на подтверждённом production target.
- Не выбраны и не проверены внешнее зашифрованное хранилище, ограничение доступа,
  retention и независимая проверка checksum после переноса.
- Нет утверждённого manifest с версией source schema, backup scope и
  consistency/row-count evidence.
- Локальный smoke подтвердил restore только в disposable PostgreSQL текущего
  запуска; он не проверяет production backup completeness, внешнее хранение,
  ownership/privileges, application data или provider state.
- Нет инвентаря всех object owners/ACL и проверенного способа воспроизвести их
  вместе с ролью `app_runtime` без production credentials.
- Нет production restore verifier, подтверждённой полноты backup данных или
  измерения RPO/RTO. Supabase-managed schemas, Storage objects и прочее
  provider-level state не инвентаризированы для восстановления.

## Локальная проверка `pg_dump` / `pg_restore`

Из `apps/backend` оператор запускает:

```sh
./scripts/local-db-backup-restore-smoke.sh
```

Сценарий принимает только фиксированный локальный контейнер
`travel-friend-test-postgres`, для которого существующий `local-test-db.sh`
проверяет точное имя, disposable label, ожидаемые DB/user settings и loopback
binding. Он не принимает URL/имя target из аргументов; если заданы `DATABASE_URL`,
`TEST_DATABASE_URL`, `SUPABASE_DB_URL` или `PRODUCTION_RUNTIME_DATABASE_URL`,
сценарий прекращает работу до обращения к Docker. Source — `travel_friend_test`,
restore target — отдельная `travel_friend_backup_restore_test`. Если target уже
существует или не удалось проверить его отсутствие, сценарий останавливается до
reset source и ничего не перезаписывает.

После preflight сценарий пересоздаёт только выделенную локальную source DB через
существующий guarded `local-test-db.sh reset`, добавляет одну синтетическую
control table/row, создаёт custom-format `pg_dump` только для `public` во
временной директории с `umask 077`, проверяет archive через `pg_restore --list`,
создаёт отсутствующий target и восстанавливает archive без `--clean`. Проверка
сравнивает только `public` schema в normalized schema-only dump обеих БД; для
сравнения используются `--no-owner --no-privileges`, поэтому ownership и
privileges/ACL этой проверкой не сравниваются. Отдельная data assertion проверяет
только synthetic control table/row, а не application records. Любая ошибка или
несовпадение даёт non-zero exit code. При успешном `createdb` сценарий удаляет
созданный им restore target при завершении, временный backup-файл и повторно
reset-ит выделенную source DB. Если `createdb` вернул ошибку, результат считается
неопределённым: команда могла создать DB до ошибки ответа. Smoke останавливается,
не запускает restore и не удаляет target автоматически; оператор должен вручную
проверить существование и принадлежность `travel_friend_backup_restore_test`
перед повторным запуском. При прерывании процесса или сбое cleanup оператор
должен проверить только эту disposable локальную среду; неизвестный target
вручную не удалять.

PostgreSQL 17 добавляет в schema-only output случайные служебные строки
`\restrict <key>` и `\unrestrict <key>`. Smoke удаляет только строки, начинающиеся
точно с этих команд, и только из временных сравнительных schema-only файлов.
Custom backup archive не меняется; всё остальное содержимое comparative dumps
сравнивается строго.

Regression tests подменяют Docker CLI stub и проверяют последовательность,
collision target, container guard отказ, ошибки команд и несовпадение
структуры/данных; сами тесты не запускают PostgreSQL. Отдельный фактический
Docker smoke от 2026-10-18 завершился с кодом 0: archive создан, restore в
отдельную disposable DB выполнен, сравнение `public` schema и synthetic control
data прошло, cleanup завершился успешно. Это подтверждает только локальный
сценарий. Проверка не подтверждает production recovery, полноту application
data, ownership/privileges, роли, Supabase state или внешнее хранение; созданный
временный archive удалён smoke cleanup и не является сохраняемым backup.

## Подготовка и разрешение первого production backup

Любые production DB connection/query/dump требуют отдельного явного scoped
разрешения до подключения. До выдачи разрешения оператор должен выполнить
Dashboard-only проверки и утвердить план; разрешение фиксирует проект и базу,
действие «read-only logical export», identity, дату/окно, допустимую нагрузку,
scope, место хранения, срок хранения и ответственного оператора.

До разрешения на dump оператор вручную:

1. Повторно подтверждает в Supabase Dashboard текущий Free Plan, project
   `travel-friend-dev` (`tlgprfsecdasloqnuyjo`), регион/endpoint и database name
   `postgres`. Нельзя полагаться только на сохранённый CLI link или старую
   запись provenance.
2. Проверяет актуальные `supabase --version`, `supabase db dump --help`, Docker
   Engine и официальные CLI backup docs. CLI запускает `pg_dump` в Docker
   container; если команда/флаги отличаются от примера ниже либо требуют
   `db push`, `db reset`, migration или DDL — **STOP**.
3. Получает через Dashboard Connect direct connection или Supavisor **session**
   pooler connection (не transaction pooler); сверяет host, port, database,
   username и TLS с целевым project. Direct connection может требовать IPv6;
   выбирать transport по фактической сети оператора.
4. Утверждает существующую DB identity, которая может читать все нужные
   user-managed schemas и все rows, а также выгрузить нужные custom roles.
   PostgreSQL `pg_dump` по умолчанию выставляет `row_security=off` для полной
   выгрузки; если identity не может обойти RLS, dump должен завершиться ошибкой.
   Нельзя использовать `--enable-row-security` как обход: это создаст частичный
   dump. См. [pg_dump RLS behavior](https://www.postgresql.org/docs/current/app-pgdump.html#PG-DUMP-OPTIONS)
   и [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
   `app_runtime` (`NOBYPASSRLS`, ограниченные application grants) не считать
   подходящей без доказанной read coverage. Не менять grants/roles для backup
   в рамках этой процедуры; при нехватке прав — **STOP**.
5. Утверждает consistency window. Три файла создаются отдельными CLI вызовами
   и не образуют единый общий snapshot. Если за время экспорта возможны записи,
   требуется согласованное операторское решение по временному write pause либо
   приемлемости такого окна; не переключать production в read-only самостоятельно.
6. Подтверждает свободное место, приватный временный каталог на зашифрованном
   устройстве, процедуру шифрования и approved offsite destination с доступом,
   retention и восстановлением ключа. Сейчас эти настройки не подтверждены.
7. Утверждает ожидаемые schema/data/role coverage, обработку migration history,
   custom объектов в managed schemas и tables, которые могут требовать
   исключения. Сопоставить каталог таблиц со scope до запуска; неизвестное или
   намеренное исключение — **STOP** до фиксации решения.

Эти предварительные пункты — Dashboard/local checks. Если для подтверждения
database identity, RLS bypass или read coverage нужен production DB query,
сначала получить отдельное разрешение только на read-only preflight query;
проверить target и результат, затем запросить отдельное разрешение на dump.
Отсутствие первой авторизации не обходить запуском `supabase db dump` «для
проверки».

Не использовать `app_runtime`, Supabase API `service_role` JWT или CLI login token
как взаимозаменяемые DB credentials: DB connection требует именно проверенную
PostgreSQL identity. Не хранить connection URL в Git, `.env`, shell history,
backup manifest или обычном логе. Не передавать password/URI в argv. CLI login
token сам по себе не заменяет DB password/identity. До появления runner, который
безопасно использует Keychain и принудительно задаёт `sslmode=require`, production
CLI command не запускать.

### Локальная проверка production connection settings на macOS

Для будущей ручной процедуры добавлен check-only helper
`apps/backend/scripts/production-backup-connection-check.py`. Запустить из
`apps/backend` на Mac:

```sh
python3 scripts/production-backup-connection-check.py
```

Helper читает generic-password item из macOS Keychain с service
`travel-friend-production-postgres` и account
`postgres.tlgprfsecdasloqnuyjo`; пароль не передавать аргументом или через
переменную окружения. Он проверяет заданные в коде host
`aws-0-eu-central-1.pooler.supabase.com`, port `5432`, database `postgres`,
username `postgres.tlgprfsecdasloqnuyjo` и `sslmode=require`, затем в памяти
формирует PostgreSQL URI с percent-encoding пароля и проверяет разобранные
параметры. Сам URI и пароль не выводятся, не записываются в файл и не сохраняются
для последующего использования; при успехе выводится только безопасное сообщение
о локальной проверке.

Helper не открывает сеть, не проверяет доступность или принадлежность реального
target, не запускает Supabase CLI и не выполняет backup. Успех подтверждает только
наличие непустого Keychain item и корректную локальную сборку URI для ожидаемой
конфигурации; production connection identity, права, полнота данных и export
coverage требуют отдельных разрешённых проверок. Отсутствующая/пустая запись,
неожиданный target или ошибка формирования приводят к non-zero status с общим
сообщением без диагностического вывода Keychain/URI. Не ослаблять target checks и
не выводить URI для передачи в shell history, logs или Codex. Helper не выдаёт
URI вызывающему процесс и не является разрешением на production connection.

## Ручной production backup через Supabase CLI — STOP до устранения TLS-блокера

Production runner не реализован, и команды ниже не являются инструкцией к
экспорту. Проверка [CLI reference](https://supabase.com/docs/reference/cli/supabase-link)
и [исходника db dump](https://github.com/supabase/cli/blob/develop/apps/cli/src/commands/db/dump/dump.handler.ts)
показала, что пароль можно передать без URI в argv: CLI документирует
`SUPABASE_DB_PASSWORD`, а [builder environment для pg_dump](https://github.com/supabase/cli/blob/develop/apps/cli/src/command-internal/pg-dump.env.ts)
передаёт пароль как `PGPASSWORD`. Это не доказывает, что секрет
невидим другим процессам того же macOS account или администраторам локального
Docker Engine; права на Mac и Docker daemon остаются частью модели доступа.

Обнаружен отдельный блокирующий вопрос по обязательному `sslmode=require`.
В исходниках Supabase CLI builder для `db dump` формирует `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD` и `PGDATABASE`, но не передаёт `sslmode` в environment
контейнера `pg_dump`. Хотя parser CLI распознаёт `sslmode` в DB URL, рассмотренный
путь dump не сохраняет это поле в передаваемых параметрах `pg_dump`. Поэтому
нельзя считать достаточными ни `SUPABASE_DB_PASSWORD` с `--linked`, ни URI без
пароля с `--db-url`: по проверенному пути не подтверждено принудительное
TLS-подключение именно с `sslmode=require`. Не запускать production export, пока
CLI не предоставит и не подтвердит для используемой версии способ задать и
проверить `PGSSLMODE=require` внутри процесса `pg_dump` без включения пароля в
argv, plaintext-файл или shell history. Не обходить этот блокер wrapper-ом,
который меняет CLI/container internals.

Потенциальный будущий runner должен получать пароль напрямую из существующей
Keychain-записи, валидировать зафиксированный project ref и target, передавать
секрет только через environment, отключать telemetry/debug, подавлять сырые
stdout/stderr CLI и использовать три раздельных вызова:
`--role-only`, schema dump, затем `--data-only --use-copy`. До получения
подтверждённого механизма `sslmode=require` такой runner не должен создавать
SQL-файлы или выполнять сетевые операции. На этом этапе безопасен только
отдельный локальный connection check выше; он не является preview экспорта.

После снятия блокера и отдельного явного разрешения оператора будущая процедура
должна создавать новую приватную директорию с отказом при коллизии, проверять
наличие и ненулевой размер `roles.sql`, `schema.sql`, `data.sql`, записывать
SHA-256 manifest без credentials и сохранять неполный результат при ошибке для
ручного разбора — автоматически удалять SQL нельзя. Только тогда следует
утвердить consistency window, encrypted/offsite storage, schema/data/role
coverage и ограничения Supabase-managed schemas. CLI exports не являются полным
backup Supabase project; зафиксировать CLI version и отдельно решить вопрос
`supabase_migrations` history и прочих user-managed schemas.

Только после снятия TLS-блокера и отдельного разрешения, при появлении будущего
runner, проверить до признания набора кандидатом backup:

- присутствуют все три regular files, они не пустые и находятся в ожидаемой
  новой директории с закрытыми правами; SQL-файлы не печатать и не открывать в
  незакрытом окружении;
- CLI exit statuses сохранены, в защищённом журнале отмечены время начала/конца,
  версии Supabase CLI и database server, project/database identity, scope и
  ожидаемое число файлов;
- оператор в защищённой среде проверил schema/table/role inventory и ожидаемые
  признаки data output без вывода пользовательских значений; отсутствие
  нужного объекта/строк означает **STOP**;
- посчитан SHA-256 каждого файла и создан manifest без DSN, паролей, PII или
  содержимого SQL; manifest включает timestamp, project ref/database, версии,
  миграционный ориентир, scope/исключения, размеры и хэши;
- каждый файл и manifest зашифрованы утверждённым средством до передачи.
  Перенести только ciphertext в approved storage **вне Supabase** с ограниченным
  доступом, retention и восстановимым ключом; получить файлы обратно в закрытую
  временную область и сверить хэши. Удалять plaintext только после проверенного
  offsite copy и по утверждённой cleanup policy.

Минимальные локальные проверки файлов и checksum (в той же закрытой директории):

```sh
test -s "$BACKUP_DIR/roles.sql"
test -s "$BACKUP_DIR/schema.sql"
test -s "$BACKUP_DIR/data.sql"
shasum -a 256 "$BACKUP_DIR/roles.sql" "$BACKUP_DIR/schema.sql" \
  "$BACKUP_DIR/data.sql" > "$BACKUP_DIR/files.sha256"
shasum -a 256 -c "$BACKUP_DIR/files.sha256"
```

Если любой файл отсутствует/пустой или checksum verification не проходит —
**STOP**; не шифровать и не передавать этот набор как backup.

## Проверенная схема зашифрованного хранения (synthetic test)

Проверка 2026-10-18 подтвердила ручной путь для будущих backup-файлов:

1. `age` v1.3.2 установлен; локальное шифрование и расшифровка synthetic
   test archive завершились успешно.
2. В Google Drive загружалась age-зашифрованная копия. После скачивания
   побайтное сравнение с загруженным ciphertext прошло; скачанный файл успешно
   расшифрован. Google Drive предназначен только для ciphertext: приватная
   identity туда не помещается.
3. Восстановительная копия приватной age identity хранится в Apple «Пароли»;
   синхронизация записи с iPhone подтверждена. Само значение identity в этом
   runbook, Git и отчётах не приводится.
4. Восстановить identity из Apple «Пароли» можно на доверенном устройстве после
   локальной аутентификации: открыть соответствующую запись, скопировать её
   содержимое в изолированную локальную recovery-сессию и проверить формат.
   При копировании заметки может добавиться лишняя первая строка (например,
   заголовок/описание); перед использованием удалить только эту постороннюю
   строку, если она присутствует, и сохранить ключевой материал без изменений.
   Не публиковать копию для проверки.
5. В тесте identity, восстановленная из Apple «Пароли», успешно расшифровала
   synthetic archive. Временный recovery-файл после проверки удалён.

Приватную age identity запрещено хранить в GitHub (включая репозитории,
issues и artifacts), Google Drive или материалах, передаваемых Codex. Не
прикладывать её к запросам, логам, скриншотам, тестовым отчётам или manifest.
На время будущей операции использовать только локальный защищённый файл,
который не попадает в синхронизируемые каталоги; удалить его после применения.
Для Google Drive передавать только уже зашифрованный backup, не plaintext.

Граница подтверждения: тест использовал только synthetic data; production
backup не создавался. Поэтому проверена схема работы с ciphertext и recovery
identity, но не шифрование/хранение реального production backup, его полнота,
доступы и retention в рабочем цикле.

Файлы могут содержать все пользовательские профили, Telegram identifiers,
сообщения и trip data; `roles.sql` также считать чувствительным. Role export не
следует считать источником восстанавливаемых паролей custom login roles.
`pg_dump`-читаемость и hashes подтверждают лишь целостность файлов, не полноту
rows или восстанавливаемость. Локальный 2026-10-18 synthetic smoke не проверял
реальные production files.

## Restore validation только в отдельную disposable БД

Production restore не входит в текущий этап и не должен выполняться в source
Supabase. Supabase CLI даёт plain SQL files, поэтому их нельзя передавать в
`pg_restore`; для SQL format нужен `psql`. Restore validation требует отдельного
разрешения, новой пустой disposable PostgreSQL/Supabase DB и отдельного
операторского плана. Target project/host/database должен быть проверен как
отличный от production. Совместимость PostgreSQL version, extensions, роли,
ownership, grants, RLS и триггеров должна быть разобрана заранее. Не используйте
`local-test-db.sh reset`: он пересоздаёт схему по migrations, а не проверяет эти
production SQL files. Если проверка требует production role scripts, неизвестных
grants, изменения credentials или ослабления RLS — **STOP**.

Доступная документация Supabase описывает restore трёх SQL files через `psql`,
но роли и privileges могут быть несовместимы между project environments;
custom `LOGIN` role passwords требуют отдельного безопасного provisioning.
Некоторые проекты требуют особой обработки triggers/encrypted columns. Эти
действия пока не проверены для Travel Friend и не должны выполняться по слепому
копированию generic commands. Подготовить отдельную disposable-only procedure,
проверить target identity read-only и остановиться при любом неясном SQL или
role ownership.

После restore сохранить результат и проверить:

- `psql` восстановил все утверждённые SQL files без ошибок в disposable target;
  checksum полученных source files соответствует external manifest;
- application table/object inventory соответствует ожидаемой миграционной
  версии; все ожидаемые 17 application tables присутствуют;
- зафиксированы row counts по application tables без вывода пользовательских
  значений; сравнение с source допустимо только при заранее определённом
  consistent snapshot method и manifest. Такой метод пока не утверждён;
- constraints, indexes, sequences, functions, triggers и RLS policies
  присутствуют; RLS enabled там, где его требует текущая schema;
- owners, ACL/grants и runtime role attributes сверены отдельно: `roles.sql`
  содержит только доступные CLI custom roles, reserved roles фильтруются, а
  passwords custom `LOGIN` roles требуют отдельного provisioning;
- нет ошибок чтения ключевых application records и связанных записей.

В репозитории есть только mock-tested local smoke для структуры и synthetic row;
production restore validator и manifest format отсутствуют. Этот checklist —
план проверки: production restore считается непроверенным до disposable
восстановления реального backup и фиксации результатов оператором.

## RPO / RTO, STOP criteria и решения

**RPO:** не установлен и сейчас не гарантируется. Scheduled backup и PITR
недоступны на подтверждённом тарифе, а текущего восстановимого backup нет.
После появления manual backup фактический RPO будет зависеть от утверждённой
частоты и времени последней успешной копии.

**RTO:** не измерен и не гарантируется. Локальный synthetic restore прошёл, но
production restore не запускался; длительность,
совместимость версий/roles/extensions и post-restore validation не проверены.

**STOP**, если target или backup identity не подтверждены; нет явного разрешения
на production DB operation; нет approved encrypted local/offsite storage; у
backup неполная read/role coverage; CLI version/flags не сверены; любой dump
завершился ошибкой, один из трёх файлов отсутствует/пустой, scope непонятен,
manifest/hash не совпадает или data window неприемлем; disposable restore target
не пустой, не изолирован или похож на production; несовместимы PostgreSQL
version/extensions/roles; restore/validation завершились ошибкой; либо требуются
непроверенные DDL/grants, изменение credentials/providers или обход RLS.

Открытые решения оператора перед первым backup: выбрать approved encrypted
offsite store, доступ/ключи и retention; определить cadence и допустимые RPO/RTO;
утвердить существующую DB identity и доказательства её schema/data/roles
coverage без изменения grants; решить consistency window и допустимый write
pause; подтвердить managed/custom schema и table exclusions, migration history
scope и Storage object export; проверить CLI version, Docker, exact command flags
и способ не раскрывать DB URL в shared process list; подготовить изолированную
disposable restore target и validation plan. Если любого обязательного решения
нет — разрешение на первый production dump пока не выдавать. Любые production
connection, queries или dump требуют отдельного явного разрешения перед
выполнением. Этот этап не реализует №22 rollback/forward-fix.
