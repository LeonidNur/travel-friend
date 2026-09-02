# Backend contracts

## Назначение и границы

Этот документ содержит два разных слоя: сначала фактические HTTP contracts `develop`, затем логические contracts будущей архитектуры. Они не равны друг другу: deferred design ниже не является API specification уже реализованного MVP.

API проектируется вокруг пользовательских и domain actions, а не как CRUD поверх каждой ER-сущности. Frontend не может напрямую создавать внутренние сущности `Match`, `ChatParticipant`, `TripParticipant`, `Proposal` и system `Message`. Backend/domain является доверенной точкой применения инвариантов, авторизации и атомарных domain-операций.

## Реализованные HTTP contracts (`develop`, 2026-09-02)

Все кроме `GET /health` требуют `Authorization: Bearer <opaque session token>`. `POST /auth/telegram` принимает только raw Telegram `init_data`; backend проверяет подпись и freshness, а не доверяет `initDataUnsafe`.

| Method | Path | Назначение |
| --- | --- | --- |
| `GET` | `/health` | health check |
| `POST` | `/auth/telegram` | verify raw `init_data`, login/create identity and session, вернуть bootstrap flags |
| `POST` | `/auth/logout` | revoke только текущую session, `204` |
| `GET` / `PATCH` | `/me/profile` | получить/изменить профиль текущего пользователя |
| `GET` / `PUT` / `DELETE` | `/me/travel-intent` | active TravelIntent; `DELETE` архивирует его, `204` |
| `PATCH` | `/me/onboarding` | переход только в `in_progress` или `completed`; completed нельзя понизить |
| `GET` | `/discover/candidates` | eligible candidates без решений текущего пользователя |
| `PUT` | `/discover/decisions/{targetUserId}` | финальное `interested` / `rejected`; reciprocal interest создаёт Match и direct Chat |
| `GET` | `/chats` | direct и group Chats текущего активного участника |
| `POST` | `/chats/groups` | создать Group Chat из минимум двух eligible direct-chat companions инициатора |
| `GET` / `POST` | `/chats/{chatId}/messages` | история / новое текстовое сообщение доступного direct или group Chat |
| `POST` | `/chats/{chatId}/trips` | создать одну `forming` Trip из доступного direct или group Chat |
| `GET` | `/trips` | Trip текущего участника |
| `GET` | `/trips/{tripId}` | detail Trip с route stops и активными participants |

Текущие ограничения реализации:

- `GET /chats/{chatId}`, message cursor pagination, read/unread API и realtime не реализованы.
- Group Chat создаётся инициатором с минимум двумя unique eligible companions; eligible означает existing matched direct Chat с инициатором. Инициатор добавляется автоматически, а состав после создания не редактируется в MVP.
- `POST /chats/{chatId}/trips` разрешает только один незавершённый (`forming`/`active`) Trip на Chat и отвечает `409` при повторе.
- Trip создаётся из direct или group Chat. Backend в одной transaction читает всех активных ChatParticipant и сразу создаёт столько же `TripParticipant`; `TripInvitation` в этом MVP flow не создаётся и не используется.
- `GET /trips` и `GET /trips/{tripId}` — read contracts. Нет Trip/stop write API, start/complete/cancel/leave, invitation или Proposal endpoints. Mini App при `409` использует `GET /trips`, чтобы найти unfinished Trip того же Chat и открыть её.
- Actual Discover не использует `DiscoverImpression`, отдельные Like records, filters или ranking: решение хранится как `discover_interest_decisions` с `interested`/`rejected`.

## Логические contracts future design

Следующие разделы сохраняют утверждённое направление будущей архитектуры. Где они расходятся с таблицей выше, приоритет для текущего MVP имеет реализованный HTTP contract.

## Identity, Profile и TravelIntent

### Identity

`POST /auth/telegram`

- принимает raw Telegram `initData`;
- backend валидирует Telegram context;
- после успешной проверки backend находит или создаёт `User` и связывает его с `TelegramIdentity`;
- ответом является bootstrap/session state;
- `TelegramIdentity` не выставляется как CRUD resource.

Frontend передаёт raw context, но не является доверенной стороной аутентификации и не использует `initDataUnsafe` как доказательство identity.

### Profile

`GET /me/profile`

`PATCH /me/profile`

Пользователь может менять только разрешённые пользовательские и profile fields. Служебные идентификаторы, identity bindings, activity state и внутренние metadata не editable через frontend.

### Profile photos

Контракт фиксирует логические действия:

- upload photo;
- delete photo;
- reorder photos.

Конкретный механизм хранения и выдачи — Storage, signed URL или proxy — пока не выбирается.

### TravelIntent

`GET /me/travel-intent`

`PUT /me/travel-intent`

`DELETE /me/travel-intent`

