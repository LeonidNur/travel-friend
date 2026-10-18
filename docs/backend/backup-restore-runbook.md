# Backup / restore — audit, local validation and operator plan

**Статус: LOCAL ARCHIVE RESTORE + CURRENT APP_RUNTIME GRANTS VERIFIED;
PRODUCTION ACL NOT VERIFIED (2026-10-18).** Archive checksum, schema/data,
archive-era structure/RLS, replay недостающих repository migrations,
migration-declared `PUBLIC EXECUTE` revokes, app_runtime grants и read-only
verifier прошли в новом disposable PostgreSQL 17.11. `--no-acl` исключил source
ACL; production restore запрещён и не выполнялся.

## Подтверждённые факты и текущие границы

- Оператор проверил Supabase Dashboard 18.10.2026: проект на Free Plan,
  scheduled backups недоступны, Point-in-Time Recovery недоступен и требует
  платного дополнения к Pro.
- Оператор подтвердил production archive от 2026-10-18 и проверенную зашифрованную
  offsite copy. Schema/data архива локально восстановлены. После replay четырёх
  repository migrations и их явных `REVOKE ... FROM PUBLIC` текущие application
  grants/verifier прошли на disposable target. Это не восстанавливает production
  ACL и не подтверждает production recovery.
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
  данные. CI запускает local test workflow и cleanup. Добавлен локальный
  production archive restore smoke; schema/data, структурные проверки и
  текущие application grants/verifier прошли после локального replay миграций.
- Supabase CLI export был рассмотрен, но не выбран из-за неподтверждённой
  передачи `sslmode=require` в `pg_dump`. Текущий аудит рассматривает прямые
  PostgreSQL 17 tools и только `public`; это также не является образом всего
  Supabase project и не включает managed schemas, cluster roles, provider state
  или Storage objects.
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
| RLS policies, grants, ownership | Да: RLS и точные права — часть runtime security boundary. | `docs/backend/security.md`; migrations; `apps/backend/scripts/grant-production-app-runtime-privileges.sql`; supplied preflight: RLS на 17/17, `app_runtime` без BYPASSRLS, `postgres` владеет таблицами и имеет SELECT. | Да: сохранить policies, ownership/grants и минимальные role attributes как отдельную recovery dependency. | Policies и часть grants есть в migrations; role provisioning/grants scripts в Git. Реальные пароли, membership, owners и полное ACL состояние нельзя считать восстановленными из Git. | Principal inventory подтверждён по областям; точный grants/ownership catalog и его воспроизведение на disposable target остаются отдельными проверками. |
| PostgreSQL roles | Да: backend подключается как `app_runtime`; operator backup identity — `postgres`. | `db.py`, `config.py`; `provision-production-app-runtime-role.sql`; production grants script; operator preflight. | Отдельно пересоздать только `app_runtime` и нужный ACL surface. Не переносить полный cluster roles dump. | Атрибуты роли и grants описаны в scripts; production password и полное membership/ACL состояние не восстанавливаются из Git. | Operator-confirmed ACL principals нужно повторно сверить перед export; их наличие в source не доказывает, что они доступны или могут быть восстановлены на disposable target. |
| Extensions / PostgreSQL version | Явных `CREATE EXTENSION` / `ALTER EXTENSION` в app migrations не найдено; PostgreSQL runtime — зависимость. | Operator read-only SQL preflight: PostgreSQL 17.6; `plpgsql 1.0`, `pgcrypto 1.3`, `uuid-ossp 1.1`, `pg_stat_statements 1.11`, `supabase_vault 0.3.1`. | Сохранить полный inventory отдельно от фактических extension dependencies объектов `public`; обеспечить только нужные совместимые extensions на restore target. | Приложенческие migrations не задают extensions. | Production inventory подтверждён на момент preflight; его актуальность и direct object dependencies повторно проверить перед export. |
| Supabase Auth (`auth`) | Кодовой зависимости не найдено: MVP проверяет Telegram `initData` и хранит identities/sessions в `public`; оператор подтвердил 0 Auth users. | Backend auth source; операторский production inventory. | Auth rows сейчас не входят в backup scope. Provider settings остаются отдельной recovery dependency. | Не восстанавливается приложенческими migrations. | Повторно сверить нулевой inventory перед первым backup; настройки provider не входят в PostgreSQL archive. |
| Supabase Storage / внешние файлы | Upload/download в MVP не реализованы; оператор подтвердил 0 Storage objects. | `docs/backend/backend-contracts.md`, app source search, операторский inventory. | Object export сейчас не требуется по подтверждённому inventory; `profile_photos.storage_key` сам файл не содержит. | Нет: файлы/buckets не восстанавливаются из Git migrations или `public` archive. | Повторно проверить objects перед первым backup; bucket/provider configuration отдельно. |
| Supabase Vault (`vault`) | Кодовой или migration зависимости не найдено; оператор подтвердил 0 Vault secrets. | Search по app code/migrations/config; операторский inventory. | Vault data сейчас не входит в backup scope; секреты не класть в архив. | Не восстанавливается приложенческими migrations. | Повторно сверить inventory и consumers перед первым backup. |
| `supabase_migrations` history | Backend не читает migration ledger; оператор подтвердил 19 production records. | `supabase/migrations/`; operator-provided production ledger count. | Сохранить версии/имена, Git revision и timestamp read-only observation в sidecar manifest; не включать ledger в `public` archive и не писать в production ledger. | SQL definitions восстанавливаются из Git; ledger records — только из read-only inventory/manifest. | Имена/shape ledger columns и точное соответствие 19 production records текущему Git revision требуют повторного сверения. |
| Остальные schemas / provider state | Приложенческой зависимости в найденных исходниках нет. | Supplied preflight сообщил о `auth`, `storage`, `supabase_migrations`, `vault` и других schemas. | До первого backup составить inventory user-managed objects вне `public`; явно включить нужные custom schemas или записать обоснованное исключение. Provider settings и secrets — отдельные recovery dependencies. | Не полностью: application migrations охватывают только проектные definitions, а не hosted/provider state. | Имена, owners, объекты и consumers прочих schemas неизвестны. |

