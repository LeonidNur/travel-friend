# Telegram Mini App: локальная настройка

Этот документ описывает безопасную локальную конфигурацию для Telegram Bot и Mini App.

## Где хранить bot token

`TELEGRAM_BOT_TOKEN` храните только в `apps/mini-app/.env.local`.

## Где хранить URL

`TELEGRAM_WEB_APP_URL` храните в `apps/mini-app/.env.local`.
Туда же указывайте локальный `ngrok`-адрес или публичный `Vercel` URL, если вы тестируете Mini App через внешний адрес.

## Что нельзя коммитить

Файл `apps/mini-app/.env.local` не должен попадать в Git. Он уже добавлен в `apps/mini-app/.gitignore`.

## Пример `.env.local`

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEB_APP_URL=
```

Значения оставляйте пустыми в шаблоне и подставляйте реальные данные только локально у себя.

## Следующий шаг

На следующем этапе WebApp-кнопку будем настраивать через Telegram Bot API.
