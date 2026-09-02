# Telegram Mini App: локальная настройка

Этот документ описывает безопасную локальную конфигурацию для Telegram Bot и Mini App.

## Какой контур используем

Для проверки Telegram Mini App теперь используем `Vercel` вместо `ngrok`.

Причина простая:

- Vercel даёт стабильный публичный URL;
- Telegram Mini App проще проверять в одном и том же адресе;
- поведение ближе к реальному внешнему окружению;
- не нужно каждый раз пересобирать и перенастраивать временный туннель.

## Переменные окружения

`TELEGRAM_BOT_TOKEN` нужен только FastAPI backend для server-side проверки raw `initData`. Не передавайте его в Next.js/Mini App и не используйте client-prefixed environment variables.

Для Mini App локально используйте `apps/mini-app/.env.local`:

```env
TELEGRAM_WEB_APP_URL=https://your-vercel-url.example
BACKEND_API_ORIGIN=http://127.0.0.1:8000
```

`BACKEND_API_ORIGIN` используется Next.js rewrite для `/api/backend/*`. Он должен указывать на доступный backend environment; production значение и deployment/runbook backend пока не зафиксированы.

Храните `TELEGRAM_BOT_TOKEN` и `DATABASE_URL` только в environment backend-процесса, например:

```env
TELEGRAM_BOT_TOKEN=
DATABASE_URL=
```

## Что нельзя коммитить

Локальные env-файлы Mini App и backend не должны попадать в Git.

## Пример `.env.local`

Значения оставляйте пустыми в шаблонах и подставляйте реальные данные только в соответствующем окружении.

## Следующий шаг

WebApp-кнопку настраиваем автоматически через npm-скрипт, чтобы не делать это вручную в каждом цикле.

## Автоматическая настройка кнопки Mini App

Выполните команду:

```bash
npm run telegram:set-menu
```

## Статус deployment

Vercel — текущий публичный контур frontend Mini App и URL для Telegram Menu Button. FastAPI backend, PostgreSQL/Supabase и безопасное production значение `BACKEND_API_ORIGIN` требуют отдельного deployment work item; не следует считать Vercel deployment Mini App готовым production deployment всей системы.
