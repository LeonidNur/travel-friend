# Журнал изменений

## 2026-08-06

- Завершён этап проектирования логической доменной модели Travel Friend.
- Утверждённая ER-модель перенесена в `docs/backend/er-diagram.md` как источник истины.
- Добавлен новый пакет backend-документации: `domain-model`, `backend-architecture`, `ai-architecture`, `integrations`, `security`.
- Обновлены `README.md`, `docs/roadmap.md`, `docs/ai-copilot.md` и `docs/safety-and-trust.md`, чтобы текущая архитектурная документация соответствовала утверждённой ER-модели.
- `docs/database-schema.md` переведён в статус отложенного артефакта до отдельного schema-этапа.

Known limitations / TODO:

- Backend/API, Supabase schema, persistence, realtime, серверный Telegram Auth и AI всё ещё не реализованы.
- Утверждена логическая модель, но physical schema и миграции ещё не проектировались.

## 2026-07-21

- За 20-21 июля завершён frontend checkpoint по Trips и Chat ↔ Trip flow.
- Добавлены Trips data model, Trips List и read-only Trip Details.
- Зафиксированы двусторонняя Chat ↔ Trip navigation, где Chat Room ведёт в конкретный Trip, а Trip Details ведёт в конкретный Chat, local session trips и поддержка `active` / `historical` trip.
- Обновлено session-aware отображение участников поездки.
- Пройдены profile validation, unified `npm test`, ESLint, `npm run check` и dependency/security audit.
- Удалён неиспользуемый Telegram SDK.
- Завершён review mock-flow и добавлены новые unit-тесты под frontend-блок.

Known limitations / TODO:

- Mock/local state остаётся единственным источником данных для этого checkpoint.
- Данные исчезают после reload.
- Backend, Supabase, API, persistence, realtime, Telegram Auth и AI отсутствуют.
- Group flow не закреплён.
- Frontend view model не является готовой Supabase schema.

## 2026-07-10

- Реализован Chat Room MVP на динамическом маршруте `/chats/[id]` с входом из Chats List, mock-историей сообщений, своими/чужими/системными сообщениями, local-only отправкой и fallback для неизвестного `chat id`.
- Добавлен переход в публичный профиль собеседника, переход в конкретный связанный Trip, скрытие Bottom Navigation внутри chat room и исправление длинных и многострочных сообщений.
- Зафиксирована предварительная продуктовая модель Chats / Trips: Chats для живого общения и будущей работы с AI, Trips для структурированного актуального состояния поездок, без второй chat room на каждую поездку.
- Обновлены README, roadmap, dev-log и AI Travel Copilot doc, чтобы они честно описывали текущий frontend-flow и не выдавали backend, persistence, Supabase или AI за уже готовые части продукта.

Known limitations / TODO:

- Chat Room MVP и другие новые сценарии по-прежнему работают на mock-data и local state.
- Messages исчезают после reload.
- Backend/API, persistence, realtime, Supabase и AI пока не реализованы.
- Trip ↔ Chat модель, групповой flow и финальная UI-структура Trips остаются предварительными и могут измениться после обсуждения с командой и дизайнером.

## 2026-07-08

- Добавлен MVP-экран профиля пользователя с локальным edit mode, slider для возраста, chips для интересов и travel preferences.
- Главная страница переведена в Discover MVP с одной карточкой попутчика за раз и публичными профилями `/buddies/[id]`.
- Добавлен mock interest/match flow с локальными решениями, списком выбранных пользователей и переходом в `/chats` как placeholder.
- Экран `/chats` стал Chats List MVP с mock-чатами и статусами `match`, `interest_sent` и `draft`.
- Вынесен единый frontend data model слой для профилей, travel preferences, интереса и mock-чатов.
- Обновлена нижняя навигация, чтобы отражать основную группу Chats / Discover / Trips и отдельный Profile.
- Усилены инструкции Codex в `AGENTS.md` и `docs/engineering-handbook/`.
- Добавлены правила игнорирования `.DS_Store`.

Known limitations / TODO:

- Все новые MVP-сценарии пока работают на mock-data и локальном state.
- Реальные backend/API, Supabase, persistence, chat room flow и AI внутри чатов ещё не реализованы.
- Финальное расположение Profile в навигации и дальнейшая интеграция потоков потребуют отдельного согласования.

## Day 3 — 2026-06-30

- Завершён первый инфраструктурный этап проекта.
- `develop` объединён в `main` как первый стабильный checkpoint.
- Зафиксирован переход к этапу разработки MVP.
- Обновлены инженерные правила для следующей фазы работы.
- Уточнён процесс командной разработки и взаимодействия ролей.

## Day 2 — 2026-06-30

- Перешли на Vercel как основной публичный контур для Telegram Mini App.
- Настроили автоматическую установку Telegram Menu Button через `npm run telegram:set-menu`.
- Ввели `develop` workflow для ежедневной разработки и интеграции изменений.
- Подготовили MRE для Telegram WebApp, чтобы отделять проблему окружения от проблемы кода.
- Исправили интеграцию Telegram WebApp после проверки в реальном Telegram-контексте.
- Вернули закреплённую нижнюю навигацию внизу экрана.

## 2026-06-29

- Добавлен новый слой инженерной документации в `docs/engineering-handbook/`.
- Создан обзорный документ `docs/engineering-principles.md` для быстрого входа новых участников команды.
- Обновлён `AGENTS.md`, чтобы он ссылался на Handbook и сохранял короткие инструкции для Codex.

## 2026-06-28

- Настроен первый каркас Next.js Telegram Mini App в `apps/mini-app`.
- Добавлена нижняя мобильная навигация для основных экранов.
- Добавлены маршруты `/`, `/chats`, `/trips` и `/profile`.
- Добавлено определение окружения Telegram SDK.
- Добавлен fallback для работы в браузере при локальной разработке вне Telegram.
- Исправлен сценарий с несовпадением состояния при гидратации Telegram state.
- Подготовлены первичные рабочие документы: `docs/roadmap.md`, `docs/dev-log.md`, `docs/team-workflow.md`.
