# Production cutover record and runbook: runtime RLS and grants

> Статус на 23.09.2026: этот cutover завершён. Production DB применена до `20260901280000`; final grants verifier и runtime deployment gate прошли; совместимый security backend deployed, `/health` и Telegram smoke успешны. Auto-Deploy остаётся Off. Не выполняйте описанные ниже шаги повторно как новый cutover: они сохраняются как точная запись применённого процесса и reference для отдельно одобренных будущих изменений.

Этот runbook описывает выполненный production cutover security
контракта: backend `988aeb0` →
`b25e08dce158b7fe7ea6d17b40d96c3e893330fa` и migrations
`20260901230000`–`20260901280000`. Источник истины для миграций и их порядка —
`supabase/migrations/`; не использовать `migration repair`, ручные записи в
`supabase_migrations.schema_migrations`, `db reset`, `--include-seed`,
`--include-roles` или `--include-all`.

## Historical preconditions

До начала оператор подтверждает все следующие факты:

- production backend сейчас находится на `988aeb0`;
- целевой backend — exact commit
  `b25e08dce158b7fe7ea6d17b40d96c3e893330fa`;
- production DB применена ровно до `20260901220000`;
- pending suffix — ровно `20260901230000`–`20260901280000`, без пропусков и
  дополнительных migration versions;
- Render Auto-Deploy выключен;
- текущий Render `DATABASE_URL` уже является Session Pooler DSN роли
  `app_runtime`;
- в ходе cutover `DATABASE_URL` не меняется и не возвращается на `postgres`.

Оператор также заранее определяет и подтверждает способ изоляции traffic.
В репозитории не документированы production Render maintenance feature или CLI
команда, поэтому этот runbook не изобретает их: конкретный безопасный механизм
остаётся operator prerequisite.

Используются две разные учётные записи:

- privileged `postgres` DSN — только для migrations, final grants и grants
  verifier;
- реальный Session Pooler DSN `app_runtime` — только для runtime deployment
  gate.

Не передавайте DSN, пароль или service-role key в repository, shell history или
ticket. Эти операции не деплоят backend и не изменяют Render configuration.

## Почему требуется maintenance boundary

Migration `20260901230000` additive, но начиная с `20260901240000` новый DB
контракт последовательно ломает write paths старого backend `988aeb0`.
Напротив, `b25e08d` нельзя запускать до появления требуемых capabilities,
политик и grants. Поэтому до применения suffix `230000`–`280000` весь traffic
старого backend должен быть остановлен или изолирован. Traffic нельзя
восстанавливать до успешного health check нового backend.

## Executed cutover

### 1. Preflight и target commit

В checkout, из которого будет выполняться cutover, проверьте exact target
commit; вывод `rev-parse` должен совпасть с SHA ниже:

```zsh
TARGET_BACKEND_SHA='b25e08dce158b7fe7ea6d17b40d96c3e893330fa'
git cat-file -e "${TARGET_BACKEND_SHA}^{commit}"
git rev-parse --verify "${TARGET_BACKEND_SHA}^{commit}"
git show -s --format='%H%n%s' "$TARGET_BACKEND_SHA"
```

Подтвердите все preconditions, включая current backend `988aeb0`, DB history
through `20260901220000`, выключенный Auto-Deploy и неизменность уже
`app_runtime` Session Pooler `DATABASE_URL`.

В trusted terminal запросите privileged DSN без echo; он используется только
в следующих privileged командах:

```zsh
read -rs 'SUPABASE_PRODUCTION_MIGRATOR_DSN?Privileged postgres DSN: '; echo
export SUPABASE_PRODUCTION_MIGRATOR_DSN
```

### 2. Quiesce traffic

Остановите или изолируйте traffic старого `988aeb0` выбранным и заранее
подтверждённым операторским механизмом. До `db push` оператор **явно
подтверждает**, что traffic quiesced. Не меняйте Render `DATABASE_URL`.

### 3. Privileged dry-run и сверка suffix

```zsh
supabase db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN" --dry-run
```

Dry-run должен показывать только непрерывный suffix:

```text
20260901230000
20260901240000
20260901250000
20260901260000
20260901270000
20260901280000
```

При любом history drift, пропуске или дополнительной version остановитесь: не
исправляйте состояние флагами или ручным SQL.

### STOP: разрешение на необратимую фазу

Непосредственно перед actual `db push` оператор обязан явно подтвердить:

