# Travel Friend — Pre-Beta Development Plan

> **Версия:** Draft 1 — 05.11.2026
> **Статус:** на проверке команды; после утверждения — единый рабочий план Pre-Beta.
> **Предыдущий документ:** `technical-hardening-backlog-2026-10-12.md` сохраняется как исторический checkpoint, не как текущая очередь задач.

## 0. Цель и границы этапа

**Цель:** подготовить Travel Friend к внешнему пользовательскому тестированию с работающим AI Copilot, связным пользовательским опытом, надёжными чатами, базовым Proposal flow, измеримой продуктовой активностью и контролируемой эксплуатацией.

**Изменение стратегии:** первоначальная идея провести финальный E2E и небольшой внешний тест до готовности ИИ отменена. ИИ — ключевое преимущество продукта; внешний тест проводится **после** его интеграции и обязательных release gates. Пока AI-разработчик ведёт свой поток работ, frontend/product/backend-часть движется по независимым задачам. Финальный E2E не отменён, а перенесён ближе к запуску; проверки отдельных функций выполняются постоянно.

**Обязательные принципы:**

- Один пункт реализации — одна ограниченная задача с проверяемыми критериями завершения. Не устраивать «попутных» рефакторингов.
- Сначала продуктовая логика и контракты, затем реализация. Любое изменение flow сверять с соседними сценариями.
- Использовать уже работающие security boundary, RLS/capabilities, CI и тесты как базу; не переоткрывать закрытые P0/P0.5 без конкретного finding.
- Сохранять разделение: **Chat** — коммуникация, **Proposal** — предлагаемые изменения, **Trip** — подтверждённое состояние; AI не применяет изменения к Trip напрямую.
- Готовность к реализации и готовность к **production rollout** — разные решения. Production изменения требуют проверки совместимости.
- Задачи разрешается выполнять в удобном порядке, если соблюдены зависимости и не создаются конкурирующие правки одних контрактов.
- Зафиксированные в документации и коде факты имеют приоритет над старыми заметками. При расхождениях сначала выполнить короткую проверку актуального `develop`.

### Формат исполнения и статусов

**Статусы:** `PENDING` → `DECIDED` → `IN PROGRESS` → `VERIFIED` (или `BLOCKED`). `DECIDED` не означает, что код написан. Для каждого завершённого slice: PR/commit, тесты, изменение пользовательского поведения, зафиксированные residual TODO/risks.

**Рабочий процесс с Codex:** Леонид задаёт границы и согласует продуктовые решения; Codex получает короткое ТЗ и может выполнять автономный **loop** (реализация → тесты → исправления → повторная проверка). Loop ограничен конкретным scope, бюджетом итераций и stop conditions. Ветка/PR изолированы; merge после review и зелёного CI. Нельзя молча принимать архитектурные решения, менять security/authorization, проводить destructive migrations, изменять production или расширять scope. Если проблема находится за границами задачи — оформить TODO/risk и остановиться при blocker.

## 1. Продуктовые решения и дизайн-дельта — ПЕРВЫЙ ЭТАП

**Результат:** короткое согласованное дополнение к спецификации дизайнера и список отдельных frontend/backend задач. **Не** передавать дизайнеру внутренние дефекты реализации как желаемый UX.

