# Дневник разработки

## 2026-09-02 — Backend-backed direct-chat MVP и pre-mega-review sync

### Что сделали

- Завершили frontend integration Profile/TravelIntent и onboarding: backend session определяет текущего пользователя, а UI восстанавливает профиль и active TravelIntent.
- Завершили persisted Discover: candidates доступны только при completed onboarding и active TravelIntent; `interested` / `rejected` final, reciprocal interest создаёт Match и direct Chat.
- Завершили persisted direct Chats/Messages: доступны list, history и создание текстового сообщения с server-side sequence.
- Добавили Trips persistence, server API создания Trip из existing direct Chat, `trip_stops` persistence, `GET /trips` и `GET /trips/{tripId}`; Trips List и Detail используют read contracts. UI ещё не вызывает Trip creation endpoint.
- Зафиксировали current direct-chat rule: при создании Trip оба текущих ChatParticipant сразу создаются как TripParticipant. `TripInvitation` в этом MVP не используется и остаётся частью future/group lifecycle design.
- Провели docs-only sync перед MVP mega-review: historical/logical design отделён от already implemented HTTP/persistence slices; AI/Proposal явно отложен до подключения второго разработчика.

### Что проверили

- Сверили migrations, FastAPI routes/schemas, contract tests, Next.js API client и integration commits `2026-08-31` — `2026-09-02`.
- Проверки документационного прохода фиксируются в текущем changeset: `git diff --check` и review ссылок/статусов; код, migrations и tests не менялись.

### Оставшиеся риски и TODO

- Нет documented production deployment backend, RLS policies и production `BACKEND_API_ORIGIN`; Vercel покрывает Mini App, но не весь backend stack.
- Direct-chat Trip сейчас read/create-only: нет write/lifecycle endpoints, stop editor, invitation/group flow или Proposal.
- `POST /chats/{chatId}/trips` не подключён к Mini App UI; это DOC/implementation gap для завершения пользовательского creation flow.
- Messages пока без realtime, pagination, read/unread и UI logout; session token живёт только в runtime state frontend.
- Current Discover не включает impressions, filters/ranking или отдельный match list.
- Existing logical ER/AI docs описывают future architecture. Перед реализацией invitation/group lifecycle нужно отдельное решение, а не перенос этой design-модели в current direct-chat flow.

## 2026-08-26 — Core Identity + Telegram Auth backend checkpoint

### Что сделали

- Настроили local Supabase CLI workflow и local PostgreSQL/Supabase environment.
- Реализовали Core Identity persistence: `users`, `telegram_identities`, `profiles`, `profile_photos`, `user_settings`, `user_activity_states` и `travel_intents` с необходимыми constraints и indexes.
- Реализовали server-side Telegram Auth: проверку raw `initData`, `POST /auth/telegram`, `POST /auth/logout` и Bearer authentication.
- Добавили server-side `user_sessions` с multiple sessions, opaque session token, хранением только SHA-256 hash в БД и TTL 30 дней.
- Зафиксировали сценарии first login (создание User, TelegramIdentity, UserSettings и UserActivityState) и repeat login (использование существующего User), а также отклонение revoked, expired и deleted-user sessions.
- Ограничили `DATABASE_URL` server environment и добавили его валидацию при запуске backend.
- Закрыли Core Identity + Telegram Auth как отдельный backend slice без реализации следующих Profile + TravelIntent API или frontend onboarding.

### Что проверили

- Финальная backend-проверка: 40 passed, 0 failed, 0 skipped, coverage 96.82%.
- `compileall` завершился успешно.
- `git diff --check` завершился успешно.

### Что осталось

- Следующий этап — Profile + TravelIntent API: authenticated read/write профиля, read/write/archive active TravelIntent и onboarding state transitions только для текущего authenticated User.
- Затем нужен frontend onboarding и первый полный flow: Telegram Auth → User → onboarding → Profile → TravelIntent → onboarding completed → основной интерфейс, с восстановлением того же пользователя и данных при повторном запуске.
- Concurrent first-login одной Telegram identity может потребовать отдельной обработки unique-conflict/race.
- Warning FastAPI TestClient/httpx2 не блокирует MVP и остаётся dependency TODO.
- Frontend onboarding, persistence интересов, чатов и поездок, realtime и AI ещё не реализованы.