### Минимальный достаточный backup для текущей application data

После разрешённого read-only preflight рекомендуемый минимум — один custom-format
archive всей схемы `public` со всеми её rows и объектами; отдельно восстановить
`app_runtime`/grants и сохранить migration ledger metadata. Manifest содержит
exact project/database, timestamp/window, PostgreSQL server/client versions,
scope, Git revision migration files, timestamped table-count observations и
archive checksum. Это не переносит cluster roles, пароли, managed schemas или
полный provider state.
Секреты и connection credentials в dump/manifest не помещать.

Считать этот набор достаточным для приложения можно только после разрешения
открытых проверок по non-public schemas, Storage buckets/objects, Vault usage,
Auth configuration/users, migration ledger и актуальности extension inventory.
Если inventory находит
нужные файлы или custom objects вне `public`, scope расширяется отдельной
зашифрованной копией и проверенным restore шагом до запуска backup. Нельзя
считать `public` archive полным backup всего Supabase project.

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
- На момент первоначального audit production archive и проверенной offsite copy
  ещё не было. Оператор позднее подтвердил их создание; результат локального
  restore указан ниже. CI backup steps и автоматизированный recovery workflow
  не добавлялись.

## Границы первоначального audit и текущие пробелы

- Не получены или не сверены полнота `pg_dump` для всех application rows,
  identity read coverage и поведение RLS на подтверждённом production target.
- Не выбраны и не проверены внешнее зашифрованное хранилище, ограничение доступа,
  retention и независимая проверка checksum после переноса.
- Нет утверждённого manifest с версией source schema, backup scope и
  timestamped counts/ledger observations. Общий exported snapshot для этих
  observations не требуется для MVP; без него нельзя делать точное сравнение
  source/restore counts.
- Synthetic local smoke подтвердил restore тестового архива. Отдельный local
  smoke для production archive подтвердил checksum, target isolation,
  schema/data restore и агрегаты структуры; backup completeness, source ACL и
  provider state остаются непроверенными.
- Нет инвентаря всех object owners/ACL и проверенного способа воспроизвести их
  вместе с ролью `app_runtime` без production credentials.
- Production archive verifier прошёл schema/data, structural, RLS/policy и
  app_runtime grants checks после локального replay migrations. Source ACL,
  полнота backup данных и RPO/RTO не подтверждены. Supabase-managed schemas,
  Storage objects и прочее provider-level state не восстанавливаются этим smoke.

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
2. Проверяет локальные `pg_dump --version`, `pg_restore --version`, `psql --version`,
   PostgreSQL 17 client tools и возможность задать `sslmode=require`; если major
   version или ожидаемые flags не совпадают — **STOP**. Не выполнять `db push`,
   `db reset`, migration или DDL.
