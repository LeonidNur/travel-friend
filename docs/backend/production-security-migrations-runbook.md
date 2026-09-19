# Production runbook: five security migrations

Этот runbook применим только к hosted Supabase production и только к уже
существующим migrations в следующем строгом порядке:

1. `20260901160000_authenticated_user_context.sql`;
2. `20260901170000_bearer_session_resolution_capability.sql`;
3. `20260901180000_telegram_login_bootstrap_capability.sql`;
4. `20260901190000_travel_intents_rls.sql`;
5. `20260901200000_profiles_rls.sql`.

Он **не** меняет migrations, не выдаёт table/function grants сверх того, что
содержится в них, не меняет `DATABASE_URL` Render, не деплоит backend и не
делает rollback. Render остаётся на `46526f8`, Auto-Deploy выключен.

## Механизм

Используется штатный Supabase CLI `db push` с прямым privileged DSN роли
`postgres`. Это сохраняет единственный source of truth —
`supabase_migrations.schema_migrations`: CLI выполняет pending migrations в
порядке timestamp и записывает версию только после успешного применения. Уже
зарегистрированные версии при повторном запуске пропускаются.

Не использовать `migration repair`, ручные `INSERT`/`DELETE` в
`schema_migrations`, `db reset`, `--include-seed`, `--include-roles` или
`--include-all`. Последние три могут расширить scope, а remote `db reset`
разрушителен.

`SUPABASE_PRODUCTION_MIGRATOR_DSN` — только временная переменная окружения
оператора/approved secret store. Это direct или session-pooler PostgreSQL DSN,
аутентифицирующийся именно как `postgres`; пароль и DSN не записываются в
repository, shell history или Render.

## До окна

- Работать из checkout, содержащего именно эти неизменённые пять файлов.
- Убедиться, что никто не выполняет schema changes в production до завершения
  verification. CLI не является блокировкой от параллельного оператора.
- В отдельном trusted terminal экспортировать DSN без значения в команде:

```zsh
read -rs 'SUPABASE_PRODUCTION_MIGRATOR_DSN?Privileged postgres DSN: '; echo
export SUPABASE_PRODUCTION_MIGRATOR_DSN
```

Не используйте `Render DATABASE_URL`, `app_runtime` DSN или service-role key.

## Fail-closed preflight (только чтение)

Эта проверка намеренно требует точного known history: шесть предшествующих
repository migrations зарегистрированы, а пять target versions отсутствуют.
При любом расхождении она завершится ошибкой до `db push`. Она также проверяет
managed-Supabase свойства подключённой роли, least-privilege `app_runtime`,
отсутствие её memberships, исходные таблицы и baseline ownership. Вывод
ownership сохраните в ticket/change record для сравнения после write.

```zsh
psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" <<'SQL'
SELECT current_user, session_user;

DO $$
DECLARE
  expected_prior constant text[] := ARRAY[
    '20260826084844', '20260826100000', '20260901120000',
    '20260901130000', '20260901140000', '20260901150000'
  ];
  target_versions constant text[] := ARRAY[
    '20260901160000', '20260901170000', '20260901180000',
    '20260901190000', '20260901200000'
  ];
  expected_tables constant text[] := ARRAY[
    'users', 'telegram_identities', 'user_sessions', 'user_settings',
    'user_activity_states', 'profiles', 'travel_intents',
    'discover_interest_decisions', 'chats', 'chat_participants', 'trips',
    'trip_participants'
  ];
  actual_history text[];
  missing_tables text[];
  runtime_ok boolean;
  postgres_ok boolean;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'refusing: migration connection must authenticate as postgres (current=%, session=%)', current_user, session_user;
  END IF;

  SELECT rolsuper = false AND rolbypassrls AND rolcreaterole AND rolcreatedb
  INTO postgres_ok FROM pg_roles WHERE rolname = 'postgres';
  IF COALESCE(postgres_ok, false) = false THEN
    RAISE EXCEPTION 'refusing: postgres does not have expected managed-Supabase attributes';
  END IF;

  SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
         AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication
  INTO runtime_ok FROM pg_roles WHERE rolname = 'app_runtime';
  IF COALESCE(runtime_ok, false) = false THEN
    RAISE EXCEPTION 'refusing: app_runtime is absent or has unsafe attributes';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'app_runtime'
  ) THEN
    RAISE EXCEPTION 'refusing: app_runtime has role memberships';
  END IF;

  SELECT array_agg(version ORDER BY version) INTO actual_history
  FROM supabase_migrations.schema_migrations;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = ANY (target_versions)
  ) THEN
    RAISE EXCEPTION 'refusing: one or more target migration versions are already registered';
  END IF;
  IF actual_history IS DISTINCT FROM expected_prior THEN
    RAISE EXCEPTION 'refusing: remote migration history is not exactly the expected six predecessors: %', actual_history;
  END IF;

  SELECT array_agg(table_name ORDER BY table_name) INTO missing_tables
  FROM unnest(expected_tables) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'refusing: required source tables are missing: %', missing_tables;
  END IF;
END;
$$;

SELECT c.relname AS application_table, pg_get_userbyid(c.relowner) AS owner
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname = ANY (ARRAY[
    'users', 'telegram_identities', 'profiles', 'profile_photos',
    'user_settings', 'user_activity_states', 'travel_intents', 'user_sessions',
    'discover_interest_decisions', 'matches', 'chats', 'chat_participants',
    'messages', 'chat_summaries', 'trips', 'trip_participants', 'trip_stops'
  ])
ORDER BY c.relname;
SQL
```