## 2026-08-06 — Логическая доменная модель и backend-документация

### Что сделали

- Зафиксировали завершение этапа проектирования логической доменной модели Travel Friend.
- Перенесли утверждённую ER-модель в новый backend-раздел документации без изменения архитектуры, связей и ограничений.
- Создали пакет документов `docs/backend/` для domain model, ER, backend architecture, AI architecture, integrations и security.
- Обновили `README.md`, чтобы он отражал новый текущий статус проекта и ссылался на backend-документацию.
- Синхронизировали обзорные документы `docs/ai-copilot.md`, `docs/safety-and-trust.md`, `docs/roadmap.md` и обезвредили преждевременный `docs/database-schema.md`, чтобы они не спорили с новой ER-моделью.

### Что проверили

- Перечитали утверждённую ER-модель как единственный источник истины перед правками.
- Сверили новые документы с текущими проектными ограничениями: без schema, таблиц, миграций, API, RLS, persistence и realtime.
- Прогнали документальную проверку `git diff --check` после завершения правок.

### Что осталось

- Backend-контур, Telegram Auth, physical schema, persistence, realtime и AI-реализация остаются следующими отдельными этапами.
- Новая backend-документация описывает логическую архитектуру, но не заменяет будущие schema- и API-документы.

## 2026-07-21 — Завершение super-review frontend-блока

### Что сделали

- Закрыли super-review по frontend-блоку Trips.
- Финально согласовали Chat ↔ Trip navigation, где Chat Room ведёт в конкретный Trip, а Trip Details ведёт в конкретный Chat.
- Зафиксировали session-aware participants и active / historical trip flow.
- Довели финальные navigation fixes до стабильного состояния.
- Добавили дополнительные unit-тесты под Trips frontend-flow.
- Зафиксировали, что frontend checkpoint остаётся mock/local-state, а не backend-ready состоянием.

### Что проверили

- Прогнали `npm test`, `npm run check`, ESLint и dependency/security audit на актуальном frontend-потоке.
- Проверили profile validation и сценарий local session trip creation из matched Chat.
- Сверили, что новые unit-тесты покрывают Trips data model, Trip Details, navigation и session-aware participants.

### Что закрыли

- Закрыли замечания review по active / historical navigation, session-aware participants и согласованию Trip Details с Chat.
- Зафиксировали завершение frontend-блока как стабилизированного mock/local-state checkpoint.
- Сохранили следующий фокус на backend foundation / persistence.

## 2026-07-20 — Trips frontend-функции и проверки

### Что сделали

- Довели Trips frontend data model, Trips List и read-only Trip Details до согласованного состояния.
- Зафиксировали единый порядок категорий и текстовые состояния категорий в Trip Details.
- Добавили двустороннюю навигацию Chat ↔ Trip и local session trip flow из matched Chat.

### Что проверили

- Прогнали profile validation, единый `npm test`, ESLint и `npm run check` на frontend-блоке.
- Выполнили dependency/security audit и убрали неиспользуемый Telegram SDK.
- Пересмотрели сценарии навигации между Chat Room и Trip Details после локальной стабилизации.

## 2026-07-10 — Chat Room MVP и предварительная модель Chats / Trips

### Что сделали

- Зафиксировали в документации, что Chat Room MVP уже реализован на динамическом маршруте `/chats/[id]`.
- Обновили описание входа в чат из Chats List, mock-истории сообщений, local-only отправки, fallback для неизвестного `chat id`, перехода в публичный профиль собеседника, перехода в конкретный связанный Trip и скрытия Bottom Navigation внутри chat room.
- Уточнили предварительную продуктовую модель: `Chats` как живое общение и будущая работа с AI, `Trips` как структурированное актуальное состояние поездок, а связь `Trip ↔ Chat` пока остаётся продуктовой договорённостью, а не backend-реализацией.
- Синхронизировали README, roadmap, CHANGELOG и AI Travel Copilot doc, чтобы они описывали текущий frontend-flow честно и без намёка на готовый backend, Supabase или persistence.

### Что проверили

