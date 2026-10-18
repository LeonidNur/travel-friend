# Backup / restore — audit and operator plan (stage 1)

**Статус: AUDIT/PLAN.** Документ описывает выбранный для MVP подход и будущую
операторскую последовательность. Он не подтверждает наличие backup, не является
разрешением на production DB operation и не сообщает об успешном restore.
Команды ниже не запускались.

## Подтверждённые факты и текущие границы

- Оператор проверил Supabase Dashboard 18.10.2026: проект на Free Plan,
  scheduled backups недоступны, Point-in-Time Recovery недоступен и требует
  платного дополнения к Pro.
- Оператор подтвердил, что восстановимого backup сейчас нет. Для MVP выбран
  ручной logical backup с внешним хранением и проверкой restore на отдельной
  disposable БД. Этот подход пока не реализован и не проверен.
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
  destructive `reset` пересоздаёт схему. Это не backup/restore процедура.
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
- Отдельных backup/restore scripts, CI steps или существующего recoverable
  artifact в репозитории не обнаружено.

## Проверки, которых пока нет

- Не получены или не сверены полнота `pg_dump` для всех application rows,
  identity read coverage и поведение RLS на подтверждённом production target.
- Не выбраны и не проверены внешнее зашифрованное хранилище, ограничение доступа,
  retention и независимая проверка checksum после переноса.
- Нет утверждённого manifest с версией source schema, backup scope и
  consistency/row-count evidence.
- Нет disposable restore target с подтверждёнными PostgreSQL version,
  extensions и role prerequisites; фактический `pg_restore` не запускался.
- Нет инвентаря всех object owners/ACL и проверенного способа воспроизвести их
  вместе с ролью `app_runtime` без production credentials.
- Нет restore-specific verifier/test, подтверждённой полноты данных или
  измерения RPO/RTO. Supabase-managed schemas, Storage objects и прочее
  provider-level state не инвентаризированы для восстановления.

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

В репозитории пока нет restore-specific validator, manifest format или
автоматизированного restore test. Поэтому этот checklist — план проверки;
restore считается непроверенным до фактического успешного disposable restore и
фиксации результатов оператором.

## RPO / RTO, STOP criteria и решения

**RPO:** не установлен и сейчас не гарантируется. Scheduled backup и PITR
недоступны на подтверждённом тарифе, а текущего восстановимого backup нет.
После появления manual backup фактический RPO будет зависеть от утверждённой
частоты и времени последней успешной копии.

**RTO:** не измерен и не гарантируется. Restore не запускался; длительность,
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
