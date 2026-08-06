# Логическая доменная модель

## Назначение документа

Этот документ кратко фиксирует логическую доменную модель Travel Friend после завершения этапа проектирования. Он не дублирует ER-диаграмму целиком и не задаёт physical schema, API или persistence-детали.

Подробная ER-модель находится в [er-diagram.md](./er-diagram.md).

## Основные домены

### 1. Identity, Profile и Discover

Домен отвечает за пользователя как за участника системы:

- `User` как корневая сущность;
- `TelegramIdentity` как единственная серверно проверяемая привязка к Telegram;
- `UserSettings` и `UserActivityState` как персональные настройки и сигналы активности;
- `Profile`, `ProfilePhoto` и `TravelIntent` как публичная и поисковая часть пользователя;
- `DiscoverImpression`, `DiscoverDecision`, `Like` и `Match` как слой поиска и взаимного интереса.

### 2. Chats

Домен отвечает за коммуникацию:

- `Chat` как контейнер сообщений и AI-контекста;
- `ChatParticipant` как членство пользователя в чате;
- `Message` как последовательные сообщения внутри чата;
- `ChatSummary` как краткое рабочее summary обсуждения.

### 3. Group chat orchestration

Домен описывает, как direct chat превращается в group chat и как группа расширяется:

- `GroupChatCreation` и `GroupChatCreationVote` для первого перехода из direct chat в group chat;
- `ChatMembershipProposal` и `ChatMembershipVote` для добавления новых участников в существующий group chat.

### 4. Trips

Домен отвечает за поездку как подтверждённое состояние, живущее внутри чата:

- `Trip` как агрегат поездки;
- `TripInvitation` как приглашение участнику чата присоединиться к поездке;
- `TripParticipant` как подтверждённый участник поездки;
- `TripBlockReview` как механизм пересмотра уже подтверждённых блоков после изменения состава;
- `TripLifecycleDecision` и `TripLifecycleVote` как слой ручной отмены поездки.

### 5. Proposal и коллективное согласование

Домен описывает, как неподтверждённые варианты превращаются в подтверждённое состояние:

- `Proposal` как предложение изменения одного блока поездки;
- `ProposalVote` как персональные голоса активных участников поездки.

### 6. AI orchestration

Домен описывает технический слой AI:

- `AIRequest` как единица AI-работы;
- связь AI с `Chat`, `Trip`, `Proposal`, `ChatSummary` и внешними API;
- `ExternalAPIRequest` как backend-вызов внешних provider-ов по инициативе AI.

### 7. External offers и monetization

Домен описывает внешние предложения, которые backend может принести в обсуждение:

- `ExternalProvider`;
- `ExternalOffer`;
- `ProposalExternalOffer`;
- `TripExternalSelection`;
- `AffiliatePartner`.

### 8. Entitlements и usage

Домен описывает доступ к AI-функциям:

- `Feature`;
- `Entitlement`;
- `UsageCounter`.

## Основные сущности

Ключевые сущности модели:

- `User`
- `TelegramIdentity`
- `Profile`
- `TravelIntent`
- `Like`
- `Match`
- `Chat`
- `ChatParticipant`
- `Message`
- `ChatSummary`
- `Trip`
- `TripInvitation`
- `TripParticipant`
- `Proposal`
- `ProposalVote`
- `TripBlockReview`
- `TripLifecycleDecision`
- `AIRequest`
- `ExternalAPIRequest`
- `ExternalOffer`
- `Entitlement`
- `UsageCounter`

## Жизненный цикл основных объектов

### Пользовательский social flow

`User` создаёт `TravelIntent`, попадает в `Discover`, отправляет `Like`, получает встречный `Like`, после чего возникает `Match` и создаётся direct `Chat`.

### Group chat flow

Сначала существует direct `Chat` двух участников. Затем через `GroupChatCreation` можно предложить третьего участника, дождаться единогласия текущих участников и отдельного согласия кандидата, после чего создаётся новый group `Chat`. Дальнейшее расширение идёт через `ChatMembershipProposal` в рамках уже существующего group chat.

### Trip

`Trip` создаётся внутри `Chat` в статусе `forming`. Всем текущим участникам чата отправляются персональные `TripInvitation`. После принятия приглашений появляются `TripParticipant`. Когда минимум два участника согласились и кто-то явно запускает планирование, состав фиксируется, оставшиеся pending invitation отменяются, а `Trip` переходит в `active`. Далее поездка либо завершается (`completed`), либо отменяется (`cancelled`).

### Proposal

`Proposal` создаётся либо по пользовательскому AI-вызову, либо как системный результат membership review. Для каждого активного `TripParticipant` заранее создаётся `ProposalVote`. Любой `reject` завершает proposal отказом, а `accepted` достигается только при единогласии. Только в этот момент подтверждённое состояние `Trip` меняется атомарно.

### TripBlockReview

После изменения состава поездки backend создаёт `TripBlockReview`. Для бюджета review обязателен сразу. Для `destination`, `dates` и `transport` AI сначала анализирует, затронут ли блок изменением состава, и либо закрывает review, либо инициирует новый `Proposal`.

### AIRequest

`AIRequest` запускается пользователем, системой или расписанием. Он может обновить `ChatSummary`, создать один или несколько `Proposal`, инициировать `ExternalAPIRequest` или завершиться без изменений пользовательского состояния.

## Ключевые бизнес-инварианты

- Один `User` имеет ровно один `TelegramIdentity`, один `UserSettings` и один `UserActivityState`.
- Профиль пользователя опционален: у `User` может быть не более одного `Profile`.
- Для одного направления `User A → User B` существует максимум один `Like`.
- `Like` нельзя отменить вручную.
- `Match` создаётся только после встречных `Like`.
- Для пары пользователей существует максимум один `Match`, а пара хранится в каноническом порядке.
- Один `Match` создаёт один direct `Chat`.
- Direct `Chat` всегда содержит ровно двух участников и не расширяется третьим участником; для группы создаётся отдельный group chat.
- Первый group chat начинается с трёх участников.
- Кандидат на добавление в чат не считается одним из голосующих.
- Одновременно в одном `Chat` допускается только одно активное предложение добавления участника.
- Один `Chat` может содержать несколько последовательных `Trip`, но только одну незавершённую одновременно.
- `Trip` может перейти в `active` только при минимум двух согласившихся участниках.
- После перехода `Trip` в `active` новых участников добавить нельзя.
- `ChatParticipant` и `TripParticipant` — разные сущности и не взаимозаменяемы.
- Подтверждённые блоки `destination`, `dates`, `budget`, `transport` хранятся прямо в `Trip`; промежуточные варианты там не живут.
- На один блок поездки допускается максимум один pending `Proposal`.
- Принятие `Proposal` и изменение `Trip` выполняются атомарно.
- После изменения состава поездки бюджет всегда требует обязательного review.
- `AIRequest` не может напрямую менять `Trip`, создавать участников, применять `Proposal`, иметь прямой HTTP-доступ или получать секреты приложения.
- Для `usage_scope = user_quota` обязателен `charged_to_user_id`.
- Premium-доступ описывается цепочкой `Feature → Entitlement → UsageCounter`, а не флагом `is_premium`.