- Сверили текущий код `develop` с документацией и убедились, что Chat Room описан как local-only MVP, а не как backend-чат.
- Проверили, что документальные формулировки не обещают real-time, Supabase, persistence или AI как уже реализованные части продукта.
- Подтвердили, что решения по Trips и Chat остаются предварительными и могут быть пересмотрены после обсуждения с командой и дизайнером.

### Что осталось

- Backend/API, persistence, realtime, Supabase и AI не реализованы.
- Chat Room и остальные новые MVP-сценарии пока живут на mock-data и локальном state.
- Trip ↔ Chat модель, групповой flow и финальная UI-структура Trips требуют отдельного согласования.

## 2026-07-08 — Синхронизация документации и Codex rules

### Что сделали

- Синхронизировали README, CHANGELOG и roadmap с фактическим состоянием продукта на конец дня.
- Зафиксировали в документации новые MVP-сценарии: Profile MVP, profile edit mode, Discover MVP, public buddy profile, mock interest/match flow, Chats List MVP и единый frontend data model слой.
- Уточнили инструкции для Codex: явное перечисление прочитанных инструкций, выбранных и неиспользуемых skills/workflows, планируемых файлов и границ скоупа.
- Добавили правило про integration awareness, чтобы при изменении существующего flow проверялись соседние сценарии вроде Discover → buddy profile → interest flow → chats.
- Зафиксировали, что docs-only задачи не должны трогать код приложения и должны завершаться одним документальным заходом на основе дневника разработки.

### Что проверили

- Перечитали и сверили `AGENTS.md`, `docs/engineering-handbook/codex-rules.md`, `docs/engineering-handbook/codex-skills-workflow.md`, `README.md`, `CHANGELOG.md` и `docs/roadmap.md`.
- Использовали дневник разработки как основной источник фактов, без выдумывания новых функций.
- Сохранили границы скоупа: документация обновляется, код приложения и `apps/mini-app` не меняются.

### Что осталось

- Реальные backend/API, Supabase, persistence и chat room flow на тот момент ещё не были готовы.
- Discover, profile и chats пока живут на mock-data и локальном state.
- Следующий документальный проход должен снова опираться на дневник разработки и не смешивать docs-only работу с продуктовой реализацией.

## 2026-06-30 — День 3

### Почему сначала строили инженерную систему

Команда сознательно сначала собрала инженерный контур, потому что без него любая продуктовая работа быстро превращается в набор разрозненных изменений. Когда нет понятного процесса, веток, проверки окружения и согласованной документации, сложно понять, что именно уже готово, что сломалось и кто отвечает за следующий шаг.

Инженерная система нужна была как основа для дальнейшей разработки:

- чтобы у команды был стабильный `main` и рабочий `develop`;
- чтобы можно было проверять изменения в понятном процессе;
- чтобы новому участнику было проще войти в проект;
- чтобы продуктовые задачи не смешивались с задачами по инфраструктуре и диагностике;
- чтобы документация отражала реальное состояние проекта, а не устные договорённости.

### Почему сегодня главным было планирование

Сегодняшний день был посвящён не добавлению пользовательских функций, а согласованию следующих шагов. Это нужно было, чтобы команда не начала писать экраны и API раньше, чем договорится о порядке, зависимостях и ролях.

Планирование было важнее реализации, потому что:

- необходимо было зафиксировать порядок MVP-работ;
- нужно было разложить фронтенд, бэкенд и UX/UI на понятные этапы;
- важно было не распылить усилия между несколькими направлениями одновременно;
- команде требовалось единое понимание того, что идёт первым, а что позже.

### Какие решения приняла команда

- Первый инфраструктурный этап считается завершённым.
- `develop` зафиксирован как интеграционная ветка и объединён в `main` как первый стабильный checkpoint.
- Команда переходит от инженерной настройки к продуктовой разработке.
- MVP будет строиться по заранее согласованному порядку, а не хаотично.
- Документация и инженерные правила остаются обязательной частью работы.

### Что переходит на следующий этап

- Profile MVP.
- Поиск попутчиков.
- Экран карточки пользователя.
- Чаты.
- AI внутри чатов.
- Trips / поездки.

## 2026-06-30 — День 2

### Какие проблемы встретились

