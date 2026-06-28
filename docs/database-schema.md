# Database Schema

## Основные сущности MVP

## `users`

Пользователи приложения.

Поля:

- `id`
- `telegram_id`
- `username`
- `first_name`
- `last_name`
- `photo_url`
- `created_at`

## `profiles`

Расширенный профиль пользователя.

Поля:

- `id`
- `user_id`
- `age`
- `city`
- `bio`
- `interests`
- `languages`
- `travel_style`
- `social_links`
- `created_at`
- `updated_at`

## `travel_forms`

Travel-анкета пользователя.

Поля:

- `id`
- `user_id`
- `destinations`
- `budget_min`
- `budget_max`
- `date_from`
- `date_to`
- `trip_duration`
- `comfort_level`
- `accommodation_preferences`
- `activity_preferences`
- `important_limits`

## `match_likes`

Интерес одного пользователя к другому.

Поля:

- `id`
- `from_user_id`
- `to_user_id`
- `status`
- `created_at`

## `matches`

Взаимный интерес между пользователями.

Поля:

- `id`
- `user_a_id`
- `user_b_id`
- `created_at`

## `chats`

Чаты после мэтча или групповые чаты поездки.

Поля:

- `id`
- `type`
- `title`
- `created_by`
- `created_at`

## `chat_members`

Участники чата.

Поля:

- `id`
- `chat_id`
- `user_id`
- `role`
- `joined_at`

## `messages`

Сообщения в чате.

Поля:

- `id`
- `chat_id`
- `user_id`
- `content`
- `message_type`
- `created_at`

## `ai_requests`

Запросы к AI Travel Copilot.

Поля:

- `id`
- `chat_id`
- `user_id`
- `command`
- `input`
- `output`
- `created_at`

## Важно

На MVP схема может быть простой.  
Главная задача — быстро проверить продуктовую гипотезу, а не построить идеальную базу данных.