3. Получает через Dashboard Connect direct connection или Supavisor **session**
   pooler connection (не transaction pooler); сверяет host, port, database,
   username и TLS с целевым project. Direct connection может требовать IPv6;
   выбирать transport по фактической сети оператора.
4. Утверждает существующую DB identity, которая может читать все нужные
   application rows и обходить RLS без изменения grants. `app_runtime` для
   полной выгрузки не подходит; роли из cluster-wide dump не экспортировать.
   PostgreSQL `pg_dump` по умолчанию выставляет `row_security=off` для полной
   выгрузки; если identity не может обойти RLS, dump должен завершиться ошибкой.
   Нельзя использовать `--enable-row-security` как обход: это создаст частичный
   dump. См. [pg_dump RLS behavior](https://www.postgresql.org/docs/17/app-pgdump.html#PG-DUMP-OPTIONS)
   и [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
   `app_runtime` (`NOBYPASSRLS`, ограниченные application grants) не считать
   подходящей без доказанной read coverage. Не менять grants/roles для backup
   в рамках этой процедуры; при нехватке прав — **STOP**.
5. Утверждает consistency window. `pg_dump` обеспечивает согласованность
   собственного archive. Counts и migration ledger, полученные отдельными
   read-only запросами, являются наблюдениями на другое время; сохранить для них
   отдельные timestamps и не выдавать за общий snapshot. Для первого MVP backup
   общий exported snapshot не требуется. Не переключать production в read-only
   самостоятельно.
6. Подтверждает свободное место, приватный временный каталог на зашифрованном
   устройстве, процедуру шифрования и approved offsite destination с доступом и
   восстановлением ключа. Для MVP утверждены локальное хранение и зашифрованная
   копия в Google Drive; перед каждой операцией оператор проверяет доступность
   обоих мест и свободное место.
7. Утверждает ожидаемые schema/data/role coverage, обработку migration history,
   custom объектов в managed schemas и tables, которые могут требовать
   исключения. Сопоставить каталог таблиц со scope до запуска; неизвестный или
   отсутствующий ACL principal, неизвестное либо намеренное исключение —
   **STOP** до отдельного решения о его обработке.

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
token сам по себе не заменяет DB password/identity. Manual runner получает пароль
из Keychain и передаёт его через `PGPASSWORD`; production operation всё равно
требует отдельного разрешения.

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

### Manual PostgreSQL backup runner (macOS, не запускался на production)

Для локального SAFE PREVIEW из `apps/backend`:

```sh
uv run python scripts/production-backup-runner.py
```

Preview проверяет Keychain item, фиксированный target, абсолютные PostgreSQL 17
client tools (major version 17), Git revision и доступность backup-каталога. Он печатает
план без пароля/URI, не подключается к сети и не создаёт каталог или backup
artifact. Требуется локально установленный Homebrew PostgreSQL 17; при иной
конфигурации или версии запуск остановится.

Для отдельного production read-only preflight запустить из `apps/backend`:

```sh
uv run python scripts/production-backup-runner.py --preflight-only
```

Режим выполняет те же read-only checks, что используются перед export, без
`pg_dump` и без создания backup directory/artifacts. Он требует TTY и отдельное
интерактивное подтверждение `PREFLIGHT travel-friend-dev`, затем собирает
metadata inventories, отдельные table counts и migration ledger. При успехе
выводит безопасную сводку: PostgreSQL version, число public tables, результат
RLS/read coverage, ACL inventory, extension inventory, число migration records
и обнаруженные STOP conditions. Пользовательские записи, SQL results,
credentials и URI не выводятся. При любой неуспешной проверке он завершится с
STOP и не запускает export. Отказ/отсутствие интерактивного подтверждения не
устанавливает DB connection. Этот режим сам по себе не изменяет production.

Режим export существует отдельно (`--export`) и требует интерактивный терминал
и точный ввод `BACKUP travel-friend-dev`. Перед первым production use необходимо
отдельное явное разрешение на подключение/query/export; в рамках реализации и её
проверок этот режим не запускался против production. До `pg_dump` runner выполняет
read-only preflight: проверяет target identity, major version сервера 17, серверную role
`postgres` с `BYPASSRLS`, owner `postgres`, RLS и SELECT для точного набора 17
public tables; отдельно инвентаризирует ACL principals по relations, functions,
types, schema и default ACL и сверяет каждый scope с операторским inventory ниже;
сверяет полный extension inventory и версии с
операторским read-only preflight от 2026-10-18; вычисляет direct catalog-tracked
extension dependencies объектов `public`; считает large objects и
catalog-tracked зависимости вне `public`; читает migration ledger и counts; и
проверяет нулевые `auth.users`, `storage.objects` и `vault.secrets`. Любая ошибка,
неизвестный ACL principal, неизвестный extension или изменение его версии, large
object, обнаруженная catalog-tracked non-public dependency, ненулевая
Auth/Storage/Vault запись или расхождение с ожидаемым migration/table inventory
приводит к STOP. ACL inventory включает grantors, grantees и owners relations,
functions, types и schema; owners перечисляются независимо от ACL rows, чтобы
пустой ACL не скрывал владельца. Default ACL учитывают глобальные записи и
записи для `public`. Runner не создаёт роли, не
выполняет DDL и не добавляет placeholders.

Подтверждённый extension inventory: `plpgsql 1.0`, `pgcrypto 1.3`,
`uuid-ossp 1.1`, `pg_stat_statements 1.11` и `supabase_vault 0.3.1`. Это полный
ожидаемый inventory для preflight, а не инструкция устанавливать все эти
extensions при restore. Полный inventory сохраняется в manifest. Restore
dependencies вычисляются отдельно по прямым `pg_depend` ссылкам публичных
объектов на объекты, принадлежащие extensions; обнаруженные ссылки сохраняются
как observations для последующего restore planning. Неизвестный extension или
другая версия требуют новой операторской проверки.

Проверка non-public dependencies следует прямым `pg_depend` записям для
relations, functions, types, view rewrite rules, constraints, triggers, column
defaults и RLS policies; среди referenced objects она разрешает только
`pg_class`, `pg_proc` и `pg_type`. Другие классы ссылок, например operators и
collations, этим запросом не инвентаризируются. PostgreSQL не фиксирует надёжно
все ссылки из строковых тел PL/pgSQL/SQL функций, динамического SQL или внешнего
runtime; это не полная проверка dependency closure функций или проекта. Пустой
результат означает отсутствие обнаруженных запросом ссылок, а не доказательство
отсутствия runtime dependencies. Перед экспортом остаётся обязательным
сопоставление с migrations и операторская проверка найденных особенностей.

Для вызовов libpq runner передаёт минимальное environment с фиксированными
`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` и `PGSSLMODE=require`;
все унаследованные `PG*` настройки отбрасываются, включая service files,
host-address, passfile и TLS overrides. Другие унаследованные DB variables также
не передаются дочерним процессам. До подключения проверяется только major version
17; фактические полные server и client versions сохраняются в manifest.

После успешного preflight runner делает один `pg_dump --format=custom
--schema=public` с Keychain password только в `PGPASSWORD`, а параметры target
передаёт через `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` и `PGSSLMODE=require`.
В архиве есть согласованный snapshot самого `pg_dump`; counts и migration ledger
снимаются отдельными read-only наблюдениями с собственными timestamps и не
объявляются snapshot-equivalent архиву. После dump проверяются ненулевой размер,
`pg_restore --list` и SHA-256; в manifest записываются target без секрета,
фактические полные server/client versions, scope, Git revision и проверенные
metadata без пользовательских значений. Успешный результат означает только
создание и локальную проверку archive; успешное восстановление этим не
подтверждается.

Выход создаётся как уникальная приватная директория под
`~/.local/share/travel-friend/backups`, вне repository; существующий путь не
перезаписывается. При ошибке оставшиеся файлы не удаляются автоматически и
каталог остаётся помеченным файлом `INCOMPLETE.txt`. Manifest без marker
подтверждает только создание и локальную проверку archive, но не успешный restore.
Runner не шифрует и не загружает archive, не выполняет restore и не настраивает
расписание: оператору нужно отдельно
обеспечить approved encryption/offsite storage и сохранить ключ по ранее
проверенной процедуре. Успешный SAFE PREVIEW или mock tests не подтверждают
production connectivity, preflight completeness, наличие production archive или
recoverability. Если preflight не может достоверно проверить любой пункт, export
останавливается до отдельного решения оператора.

## Direct PostgreSQL 17 backup scope audit (2026-10-18)

Это выбранная схема ручного backup вместо трёх Supabase CLI exports; локальный
runner реализован, но не подтверждает production dump.
Аудит основан на текущих migrations/scripts и подтверждённом оператором
production inventory. К production не подключались.

### Состав архива и исключения

Минимальный artifact: один custom-format archive, сформированный PostgreSQL 17
`pg_dump` с выбором всей схемы `public` (`--format=custom --schema=public`). Не
перечислять отдельные таблицы флагами: schema-wide выбор включает все 17 текущих
таблиц и не теряет новые public tables при последующем изменении MVP:
`users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`,
`user_activity_states`, `travel_intents`, `user_sessions`,
`discover_interest_decisions`, `matches`, `chats`, `chat_participants`,
`messages`, `chat_summaries`, `trips`, `trip_participants`, `trip_stops`.

Archive охватывает определения объектов и строки таблиц в `public`: функции,
trigger function/trigger, RLS enablement и policies, indexes, constraints,
defaults, types и schema/object ACL. В текущем repo migrations определяют
application functions/policies, chat trigger и constraints/indexes. `pg_dump`
не включает cluster roles, Supabase-managed schemas, server/provider settings,
внешние Storage objects или migration ledger. `--schema=public` также пропускает
database-wide large objects и не пытается автоматически добавить зависимости
из других schemas; до первого backup проверить эти зависимости и подтвердить,
что за пределами `public` не осталось нужных app objects.

**Формат:** custom archive выбран вместо plain SQL: его можно проверить через
`pg_restore --list`, он поддерживает выборочное восстановление и остановку на
первой ошибке. Plain SQL проще читать и подавать через `psql`, но не даёт
`pg_restore` TOC/selective restore/error controls. Archive сохраняет исходные
ownership/ACL metadata. Для отдельной disposable-проверки только schema/data
допустимы `pg_restore --no-owner --no-acl --exit-on-error
--single-transaction`: эти флаги намеренно не проверяют восстановление source
owners, ACL и runtime grants, поэтому такой результат не является полным
restore.

Оператор подтвердил production ACL inventory по отдельным областям:

| Область | Подтверждённые principals |
|---|---|
| relations | `anon`, `authenticated`, `postgres`, `service_role` |
| functions | `app_runtime`, `postgres` |
| types | `PUBLIC`, `postgres` |
| schema | `PUBLIC`, `anon`, `app_runtime`, `authenticated`, `pg_database_owner`, `postgres`, `service_role` |
| default ACL | `anon`, `authenticated`, `postgres`, `service_role`, `supabase_admin` |

Runner сверяет principals с allowlist именно их области. Это production inventory,
а не доказательство, что те же managed roles и ACL можно восстановить в обычной
disposable PostgreSQL. Для полной restore-проверки отдельно подтвердить ACL
principals и `app_runtime` grants; отсутствующий или новый principal означает
**STOP** до отдельного решения. Автоматически создавать placeholder roles
запрещено. Не импортировать все Supabase cluster roles/role password hashes.
`app_runtime` создавать только как отдельную известную application role по
reviewed provisioning/grant scripts; не запускать production provisioning
script против источника.

Границы schema-wide dump и archive/restore options сверены с официальными
[PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) и
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) docs.

Миграции указывают `app_runtime` как policy/grant principal; backend не требует
Supabase `anon`, `authenticated` или `service_role` для DB access. Production ACL
inventory подтверждён оператором и проверяется по областям; возможность
восстановить эти principals/ACL в disposable PostgreSQL остаётся отдельной
проверкой. В migrations нет `CREATE EXTENSION`; прямой
зависимости MVP от Supabase Auth, Storage или Vault data не выявлено. Оператор
подтвердил 0 Auth users, 0 Storage objects и 0 Vault secrets. Повторить эти
inventory checks перед backup; provider configuration остаётся отдельным
recovery dependency.

### Migration history, полнота и consistency

Оператор подтвердил 19 production migration ledger records. `public` archive не
включает `supabase_migrations`. Сохранить в sidecar manifest фактические
production migration version IDs (и доступные names), число записей, Git commit и
соответствие version IDs файлам `supabase/migrations/`. Получать ledger только
read-only запросом в рамках будущего разрешённого backup, не редактировать
production ledger и не импортировать его в recovery target автоматически.

Manifest должен содержать target/database identity, UTC window, PostgreSQL
server/client versions, выбранные options/scope, список public tables, counts
по 17 таблицам, policy/function/trigger inventory, extension inventory,
migration versions/revision, размер и SHA-256 archive. Не включать credentials,
пользовательские значения или содержимое SQL. `pg_dump` обеспечивает
согласованность собственного archive, в том числе при concurrent writes.
Отдельные table counts и migration ledger — наблюдения на другое время; runner
должен фиксировать для них timestamp и явно обозначать это в manifest. Точное
сравнение source/restore counts без общего snapshot недопустимо. Для первого MVP
backup exported snapshot coordination не требуется; это возможное будущее
улучшение, а не блокер.

По RLS `pg_dump` по умолчанию выключает row security, чтобы выгрузить все строки;
при недостаточных правах он должен упасть. Не включать `--enable-row-security`
для backup: результат может быть частичным. Ранее подтверждённые `postgres`
`LOGIN/BYPASSRLS`, ownership всех 17 public tables и SELECT позволяют считать
эту identity кандидатом для полной выгрузки; перед первым запуском повторно
проверить target и read coverage отдельным разрешённым preflight.

### Restore только в disposable PostgreSQL

1. Проверить SHA-256 manifest, `pg_restore --list`, scope и version metadata.
2. Создать новое локальное disposable PostgreSQL 17 и уникальную пустую database
   из `template0`; подтвердить localhost/server identity и точное имя target,
   отличное от production. Не применять `--create` или `--clean`.
3. До restore выбрать цель проверки. Для schema/data-only допускается исключить
   owner и ACL через `--no-owner --no-acl`; это не подтверждает ACL или runtime
   grants. Для полной restore отдельно сверить ACL principals и их доступность
   на target. Новый/отсутствующий principal — **STOP** до отдельного решения;
   не создавать placeholder roles автоматически и не импортировать полный
   Supabase roles dump. `app_runtime` — известная отдельная application role:
   создавать её только по reviewed provisioning procedure с
   `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB`,
   `NOCREATEROLE`, `NOREPLICATION` и случайным локальным disposable password.
   Убедиться, что target новый и изолированный.
4. В свежей DB проверить `public` schema. Если она уже создана template, удалять
   её разрешается только после подтверждения точного target и факта, что DB
   создана текущим restore запуском; это повторяет guard local smoke. Затем
   восстановить archive в эту DB с `--no-owner --no-acl --exit-on-error
   --single-transaction`, без `--clean`, если это schema/data-only validation.
5. Для признания restore полной отдельно восстановить и проверить ACL, затем
   запустить grant script и read-only role/grants verifier на disposable target.
   Эти проверки не заменяются `--no-owner --no-acl`; placeholders не создавать.
   Сверить table/object inventory, записать восстановленные row counts, проверить
   RLS/policies, functions/triggers, indexes/constraints, hashes и 19 ledger
   versions из sidecar manifest; выполнить `ANALYZE`. Точное сравнение
   source/restore counts разрешено только при доказанном общем snapshot; без него
   counts остаются отдельными временными наблюдениями и equality assertion не
   выполнять. Не выполнять restore или DDL на Supabase source.

PostgreSQL server 17.6 и client tools 17.11 имеют совместимый major version:
`pg_dump` 17.11 может читать 17.6, а восстановление следует тестировать на
PostgreSQL 17.x. Это не доказывает production restore; для максимально близкой
валидации нужен disposable server той же minor version 17.6. Перед export
проверять major version 17 у `pg_dump`/`pg_restore`, фиксированный host/database и
`sslmode=require`; пароль передавать через `PGPASSWORD` environment (не URI в
argv, временный plaintext или shell history). Local restore smoke не подключался
к production и не повторял эти проверки.

На момент первоначального audit оставались непроверенными: повторная
актуальность ACL inventory, large-object inventory, catalog dependency
observations, timestamped counts/ledger и ledger-to-Git reconciliation. Позднее
оператор подтвердил первый production archive и encrypted offsite copy; ниже
зафиксирован отдельный local restore smoke этого archive. Это не подтверждает
полноту source ACL или точное соответствие всех ledger versions текущему Git.
Изменение production inventory после зафиксированного preflight не исключено.

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

Custom archive может содержать пользовательские профили, Telegram identifiers,
сообщения и trip data. Считать его чувствительным. Archive readability и SHA-256
подтверждают целостность, но не полноту rows или восстанавливаемость. Локальный
2026-10-18 synthetic smoke не проверял production archive.

## Restore validation только в отдельную disposable БД

Production restore в Supabase запрещён и не выполнялся. Локальная restore
validation выбранного custom archive выполнена отдельным runner ниже; повторный
прогон создаёт новую пустую disposable PostgreSQL 17 DB. Target проверяется как
изолированный Docker container без сети и портов. Совместимость PostgreSQL
version, extensions, ACL principals, ownership, grants, RLS и triggers должна
быть разобрана заранее. Не используйте
`local-test-db.sh reset`: он пересоздаёт schema по migrations, а не проверяет
production archive. При неизвестных grants, необходимости credential changes
или ослаблении RLS — **STOP**.

После restore сохранить результат и проверить:

- SHA-256 archive совпадает с external manifest; `pg_restore --list` читается;
  schema/data-only `pg_restore --exit-on-error --single-transaction --no-owner
  --no-acl` завершился без ошибок в disposable target;
- application table/object inventory соответствует ожидаемой миграционной
  версии; все ожидаемые 17 application tables присутствуют;
- зафиксированы row counts по application tables без вывода пользовательских
  значений и с timestamp; это отдельные временные наблюдения. Точное сравнение
  source/restore counts без общего snapshot недопустимо; без него equality
  assertion не выполнять. Общая exported snapshot coordination не является
  требованием MVP и может быть добавлена позднее;
- constraints, indexes, defaults, functions, triggers и RLS policies
  присутствуют; RLS enabled там, где его требует текущая schema;
- schema/data-only restore ownership назначен disposable restore identity;
  этот режим с `--no-acl` не восстанавливает и не подтверждает ACL. До признания
  restore полной ACL principals отдельно сверены с target, при
  неизвестном/отсутствующем principal операция остановлена до решения;
  placeholders автоматически не создаются. `app_runtime` создан в disposable
  контейнере с least-privilege attributes; после локального replay актуальных
  migrations текущие application grants/verifier прошли, см. ниже;
- runner не читает и не выводит пользовательские записи или тексты сообщений;
  используются агрегаты и inventory системного каталога.

Локальный runner для production archive находится в
`apps/backend/scripts/local-production-backup-restore-smoke.py`; его targeted
tests используют mock/fake manifest, а фактический повторный прогон ниже прошёл.
Повторная команда из `apps/backend`:

```sh
uv run python scripts/local-production-backup-restore-smoke.py
```

Runner проверяет SHA-256 по manifest, custom/public scope, PostgreSQL 17 major,
читабельность archive, затем использует уникальный Docker container с
`--network=none`, без опубликованных портов и с отдельной пустой database. Сначала
он проверяет ровно архивные 19 migrations и 18 функций, затем применяет в этой
disposable DB repository migrations, которых нет в manifest. После этого
повторяет только `REVOKE ... FROM PUBLIC` statements, явно записанные в migration
SQL, запускает structural/RLS inventory, текущий grant script и read-only
verifier. Новые роли, функции и migration files не создаются и не изменяются.
`supabase_migrations` ledger не восстанавливается и не изменяется.
Печатаются только агрегаты. Контейнер удаляется в cleanup; исходные archive и
manifest открываются только для чтения.

Фактический запуск 2026-10-18: SHA-256/scope/format прошли; локальные
server/client major равны 17; `pg_restore --no-owner --no-acl --exit-on-error`
успешно восстановил schema/data в отдельную пустую DB. В архивной схеме прошли
17/17 таблиц, schema-only dump equality, 93 constraints, 36 indexes, 3 triggers,
18 functions, RLS на 17/17 таблицах, 17 policies и 133 aggregate rows в restored
database. Source counts не сравнивались.
Production archive manifest содержит 19 migration records; все версии и имена
сопоставились с repository migration filenames. В checkout есть четыре более
поздние migration files, которые runner применил только в disposable database;
после них inventory содержит 20 functions. В архиве нет определения
`public.bootstrap_telegram_login(bigint,text,text,text,text,text)` и
`public.chat_participant_public_profile(uuid,uuid)`, которые добавляются
соответственно `20260924100000_session_lifecycle_baseline.sql` и
`20261003090000_chat_participant_public_profile.sql`. Текущий backend вызывает
первую в `apps/backend/src/travel_friend_backend/auth/service.py`, вторую в
`apps/backend/src/travel_friend_backend/routers/chats.py`; обе функции нужны
действующему приложению и не являются устаревшими остатками.

Для schema-only equality сравниваются весь custom archive и повторный dump
восстановленной `public` schema после исключения ownership/ACL. В сравнительных
файлах удаляются только `\\restrict` / `\\unrestrict` строки PostgreSQL 17 и
точные pg_dump metadata comments (`-- PostgreSQL database dump`, `-- Dumped ...`,
`-- Name:`, `-- Type:`, `-- Schema:`, `-- Owner:`). SQL statements, включая
`COMMENT ON`, сравниваются строго; сами dump/SQL contents не выводятся.

Первый прогон grants остановился на двух функциях, отсутствовавших в архиве.
После проверки их migration и application происхождения runner в новом
контейнере применил четыре уже имеющиеся repository migrations, затем 25
migration-declared `PUBLIC EXECUTE` revokes, production app_runtime grant script
и read-only verifier. Application grants прошли для восстановленной и
forward-migrated disposable schema. Это отдельная локальная проверка прав,
заданных Git migrations и grant script; она не импортирует и не подтверждает
source ACL из архива.

Локальный schema/data restore, current-schema structural/RLS checks и
`app_runtime` grants/verifier подтверждены. Production restore в Supabase не
выполнялся. Даже успешные локальные application grants с `--no-acl` не
подтверждают перенос production ACL: owners, ACL principals и все source grants
остаются самостоятельной непроверенной областью.

## Принятая MVP operational policy

- Ответственный оператор: **Leonid**.
- Выполнять backup вручную еженедельно и дополнительно перед значительными
  изменениями базы данных. Автоматического расписания нет.
- Хранить локальную копию и зашифрованную offsite-копию в Google Drive. В Drive
  помещать только ciphertext; age identity не хранить в GitHub, Google Drive или
  материалах, передаваемых Codex. Проверенная схема хранения и восстановления
  ключа описана выше.
- Сохранять последние четыре еженедельные копии. Оператор вручную проверяет
  состав и возраст копий; автоматическое удаление и retention scripts не
  используются.
- Проверять восстановление после значительных изменений схемы и периодически.
  Периодическую проверку проводить вручную; отдельный календарный интервал пока
  не задан.

Migration drift production и Git остаётся отдельным риском задачи №16. В частности,
локальное применение более поздних repository migrations при restore smoke не
подтверждает соответствие production schema или migration ledger текущему Git;
этот drift требует отдельной проверки и не считается закрытым backup-процедурой.

Не планируются платные подписки или upgrade provider plan. Supabase Free не
предоставляет scheduled backups и PITR. Ручная политика ниже не означает, что
Supabase-managed recovery или production ACL полностью проверены.

## RPO / RTO, STOP criteria и решения

**RPO target:** до 7 дней при условии своевременного успешного еженедельного
backup. Это целевой показатель, а не гарантия: при пропуске или неуспешном запуске
фактический RPO может быть больше. Scheduled backups и PITR на подтверждённом
Free plan недоступны.

**RTO target:** 24 часа; показатель ещё не измерен и не гарантируется. Локальные
schema/data restore и application grants после replay migrations прошли, но
длительность полного recovery, Supabase-managed recovery и полный production ACL
restore не проверены.

**STOP**, если target или backup identity не подтверждены; нет явного разрешения
на production DB operation; нет approved encrypted local/offsite storage; у
backup неполная read/role coverage; `pg_dump`/`pg_restore` major version не
сверены; dump завершился ошибкой, archive отсутствует/пустой, scope непонятен,
manifest/hash не совпадает или data window неприемлем; disposable restore target
не пустой, не изолирован или похож на production; несовместимы PostgreSQL
version/extensions/roles; обнаружен неизвестный или отсутствующий ACL principal
без отдельного решения о его обработке; ledger не сопоставляется с repository,
есть migration gap, локальный replay или grants/verifier завершается ошибкой;
либо требуются непроверенные DDL/grants, изменение credentials/providers или
обход RLS. Отсутствие общего exported snapshot само по себе не является STOP для
первого MVP backup; при этом точное сравнение source/restore counts запрещено.

Для следующих production backups вручную соблюдать утверждённые cadence и
retention; перед запуском повторно подтвердить DB identity и schema/data/roles
coverage без изменения grants; сохранить consistency window и timestamped
counts/ledger observations; повторно сверять extensions, large objects, ACL
principals, non-public schemas, migration history и Auth/Storage/Vault inventories.
Для будущей схемы повторять локальную проверку grants; production ACL требует
отдельной процедуры и не подтверждён этим smoke. Migration drift остаётся отдельным
риском задачи №16.
Реализованный runner предусматривает
SAFE PREVIEW, явное интерактивное подтверждение export, private no-overwrite
directory, custom archive, timestamped counts/ledger observations без требования
общего exported snapshot, SHA-256 manifest, Keychain read и redacted errors.
Проверка archive restore не подтверждает повторяемость production backup. Общая
exported snapshot coordination может быть будущим улучшением.
Любые production
connection, queries или dump требуют отдельного явного разрешения перед
выполнением. Этот этап не реализует №22 rollback/forward-fix.
