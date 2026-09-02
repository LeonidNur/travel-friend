# User Flows

## Базовый пользовательский сценарий

```text
Открытие Telegram Mini App
→ вход через Telegram
→ заполнение профиля
→ заполнение travel-анкеты
→ просмотр потенциальных попутчиков
→ выражение интереса
→ взаимный мэтч
→ создание чата
→ обсуждение поездки
→ обсуждение в direct или group Chat
→ создание Trip из Chat
→ просмотр server-side Trip в списке и read-only detail
```

## Граница текущего MVP

Group Chat создаётся создателем из минимум двух existing matched/direct-chat companions; вместе с создателем в нём минимум три участника. Состав фиксирован для MVP, persisted group title отсутствует, а persisted messages доступны всем участникам. `POST /chats/{chatId}/trips` создаёт Trip из direct или group Chat и сразу добавляет всех активных ChatParticipant как TripParticipant; `TripInvitation` не используется. Mini App вызывает endpoint из Chat Room: при `201` открывает Trip Detail, при `409` читает `GET /trips` и открывает existing unfinished Trip того же Chat. Invitations, add/remove/leave, roles/admin/permissions, invite links, редактирование Trip, realtime, read receipts, pagination и AI/Proposal остаются deferred.
