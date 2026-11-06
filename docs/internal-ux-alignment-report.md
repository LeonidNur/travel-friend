# Internal UX Alignment Report — Pre-Beta UX-01…UX-10

Дата исходного аудита: 2026-11-05. Stage 4 implementation update: 2026-11-06. Сверено с утверждённым [Pre-Beta Development Plan](pre-beta-development-plan.md) и текущим code/contracts. Ниже сохранён исторический UX-01…UX-10 audit; Group Chat implementation завершён и проверен в этой ветке, без shared-environment migration или deployment.

## Источники и ограничения аудита

- [Pre-Beta Development Plan](pre-beta-development-plan.md) задаёт приоритет и обязательный pre-test scope. [User Flows](user-flows.md), [MVP Scope](mvp-scope.md), [Feature List](feature-list.md), [Backend Contracts](backend/backend-contracts.md), [Domain Model](backend/domain-model.md), [AI Copilot](ai-copilot.md) и [Technical Hardening Backlog](technical-hardening-backlog.md) дают продуктовый, logical contract и implementation context.
- Текущее поведение проверено по `apps/mini-app/app`, `apps/mini-app/components`, `apps/mini-app/lib`, `apps/backend/src/travel_friend_backend` и актуальным migrations/tests, где это требовалось.
- В checkout не найдены отдельные ранее переданные дизайнеру User Flows / Screen-State Matrix; прежний handoff нельзя побайтно сравнить. План доступен в checkout и использован для финального alignment.
- Для текущего поведения приоритет имеют runtime/API/migrations. Утверждённый target behavior и обязательный pre-beta scope не считаются реализованными до соответствующей проверки.

## Матрица UX-01…UX-10

