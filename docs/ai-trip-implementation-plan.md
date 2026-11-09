# Travel Friend — Implementation Plan: AI / Trip / Proposal / Draft

**Дата:** 2026-11-07
**Статус:** execution plan на основе [канонической продуктовой спецификации](ai-trip-product-spec.md). Не означает, что миграции/код уже готовы.
**Приоритет требований:** спецификация 07.11.2026 и решения этого чата выше старых GitHub-документов.

## 1. Вывод по параллельной разработке

**Да, AI-разработчик может начать и закончить свою часть до того, как Леонид начнёт реализацию backend/UI.** Предусловие: общий `copilot-v1` contract, fixtures, fake backend/tool gateway и автоматические contract tests. Ни один разработчик не меняет схему/HTTP контракты другого самостоятельно.

| Область | Ответственный |
|---|---|
| Telegram auth, permissions, RLS, capabilities, models/DB, Chat/Trip/Draft/Proposal, votes, PDF, Telegram bot notifications | Леонид + Codex |
| Структура безопасного контекста и его выдача, token/tool quota budget, AIRequest persistence/status/usage, tool gateway и external-provider API keys | Наш backend |
| Prompt strategy, model adapter, ChatSummary suggestion, itinerary planning, structured `CopilotOutputV1`, evaluation, provider-neutral model switching | AI-разработчик |
| Финальная сборка UI↔backend↔AI service, telemetry, deployment, E2E и release gates | Совместно, owner интеграции — Леонид |

AI-разработчик **не** владеет SQL migrations, RLS, голосованиями или state machine Trip. Он не должен ждать readiness frontend; наша сторона может тестироваться на статических `CopilotOutputV1` fixtures.

## 2. Реальное состояние на момент аудита (не путать с TARGET)

**Источник:** read-only GitHub connector, `develop` SHA `83f71e27594abad0f55c4a4ba86e9e48c5879ec1`, 07.11.2026.

- В `apps/backend` FastAPI routers есть Chat, Discover, Me и Trips; **нет runtime AI/Proposal endpoints**.
- `GET /trips`, `GET /trips/{id}` и `POST /chats/{id}/trips` поддерживают существующую Trip с route/date/budget/transport метаданными, но **без** полноценного itinerary/day-editor, Draft и voting.
- В дереве `supabase/migrations` есть `20261105121901_live_chat_pagination_unread_idempotency.sql` и `20261106080902_group_chat_titles_and_rename.sql`; соответствующие тесты и frontend файлы присутствуют.
- Старый `docs/backend/backend-contracts.md` утверждает «один Proposal на legacy block», AI-origin и 4 базовых блока; это теперь **исторический дизайн**, требующий отдельной синхронизации.
- В Pre-Beta Plan, находящемся на `develop`, статусы UX и Stage 4 обновлены, но очередь Live/Group в начале раздела 9 отчасти осталась устаревшей. Приложенный Draft 05.11 ещё старше.

### Read-only Deployment Preflight: частично выполнен

| Источник | Что фактически установлено | Что пока НЕ установлено |
|---|---|---|
| GitHub `develop` | SHA `83f71e2…`, две миграции Live Chat/Group Chat присутствуют в дереве | Соответствие фактическому production backend |
| Supabase `travel-friend-dev` | `ACTIVE_HEALTHY`; `list_migrations` заканчивается `20261018090000_server_side_tester_admission_session_identity` | Две последние миграции **не применены в доступном dev-проекте**. Это не доказательство состояния отдельной production БД, если такая есть |
| Vercel `travel-friend-mini-app` | latest production deployment `dpl_DjcqzYmZQhDJS9FFzNSk2Scb7J41`, `READY`, создан **29.10.2026**, source=`cli` | Коммит Git SHA не получен: CLI deployment не предоставил gitSource, поэтому утверждать parity с `develop` нельзя |
| Render | Коннектор обнаружил workspace, но не разрешил прочитать сервисы без **явного выбора workspace пользователем** | Backend service/deploy SHA, health/ready, автообновление/rollout |
| Security/backup/smoke | В коде есть тесты и runbooks; live change не производили | Не проходили live Telegram E2E, миграции/grants parity и restore test |

**Стоп-условие:** не накатывать миграции и не переключать production deployment только ради согласования спецификации. Перед новым runtime loop проверить миграционную цепочку, exact-SHA, совместимость клиентов, резервные копии, `/health` и `/ready`, затем контролируемый rollout. Render workspace выбрать явно в отдельной операции.

## 3. Контрактная граница и порядок утверждения

Нормативный продукт: [ai-trip-product-spec.md](ai-trip-product-spec.md). Техническая версия на старт: **`copilot-v1`**, схема в [ai-developer-handoff.md](ai-developer-handoff.md). Перед первой совместной реализацией два разработчика зафиксируют schema fixtures/checksums; после этого изменения контракта оформляются отдельным согласованным PR, а не самостоятельной «улучшающей» правкой AI или backend.