| ID | Решение / вопрос | Критерий завершения | Статус |
|---|---|---|---|
| UX-01 | Discover → реальный Public Profile; единые финальные `interested` / `rejected` действия | Один backend decision flow на карточке и в профиле; без demo/local решения | DECIDED |
| UX-02 | Chat → Public Profile (включая group participant) | Переходы, доступность и error states зафиксированы; существующая реализация подтверждена | DECIDED |
| UX-03 | Где после onboarding показывать и менять active Travel Intent | Отдельно от Profile; существующее расположение и редактирование подтверждены | DECIDED |
| UX-04 | Preview Mode / незавершённый onboarding | Preview Mode не будет; onboarding обязателен до Discover | DECIDED |
| UX-05 | Chats list и Chat room: последнее сообщение, время, unread, empty/loading/error/offline | UI-состав зафиксирован; last message/time/unread реализация входит в Live Chats block | DECIDED |
| UX-06 | Group Chat: название, участники, создание/переименование; без invitations/leave/remove/admin roles | Optional пользовательское название (до 80 Unicode characters); любое active group membership может переименовать; blank отображается как «Групповой чат»; roster фиксированный | DECIDED |
| UX-07 | Chat → Trip: «Создать поездку» или «Открыть поездку»; empty Trips | Явный CTA по состоянию; `409` только технический recovery fallback | DECIDED |
| UX-08 | Trip data/lifecycle/participants/ownership | Creator — атрибуция; confirmed changes проходят через Proposal, не creator-only write | DECIDED |
| UX-09 | AI Copilot + baseline Proposal: creation, review, vote, accepted/rejected/stale outcomes | Обязательный scope до внешнего теста; состояния согласованы, implementation не завершён | DECIDED |
| UX-10 | Консистентность локализации, validation focus и сообщения ошибок | Первая бета на русском, без locale switcher/full i18n; implementation отдельно | DECIDED |

`DECIDED` означает, что продуктовая/дизайнерская рамка согласована; это не статус реализации. Runtime, tests, contracts, rollout и release gates проходят свои implementation/verification статусы отдельно.

**Аудит исходных observations выполнен 05.11:** актуальные gaps и закрытые findings записаны в [Internal UX Alignment Report](internal-ux-alignment-report.md). Mock-backed Discover Public Profile остаётся implementation task; Chat → Profile и active Travel Intent display/edit подтверждены реализованными. Не создавать для закрытых сценариев дубликаты задач.

**Передача дизайнеру:** только утверждённые решения, новая screen/state matrix и краткий перечень изменённых экранов; без внутреннего technical backlog. По окончании — проверка, что дизайн не расходится с backend-контрактами.

## 2. Архитектурный review и подготовка slices

**Цель:** убедиться, что предстоящие изменения не закрепляют плохие границы и не конфликтуют с работой AI-разработчика. **Это не разрешение на массовый рефакторинг.**

- Проверить текущие модули и контракты Chat / Messages / Group / Trip / Proposal / AI; актуальные ownership, авторизацию и миграционный порядок.
- Выделить только конкретные препятствия для live chat, group membership, Proposal и аналитики. Для каждого: evidence, severity, минимальное решение, отдельный TODO или blocker.
- Передать потенциальные изменения shared API и схемы AI-разработчику на согласование; закрепить контрактные границы.
- Протестировать новый code-quality skill на ограниченной задаче/review; проверить рекомендации на применимость, не считать их обязательной архитектурой. Не внедрять generic DAO, repository, UoW, Clean Architecture и новый стек без доказанной пользы.
- До добавления новых задач сверить текущую реализацию, тесты и документацию. Обновить лишь затронутые контракты.

**Done:** есть короткая карта зависимостей, список blockers и контрактов, порядок небольших slices; нет бесконтрольной инициативы «переписать всё красиво».

## 3. Live Chats

**Зависимости:** UX-05; обзор текущего transport/auth boundary; без изменения Proposal/Trip.

**Принятые решения Stage 3:** HTTP polling с ограниченной частотой; persisted backend messages — источник истины; initial history bounded и синхронизируется по sequence cursor с before/after pagination; unread — количество доступных пользователю сообщений выше его read watermark, отправленные самим пользователем не считаются; watermark продвигается после отображения сообщений в активной комнате; повтор неоднозначной отправки использует тот же request ID и не создаёт дубликат. Realtime transport и расширенные функции мессенджера не входят в этот slice.

**Порядок реализации (IN PROGRESS; решение не означает готовность к внешнему тесту):**

