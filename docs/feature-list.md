# Feature List

## MVP-функции

### Telegram Mini App

- открытие приложения внутри Telegram;
- server-side проверка raw `initData` и backend session;
- onboarding profile и TravelIntent.

### Профиль

- имя;
- возраст;
- город;
- фото — physical storage поддержан схемой, UI/API ещё не реализованы;
- описание;
- интересы;
- стиль отдыха.

### Travel-анкета

- одно активное направление;
- даты;
- уровень комфорта;

### Поиск попутчиков

- карточки пользователей;
- финальное решение `interested` / `rejected`;
- взаимный мэтч.

### Чат

- чат после мэтча;
- текстовые сообщения;
- серверная история сообщений без realtime/read receipts.
- Group Chat: создатель выбирает existing matched/direct-chat companions, в группе минимум три участника вместе с создателем, сообщения persisted, а состав после создания фиксирован;
- из direct и group Chat создаётся Trip, при этом все текущие `ChatParticipant` становятся `TripParticipant`.

### Trips

- создание из existing direct или group Chat через Mini App;
- все активные ChatParticipant сразу становятся TripParticipant;
- при `409` Mini App читает `GET /trips` и открывает existing unfinished Trip того же Chat;
- список и read-only detail Trip;
- read `trip_stops`.

## После MVP

- полноценная геймификация;
- рейтинги;
- верификация;
- подписки;
- интеграции с travel-сервисами;
- отдельное мобильное приложение.
- AI Travel Copilot / Proposal и внешние travel provider-интеграции (отложены до подключения второго разработчика);
- invitations, add/remove members, leave, roles/admin/permissions, invite links, persisted group title и сложный membership lifecycle Group Chat;
- TripInvitation и расширенный lifecycle поездки;
- realtime messaging, pagination и read receipts;
- Profile photo UI/API и Discover filters/ranking.
