# Database Schema

## Основные сущности

На MVP нужны только базовые таблицы.

## `users`

Пользователи приложения.

Поля:

- `id`
- `name`
- `age`
- `city`
- `bio`
- `created_at`

## `travel_profiles`

Профиль путешественника.

Поля:

- `id`
- `user_id`
- `interests`
- `preferred_destinations`
- `budget_min`
- `budget_max`
- `preferred_dates`
- `travel_style`

## `trip_intents`

Желание пользователя найти поездку.

Поля:

- `id`
- `user_id`
- `destination`
- `date_from`
- `date_to`
- `budget`
- `description`
- `status`

## `matches`

Взаимный интерес между пользователями.

Поля:

- `id`
- `user_a_id`
- `user_b_id`
- `status`
- `created_at`

## `trip_chats`

Чаты будущих поездок.

Поля:

- `id`
- `title`
- `destination`
- `created_by`
- `created_at`

## `chat_members`

Участники чата.

Поля:

- `id`
- `chat_id`
- `user_id`
- `role`

## `messages`

Сообщения в чате.

Поля:

- `id`
- `chat_id`
- `user_id`
- `content`
- `message_type`
- `created_at`

## `ai_summaries`

Краткие выводы ИИ по обсуждению.

Поля:

- `id`
- `chat_id`
- `summary`
- `created_at`

## Важно

На MVP схема может быть простой.  
Главная задача — быстро проверить продуктовую гипотезу, а не построить идеальную базу данных.