1. **Transport** — bounded HTTP polling в активной видимой Chat Room; обновление Chats list с ограниченной частотой и восстановление после возврата вкладки/сети.
2. **History and sync** — ограниченная первая страница и sequence-cursor pagination в обе стороны; курсор учитывает high-water sequence, чтобы пропуски недоступных recipient-only сообщений не приводили к потере синхронизации.
3. **Idempotent send** — backend persisted state и клиентский request ID защищают повтор после неоднозначного результата; один ключ не может быть повторно использован с другим текстом.
4. **Chats list and unread** — видимые последнее сообщение/время, backend unread count без собственных сообщений; mark-as-read только до фактически отображённой позиции.
5. **Security, tests and performance** — сохранить активное членство/RLS и capability-only writes; ограничить размер истории и частоту polling; проверить direct/group, reconnect, concurrent sends и стоимость для ожидаемой беты.

**Done:** два и более реальных пользователя видят сообщения без ручного refresh, подтверждены persisted history/reconnect/order/no-duplicates, работают права доступа, bounded pagination и unread соответствуют UX, CI и multi-user integration tests проходят. Нагрузка и стоимость приемлемы для запланированной беты. Stage 3 остаётся `IN PROGRESS`, пока эти критерии не проверены; это не production rollout.

## 4. Group Chats

**Зависимости:** решение UX-06, live message infrastructure и модель доступа; связь с Trip и Proposal согласована.

**Baseline:** создание backend-backed группы уже присутствует в прежней документации — не переписывать его без finding.

**Принятые решения:** название необязательное, после trim пустое значение хранится как `null` и отображается как «Групповой чат»; максимум 80 Unicode characters. Любой активный участник группы может переименовать её. Создатель не получает отдельной роли; direct Chats не имеют title/rename. Одновременные переименования используют last-write-wins.

**Implementation:** persisted title при создании и rename; отображение в Chats List/Chat Room; тесты прав доступа и совместимости. Stage 4 реализован и проверен в текущей ветке полным disposable PostgreSQL и frontend checks; migration/deployment на shared environments не выполнялись. Состав первой beta фиксирован; invitations, leave/remove и admin roles исключены.

**Отложенный вопрос для будущей версии:** если roster когда-либо станет mutable, отдельно определить последствия для истории чата, Trip participants, прав и Proposal voting. В первой бете roster фиксирован; не реализовывать mutable membership.

**Done:** базовый групповой чат воспринимается как законченный сценарий, есть предсказуемый состав/название, все разрешённые операции покрыты проверками authorization и multi-user tests; отложенные действия не выглядят как работающие.

## 5. Proposal foundation и интеграционная граница ИИ

**Зависимости:** UX-08/09, подтверждённый ownership Chat/Trip, контракт с AI-разработчиком. Может проектироваться параллельно с чатами; не менять shared schema/API без синхронизации.

**Принятый инвариант:** AI создаёт структурированное предложение; **Proposal** хранит версии и решения участников; **только backend после необходимых подтверждений** атомарно применяет изменения к Trip. AI не является владельцем confirmed Trip state.

**Обязательный Pre-Beta baseline (точные shared schema/API детали согласовать в contract review):**

1. Product state machine: кто создаёт Proposal; связь с Chat/Trip; кто голосует; единогласие, отклонение, отмена; что делать при смене участников.
2. Contract: schema / validation / error model между AI output, Proposal API и Trip apply; version/stale checks, idempotency, authorization.
3. Persistence + read API и тесты, без неявного изменения Trip.
4. Decisions/voting и atomic apply с конкурентными тестами; защита от двойного принятия и stale state.
5. UI Proposal flow и notification states; интеграционный E2E с контролируемым AI output.

**Done:** полная цепочка «предложение → решения участников → подтверждённый Trip» работает с явными правами и проверками версий; непринятые предложения не меняют Trip. Реальную генерацию ИИ и её отдельные service contracts поставляет AI-разработчик; интеграция проверена совместно.

## 6. Продуктовая аналитика (до первого внешнего теста)