The preflight explicitly rejects any registered target version; exact equality
to the six predecessors additionally proves that no other local migration is
pending. Do not relax this condition. If the project later legitimately receives
another migration, update this runbook in a separately reviewed change; do not
run it unchanged.

Also run the CLI’s read-only plan. Its list must contain exactly the five files
above, in that order, and nothing else:

```zsh
supabase db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN" --dry-run
```

## Exact apply command for Leonid

Only after both preflight checks passed and the dry-run list was checked:

```zsh
supabase db push --db-url "$SUPABASE_PRODUCTION_MIGRATOR_DSN"
```

Do not append flags. In particular, do not use `--include-all`; standard
`db push` is the mechanism that respects the remote migration history.

## Read-only post-migration verification

Run immediately after a successful `db push`. It checks history, all functions,
their expected owner/security/search path/effective grants, RLS and exact policy
sets, `app_runtime`, and table ownership. The expected grants are deliberately
only those present in the five migrations: the four profile projection
capabilities are executable by `app_runtime`; no additional runtime function or
table grant is added here.

```zsh
psql -X -v ON_ERROR_STOP=1 "$SUPABASE_PRODUCTION_MIGRATOR_DSN" <<'SQL'
SELECT current_user, session_user;

DO $$
DECLARE
  target_versions constant text[] := ARRAY[
    '20260901160000', '20260901170000', '20260901180000',
    '20260901190000', '20260901200000'
  ];
  expected_functions constant text[] := ARRAY[
    'public.current_authenticated_user_id()',
    'public.resolve_bearer_session(text)',
    'public.bootstrap_telegram_login(bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'public.discover_eligible_travel_intents()',
    'public.archive_current_active_travel_intent()',
    'public.discover_candidate_profile_projection()',
    'public.discover_target_is_eligible(uuid)',
    'public.chat_participant_profile_projection(uuid)',
    'public.trip_participant_profile_projection(uuid)'
  ];
  signature text;
  fn_oid oid;
  expected_definer boolean;
  expected_runtime_execute boolean;
  history_count integer;
  runtime_ok boolean;
  policy_names text[];
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'verification connection is not postgres';
  END IF;
  SELECT count(*) INTO history_count
  FROM supabase_migrations.schema_migrations
  WHERE version = ANY (target_versions);
  IF history_count <> 5 THEN
    RAISE EXCEPTION 'expected five target versions in migration history, found %', history_count;
  END IF;

  FOREACH signature IN ARRAY expected_functions LOOP
    fn_oid := to_regprocedure(signature);
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'missing function %', signature;
    END IF;
    expected_definer := signature <> 'public.current_authenticated_user_id()';
    expected_runtime_execute := signature = ANY (ARRAY[
      'public.discover_candidate_profile_projection()',
      'public.discover_target_is_eligible(uuid)',
      'public.chat_participant_profile_projection(uuid)',
      'public.trip_participant_profile_projection(uuid)'
    ]);
    IF (SELECT prosecdef FROM pg_proc WHERE oid = fn_oid) <> expected_definer
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = fn_oid) <> 'postgres'
       OR COALESCE((SELECT proconfig @> ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid = fn_oid), false) <> expected_definer
       OR has_function_privilege('PUBLIC', fn_oid, 'EXECUTE')
       OR has_function_privilege('app_runtime', fn_oid, 'EXECUTE') <> expected_runtime_execute THEN
      RAISE EXCEPTION 'function security metadata/grants do not match migration: %', signature;
    END IF;
  END LOOP;

  SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
         AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication
  INTO runtime_ok FROM pg_roles WHERE rolname = 'app_runtime';
  IF COALESCE(runtime_ok, false) = false
     OR EXISTS (
       SELECT 1 FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       WHERE member.rolname = 'app_runtime'
     ) THEN
    RAISE EXCEPTION 'app_runtime attributes or memberships changed unexpectedly';
  END IF;

  IF COALESCE((SELECT relrowsecurity AND NOT relforcerowsecurity
               FROM pg_class WHERE oid = 'public.travel_intents'::regclass), false) = false
     OR COALESCE((SELECT relrowsecurity AND NOT relforcerowsecurity
                  FROM pg_class WHERE oid = 'public.profiles'::regclass), false) = false THEN
    RAISE EXCEPTION 'RLS is not enabled exactly as expected on travel_intents and profiles';
  END IF;
  SELECT array_agg(policyname ORDER BY policyname) INTO policy_names
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'travel_intents';
  IF policy_names IS DISTINCT FROM ARRAY[
    'travel_intents_insert_own_active', 'travel_intents_select_own_active',
    'travel_intents_update_own_active'
  ] THEN
    RAISE EXCEPTION 'travel_intents policies do not exactly match the migration: %', policy_names;
  END IF;
  SELECT array_agg(policyname ORDER BY policyname) INTO policy_names
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  IF policy_names IS DISTINCT FROM ARRAY[
    'profiles_insert_own', 'profiles_select_own', 'profiles_update_own'
  ] THEN
    RAISE EXCEPTION 'profiles policies do not exactly match the migration: %', policy_names;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname = ANY (ARRAY[
        'users', 'telegram_identities', 'profiles', 'profile_photos',
        'user_settings', 'user_activity_states', 'travel_intents', 'user_sessions',
        'discover_interest_decisions', 'matches', 'chats', 'chat_participants',
        'messages', 'chat_summaries', 'trips', 'trip_participants', 'trip_stops'
      ])
      AND pg_get_userbyid(c.relowner) = 'app_runtime'
  ) THEN
    RAISE EXCEPTION 'an application table is unexpectedly owned by app_runtime';
  END IF;
END;
$$;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('travel_intents', 'profiles')
ORDER BY c.relname;

SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('travel_intents', 'profiles')
ORDER BY tablename, policyname;

SELECT c.relname AS application_table, pg_get_userbyid(c.relowner) AS owner
FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relname = ANY (ARRAY[
    'users', 'telegram_identities', 'profiles', 'profile_photos',
    'user_settings', 'user_activity_states', 'travel_intents', 'user_sessions',
    'discover_interest_decisions', 'matches', 'chats', 'chat_participants',
    'messages', 'chat_summaries', 'trips', 'trip_participants', 'trip_stops'
  ])
ORDER BY c.relname;
SQL
```

