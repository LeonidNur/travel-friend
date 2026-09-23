# Production runbook: runtime RLS and grants

Этот runbook применяется к hosted Supabase production для текущего security
контракта migrations, включая `20260901280000_internal_dormant_tables_rls.sql`. Источник истины
для состава и порядка — `supabase/migrations/`, а не захардкоженный список
версий в этом документе. Не использовать `migration repair`, ручные записи в
`supabase_migrations.schema_migrations`, `db reset`, `--include-seed`,
`--include-roles` или `--include-all`.

## Границы

Оператор использует три разные учётные записи:

- privileged `postgres` DSN только для `supabase db push`, grants и verifier;
- реальный Session Pooler DSN `app_runtime` только для deployment gate;
- Render `DATABASE_URL` меняется вручную только после успешного gate.

Не передавайте DSN, пароль или service-role key в repository, shell history или
ticket. `db push`, grants и verification не деплоят backend и не меняют Render.

## Применение

В trusted terminal временно экспортируйте privileged DSN и сначала проверьте
список pending migrations:

```zsh
read -rs 'SUPABASE_PRODUCTION_MIGRATOR_DSN?Privileged postgres DSN: '; echo
export SUPABASE_PRODUCTION_MIGRATOR_DSN
supabase db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN" --dry-run
```

Сверьте dry-run с checkout: он должен включать ожидаемый непрерывный pending
suffix, включая `20260901280000_internal_dormant_tables_rls.sql`, если final internal/dormant RLS slice ещё не зарегистрирован.
При history drift остановитесь: не пытайтесь исправить его флагами или ручным
SQL. После проверки выполните standard apply:

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
  отсутствуют, как и UPDATE privilege на `chats` и `chat_participants`.
- `users`, `telegram_identities`, `user_settings`, `profile_photos` и
  `chat_summaries` имеют enabled RLS, не owned `app_runtime`, не имеют policies
  и не имеют effective direct table/column privileges для `app_runtime`.

## Deployment gate

Только после успешного verifier запустите gate через фактический runtime DSN:

```zsh
read -rs 'PRODUCTION_RUNTIME_DATABASE_URL?app_runtime Session Pooler DSN: '; echo
export PRODUCTION_RUNTIME_DATABASE_URL
cd apps/backend
uv run --python 3.12 scripts/production-runtime-deployment-gate.py
```

Gate fail closed проверяет runtime identity, exact grants, capability metadata,
RLS enabled/non-owner и exact policy inventory всех 17 tables, включая пустую
policy/ACL surface пяти internal/dormant tables, fail-closed reads без
`app.user_id` и отсутствие direct mutations (включая все Trip tables). Он не создаёт данных:
negative probes используют `WHERE false` и rollback. Только `passed` разрешает
следующий ручной шаг смены Render DSN и deployment.

## Failure handling

При любом failed preflight, dry-run, migration, verifier или gate остановитесь.
Сохраните output и прочитайте migration history; не выдавайте временных grants,
не меняйте owners/RLS/policies вручную и не переключайте Render. Remediation или
rollback требуют отдельного approved change.