- traffic quiesced;
- Render Auto-Deploy OFF;
- current production backend — `988aeb0`, а DB history — through
  `20260901220000`;
- dry-run показывает exact suffix `20260901230000`–`20260901280000`;
- target commit `b25e08dce158b7fe7ea6d17b40d96c3e893330fa` существует и
  проверен выше.

Если хотя бы один пункт не подтверждён, **не выполняйте `db push`**.

### 4. Apply DB contract, grants и checks

```zsh
supabase db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN"

psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" \
  -f apps/backend/scripts/grant-production-app-runtime-privileges.sql

psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" \
  -f apps/backend/scripts/verify-production-app-runtime-privileges.sql
```

`verify-production-app-runtime-privileges.sql` только читает каталог. Все
столбцы `is_*` должны быть true, а unexpected effective function privileges —
отсутствовать. Он проверяет exact runtime table/column grants, RLS/non-owner
inventory всех 17 application tables, пустой policy surface internal/dormant
tables и обе Trip capabilities.

Затем запросите runtime DSN отдельно, без echo, и запустите gate только с
Session Pooler DSN `app_runtime`:

```zsh
read -rs 'PRODUCTION_RUNTIME_DATABASE_URL?app_runtime Session Pooler DSN: '; echo
export PRODUCTION_RUNTIME_DATABASE_URL
(
  cd apps/backend
  uv run --python 3.12 scripts/production-runtime-deployment-gate.py
)
```

Gate fail closed проверяет runtime identity, exact grants, capability metadata,
RLS enabled/non-owner и exact policy inventory всех 17 tables, включая пустую
policy/ACL surface пяти internal/dormant tables, fail-closed reads без
`app.user_id` и отсутствие direct mutations (включая все Trip tables). Он не
создаёт данных: negative probes используют `WHERE false` и rollback.

### 5. Deploy, health и traffic restore

После успешных verifier и runtime gate был вручную deployed exact SHA
`b25e08dce158b7fe7ea6d17b40d96c3e893330fa` в Render. Auto-Deploy остаётся
выключенным; `DATABASE_URL` не меняется.

После deploy выполните health check по base URL, который предоставил оператор;
runbook не задаёт production URL:

```zsh
PRODUCTION_BASE_URL='https://operator-provided-base-url'
curl --fail --show-error --silent "$PRODUCTION_BASE_URL/health"
```

Восстановите traffic только при успешном health check. Затем выполните Telegram
production E2E/smoke для критичного пользовательского flow.

## Final RLS production contract

После migrations и grants должны выполняться все условия:

- `trips`, `trip_participants`, `trip_stops` имеют enabled RLS, не owned
  `app_runtime` и не имеют mutation policies для runtime;
- policy surfaces состоят ровно из `trips_select_active_participant`,
  `trip_participants_select_active_trip` и
  `trip_stops_select_active_participant` с participant predicates;
- `is_current_active_trip_participant(uuid)` и
  `create_current_trip_from_chat(uuid)` — `SECURITY DEFINER`, fixed
  `search_path=pg_catalog`, no PUBLIC EXECUTE, EXECUTE только `app_runtime`;
- `app_runtime` имеет только required SELECT columns на Trip tables и не имеет
  INSERT/UPDATE/DELETE на них;
- Chat policies состоят из обычных SELECT surfaces: temporary
  `chats_lock_active_participant` и `chat_participants_lock_active_chat`
  отсутствуют, как и UPDATE privilege на `chats` и `chat_participants`;
- `users`, `telegram_identities`, `user_settings`, `profile_photos` и
  `chat_summaries` имеют enabled RLS, не owned `app_runtime`, не имеют policies
  и не имеют effective direct table/column privileges для `app_runtime`.

## Failure handling и rollback boundaries

Если `db push` fails, оставьте traffic изолированным и сначала изучите exact
migration history. Не пытайтесь лечить его `migration repair`, ручными
записями migration history, ad-hoc `DROP` migrations или ручным SQL.

После любой breaking migration, начиная с `20260901240000`, не возобновляйте
`988aeb0` без отдельной compatibility validation. После final grants `988aeb0`
явно **не является valid rollback target**. Failure после final DB contract
требует forward-fix либо другого явно validated compatible backend.

Никогда не восстанавливайте broad runtime grants, не меняйте owners/RLS/policies
вручную и не переключайте Render `DATABASE_URL` на privileged `postgres`.
Любая иная remediation или rollback требует отдельного approved change.