`TravelIntent` отделён от `Profile`. `DELETE` означает отсутствие активного intent. Будущая physical deletion или archive strategy этим документом не определяется.

## Discover, Like и Match

`GET /discover`

`POST /discover/{impressionId}/skip`

`POST /discover/{impressionId}/like`

- filters и ranking выполняет backend;
- `like` и `skip` привязаны к конкретному `DiscoverImpression`;
- frontend не создаёт `Like`, `Match` или `Chat` напрямую;
- встречные likes атомарно создают `Match` и direct `Chat`;
- успешный match не требует автоматического перехода frontend в Chats: пользователь может открыть созданный Chat или продолжить Discover.

Отдельный endpoint для incoming likes и отдельный Match list endpoint в MVP не требуются.

## Chats и messages

`GET /chats`

`GET /chats/{chatId}`

`GET /chats/{chatId}/messages`

`POST /chats/{chatId}/messages`

`POST /chats/{chatId}/read`

Chat metadata и message history — разные read-модели и операции. Messages читаются с cursor/sequence pagination.

- sender определяется backend session;
- `sequence_number` назначает backend и гарантирует последовательность внутри Chat;
- пользователь создаёт только обычные сообщения от своего имени;
- system messages создаёт только backend;
- read sequence может двигаться только вперёд;
- unread state/count рассчитывает backend;
- realtime в будущем накладывается поверх этих contracts и не заменяет их;
- archive/restore в этом документе не проектируются.

## Trips

### Read operations

`GET /trips`

`GET /trips/{tripId}`

### Lifecycle commands

- создать Trip: `POST /chats/{chatId}/trips`;
- принять `TripInvitation`: `POST /trips/{tripId}/invitations/{invitationId}/accept`;
- отклонить `TripInvitation`: `POST /trips/{tripId}/invitations/{invitationId}/decline`;
- `POST /trips/{tripId}/start-planning`;
- завершить Trip: `POST /trips/{tripId}/complete`;
- покинуть Trip: `POST /trips/{tripId}/leave`;
- принять решение об отмене через collective lifecycle decision/voting: `POST /trips/{tripId}/cancellation-decision`.

Future/group lifecycle design: Trip создаётся только внутри Chat. После создания backend автоматически создаёт `TripInvitation` для текущих участников Chat. `TripParticipant` появляется только после accept invitation. `start-planning` — отдельная domain command; generic `PATCH status` не используется.

Это **не** описание current MVP: в нём TripInvitation не используется, а все активные участники existing direct или group Chat становятся TripParticipant немедленно при создании Trip.

После leave backend сам применяет membership-version, review и cancellation rules из domain model: увеличивает membership version, отменяет pending proposals и запускает необходимые reviews; budget всегда требует пересмотра. Если активных участников становится меньше двух, Trip автоматически отменяется.

Один пользователь не может самостоятельно отменить active Trip: cancellation проходит через коллективное lifecycle decision/voting. Завершение Trip выполняется вручную пользователем и допустимо только если даты поездки подтверждены, а backend определяет, что дата окончания поездки уже наступила или прошла. Frontend UI не является источником этого ограничения.

## Proposal и voting

Основные операции:

- получить proposals Trip: `GET /trips/{tripId}/proposals`;
- получить конкретный Proposal: `GET /proposals/{proposalId}`;
- проголосовать `accept` или `reject`: `POST /proposals/{proposalId}/vote`.

Frontend не создаёт Proposal напрямую. Proposal появляется через `AIRequest` или membership review. Backend заранее фиксирует участников голосования. Authenticated user из backend session определяет voter.

Правила голосования:

- голос нельзя изменить;
- любой `reject` завершает Proposal как `rejected`;
- `accepted` требует необходимого единогласия;
- принятие Proposal и изменение Trip выполняются атомарно;
- stale Proposal не меняет Trip;
- для разных Trip blocks могут существовать pending proposals параллельно;
- на один block допускается максимум один pending Proposal.

В MVP `destination` — route aggregate: Proposal заменяет весь ordered stops plan. `transport` — transport aggregate: Proposal заменяет весь ordered transport plan. Stop-level и segment-level Proposal не вводятся.

Обычный Proposal с `accept`/`reject` votes не содержит несколько альтернатив, между которыми пользователи выбирают. Proposal относится к одному Trip block и представляет один уже выбранный вариант. Flow выбора выглядит так:

`external APIs → backend normalization → AI/ML ranking → option set из нескольких осмысленных вариантов с trade-offs → пользователи выбирают один вариант → выбранный вариант становится Proposal для конкретного Trip block → Proposal проходит существующий accept/reject flow → после единогласного accepted backend атомарно обновляет Trip`

Полноценное multi-choice/ranked voting сейчас не проектируется. Оно потребовало бы отдельного изменения domain model и contracts.