- Telegram Mini App нужно было проверять не только локально, но и в реальном Telegram-контексте.
- Поведение WebApp отличалось между локальным запуском, браузером и публичным URL.
- Часть симптомов выглядела как проблема React или рендера, но это оказалось слишком ранним выводом.
- Требовалось вернуть стабильный рабочий контур разработки без постоянной ручной перенастройки внешнего адреса.

### Какие гипотезы проверялись

Сначала команда смотрела в сторону клиентской части:

- возможно, проблема в React-компонентах;
- возможно, ломается гидратация;
- возможно, состояние Telegram SDK и браузерного fallback расходятся;
- возможно, ошибка в layout или навигации.

Параллельно проверяли сценарий окружения:

- как ведёт себя Mini App на публичном URL;
- что меняется при запуске через Vercel;
- одинаково ли воспроизводится ошибка вне Telegram и внутри Telegram WebView;
- помогает ли минимальный пример отделить продуктовую проблему от инфраструктурной.

### Почему проблема оказалась не в React, а в окружении

Ключевой вывод был такой: сначала приложение выглядело как источник ошибки, но потом стало понятно, что симптом зависит от среды запуска.

Если проблема воспроизводится только в Telegram-контексте или только на конкретном публичном адресе, это уже не похоже на чистую проблему React-компонента. В таком случае нужно смотреть на:

- WebApp-окружение;
- внешний URL;
- поведение Telegram SDK;
- разницу между локальным браузером и Telegram WebView.

Именно поэтому был полезен MRE для Telegram WebApp: он показал, что сначала надо изолировать среду, а уже потом трогать код.

### Чему научилась команда

- Не начинать с исправления кода, пока не проверена гипотеза.
- Если после нескольких разумных попыток причина не находится, нужен MRE.
- Telegram Mini App лучше проверять на стабильном публичном URL, а не на временном туннеле.
- Диагностика и исправление должны идти по порядку: сначала понять среду, потом чинить поведение.
- Документация должна обновляться в тот же день, когда команда пришла к новому инженерному выводу.

## 2026-06-29 — Документальный этап

### Что было сделано

- Создан новый `docs/engineering-handbook/` с правилами рабочего процесса, роли Codex, документации и принятия технических решений.
- Добавлен `docs/engineering-principles.md` как краткая точка входа в инженерные правила проекта.
- Упрощён `AGENTS.md`, чтобы он оставался короткой инструкцией для Codex и ссылался на Handbook вместо дублирования правил.

### Технические решения

- Подробные правила вынесены в отдельный Handbook, чтобы `AGENTS.md` не разрастался и оставался рабочей инструкцией, а не полноценным регламентом.
- Документация сохранена на русском языке, чтобы соответствовать текущим правилам проекта.

### Что дальше

- Использовать новый Handbook как основной ориентир для будущих инженерных и документальных изменений.

## 2026-06-28 — День 1

### Что было сделано

- Настроен первый каркас Mini App на Next.js в `apps/mini-app`.
- Добавлена мобильная нижняя навигация и маршруты `/`, `/chats`, `/trips` и `/profile`.
- Подключено определение окружения Telegram SDK, чтобы приложение могло понимать, запущено ли оно внутри Telegram.
- Добавлен резервный режим браузера, чтобы проект можно было открывать и развивать вне Telegram во время локальной разработки.
- Исправлен путь с hydration mismatch: Telegram state хранится на клиенте, а состояния загрузки, Telegram и браузера разделены.

### Технические решения

- Telegram Mini App выбран как основная MVP-платформа вместо отдельного мобильного приложения.
- AI-помощник будет встроен в чаты и поездки, а не вынесен в отдельный экран.
- Локальная разработка в браузере сохранена, чтобы не зависеть от Telegram на каждом шаге.
- Текущая сборка намеренно является каркасом: сначала маршруты, layout, навигация и определение окружения, затем продуктовая логика.

### Что дальше

- Настройка Telegram bot и публичного URL.
- Telegram-аутентификация и серверная проверка `initData`.
- Схема Supabase для пользователей, поездок, чатов и членства в группах.
- MVP профиля, MVP поездок и чатовый поток.
- Встроенный AI-помощник внутри контекста поездки и чата.