**Управление AIRequest** — наш backend: резервирует личную квоту, делает authorized frozen snapshot, запускает AI worker через внутренний адаптер, обрабатывает разрешённые tool requests, принимает validated candidate output, публикует answer/draft card в Chat. AI worker не имеет доступа к SQL и произвольным внешним API.

`copilot-v1` намеренно не фиксирует транспорт worker (HTTP, queue, task runner) до проверки deployment topology. Внутренний чистый интерфейс `run_copilot(input, tool_gateway) -> output` позволяет AI-разработчику завершить работу на локальных fixtures. Tool gateway принадлежит нашему backend, его mock входит в handoff.

**Разграничение trust:** JSON Schema/Pydantic validation недостаточно для принятия Proposal. Backend отдельно проверяет пользователя, Trip membership, корректные ID/versions и scope locks, бюджет предупреждения, зависимость, размер payload, возможность применения. AI result — кандидаты, не готовые доверенные DB-операции.

## 4. Крупные функциональные loops (не микрозадачи)

Каждый loop — функционально законченный вертикальный блок: модель → безопасность/RLS → API → UI → тесты → review → отдельный PR. Внутри loop Codex вправе автономно исправлять тесты и ошибки **в согласованном scope**. Новые проблемы — отдельный TODO/risk, а не поправки «заодно».

### Loop A — Trip domain, itinerary и общий Draft

**Статус:** реализовано в текущей feature-ветке; локальные backend PostgreSQL integration и frontend checks пройдены. Миграция не применялась к production; release/deployment gates остаются отдельными.

**Цель:** надёжный day-based план и ручное редактирование без AI. Существующие Trips/TripStops не терять.

Включает migration path для дней/событий/проживания/других областей, стабильно идентифицируемые объекты и версионирование, read APIs, один shared working Draft + alternatives, ручное сохранение по base version, экран подробной Trip и Draft, состояние unknown/empty days. Базовое history/audit для содержательных операций. RLS и scoped capabilities строятся в той же миграции, запрет client-initiated confirmed writes.

**Acceptance:** два участника видят один Draft; гонка не приводит к silent overwrite; outsider не читает/не пишет чужую программу; manual edits не меняют confirmed Trip. Старые Trips читаются и мигрируются обратимо/контролируемо. Supabase integration tests + UI tests.

### Loop B — Proposal engine + голосования + атомарный apply

**Цель:** весь ручной flow, не требующий AI. Единый immutable Proposal с 1..N операциями/областями, зависимостями и существованием в Chat/Trip.

Создание из редактора, human approval of AI candidate позже; два шага выбора и подачи голоса; фиксация voters; accept unanimous, reject first, cancel initiator, optional expiry; stale/blocked/review states; conservative per-area locking и serialisation на backend. Atomic commit изменений + versions + status + system chat message; idempotency и race tests; impact warnings without auto rewriting related confirmed data.

**Acceptance:** успешное единогласие обновляет только перечисленные области; any reject не меняет Trip; duplicate votes и конкурентные Proposal безопасны; на совпадающей области проигравший POST получает 409; rejected/stale/dependent UI читаемы; strict RLS/capabilities/IDOR проверены. Без AI можно пройти полный путь.

### Loop C — AIRequest orchestration + quota + independent AI integration

**Цель:** Copilot в общем Chat без участия LLM в доверенных мутациях.

Наш backend: explicit button/@mention trigger, one active per Chat, frozen sequence, normalize context, ChatSummary boundary, immutable request ownership, quota reserve/commit/refund, entitlement, cost/concurrency caps, kill switch, tool gateway. AI-developer: adapter/model/prompts/schema/fixtures/quality eval. UI: light blue chat processing state, status/cancel, assistant reply/AI Draft card; manual adoption and Proposal follow up.

**Acceptance:** контрактные fixtures проходят обе стороны; outsiders не вызывают AI для чужих чатов; free не использует Premium tier; один запрос не списывается дважды; новые сообщения не меняют frozen context; tool limits hard-fail gracefully; cancel/timeout без висящего processing; Chat продолжает работать при выключенном AI.

### Loop D — Trip readiness + единственный PDF + Telegram bot notifications

**Цель:** полезный завершающий документ и голосования без необходимости постоянно открывать Mini App.

Readiness consensus по точной `state_version`; детерминированный PDF из confirmed snapshot, один актуальный сохранённый файл, stale marker и контролируемая замена; private/signed access и нет leaks. Notification outbox + Telegram bot с 24/72h reminders, event notifications, prefs, safe deep links; deliverability error не ломает транзакции голосований. Не генерировать PDF с LLM.

**Acceptance:** все участники подтвердили готовность → PDF; edit после PDF → stale, требуется новое единогласие; storage RLS/private file access; unauthorized/expired signed links; outbox dedupe/at-least-once delivery без спама, бот не инициирует личный диалог без `/start`.