До принятия Proposal подтверждённое состояние Trip не меняется.

## AI / ML contracts

Публичные операции:

`POST /trips/{tripId}/ai-requests`

`GET /ai-requests/{requestId}`

`AIRequest` — асинхронная единица работы со статусами:

- `queued`;
- `processing`;
- `completed`;
- `failed`;
- `cancelled`.

`AIRequest` не обязан создавать Proposal. Концептуально результат может иметь разные типы:

- assistant message;
- proposal;
- option set;
- itinerary/plan;
- external offers;
- summary.

AI itinerary/program of trip может быть самостоятельным пользовательским результатом: текстом, structured artifact или в будущем файлом/визуальным материалом. Он не обязан становиться Proposal и не должен автоматически менять Trip.

Frontend не знает, используется ли наша ML, LLM provider или конкретный external API. Публичный MVP API создаёт user-triggered requests; system/scheduled AI requests остаются внутренним механизмом.

## Internal AI/ML integration

Фиксируется только логическая граница, без выбора HTTP, gRPC, queue или process architecture.

Backend/AI orchestrator получает нормализованный context и явно разрешённые tools. Наша ML в будущем может работать отдельным сервисом, в том числе на отдельном сервере или PC, без изменения frontend contracts.

AI/ML не получает application secrets и не изменяет Trip напрямую. Любое изменение подтверждённого domain state проходит через backend/domain rules и соответствующие пользовательские решения.

## External providers

Все provider calls идут через backend integration layer. Frontend и ML-модель не вызывают внешние travel API напрямую.

Логический flow:

`AI/orchestrator requests external data`
`→ backend/provider adapter`
`→ external API`
`→ validation/normalization`
`→ ExternalAPIRequest / ExternalOffer`
`→ AI/ML analysis`
`→ пользовательский результат / option set / Proposal при необходимости`

Архитектура сохраняет возможность подключить:

- transport/flight providers;
- hotel/lodging providers;
- maps/geodata;
- другие future providers.

Конкретные поставщики сейчас не выбираются. Все внешние ответы считаются недоверенными, валидируются и нормализуются backend-ом; provider secrets остаются только на backend.

## Future Group Chat membership design

Current MVP уже создаёт Group Chat через `POST /chats/groups`: создатель выбирает минимум двух eligible direct-chat companions, инициатор добавляется автоматически, а состав фиксирован. Ниже описан **deferred** design invitations, голосований и изменения состава; его endpoints не реализованы.

### Первый group chat

Инициирование начинается из direct Chat. Текущие участники голосуют по отдельной операции, а candidate отправляет отдельный candidate response. После единогласия текущих участников и согласия candidate backend атомарно создаёт новый group Chat из трёх участников. Исходный direct Chat сохраняется.

Логическая поверхность операций:

- first group creation: `POST /chats/{chatId}/group-chat-creation`;
- current participant votes: `POST /group-chat-creations/{creationId}/vote`;
- candidate response: `POST /group-chat-creations/{creationId}/candidate-response`.

### Расширение существующей группы

Добавление выполняется через membership proposal:

- текущие участники group Chat голосуют;
- candidate отдельно принимает или отклоняет предложение;
- после успешного решения backend создаёт `ChatParticipant` в существующем group Chat.

Candidate не является одним из голосующих. Все текущие участники должны согласиться. Frontend не создаёт `ChatParticipant`.

Для одного Chat допускается максимум одно активное membership proposal. При выполнении операции backend проверяет `base_membership_version`; stale membership operation не применяется. Механизм принудительного удаления участника не проектируется, так как его нет в утверждённой модели.

Логическая поверхность операций:

- existing group membership proposal: `POST /chats/{chatId}/membership-proposals`;
- participant votes: `POST /membership-proposals/{proposalId}/vote`;
- candidate response: `POST /membership-proposals/{proposalId}/candidate-response`.

## Entitlements и usage

`GET /me/entitlements`

`GET /me/usage`

Capabilities моделируются через цепочку `Feature → Entitlement`, а не через простой `is_premium` flag. Frontend может использовать entitlement для UI, но backend всегда повторно проверяет право на выполнение операции.

Usage и quota считает только backend. Перед выполнением `AIRequest` backend проверяет entitlement и quota. Публичный MVP API создаёт user-triggered AI requests; system/scheduled requests остаются внутренним механизмом и учитываются по соответствующим внутренним правилам.

## Что этот документ НЕ определяет

Этот документ не определяет:

- physical PostgreSQL/Supabase schema;
- migrations;
- RLS;
- конкретный auth/session implementation;
- FastAPI implementation;
- OpenAPI details;
- realtime transport;
- конкретный ML deployment;
- конкретные external providers;
- домашний/self-hosted server topology.
