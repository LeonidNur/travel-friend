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
- Предложенный ниже dump ограничен schema `public`, не включает PostgreSQL
  cluster globals (в том числе role attributes/passwords), Supabase project
  settings/secrets или данные других schemas. Обычный `pg_dump` сохраняет
  object ownership/ACL entries, но не создаёт роли; соответствующие role names
  и attributes нужно отдельно подготовить и проверить на disposable target.
- Logical dump будет содержать персональные данные и содержимое сообщений и
  должен обрабатываться как чувствительная пользовательская информация.

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

## Операторская последовательность для будущего backup

### 1. Разрешение и подтверждение target

Перед любым production DB connection/query или dump требуется явное scoped
разрешение оператора. В нём должны быть названы проект/DB, точное действие,
оператор и временное окно, backup scope и одобренное внешнее хранилище. Без
такого разрешения — **STOP**.

По deployment provenance, ожидаемый project — Supabase
`travel-friend-dev` (`tlgprfsecdasloqnuyjo`); оператор заново подтверждает в
Dashboard, что это нужный production target, а затем сверяет endpoint, database
name и environment через защищённую service definition. После разрешения
подтвердить подключение read-only запросом:

```sh
psql "service=travel_friend_backup" -X -v ON_ERROR_STOP=1 -Atc \
  'SELECT current_database(), current_user, inet_server_addr(), inet_server_port()'
```

Сверить результат с Dashboard и заранее записанным manifest target. Не выводить
DSN/password в terminal log, shell history или отчёт. `app_runtime` имеет
ограниченные application privileges и не считается автоматически подходящей
для полного dump identity; используйте только уже одобренную backup identity.
Если её read coverage недостаточен или требует изменения grants/credentials —
**STOP** и отдельное решение оператора.

### 2. Получение logical backup

Установить `PGSERVICEFILE` на защищённую operator service file, содержащую
подтверждённый source target; права файла должны быть ограничены оператором.
Не хранить пароль в service file: использовать только существующий защищённый
passfile/credential mechanism с ограниченными правами.
Подготовить путь на зашифрованном локальном носителе. Если шифрование и доступ к
пути не подтверждены, dump не начинать.

```sh
umask 077
BACKUP_FILE="/approved-encrypted-volume/travel-friend-prod-<UTC timestamp>.dump"
pg_dump --dbname="service=travel_friend_backup" \
  --format=custom --schema=public \
  --file="$BACKUP_FILE"
```

`pg_dump` должен завершиться с кодом 0 и создать файл ненулевого размера. В
manifest зафиксировать UTC timestamp, project/database identity, PostgreSQL и
`pg_dump` versions, scope (`public`), migration version и backup file hash; не
включать DSN, PII или строки/сообщения пользователей.

Проверить, что одобренная identity читает все требуемые application tables и
может получить все строки при включённом RLS. Если полного row visibility нет,
не расширять grants самостоятельно — **STOP** и запросить отдельное решение.

### 3. Внешнее хранение и целостность

Перенести backup в заранее одобренное, зашифрованное at-rest хранилище **вне
Supabase** с ограниченным доступом и согласованным retention. Конкретное
хранилище, права, сроки хранения и cleanup policy пока не выбраны. Не помещать
dump в Git, обычный shared folder, незашифрованное временное хранилище, email
или chat. Если подходящего места нет — **STOP**; локальный dump не является
доказанным внешним backup.

Проверить, что custom archive читается, вычислить checksum и зафиксировать её в
manifest. После переноса прочитать объект из внешнего хранилища и сравнить его
hash с manifest:

```sh
pg_restore --list "$BACKUP_FILE" >/dev/null
shasum -a 256 "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
shasum -a 256 -c "$BACKUP_FILE.sha256"
# После fetch/copy-back проверить полученный файл отдельно:
shasum -a 256 "$DOWNLOADED_BACKUP_FILE"
```

Checksum подтверждает неизменность файла, а `pg_restore --list` — читаемость
archive metadata; ни одна из проверок сама по себе не подтверждает успешный
restore.

## Restore check только в отдельную disposable БД

Restore production backup непосредственно в production не входит в этот план.
Для проверки нужна новая, пустая и изолированная disposable PostgreSQL DB/instance
с совместимой major version и необходимыми extensions/roles. Project/host/database
identity target должен быть явно отличим от production и проверен до restore.
Нужные роли, policies и extensions следует подготовить по отдельному
проверенному test setup; если это требует production role scripts, неизвестных
grants или ослабления RLS — **STOP**. Не используйте `local-test-db.sh reset`:
он удаляет содержимое схемы и применяет migrations вместо восстановления dump.

Сначала подтвердить пустую disposable target через защищённую service
definition и read-only identity query. До restore подготовить требуемые role
names/attributes и owner identities в disposable environment; production role
provisioning scripts и credentials нельзя автоматически переиспользовать.
Поскольку dump сохраняет object owners и ACL entries, если их нельзя безопасно
воспроизвести или меняется семантика `SECURITY DEFINER` — **STOP**. Затем
восстановить архив без `--clean` в только что созданную отдельную DB от
disposable admin identity:

```sh
pg_restore --dbname="service=travel_friend_restore_test" \
  --exit-on-error "$BACKUP_FILE"
```

Команду нельзя запускать, пока имя проекта, endpoint и DB не подтверждены как
отдельный disposable target. При ошибке остановить проверку и расследовать
partial restore только в этой disposable среде; не повторять команду в другой
или production target.

После restore сохранить результат и проверить:

- `pg_restore` завершился с кодом 0; checksum соответствует внешнему manifest;
- application table/object inventory соответствует ожидаемой миграционной
  версии; все ожидаемые 17 application tables присутствуют;
- зафиксированы row counts по application tables без вывода пользовательских
  значений; сравнение с source допустимо только при заранее определённом
  consistent snapshot method и manifest. Такой метод пока не утверждён;
- constraints, indexes, sequences, functions, triggers и RLS policies
  присутствуют; RLS enabled там, где его требует текущая schema;
- owners, ACL/grants и runtime role attributes сверены отдельно: archive
  содержит object owner/ACL entries, но не восстанавливает PostgreSQL roles и
  их attributes/passwords;
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
на production DB operation; нет approved encrypted external storage; у backup
неполная read coverage; archive/checksum не прошли проверки; disposable restore
target не пустой, не изолирован или похож на production; несовместимы PostgreSQL
version/extensions/roles; restore/validation завершились ошибкой; либо требуются
непроверенные DDL/grants, изменение credentials/providers или обход RLS.

Перед следующей стадией оператору нужно выбрать и зафиксировать: внешнее
хранилище и доступ; backup cadence и retention; допустимые RPO/RTO; точную
backup role/scope; совместимую disposable restore environment; validation
criteria; расписание/владельца и срок проверки. Любые production connection,
queries или dump требуют отдельного явного разрешения перед выполнением. Этот
этап не реализует №22 rollback/forward-fix.
