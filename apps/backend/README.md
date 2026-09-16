# Travel Friend Backend

Минимальный FastAPI runtime и серверная проверка Telegram Mini App raw `initData`.

## Локальный запуск

Нужен Python 3.12+ и `uv`. Укажите bot token только в окружении процесса:

```bash
cd apps/backend
export TELEGRAM_BOT_TOKEN='your-telegram-bot-token'
uv run --python 3.12 uvicorn travel_friend_backend.main:app --reload
```

Проверка health endpoint:

```bash
curl http://127.0.0.1:8000/health
```

Проверка тестов verifier:

```bash
uv run --python 3.12 --group dev pytest --cov
```

## PostgreSQL integration tests

Для PostgreSQL-backed tests используется отдельный disposable контейнер `postgres:17-alpine`, а не local/hosted Supabase: существующий Supabase CLI поднимает БД `postgres`, тогда как destructive tests разрешают только выделенную `travel_friend_test`. Нужен Docker; image будет загружен при первом запуске.

Из `apps/backend`:

```bash
# Поднять изолированный PostgreSQL только на 127.0.0.1:55432.
./scripts/local-test-db.sh start

# Полностью пересоздать public schema, включить pgcrypto и применить все migrations.
./scripts/local-test-db.sh reset

# Получить local TEST_DATABASE_URL, если tests нужно запустить вручную.
export TEST_DATABASE_URL="$(./scripts/local-test-db.sh url)"
env -u DATABASE_URL uv run --python 3.12 --group dev pytest --cov

# Или выполнить reset и весь PostgreSQL-backed suite одной командой.
./scripts/local-test-db.sh test

# Удалить контейнер и все его данные.
./scripts/local-test-db.sh stop
```

Скрипт создаёт только контейнер `travel-friend-test-postgres` с label disposable test DB, binding исключительно на loopback и БД `travel_friend_test`; он откажется удалять контейнер без этого label. Guard в tests допускает только loopback URL этой БД на порту `55432`, повторно валидирует target непосредственно перед `TRUNCATE` и отклоняет совпадение с `DATABASE_URL`. В workflow `DATABASE_URL` удаляется из окружения pytest, поэтому production/development URL не может стать target тестов.

`TELEGRAM_BOT_TOKEN` не имеет fallback-значения: без него backend не запускается. Verifier принимает только raw `initData`; он не доверяет `initDataUnsafe` или отдельно переданному user id.
