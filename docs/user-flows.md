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
→ обсуждение в direct Chat
→ просмотр server-side Trip в списке и read-only detail, если она уже создана
```

## Граница текущего MVP

`POST /chats/{chatId}/trips` уже создаёт Trip и сразу добавляет обоих участников direct Chat как TripParticipant, но кнопка/вызов этого endpoint в Mini App ещё не реализованы. `TripInvitation` в этом direct-chat flow не создаётся и не используется. Базовый Group Chat входит в MVP, но пока не реализован; invitations и сложный membership lifecycle, редактирование Trip, realtime и AI/Proposal остаются отложенными сценариями. AI возвращается в план только после подключения второго разработчика.