**Зависимости:** согласованные user identity, события onboarding/match/chat/trip и границы privacy. Проектирование можно начать параллельно с этапами 3–5; внедрение — до внешних пользователей.

**Минимальный словарь событий:** регистрация, completed onboarding, просмотр кандидата, interested/pass, reciprocal match, первое сообщение, создание/открытие Trip, Proposal created/accepted/rejected, ключевые ошибки/сбои. Не собирать тексты переписки или ненужные персональные данные в analytics.

**Метрики:** registered users, новые пользователи, DAU/WAU/MAU, retention по когортам, конверсия воронки, чаты/сообщения, Trips, принятия Proposal. Для «online» отдельно определить техническую оценку активности за окно времени; действующая сессия не равна присутствию онлайн.

**Решения до реализации:** точные определения active user и периода в timezone, идентификаторы событий, дедупликация, retention данных, доступ к отчётам, consent/privacy требования; PostHog vs минимальный собственный event tracking — выбрать по реальным потребностям, стоимости и обслуживанию.

**Done:** тестовые события поступают без дублей и лишних персональных данных, определены вычисления DAU/MAU/retention/воронки, доступна простая панель или воспроизводимый запрос, аналитика готова до первой внешней когорты.

## 7. Release Readiness — ОБЯЗАТЕЛЬНЫЕ GATES ПЕРЕД ВНЕШНИМ ТЕСТОМ

Эта часть **не заменяется** готовыми UI и AI. Порядок реализации подготовительных документов может отличаться от порядка выпуска в production.

| Gate | Проверить и закрыть | Статус |
|---|---|---|
| R-01 Local development hygiene | Проверить актуальность прежних №19 local test DB hygiene и №20 backend runbook; воспроизводимая среда без удаления данных вслепую | PENDING / RECHECK |
| R-02 Security review | Разобрать подготовленные security checklist / skills; классифицировать findings; до теста исправить подтверждённые blockers, не открывая все закрытые P0 заново | PENDING |
| R-03 Deployment workflow + provenance | Manual exact-SHA rollout; preflight, compatibility, production branch/env/Render/Vercel/Supabase revision и migrations parity; Auto-Deploy без отдельного решения остаётся Off | PENDING |
| R-04 Backup and recovery | Проверить реальные backup/retention/restore возможности тарифа; документировать безопасный restore path, rollback vs forward-fix, stop conditions | PENDING |
| R-05 Deployed smoke | Frontend → backend rewrite, `/health`, `/ready`, auth, DB, Telegram Mini App, минимальная persisted operation и stop conditions | PENDING |
| R-06 Cost / abuse guardrails | Проверить фактические тарифы и topology Vercel/Render/Supabase, лимиты запросов/истории, write rates, сессии, ingress, alerts vs hard caps, worst-case burn, monitoring и kill switch | PENDING |
| R-07 Pre-AI FinOps | Per-user/global AI allowances, model/token/context/output/call ceilings, bounded retries/concurrency, accounting, anomaly checks, AI kill switch до включения ИИ для внешних пользователей | PENDING |
| R-08 Final production E2E | На подтверждённых Git SHA и schema/grants: Telegram auth → onboarding → Discover → match → direct/group chat → messages → Proposal → confirmed Trip → reopen; отказные и multi-user сценарии | PENDING |
| R-09 External test decision | Объём/длительность когорты, support/feedback channel, критерии остановки, owner мониторинга, privacy и известные residual risks | PENDING |

**Важный пересмотр:** прежняя идея Telegram-ID allowlist для первой группы — лишь исторический кандидат. Схема открытой регистрации должна проверяться по последнему принятому решению команды; **не добавлять allowlist автоматически**. При ожидаемом заметном числе пользователей нужна адекватная эксплуатационная готовность, а не предположение «тестируют всего десять друзей».

