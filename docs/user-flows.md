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

Текущее состояние: Group Chat создаётся из минимум двух existing matched/direct-chat companions; вместе с создателем в нём минимум три участника. Состав фиксирован, persisted group title пока отсутствует. `POST /chats/{chatId}/trips` создаёт Trip из direct или group Chat и сразу добавляет всех активных ChatParticipant как TripParticipant; `TripInvitation` не используется. Mini App открывает созданную Trip; при `409` читает `GET /trips` и находит existing unfinished Trip того же Chat.

Утверждённая Pre-Beta UX-дельта: Group Chat получает пользовательское название при создании и rename flow при фиксированном составе; permission на переименование требует отдельного contract/authorization решения. Chats List показывает последнее сообщение, его время и unread indicator. В Chat явное действие зависит от состояния: «Создать поездку» либо «Открыть поездку»; `409` остаётся recovery fallback. Creator Trip — атрибуция, не административная роль. Confirmed Trip меняется через baseline Proposal flow, не односторонним действием creator. AI Copilot и базовый Proposal flow обязательны до первого внешнего теста, но пока не реализованы. Preview Mode нет; onboarding обязателен. Первая бета русскоязычная без locale switcher/full i18n.

Invitations, add/remove/leave, roles/admin/permissions, invite links и расширенный Trip lifecycle не входят в согласованный UX scope первой беты. Текущее отсутствие realtime/unread/last-message preview — implementation status, не scope exclusion: реализация относится к [Live Chats](pre-beta-development-plan.md#3-live-chats). AI/Proposal также обязательны до внешнего теста и ещё не реализованы; см. [Proposal foundation](pre-beta-development-plan.md#5-proposal-foundation-и-интеграционная-граница-ии).
