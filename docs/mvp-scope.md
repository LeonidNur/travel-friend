# MVP Scope

## Главная гипотеза MVP

Люди готовы использовать Telegram Mini App, чтобы:

- заполнить профиль путешественника;
- найти потенциальных попутчиков;
- выразить интерес к людям;
- получить взаимный мэтч;
- перейти в чат;
- обсудить поездку;
- создать и просмотреть совместную Trip из direct или group Chat.

## Что входит в MVP

- запуск Telegram Mini App;
- вход пользователя через Telegram;
- профиль пользователя;
- travel-анкета;
- поиск потенциальных попутчиков;
- простая механика совместимости;
- механика взаимного интереса / мэтча;
- создание чата после совпадения;
- обсуждение поездки;
- Chats List с последним сообщением, временем и unread indicator (доставка/read state — отдельный Live Chats block);
- Group Chat: инициатор выбирает existing matched/direct-chat companions; в группе минимум три участника вместе с инициатором; пользовательское название необязательно (до 80 Unicode code points), blank отображается как «Групповой чат», любое active group membership может переименовать; direct Chats не имеют title; сообщения persisted и видны в Chats; состав фиксирован;
- создание Trip из direct или group Chat с переносом всех текущих `ChatParticipant` в `TripParticipant`;
- создание Trip из existing direct или group Chat через Chat Room; при `409` Mini App через `GET /trips` открывает existing unfinished Trip того же Chat;
- список и detail сохранённых Trip, включая участников и `trip_stops`;
- AI Travel Copilot и базовый Proposal flow — обязательный Pre-Beta scope до первого внешнего теста. Copilot помогает в контексте Chat/Trip; подтверждённое состояние Trip меняется только после согласования Proposal. Эти slices ещё не реализованы; детали и зависимости находятся в [Pre-Beta Development Plan](pre-beta-development-plan.md).
- Явное действие Chat «Создать поездку» / «Открыть поездку» зависит от состояния; `409` остаётся recovery fallback.
- Первая бета русскоязычная, без переключения локалей и полноценной i18n-системы.
- Live Chats до внешнего теста включает realtime incoming messages, preview/time/unread, read/reconnect recovery и необходимые history bounds; scope ограничен [Pre-Beta Development Plan](pre-beta-development-plan.md).

## Что НЕ входит в MVP

- отдельное мобильное приложение для iOS и Android;
- публикация в App Store и Google Play;
- покупка билетов;
- бронирование отелей;
- юридическая верификация документов;
- сложная рекомендательная ML-система;
- полноценная геймификация;
- платные подписки;
- маркетплейс украшений профиля;
- интеграции с авиакомпаниями, отелями и туроператорами;
- генерация маршрута и внешние provider-интеграции;
- invitations, add/remove members, leave, roles/admin/permissions, invite links и сложный membership lifecycle Group Chat;
- расширенные messenger features сверх Live Chats scope Pre-Beta;
- TripInvitation и расширенный Trip lifecycle;
- Preview Mode: onboarding обязателен.

## Критерий успеха MVP

MVP считается успешным, если пользователи:

- проходят вход через Telegram;
- заполняют профиль и travel-анкету;
- просматривают других пользователей;
- используют механику интереса / мэтча;
- переходят к обсуждению поездки;
- создают Trip из direct или group Chat и видят её сохранённое состояние после повторного открытия приложения;
- до первого внешнего теста используют встроенный AI Copilot и базовый Proposal flow для согласования изменений Trip.