**Тарифы:** не назначать платные тарифы автоматически. До запуска проверить актуальные billing/usage limits, коммерческие условия Vercel, Render compute, Supabase backups и нагрузочные/AI расходы. Решение о платном плане — отдельный операционный checkpoint. ChatGPT Plus/Codex: начинать без дополнительных подписок, учитывать реальные usage limits; не предполагать безлимитную автономную работу.

## 8. Development Harness — ЗАКЛЮЧИТЕЛЬНЫЙ ЭТАП

**Сейчас:** используем контролируемые автономные Codex loops внутри одного понятного scope, существующие ветки/PR и CI. **Не** строим параллельную агентную систему как предварительное условие продуктовых задач.

**В конце Pre-Beta, после основной продуктовой разработки:**

1. Проанализировать результаты loops: какие задачи можно делегировать, где ошибки и стоимость review.
2. Сделать минимальный воспроизводимый harness: 2–3 независимых агента, отдельные `git worktree`/ветки, явное распределение задач, test/CI gates, журнал результатов.
3. Запретить конфликтующие параллельные правки общих контрактов, миграций, security-sensitive участков; merge и production оставлять под контролем человека.
4. Проверить сравнением реальных задач репозитория пользу дешёвых/локальных моделей против облачных. Оценивать **совокупную** стоимость (токены/лимиты, оборудование, время ревью), а не только цену генерации.

**Done:** есть документированный повторяемый параллельный workflow без обязательных новых подписок и с измеримым выигрышем. Если выигрыш не доказан — остаёмся на обычных loops.

**Долгосрочная гипотеза, вне scope Pre-Beta:** после финансирования отдельно исследовать локальную машину для coding agents и inference-сервер для пользовательского AI. Это два разных экономических расчёта; покупку оборудования не планировать до измерения нагрузки и качества моделей.

## 9. Очередь на старт и контроль зависимостей

1. **DONE (05.11):** сверить текущий repository context/реализацию и status прежних UX observations; findings записаны в alignment report.
2. **DONE (05.11):** принять UX-01…UX-10 и подготовить Designer Update. Решения утверждены; связанные реализации остаются pending.
3. **Architecture/contract review** по Chat / Group / Proposal / Trip / AI, оценить применимость нового code-quality skill.
4. **Live Chats** небольшими loops → **Group Chats** небольшими loops; каждый slice через тесты и review.
5. **Proposal**: сначала совместный контракт с AI-разработчиком, затем backend/domain и UI slices; не допускать конфликтующих параллельных изменений.
6. **Analytics** — проектировать и внедрять параллельно, завершить до первой внешней когорты.
7. **Release gates R-01…R-09** + совместная AI-интеграция, production rollout, финальный E2E; только затем внешний тест.
8. **Development Harness** — в конце, без блокирования beta-release. Если срок запуска наступит раньше, это не release blocker.

### Что сознательно НЕ входит в этот этап без отдельного решения

Полный redesign, все пожелания «на будущее», сложная независимая Trip editing system в обход Proposal, RAG и дополнительная AI-оркестрация без проверки основной гипотезы, generic architecture frameworks, Redis/IaC/масштабирование «на всякий случай», полная перестройка CI, собственная BI-платформа, покупка GPU-серверов, безусловный mutable group membership.

## 10. Открытые вопросы реализации и эксплуатации

- Какие schema/validation/error contract и handoff нужны между AI-разработчиком, Proposal API и Trip apply?
- Каковы ожидаемый объём одновременных Chat Rooms и допустимая polling latency/cost? Проверить на release cost/abuse gate; транспорт и cursor/read semantics для Stage 3 уже приняты.
- Какую метрику считать active user, что означает «online» и какая платформа аналитики нужна?
- Какая прогнозируемая первая когорта и допустимый worst-case операционный бюджет?

**UX-01…UX-10 decisions завершены.** Group Chat authorization, title limit и blank behavior утверждены; Stage 4 верифицирован в этой ветке. Остальные следующие действия определяются статусами implementation и Release Gates, включая совместную AI ↔ Proposal интеграцию.