| ID | Ожидаемое поведение и evidence | Актуальность finding | Классификация |
|---|---|---|---|
| UX-01 | Discover фиксирует финальный `interested` или `rejected`; mutual interest создаёт Match + direct Chat. Однако активная Discover карточка не ведёт в профиль. `/buddies/[id]` читает статические mock-данные, а её интерес-action тоже не связан с активным backend candidate. Код: `apps/mini-app/app/page.tsx`, `components/BuddyCard.tsx`, `app/buddies/[id]/page.tsx`, `components/BuddyPublicProfile.tsx`; approved behavior: [User Flows — Discover](user-flows.md). | Решённый target: реальный профиль и единое решение. Runtime gap актуален; legacy profile не является доказательством закрытия. | **DECIDED; implementation gap** (и отсутствовал актуальный designer handoff). |
| UX-02 | В Chat Room direct собеседник и каждый участник группы открывают профиль через профильный endpoint, ограниченный контекстом чата; есть loading/error/not-found и возврат в исходный чат. Код: `components/ChatRoom.tsx`, `components/ChatParticipantProfile.tsx`, `app/chats/[id]/participants/[userId]/page.tsx`, backend `routers/chats.py`. | Продуктовое решение и поведение подтверждены; расхождение закрыто. | **DECIDED; implemented**. |
| UX-03 | Profile показывает отдельную active Travel Intent и позволяет менять направление/даты. Backend сохраняет один активный intent; удалить его после completed onboarding нельзя (`409`). Код: `app/profile/page.tsx`, `lib/profile-travel-intent.ts`, backend `routers/me.py`; contract: [Backend Contracts — TravelIntent](backend/backend-contracts.md). | Решение расположения/действий подтверждено. В Discover intent виден как часть candidate data. | **DECIDED; implemented**. |
| UX-04 | Серверный bootstrap выставляет `onboarding_required`; App Shell заменяет обычные маршруты обязательными шагами Profile → Travel Intent. Discover eligibility требует completed onboarding, Profile и active intent. Код: `components/TelegramAppShell.tsx`, `components/OnboardingProfileScreen.tsx`, `components/OnboardingTravelIntentScreen.tsx`, backend `routers/discover.py`. | Решено: Preview Mode нет, onboarding обязателен. Runtime onboarding уже соответствует целевому правилу. | **DECIDED**; onboarding **implemented**, Preview исключён из beta scope. |
| UX-05 | Сейчас Chats List даёт loading/error/empty/populated, но list model не содержит last message/time/unread; backend messages возвращает полную историю без cursor, Chat Room не обновляет входящие сообщения и не отмечает read. Код: `schemas/chats.py`, `routers/chats.py`, `app/chats/page.tsx`, `components/ChatRoom.tsx`, `lib/chat-runtime.ts`. Целевое решение: последнее сообщение, время и unread indicator; реализация относится к [Live Chats](pre-beta-development-plan.md#3-live-chats). | Решено включить эти три элемента в beta UX. Техническая реализация, offline/reconnect и ограничения history остаются implementation work; расширенный messenger scope исключён. | **DECIDED**; **implementation pending** в Live Chats block. |
| UX-06 | Stage 4 добавил optional persisted title (80 Unicode code points), read model и отдельный rename route/capability; blank нормализуется в `null` и показывается как «Групповой чат». | Решено: любое активное членство группы разрешает rename; direct chats исключены; состав неизменяем; concurrent updates — last-write-wins. | **DECIDED; implemented and verified in this branch** (disposable PostgreSQL, frontend checks, security/grant review). |
| UX-07 | Trip создаётся из direct/group Chat; create открывает Detail, при `409` код читает `GET /trips` и открывает существующую unfinished Trip. Trips List имеет loading/error/empty/populated. Код: `components/ChatRoom.tsx`, `lib/chat-trip-runtime.ts`, `app/trips/page.tsx`, `app/trips/[id]/page.tsx`. | Решено показывать явное действие «Создать поездку» или «Открыть поездку» по состоянию; `409` recovery оставить только fallback. | **DECIDED**; proactive state lookup/CTA **implementation pending**. |
| UX-08 | Trip создаётся со статусом `forming`; все текущие active ChatParticipant сразу становятся TripParticipant. Read model содержит `created_by`, версии, блоки, stops и участников; UI сейчас read-only. Код: `schemas/trips.py`, `routers/trips.py`, `app/trips/*`. | Решено: creator — атрибуция, не admin; creator не меняет confirmed state единолично; согласованные изменения идут через Proposal. Прочие lifecycle/invitations остаются вне scope. | **DECIDED** по ownership/правилам; Proposal apply flow **implementation pending**. |
| UX-09 | Logical contracts задают AI-produced Proposal, accept/reject, неизменяемый голос, rejected при любом reject, единогласный accepted, atomic apply и stale без изменения Trip. Реализованных Proposal UI/API/persistence сейчас нет. Источники: [Backend Contracts — Proposal](backend/backend-contracts.md), [Domain Model](backend/domain-model.md), [AI Copilot](ai-copilot.md), [Pre-Beta Plan](pre-beta-development-plan.md#5-proposal-foundation-и-интеграционная-граница-ии). | Решено включить AI Copilot и baseline Proposal до первого внешнего теста. Старые future-only/post-MVP метки устарели для roadmap scope; отсутствие реализации остаётся фактом. | **DECIDED**; **implementation pending**, обязательная pre-beta dependency. |
| UX-10 | UI использует русские тексты, но есть английские labels и raw ISO date presentation. Код: `app/profile/page.tsx`, `components/BuddyPublicProfile.tsx`, `lib/trip-list-runtime.ts`, `lib/chat-runtime.ts`. | Решено: первая бета русскоязычная, без locale switcher и полноценной i18n-системы. | **DECIDED**; targeted Russian copy/date consistency **implementation pending**. |

## Принятые продуктовые решения

- Discover card и расширенный Public Profile используют одно финальное решение `interested` / `rejected`; возврат из профиля не должен создавать новое решение. Это требование сценария UX-01 и не меняет серверный security boundary или contract.
- Chat — место коммуникации; Proposal описывает предлагаемое изменение; Trip — подтверждённое состояние. До Proposal принятия Trip не меняется.
- Trip из чата сразу включает активный roster этого чата. Creator Trip — атрибуция, не admin; confirmed state меняется по результату согласованного Proposal.
- AI Copilot и baseline Proposal flow обязательны до первого внешнего теста, но не реализованы. AI не меняет Trip напрямую.
- Group Chat получает название при создании и возможность переименования; roster остаётся фиксированным. Invitations, leave/remove и admin roles исключены.
- Group title необязательный, максимум 80 Unicode code points; blank title очищается, UI показывает «Групповой чат». Rename разрешён любому активному участнику, без creator/admin role.
- Chats List показывает последнее сообщение, время и unread indicator; backend/runtime work планируется в Live Chats block, без расширенных функций мессенджера.
- В Chat показывается «Создать поездку» или «Открыть поездку» по состоянию; `409` — технический recovery fallback.
- Preview Mode отсутствует; onboarding обязателен. Первая бета русскоязычная без locale switcher/full i18n.

## Implementation questions (не открытые продуктовые решения)

Продуктовые решения выше утверждены. Следующие вопросы относятся к contract/implementation review и не меняют beta scope:

1. **AI ↔ Proposal boundary:** согласовать с AI-разработчиком schema/validation/error contract и producer handoff, как предусмотрено планом. Это implementation dependency, не основание убирать Copilot/Proposal из pre-beta scope.
2. **Live Chats:** определить серверную модель unread/read, list refresh/reconnect и offline recovery внутри планового блока. Набор UI: last message, time и unread indicator — уже утверждён.

## Отдельный implementation backlog

1. **Discover Public Profile (UX-01):** связать candidate card с backend-backed профилем и одним финальным decision flow; убрать mock profile как beta behavior.
2. **Live Chats (UX-05):** реализовать last message/time/unread, realtime, read/unread semantics, history bounds и reconnect/offline recovery по плану; не расширять до Telegram-подобного мессенджера.
3. **Group title (UX-06):** optional persisted title при создании, отображение и rename любым активным участником. Stage 4 implemented and verified in this branch; migration/deployment на shared environments не выполнялись. Не добавлять invitations, leave/remove, admin roles или mutable roster.
4. **Existing Trip navigation (UX-07):** state lookup и явный Create/Open CTA; `409 → GET /trips` оставить recovery fallback.
5. **Trip + Proposal (UX-08/09):** согласовать contracts с AI-разработчиком; реализовать baseline persistence/read/vote/outcomes/stale/atomic apply и UI до внешнего теста. Creator остаётся attribution; AI не меняет Trip напрямую.
6. **AI Copilot (UX-09):** интегрировать в Chat/Trip, покрыть loading/success/no-proposal/failure states и FinOps gates; не отмечать complete до проверки end-to-end chain.
7. **Russian UI consistency (UX-10):** привести labels, validation/errors и date formats к русскому языку; без locale switcher/full i18n.

## Зависимости

| Область | Что уже есть | Что блокирует полное UX |
|---|---|---|
| Live Chats | Persisted direct/group messages; last message/time/unread UX decided | Live updates, read/unread, history bounds and recovery in plan block |
| Group Chat | Creation, fixed roster and profile links; optional title and active-member rename implemented | Stage 4 checks pass in this branch; no invites/leave/remove/admin roles |
| Trip | Create/read, participants and `forming`; creator attribution/Create/Open UX decided | Proactive CTA; confirmed change through Proposal; no creator-only write |
| Proposal | Logical voting/stale/atomic constraints approved; required pre-beta | Persistence/API/UI not implemented; coordinate shared contract with AI developer |
| AI | Embedded Copilot target; never alters confirmed Trip directly | Required pre-beta, not implemented; integration/output contracts, FinOps and end-to-end verification pending |
| Onboarding | Mandatory two-step flow; no Preview Mode | Runtime already matches target |
| Localization | Russian beta; no locale switcher/full i18n | English labels and date formatting need targeted implementation |

## Residual risks

- Предыдущий дизайнерский handoff отсутствует в checkout; delta не может побайтно сравнить файлы, которые уже есть у дизайнера.
- Current routes/contracts/schema всё ещё отражают существующий runtime (без Live Chats, title/rename, AI/Proposal); это не означает, что обязательные pre-beta slices уже поставлены.
- Discover public-profile route — статический mock flow, который нельзя считать готовой частью backend-backed beta.
- Список чатов не отражает последние сообщения и непрочитанное; realtime и read receipts отсутствуют. Внешний тест блокируется обязательным Pre-Beta scope, а не текущим MVP checkpoint.
- Shared environment still needs its approved migration/deployment process; this task has only applied the migration to disposable PostgreSQL.
- AI/Proposal states требуют совместной contract review и реализации, несмотря на уже утверждённые продуктовые решения.
