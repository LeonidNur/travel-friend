# Feature List

## Реализовано в MVP

### Telegram Mini App и доступ

- вход через проверку raw Telegram `initData` на backend и Bearer session;
- onboarding с заполнением профиля и TravelIntent.

### Profile и TravelIntent

- просмотр и редактирование профиля: имя, дата рождения/возраст, город, описание, интересы, стиль поездки, бюджет и уровень комфорта;
- одна активная TravelIntent с направлением и необязательными датами.

### Discover и Match

- просмотр подходящих кандидатов при выполненном onboarding, заполненном профиле и активном TravelIntent;
- финальное решение `interested` или `rejected`;
- взаимный интерес создаёт Match и direct Chat.

### Chats

- список и persisted история direct Chats;
- Group Chat из существующих matched direct-chat companions: минимум три участника вместе с создателем, persisted сообщения и фиксированный состав;
- текстовые сообщения сохраняются и читаются участниками.

### Trips

- создание Trip из direct или group Chat с переносом всех текущих ChatParticipant в TripParticipant;
- список и read-only detail Trip, включая участников и чтение `trip_stops`;
- при `409` Mini App находит и открывает незавершённую Trip этого Chat через `GET /trips`.

## Реализовано частично

- Profile photos: таблица предусмотрена схемой БД; UI и API загрузки/управления фото отсутствуют.
- Messaging: доступны persisted текст и история; realtime, pagination и read receipts отсутствуют.
- Trips: создание и чтение реализованы; изменение данных и lifecycle-команды отсутствуют.

## Отложено

- AI Travel Copilot, `Proposal`, генерация маршрута и внешние travel provider-интеграции — до подключения второго разработчика;
- расширенный Group Chat lifecycle: invitations, добавление/удаление участников, выход, роли/admin/permissions, invite links, название группы и изменение состава;
- TripInvitation и расширенный lifecycle поездки;
- Discover filters/ranking;
- геймификация, рейтинги, верификация, подписки, travel-сервис интеграции и отдельное мобильное приложение.
