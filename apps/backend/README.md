# Travel Friend Backend

Минимальный FastAPI runtime и серверная проверка Telegram Mini App raw `initData`.

## Инструменты и локальные переменные

Нужны Python 3.12+ и установленный `uv`; зависимости и их версии зафиксированы
в `uv.lock`. CI выбирает Python 3.12 и устанавливает `uv` через
`setup-uv@v10.3.0`; точная версия исполняемого `uv` отдельно в репозитории не
зафиксирована. Для PostgreSQL integration workflow нужен Docker с возможностью
запускать локальные контейнеры. Скрипт использует только образ
`postgres:17-alpine`; Node.js и Supabase CLI для локального backend и этого
workflow не нужны. Установка backend-зависимостей из lockfile:

```bash
cd apps/backend
uv sync --locked --group dev
```

Backend требует `TELEGRAM_BOT_TOKEN` и `DATABASE_URL` в окружении процесса.
Токен нужен для серверной проверки Telegram raw `initData`; `DATABASE_URL`
должен указывать на PostgreSQL и использоваться только на сервере. Для локальной
разработки значения передавайте в shell environment, не сохраняйте и не
коммитьте реальные секреты в env-файлах:

```bash
export TELEGRAM_BOT_TOKEN='your-telegram-bot-token'
```

Для `DATABASE_URL` сначала подготовьте выделенную disposable БД по разделу ниже.
Скрипт выдаёт отдельный runtime URL роли `app_runtime`; не используйте owner URL
как runtime URL.

## Локальный запуск

Из `apps/backend` подготовьте локальную БД и настройте runtime-подключение:

```bash
./scripts/local-test-db.sh reset
export DATABASE_URL="$(./scripts/local-test-db.sh runtime-url)"
uv run --python 3.12 uvicorn travel_friend_backend.main:app --reload
```

`reset` пересоздаёт схему только в защищённом скриптом контейнере
`travel-friend-test-postgres` и применяет migrations. Убедитесь, что это именно
локальный disposable workflow: не направляйте destructive DB-команды или
тестовые URL на неизвестную, общую либо production БД. Production migrations и
grants — отдельная операторская процедура, описанная в
[production security migrations runbook](../../docs/backend/production-security-migrations-runbook.md);
этот завершённый cutover нельзя повторять как обычный локальный setup.

Проверка liveness и readiness endpoints:

```bash
curl http://127.0.0.1:8000/health
curl --fail --show-error --silent http://127.0.0.1:8000/ready
```

`/health` проверяет только liveness процесса и не подключается к DB. `/ready`
проверяет минимальную runtime dependency: новое соединение через `DATABASE_URL` и
`SELECT 1`; при DB failure возвращает generic `503`. После backend deploy
оператор проверяет `/ready` перед восстановлением или подтверждением готовности
traffic. В репозитории нет platform health-check configuration, поэтому этот
контракт не утверждает, что Render автоматически использует `/ready`.

Запуск backend suite без PostgreSQL integration target:

```bash
uv run --python 3.12 --group dev pytest --cov
```

PostgreSQL integration tests запускайте отдельным disposable workflow ниже.
Для него не переиспользуйте production/development `DATABASE_URL`.

## PostgreSQL integration tests

Для PostgreSQL-backed tests используется отдельный disposable контейнер `postgres:17-alpine`, а не local/hosted Supabase: существующий Supabase CLI поднимает БД `postgres`, тогда как destructive tests разрешают только выделенную `travel_friend_test`. Нужен Docker; image будет загружен при первом запуске.

Из `apps/backend`:

```bash
# Поднять изолированный PostgreSQL только на 127.0.0.1:55432.
./scripts/local-test-db.sh start

# Destructive только для защищённого локального disposable контейнера:
# пересоздать public schema, включить pgcrypto и применить migrations.
./scripts/local-test-db.sh reset

# Получить отдельные owner/runtime URL, если tests нужно запустить вручную.
export TEST_DATABASE_URL="$(./scripts/local-test-db.sh url)"
export DATABASE_URL="$(./scripts/local-test-db.sh runtime-url)"
uv run --python 3.12 --group dev pytest --cov

# Или выполнить reset и весь PostgreSQL-backed suite одной командой.
./scripts/local-test-db.sh test

# Удалить контейнер и все его данные.
./scripts/local-test-db.sh stop
```

