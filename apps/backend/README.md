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

`TELEGRAM_BOT_TOKEN` не имеет fallback-значения: без него backend не запускается. Verifier принимает только raw `initData`; он не доверяет `initDataUnsafe` или отдельно переданному user id.