Expected policies, with no `DELETE` policy:

- `profiles`: `profiles_select_own`, `profiles_insert_own`, `profiles_update_own`;
- `travel_intents`: `travel_intents_select_own_active`,
  `travel_intents_insert_own_active`, `travel_intents_update_own_active`.

The displayed ownership list must be identical to the baseline captured in
preflight. RLS is enabled and `FORCE ROW LEVEL SECURITY` remains false on both
tables. Do not run application writes as a verification probe: this work item
does not switch the backend credential.

## Failure and partial-failure handling

If preflight, dry-run, `db push`, or verification fails:

1. Stop. Do not retry with flags, edit the existing migrations, deploy, grant
   privileges, use `migration repair`, or manually change history.
2. Preserve the complete command output and query
   `supabase_migrations.schema_migrations` read-only to identify the exact
   registered prefix of the five versions.
3. A later operator may rerun the same standard `db push` only after the cause
   is reviewed. Registered versions are skipped, so the remaining suffix is
   discoverable and will not be duplicated. An unregistered failed migration is
   not treated as applied.
4. Any schema remediation or rollback is a separate approved change; it is not
   part of this runbook.

Because the backend remains on privileged `postgres` and no deployment changes,
successful application only adds the functions, two RLS settings, six policies,
and the five migration-history rows. It does not change existing application
table owners or product logic.

## Deferred risk

The local runtime-role setup grants more access than these five hosted
migrations. In particular, these migrations alone do not grant `app_runtime`
execution of `current_authenticated_user_id`, the bearer/login capabilities, or
the travel-intent capabilities, and do not issue its table grants. This is
intentional in this scope and safe while Render stays on its privileged rollback
configuration, but it is a blocker for any future switch to `app_runtime` until
a separately reviewed grants work item and runtime verification are completed.