Скрипт создаёт только контейнер `travel-friend-test-postgres` с label
disposable test DB, публикует порт только на `127.0.0.1:55432` и использует БД
`travel_friend_test`; `reset` и `stop` откажутся менять контейнер без этого
label. Сам workflow не принимает внешний DB target: он передаёт pytest
`TEST_DATABASE_URL` owner-роли и `DATABASE_URL` runtime-роли, оба для этой
локальной БД. Поэтому утверждение, что `DATABASE_URL` удаляется из окружения
pytest, неверно: скрипт явно переопределяет его безопасным локальным runtime URL.
Guard в tests независимо проверяет loopback host, порт, имя БД и ожидаемую роль,
повторно валидирует target перед `TRUNCATE` и отклоняет неподходящий target.
Для ручного запуска команду `export DATABASE_URL=...` выше также выполняйте
только с локальным `runtime-url` этого скрипта.

После migrations workflow применяет version-controlled
`scripts/local-test-db-runtime-role.sql`: application objects остаются owned
`travel_friend_test`, а FastAPI подключается как non-owner `app_runtime`.
`TEST_DATABASE_URL` — локальное owner-подключение только для fixture
setup/cleanup; `DATABASE_URL` — локальная роль `app_runtime` для запросов
приложения и TestClient. Production roles, grants, migrations и gate — отдельный
контур; SQL и процедуры для него описаны в [production security migrations
runbook](../../docs/backend/production-security-migrations-runbook.md), а
общие security boundaries — в [backend security](../../docs/backend/security.md).
Локальный SQL-файл runtime role не является hosted Supabase migration и не
предназначен для запуска на удалённой БД.

Для production runbook использует migrations из `supabase/migrations/`,
`grant-production-app-runtime-privileges.sql`, read-only
`verify-production-app-runtime-privileges.sql` и
`production-runtime-deployment-gate.py`. Runbook фиксирует уже завершённый
cutover и его preconditions; не запускайте эти операции повторно или на
неизвестном target. Проверки verifier и gate не заменяют согласование отдельной
production-операции.

## Окружения и ingress

- **Local:** FastAPI запускается через Uvicorn; `DATABASE_URL` указывает на
  локальную disposable БД и роль `app_runtime`.
- **Test:** `local-test-db.sh test` пересоздаёт только выделенный контейнер,
  применяет migrations и grants тестовой runtime-роли, затем запускает
  `pytest --cov` с явными локальными `TEST_DATABASE_URL` и `DATABASE_URL`.
- **Production:** Render — backend-контур, а Vercel — frontend-контур. В коде
  предусмотрен путь Browser/Telegram → Vercel Next.js → rewrite
  `/api/backend/*` на `BACKEND_API_ORIGIN` → backend FastAPI/Uvicorn; Render
  документирован как backend-контур. Фактическая production-цель задаётся
  окружением deployment и не зашита в репозиторий. Production `DATABASE_URL` — секрет
  runtime-роли `app_runtime`. История и preconditions migrations/grants/gate
  описаны в [production runbook](../../docs/backend/production-security-migrations-runbook.md).

FastAPI middleware ограничивает raw request body значением 256 KiB
(262144 bytes) и возвращает `413` при превышении; детали HTTP-контрактов — в
[backend contracts](../../docs/backend/backend-contracts.md). Это лимит самого
backend. Настройки и эффективные body/request limits Next.js, Vercel и Render
в репозитории не зафиксированы; их значения и порядок применения нужно
подтвердить в текущей конфигурации providers перед external test или изменением
payload size. Также из файлов репозитория нельзя подтвердить, закрыт ли прямой
доступ к backend в обход Vercel rewrite.

`TELEGRAM_BOT_TOKEN` не имеет fallback-значения: без него backend не запускается. Verifier принимает только raw `initData`; он не доверяет `initDataUnsafe` или отдельно переданному user id.