### Loop E — Analytics, integration E2E и release gates

**Цель:** не выпускать работающий UI на неподтверждённый production runtime. Минимальные privacy-safe события воронки и AI costs, dashboard/SQL, multi-user Telegram WebView E2E, deployment parity, security/failure/backup checks.

**Acceptance:** backend/frontend/AI tested together on exact schema revision, verified Git SHAs and environment, external test only after defined release gates. Code-quality skill / multi-agent harness — отдельно **после** основного Pre-Beta, не блокирует Copilot.

## 5. Возможный порядок без блокирования AI-разработчика

| Очередь | Леонид / Codex | AI-разработчик |
|---|---|---|
| Теперь | Утверждаем общую `copilot-v1` схему и fixtures, выпускаем docs PR; завершаем Deployment Preflight read-only | Получает handoff и mock gateway; начинает adapter, prompts, structured generation |
| Параллельно | В удобный момент Loop A и B | Завершает ChatSummary/itinerary/candidate generation, safety/evals |
| После B | Loop C: подключает уже готовый service; либо mocks до готовности сервиса | Contract tests, точечные исправления; не правит наши migrations |
| После C | Loop D и E | Поддержка joint E2E, regression и model quality |

**Критический путь:** качество AI можно закончить раньше UI, однако общая работающая система требует backend orchestration, RLS, DRAFT/Proposal domain и совместный E2E. Реальные tool APIs могут подключаться по одному, не задерживая общий adapter. Не обещать запуск без фактических environment checks.

## 6. Security checklist каждого loop

- Identity из server-verified Telegram/Bearer, а не client-supplied user ID.
- RLS on all exposed new tables; deny-by-default, capability-only public writes, no runtime SQL privilege widening без review.
- Explicit `GRANT`/`REVOKE EXECUTE` у `SECURITY DEFINER` функций; `search_path` и principal checks.
- Проверка authenticated `app.user_id` в транзакции и owner/membership + fixed vote cohort; service-role secrets не во frontend/LLM.
- Bounded data, parameterized queries, payload/time/size/rate caps, no source text in analytics/logs.
- Multi-user integration tests (member/outsider), IDOR, concurrent requests, duplicate idempotency key, stale update, compromised tool output, revoked session.
- No unreviewed `production` DB update, restore, env var edits or deploy from Codex loop.

## 7. Предварительный backlog рисков и решений, требующих техпроверки

1. **RISK P0:** Документация четырёх legacy Trip blocks конфликтует с day itinerary + пакетными Proposal. Новая схема/миграция должна быть reviewable, без silent rewrite старых данных.
2. **RISK P0:** Capability-only Postgres auth использует transaction-scoped actor; нужен security review новых function privileges и недопущение bypass через широкие runtime grants.
3. **RISK P0:** Supabase `travel-friend-dev` на 07.11.2026 не применил последние две миграции из develop; сначала parity check/deploy plan.
4. **RISK P1:** Vercel prod READY не доказывает Git/DB/API совместимость, т. к. CLI deploy не сообщает Git SHA.
5. **RISK P1:** Render не прочитан: требуется подтверждённый workspace; не делать вывод о backend status.
6. **RISK P1:** Консервативный scope lock не обнаруживает временную несовместимость разных суток/сфер; сейчас не обещаем автоматический conflict resolver.
7. **RISK P1:** Глобальный cloud spend limit нельзя оставлять только наблюдаемой метрикой; нужен hard cap и fail-closed guard.
8. **RISK P1:** Telegram delivery depends on bot started/permissions; outbox errors не должны повредить Proposal.
9. **RISK P2:** PDF «одна версия» не позволяет отзывать ранее скачанные файлы; предупреждение/новое имя документа.
10. **FUTURE:** лицензированный RAG и multi-model routing после доказанной пользы, не скрытые зависимости первых loops.

## 8. Действия Леонида в git/терминале перед первым Codex loop

После принятия документов, **не раньше завершения read-only Deployment Preflight** для rollout:

```bash
git switch develop
git pull --ff-only origin develop
git status --short
git switch -c feature/trip-draft-foundation
```

Первый самостоятельный loop для Codex: **Loop A** целиком по этому плану. Не давать одновременно второму агенту править новые SQL migrations/Trip contracts. Работать в feature branch, тестировать миграции локально, вести PR против `develop`. Внутренние правила репозитория см. `docs/engineering-handbook/`, не копировать их в каждое ТЗ.

## 9. Критерий завершения документационной фазы

- Product owner принимает [spec](ai-trip-product-spec.md) как приоритетный источник требований.
- AI-разработчик получает [handoff](ai-developer-handoff.md), запускает contract fixtures с mock data и не зависит от UI/backend ETA.
- Дизайнер получает [UX handoff](ai-trip-designer-handoff.md); будущий дизайн не внедряет неподтверждённые старые блоки.
- Оставшиеся open technical choices выражены как contract review issues, а не как скрытые решения разработчиков.
