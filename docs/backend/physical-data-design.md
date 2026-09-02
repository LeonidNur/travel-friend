# Travel Friend — Physical Data Design

> Статус: reviewed design input. Его identity/chat/trip подмножество частично реализовано migrations в `supabase/migrations/` по состоянию на 2026-09-02; остальные разделы не являются описанием поставленной schema.
>
> Источники истины: актуальные ER/domain model и backend contracts.
>
> Этот документ не является SQL migration, RLS policy или OpenAPI specification.

## Статус реализации и важные расхождения current MVP

Фактические SQL-источники истины — migrations. Уже существуют identity/session, `discover_interest_decisions` + `matches`, direct/group Chats/Messages, `trips`, `trip_participants` и `trip_stops`.

Этот документ сохраняет более широкую future design. В частности, current Discover пока не создаёт `discover_impressions`, `discover_decisions` или `likes`; а Trip из direct или group Chat создаётся без `TripInvitation`: все активные ChatParticipant сразу становятся TripParticipant. Group Chat использует существующие `chats(type='group')` и `chat_participants`, начинается минимум с трёх участников и имеет фиксированный MVP-состав без persisted title. Invitations, сложный group membership lifecycle, Proposal/AI, transport, external offers, audit/moderation и RLS остаются deferred.

## Общие правила

- Основные внутренние идентификаторы: `UUID`.
- Telegram user id: `BIGINT`.
- Временные метки: `TIMESTAMPTZ`.
- Деньги: `NUMERIC(12,2)` + ISO currency code.
- Критические domain invariants защищаются backend и, где возможно, database constraints.
- Frontend не создаёт внутренние domain entities напрямую.
- `User` удаляется логически; исторические Chat/Trip/Audit данные не исчезают каскадно.
- Конкретные `ON DELETE` policies фиксируются перед migrations.
- Пока используются `TEXT + CHECK`, а не PostgreSQL enum.
- Secrets живут только в server-side env / secret manager.

---

# 1. Identity / Profile / Discover

## users

```text
id          UUID          PRIMARY KEY
created_at  TIMESTAMPTZ   NOT NULL
updated_at  TIMESTAMPTZ   NOT NULL
deleted_at  TIMESTAMPTZ   NULL
```

`User` — внутренняя identity Travel Friend. Telegram id не является primary key.

## telegram_identities

```text
id                UUID          PRIMARY KEY
user_id           UUID          NOT NULL UNIQUE FK → users.id
telegram_user_id  BIGINT        NOT NULL UNIQUE

username          TEXT          NULL
first_name        TEXT          NULL
last_name         TEXT          NULL
language_code     TEXT          NULL

created_at        TIMESTAMPTZ   NOT NULL
updated_at        TIMESTAMPTZ   NOT NULL
```

Rules:
- MVP: один `User` ↔ одна `TelegramIdentity`.
- Telegram metadata не перезаписывает Profile автоматически.
- Bot token в БД не хранится.

## profiles

```text
id              UUID          PRIMARY KEY
user_id         UUID          NOT NULL UNIQUE FK → users.id

display_name    TEXT          NOT NULL
birth_date      DATE          NULL
gender          TEXT          NULL
city            TEXT          NULL
bio             TEXT          NULL

travel_style    TEXT[]        NOT NULL DEFAULT '{}'
interests       TEXT[]        NOT NULL DEFAULT '{}'
budget_level    TEXT          NULL
comfort_level   TEXT          NULL

created_at      TIMESTAMPTZ   NOT NULL
updated_at      TIMESTAMPTZ   NOT NULL
```

Notes:
- Возраст вычисляется из `birth_date`.
- Допустимые значения preferences валидирует backend/application.

## profile_photos

```text
id            UUID          PRIMARY KEY
profile_id    UUID          NOT NULL FK → profiles.id
storage_key   TEXT          NOT NULL
position      SMALLINT      NOT NULL
created_at    TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(profile_id, position)
CHECK(position >= 0)
```

## user_settings

```text
user_id       UUID          PRIMARY KEY FK → users.id
ai_enabled    BOOLEAN       NOT NULL DEFAULT TRUE
created_at    TIMESTAMPTZ   NOT NULL
updated_at    TIMESTAMPTZ   NOT NULL
```

TODO: reminder/settings поля добавлять только после отдельного продуктового решения.

## user_activity_states

```text
user_id                   UUID          PRIMARY KEY FK → users.id
onboarding_status         TEXT          NOT NULL
last_app_activity_at      TIMESTAMPTZ   NULL
last_discover_opened_at   TIMESTAMPTZ   NULL
created_at                TIMESTAMPTZ   NOT NULL
updated_at                TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(onboarding_status IN ('not_started', 'in_progress', 'completed'))
```

`last_discover_opened_at` пока остаётся временным механизмом aggregated Discover signal.

## travel_intents

```text
id                       UUID          PRIMARY KEY
user_id                  UUID          NOT NULL FK → users.id

destination_label        TEXT          NOT NULL
destination_country_code TEXT          NULL
destination_place_ref    TEXT          NULL

date_from                DATE          NULL
date_to                  DATE          NULL
status                   TEXT          NOT NULL

created_at               TIMESTAMPTZ   NOT NULL
updated_at               TIMESTAMPTZ   NOT NULL
archived_at              TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(status IN ('active', 'archived'))
CHECK(date_from IS NULL OR date_to IS NULL OR date_to >= date_from)

partial UNIQUE(user_id)
WHERE status = 'active'
```

## discover_impressions

```text
id                    UUID          PRIMARY KEY
viewer_user_id        UUID          NOT NULL FK → users.id
candidate_user_id     UUID          NOT NULL FK → users.id
created_at            TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(viewer_user_id <> candidate_user_id)
```

Recommended index:

```text
(viewer_user_id, created_at)
```

Не ставить `UNIQUE(viewer_user_id, candidate_user_id)`: impression — событие показа.

## discover_decisions

```text
id              UUID          PRIMARY KEY
impression_id   UUID          NOT NULL UNIQUE FK → discover_impressions.id
decision        TEXT          NOT NULL
created_at      TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(decision IN ('like', 'skip'))
```

## likes

```text
id                  UUID          PRIMARY KEY
from_user_id        UUID          NOT NULL FK → users.id
to_user_id          UUID          NOT NULL FK → users.id
source_decision_id  UUID          NULL UNIQUE FK → discover_decisions.id
created_at          TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(from_user_id <> to_user_id)
UNIQUE(from_user_id, to_user_id)
```

Recommended index:

```text
(to_user_id)
```

## matches

```text
id          UUID          PRIMARY KEY
user_a_id   UUID          NOT NULL FK → users.id
user_b_id   UUID          NOT NULL FK → users.id
chat_id     UUID          NULL UNIQUE FK → chats.id
created_at  TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(user_a_id < user_b_id)
UNIQUE(user_a_id, user_b_id)
```

Rules:
- Mutual Like → `Match + direct Chat + 2 ChatParticipant` одной transaction.
- После создания direct Chat `chat_id` должен быть заполнен.

---

# 2. Chat / Messages

## chats

```text
id                  UUID          PRIMARY KEY
type                TEXT          NOT NULL
membership_version  INTEGER       NOT NULL DEFAULT 1
last_sequence       BIGINT        NOT NULL DEFAULT 0
created_at          TIMESTAMPTZ   NOT NULL
updated_at          TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(type IN ('direct', 'group'))
CHECK(membership_version >= 1)
CHECK(last_sequence >= 0)
```

Rules:
- direct Chat содержит ровно 2 участников и не расширяется;
- group Chat начинается с 3 участников;
- верхнего продуктового лимита group size нет.

## chat_participants

```text
id                            UUID          PRIMARY KEY
chat_id                       UUID          NOT NULL FK → chats.id
user_id                       UUID          NOT NULL FK → users.id

joined_at                     TIMESTAMPTZ   NOT NULL
left_at                       TIMESTAMPTZ   NULL
hidden_at                     TIMESTAMPTZ   NULL

last_read_sequence            BIGINT        NOT NULL DEFAULT 0
last_visible_message_sequence BIGINT        NOT NULL DEFAULT 0
left_after_sequence           BIGINT        NULL

created_at                    TIMESTAMPTZ   NOT NULL
updated_at                    TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(chat_id, user_id)
CHECK(last_read_sequence >= 0)
CHECK(last_visible_message_sequence >= 0)
CHECK(left_after_sequence IS NULL OR left_after_sequence >= 0)
CHECK(last_read_sequence <= last_visible_message_sequence)
```

Semantics:
- unread: `last_visible_message_sequence > last_read_sequence`;
- `left_after_sequence` фиксирует границу истории после выхода;
- read state движется только вперёд.

Recommended index:

```text
(user_id)
```

## messages

```text
id                UUID          PRIMARY KEY
chat_id           UUID          NOT NULL FK → chats.id
sender_user_id    UUID          NULL FK → users.id
recipient_user_id UUID          NULL FK → users.id

sequence_number   BIGINT        NOT NULL
type              TEXT          NOT NULL
content_text      TEXT          NULL
system_event      TEXT          NULL
metadata          JSONB         NOT NULL DEFAULT '{}'

created_at        TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(chat_id, sequence_number)
CHECK(sequence_number > 0)
CHECK(type IN ('user', 'system'))

CHECK(
  (type = 'user' AND sender_user_id IS NOT NULL AND recipient_user_id IS NULL)
  OR
  (type = 'system' AND sender_user_id IS NULL)
)
```

Rules:
- user message создаётся только от authenticated sender;
- system messages создаёт только backend;
- system message может быть общим или персональным через `recipient_user_id`;
- сообщения в MVP не редактируются и физически не удаляются.

Recommended access path:

```text
(chat_id, sequence_number DESC)
```

## chat_summaries

```text
id                UUID          PRIMARY KEY
chat_id           UUID          NOT NULL UNIQUE FK → chats.id
summary_text      TEXT          NOT NULL
through_sequence  BIGINT        NOT NULL
created_at        TIMESTAMPTZ   NOT NULL
updated_at        TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(through_sequence >= 0)
```

Max one summary per Chat.

---

# 3. Group Chat creation / membership

## group_chat_creations

```text
id                        UUID          PRIMARY KEY
source_chat_id            UUID          NOT NULL FK → chats.id
initiated_by_user_id      UUID          NOT NULL FK → users.id
candidate_user_id         UUID          NOT NULL FK → users.id
status                    TEXT          NOT NULL
candidate_response        TEXT          NULL
candidate_responded_at    TIMESTAMPTZ   NULL
base_membership_version   INTEGER       NOT NULL
created_group_chat_id     UUID          NULL UNIQUE FK → chats.id
created_at                TIMESTAMPTZ   NOT NULL
resolved_at               TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(status IN ('pending', 'accepted', 'rejected', 'stale', 'cancelled'))
CHECK(candidate_response IS NULL OR candidate_response IN ('accept', 'reject'))
CHECK(candidate_user_id <> initiated_by_user_id)
CHECK(base_membership_version >= 1)

partial UNIQUE(source_chat_id)
WHERE status = 'pending'
```

Rules:
- source Chat должен быть direct;
- candidate не голосует как current participant;
- candidate должен иметь Match хотя бы с одним current participant;
- unanimity current participants + candidate accept;
- затем атомарно создаётся новый group Chat из 3 участников;
- исходный direct Chat остаётся.

## group_chat_creation_votes

```text
id           UUID          PRIMARY KEY
creation_id  UUID          NOT NULL FK → group_chat_creations.id
user_id      UUID          NOT NULL FK → users.id
vote         TEXT          NULL
created_at   TIMESTAMPTZ   NOT NULL
voted_at     TIMESTAMPTZ   NULL
```

Constraints:

```text
UNIQUE(creation_id, user_id)
CHECK(vote IS NULL OR vote IN ('accept', 'reject'))
```

## chat_membership_proposals

```text
id                        UUID          PRIMARY KEY
chat_id                   UUID          NOT NULL FK → chats.id
initiated_by_user_id      UUID          NOT NULL FK → users.id
candidate_user_id         UUID          NOT NULL FK → users.id
status                    TEXT          NOT NULL
candidate_response        TEXT          NULL
candidate_responded_at    TIMESTAMPTZ   NULL
base_membership_version   INTEGER       NOT NULL
created_at                TIMESTAMPTZ   NOT NULL
resolved_at               TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(status IN ('pending', 'accepted', 'rejected', 'stale', 'cancelled'))
CHECK(candidate_response IS NULL OR candidate_response IN ('accept', 'reject'))
CHECK(base_membership_version >= 1)

partial UNIQUE(chat_id)
WHERE status = 'pending'
```

Rules:
- Chat должен быть group;
- candidate должен иметь Match хотя бы с одним current participant;
- current participants голосуют, candidate отвечает отдельно;
- apply проверяет `base_membership_version`;
- successful apply → create ChatParticipant + `membership_version++` + system Message атомарно.

## chat_membership_votes

```text
id           UUID          PRIMARY KEY
proposal_id  UUID          NOT NULL FK → chat_membership_proposals.id
user_id      UUID          NOT NULL FK → users.id
vote         TEXT          NULL
created_at   TIMESTAMPTZ   NOT NULL
voted_at     TIMESTAMPTZ   NULL
```

Constraints:

```text
UNIQUE(proposal_id, user_id)
CHECK(vote IS NULL OR vote IN ('accept', 'reject'))
```

---

# 4. Trips — lifecycle / membership / confirmed state

## trips

```text
id                    UUID          PRIMARY KEY
chat_id               UUID          NOT NULL FK → chats.id
created_by_user_id     UUID          NOT NULL FK → users.id

status                 TEXT          NOT NULL
membership_version     INTEGER       NOT NULL DEFAULT 1
state_version          INTEGER       NOT NULL DEFAULT 1

destination_version    INTEGER       NOT NULL DEFAULT 0
dates_version          INTEGER       NOT NULL DEFAULT 0
budget_version         INTEGER       NOT NULL DEFAULT 0
transport_version      INTEGER       NOT NULL DEFAULT 0

destination_status     TEXT          NOT NULL DEFAULT 'empty'
dates_status           TEXT          NOT NULL DEFAULT 'empty'
budget_status          TEXT          NOT NULL DEFAULT 'empty'
transport_status       TEXT          NOT NULL DEFAULT 'empty'

date_from               DATE          NULL
date_to                 DATE          NULL

budget_min              NUMERIC(12,2) NULL
budget_max              NUMERIC(12,2) NULL
budget_currency         TEXT          NULL
budget_scope            TEXT          NULL

started_at              TIMESTAMPTZ   NULL
completed_at            TIMESTAMPTZ   NULL
cancelled_at            TIMESTAMPTZ   NULL

created_at              TIMESTAMPTZ   NOT NULL
updated_at              TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(status IN ('forming', 'active', 'completed', 'cancelled'))

CHECK(membership_version >= 1)
CHECK(state_version >= 1)

CHECK(destination_version >= 0)
CHECK(dates_version >= 0)
CHECK(budget_version >= 0)
CHECK(transport_version >= 0)

CHECK(destination_status IN ('empty', 'confirmed', 'review_required', 'pending_analysis'))
CHECK(dates_status IN ('empty', 'confirmed', 'review_required', 'pending_analysis'))
CHECK(budget_status IN ('empty', 'confirmed', 'review_required', 'pending_analysis'))
CHECK(transport_status IN ('empty', 'confirmed', 'review_required', 'pending_analysis'))

CHECK(date_from IS NULL OR date_to IS NULL OR date_to >= date_from)
CHECK(budget_min IS NULL OR budget_min >= 0)
CHECK(budget_max IS NULL OR budget_max >= 0)
CHECK(budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min)
CHECK(budget_scope IS NULL OR budget_scope IN ('per_person', 'group_total'))

partial UNIQUE(chat_id)
WHERE status IN ('forming', 'active')
```

Rules:
- confirmed Trip state — snapshot и не меняется автоматически от Profile/TravelIntent;
- version `0` означает, что block ещё не был подтверждён;
- `NULL`/`empty` означает отсутствие подтверждённого значения;
- после `active` новых TripParticipant добавлять нельзя.

### Route / destination model — FINAL FOR MVP

`destination` в domain semantics трактуется как aggregate route block, а не как один scalar destination.

Реальные точки маршрута хранятся в `trip_stops`:

```text
Tokyo → Kyoto → Osaka
```

В `trips` не хранится один `destination_label`.

Aggregate-level поля остаются:

```text
destination_version
destination_status
```

Они относятся ко всему упорядоченному route/stops plan.

Proposal и TripBlockReview для `destination` в MVP работают с route aggregate целиком.

## trip_invitations

```text
id            UUID          PRIMARY KEY
trip_id       UUID          NOT NULL FK → trips.id
user_id       UUID          NOT NULL FK → users.id
message_id    UUID          NOT NULL UNIQUE FK → messages.id
status        TEXT          NOT NULL
created_at    TIMESTAMPTZ   NOT NULL
responded_at  TIMESTAMPTZ   NULL
cancelled_at  TIMESTAMPTZ   NULL
```

Constraints:

```text
UNIQUE(trip_id, user_id)
CHECK(status IN ('pending', 'accepted', 'declined', 'cancelled'))
```

ER relation `TripInvitation 1:1 Message` означает обязательный `message_id`.

## trip_participants

```text
id          UUID          PRIMARY KEY
trip_id     UUID          NOT NULL FK → trips.id
user_id     UUID          NOT NULL FK → users.id
joined_at   TIMESTAMPTZ   NOT NULL
left_at     TIMESTAMPTZ   NULL
created_at  TIMESTAMPTZ   NOT NULL
updated_at  TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
UNIQUE(trip_id, user_id)
```

Lifecycle:

```text
Create Trip
→ forming
→ personal TripInvitation + personal system Message

Accept invitation
→ TripParticipant

Start planning
→ forming
→ >=2 active participants
→ remaining pending invitations cancelled
→ active + started_at

Leave
→ left_at
→ membership_version++
→ pending Proposals cancelled
→ TripBlockReview
→ if active participants < 2: Trip cancelled

Complete
→ any active TripParticipant may complete only if:
   status = active
   dates_status = confirmed
   date_to IS NOT NULL
   current date >= date_to

Manual cancel
→ only via TripLifecycleDecision + unanimous votes
```

## trip_stops

```text
id                    UUID          PRIMARY KEY
trip_id               UUID          NOT NULL FK → trips.id

position               INTEGER       NOT NULL

place_label            TEXT          NOT NULL
country_code           TEXT          NULL
place_ref              TEXT          NULL

stay_from              DATE          NULL
stay_to                DATE          NULL

notes                   TEXT          NULL

created_at              TIMESTAMPTZ   NOT NULL
updated_at              TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(trip_id, position)
UNIQUE(trip_id, id)
CHECK(position >= 1)

CHECK(
  stay_from IS NULL
  OR stay_to IS NULL
  OR stay_to >= stay_from
)
```

Semantics:

- `trip_stops` — подтверждённый ordered route snapshot;
- минимум один stop нужен, когда destination/route block становится `confirmed`;
- изменение stop/order считается изменением destination block:
  `trips.destination_version++` и `trips.state_version++`;
- изменение Profile/TravelIntent пользователя не меняет `trip_stops`;
- `place_ref` provider-neutral и не привязан к конкретному Maps API;
- `stay_from/stay_to` optional: общий Trip date range по-прежнему хранится в `trips.date_from/date_to`.

Example:

```text
position 1 → Tokyo
position 2 → Kyoto
position 3 → Osaka
```

Route Proposal в MVP предлагает целиком новый ordered stops snapshot, а не независимые stop-level mutations.

Recommended access path:

```text
(trip_id, position)
```

## trip_transport_segments

> Согласованная часть physical model; ER/domain documentation синхронизирована с этой семантикой.

```text
id                    UUID          PRIMARY KEY
trip_id               UUID          NOT NULL FK → trips.id

position               INTEGER       NOT NULL
mode                   TEXT          NOT NULL

origin_trip_stop_id   UUID          NOT NULL FK → trip_stops.id
destination_trip_stop_id UUID       NOT NULL FK → trip_stops.id

origin_label           TEXT          NOT NULL
origin_place_ref       TEXT          NULL
destination_label      TEXT          NOT NULL
destination_place_ref  TEXT          NULL

departure_at           TIMESTAMPTZ   NULL
arrival_at             TIMESTAMPTZ   NULL

price_amount           NUMERIC(12,2) NULL
price_currency         TEXT          NULL
price_scope            TEXT          NULL

details                JSONB         NOT NULL DEFAULT '{}'
external_selection_id  UUID          NULL FK → trip_external_selections.id

created_at             TIMESTAMPTZ   NOT NULL
updated_at             TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(trip_id, position)
CHECK(position >= 1)
CHECK(mode IN ('flight', 'train', 'bus', 'car', 'ferry', 'other'))
CHECK(origin_trip_stop_id <> destination_trip_stop_id)
CHECK(price_amount IS NULL OR price_amount >= 0)
CHECK(price_scope IS NULL OR price_scope IN ('per_person', 'group_total'))
CHECK(departure_at IS NULL OR arrival_at IS NULL OR arrival_at >= departure_at)

FOREIGN KEY(trip_id, origin_trip_stop_id)
  REFERENCES trip_stops(trip_id, id)
FOREIGN KEY(trip_id, destination_trip_stop_id)
  REFERENCES trip_stops(trip_id, id)
```

`trip_stops` дополнительно имеет `UNIQUE(trip_id, id)` для этих composite foreign keys.

Semantics:

```text
TripTransportSegment соединяет две TripStop той же Trip.
Изменение segment/order меняет transport aggregate:
trips.transport_version++
→ trips.state_version++
```

`details JSONB` хранит mode-specific confirmed snapshot. `transport_status` и `transport_version` относятся ко всему transport aggregate в `trips`, а не к отдельному segment.

Transport Proposal в MVP предлагает целиком новый ordered transport-plan snapshot, а не независимые segment-level mutations.

---

# 5. Proposal / voting / reviews

## proposals

```text
id                        UUID          PRIMARY KEY
trip_id                   UUID          NOT NULL FK → trips.id

proposal_type             TEXT          NOT NULL
block_type                TEXT          NOT NULL
status                    TEXT          NOT NULL
origin                    TEXT          NOT NULL

initiated_by_user_id      UUID          NULL FK → users.id
ai_request_id             UUID          NULL FK → ai_requests.id
message_id                UUID          NOT NULL UNIQUE FK → messages.id

proposed_value            JSONB         NOT NULL
explanation               TEXT          NULL

base_membership_version   INTEGER       NOT NULL
base_block_version        INTEGER       NOT NULL


created_at                TIMESTAMPTZ   NOT NULL
resolved_at               TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(proposal_type IN (
  'update_destination',
  'update_dates',
  'update_budget',
  'update_transport'
))

CHECK(block_type IN ('destination', 'dates', 'budget', 'transport'))

CHECK(status IN (
  'pending',
  'accepted',
  'rejected',
  'cancelled',
  'expired',
  'stale'
))

CHECK(origin IN ('user_ai_request', 'membership_review'))

CHECK(base_membership_version >= 1)
CHECK(base_block_version >= 0)

partial UNIQUE(trip_id, block_type)
WHERE status = 'pending'
```

Rules:
- `message_id` обязателен: Proposal отображается через Message;
- `user_ai_request` → initiated_by_user_id required, ai_request_id expected;
- `membership_review` → initiated_by_user_id may be NULL;
- Proposal в MVP применяется к aggregate block целиком;
- `destination` Proposal содержит полный ordered route/stops snapshot;
- `transport` Proposal содержит полный подтверждаемый transport-plan snapshot;
- stop-level и segment-level Proposal / parallel voting не входят в MVP.

## proposal_votes

```text
id           UUID          PRIMARY KEY
proposal_id  UUID          NOT NULL FK → proposals.id
user_id      UUID          NOT NULL FK → users.id
vote         TEXT          NULL
created_at   TIMESTAMPTZ   NOT NULL
voted_at     TIMESTAMPTZ   NULL
```

Constraints:

```text
UNIQUE(proposal_id, user_id)
CHECK(vote IS NULL OR vote IN ('accept', 'reject'))
```

Rules:
- rows создаются заранее для всех active TripParticipants;
- голос меняется `NULL → accept/reject` один раз;
- любой reject → rejected;
- unanimity → accepted;
- apply проверяет membership/block versions;
- Proposal status + Trip update + versions + system Message — одна transaction;
- version mismatch → stale;
- membership change → unfinished Proposal cancelled.

Option flow:

```text
ExternalOffers
→ AI ranking
→ OptionSet / comparison
→ selected option
→ one Proposal
→ accept/reject
→ confirmed Trip state
```

Текущая модель не является multi-choice/ranked voting.

## trip_block_reviews

```text
id                        UUID          PRIMARY KEY
trip_id                   UUID          NOT NULL FK → trips.id

block_type                TEXT          NOT NULL
trigger                   TEXT          NOT NULL
status                    TEXT          NOT NULL

base_membership_version   INTEGER       NOT NULL
base_block_version        INTEGER       NOT NULL

resolved_by_proposal_id   UUID          NULL UNIQUE FK → proposals.id

created_at                TIMESTAMPTZ   NOT NULL
resolved_at               TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(block_type IN ('destination', 'dates', 'budget', 'transport'))
CHECK(trigger IN ('membership_changed', 'manual', 'system'))

CHECK(status IN (
  'pending_analysis',
  'review_required',
  'resolved',
  'cancelled'
))

CHECK(base_membership_version >= 1)
CHECK(base_block_version >= 0)

partial UNIQUE(trip_id, block_type)
WHERE status IN ('pending_analysis', 'review_required')
```

Reconciliation with ER:
- `stale` НЕ добавляется в Review status;
- устаревший analysis не применяется, текущий review отменяется/заменяется при необходимости.

After membership change:

```text
budget → review_required

destination / dates / transport
→ pending_analysis
→ AI: unaffected OR needs_review
```

AI не меняет Trip напрямую.

- unaffected → resolved, confirmed value stays;
- needs_review → review_required → Proposal;
- rejected Proposal не закрывает review;
- accepted Proposal закрывает review;
- completed/cancelled Trip отменяет unfinished reviews.

---

# 6. Trip lifecycle decisions

## trip_lifecycle_decisions

```text
id                        UUID          PRIMARY KEY
trip_id                   UUID          NOT NULL FK → trips.id
initiated_by_user_id      UUID          NOT NULL FK → users.id
decision_type             TEXT          NOT NULL
status                    TEXT          NOT NULL
base_membership_version   INTEGER       NOT NULL
base_state_version        INTEGER       NOT NULL
created_at                TIMESTAMPTZ   NOT NULL
resolved_at               TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(decision_type IN ('cancel_trip'))
CHECK(status IN ('pending', 'accepted', 'rejected', 'stale', 'cancelled'))
CHECK(base_membership_version >= 1)
CHECK(base_state_version >= 1)

partial UNIQUE(trip_id, decision_type)
WHERE status = 'pending'
```

Membership change cancels unfinished lifecycle vote.

## trip_lifecycle_votes

```text
id           UUID          PRIMARY KEY
decision_id  UUID          NOT NULL FK → trip_lifecycle_decisions.id
user_id      UUID          NOT NULL FK → users.id
vote         TEXT          NULL
created_at   TIMESTAMPTZ   NOT NULL
voted_at     TIMESTAMPTZ   NULL
```

Constraints:

```text
UNIQUE(decision_id, user_id)
CHECK(vote IS NULL OR vote IN ('accept', 'reject'))
```

Manual cancellation:
- active Trip;
- vote rows for all active TripParticipants;
- any reject → rejected;
- unanimity → accepted + Trip cancelled atomically.

Automatic cancellation (`active participants < 2`) не требует lifecycle decision.

---

# 7. AI / External Integrations

## ai_requests

```text
id                    UUID          PRIMARY KEY
chat_id               UUID          NOT NULL FK → chats.id
trip_id               UUID          NULL FK → trips.id

initiated_by_user_id  UUID          NULL FK → users.id
charged_to_user_id    UUID          NULL FK → users.id

trigger_type          TEXT          NOT NULL
usage_scope           TEXT          NOT NULL

task_type             TEXT          NOT NULL
status                TEXT          NOT NULL

input_context         JSONB         NOT NULL DEFAULT '{}'
result_type           TEXT          NULL
result_data           JSONB         NULL

started_at            TIMESTAMPTZ   NULL
completed_at          TIMESTAMPTZ   NULL
failed_at             TIMESTAMPTZ   NULL
error_code            TEXT          NULL

created_at            TIMESTAMPTZ   NOT NULL
updated_at            TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(trigger_type IN ('user', 'system', 'scheduled'))

CHECK(usage_scope IN (
  'user_quota',
  'system',
  'promotional'
))

CHECK(status IN (
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
))

CHECK(usage_scope <> 'user_quota' OR charged_to_user_id IS NOT NULL)
CHECK(trigger_type <> 'user' OR initiated_by_user_id IS NOT NULL)
```

Rules:
- Public MVP API создаёт user-triggered requests.
- System/scheduled requests — internal backend operations.
- System usage не расходует user quota.
- AI может создать 0..N Proposal и может завершиться без Proposal.
- `input_context` не является unrestricted prompt dump и не содержит secrets.
- AI/ML не меняет Trip напрямую.

## external_providers

```text
id                    UUID          PRIMARY KEY
provider_key          TEXT          NOT NULL UNIQUE
provider_category     TEXT          NOT NULL
display_name          TEXT          NOT NULL
is_active             BOOLEAN       NOT NULL DEFAULT TRUE
created_at            TIMESTAMPTZ   NOT NULL
updated_at            TIMESTAMPTZ   NOT NULL
```

Suggested categories:

```text
transport
lodging
maps
currency
travel_content
other
```

Конкретные provider-ы выбираются позже.

## external_api_requests

```text
id                    UUID          PRIMARY KEY
ai_request_id         UUID          NULL FK → ai_requests.id
trip_id               UUID          NULL FK → trips.id
provider_id           UUID          NOT NULL FK → external_providers.id

request_type          TEXT          NOT NULL
status                TEXT          NOT NULL

request_params        JSONB         NOT NULL
response_metadata     JSONB         NULL

started_at            TIMESTAMPTZ   NULL
completed_at          TIMESTAMPTZ   NULL
failed_at             TIMESTAMPTZ   NULL
error_code            TEXT          NULL
created_at            TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'))
```

`ExternalAPIRequest` может существовать без AIRequest; `trip_id` сохраняет Trip context.

## external_offers

```text
id                        UUID          PRIMARY KEY
external_api_request_id   UUID          NOT NULL FK → external_api_requests.id
provider_id               UUID          NOT NULL FK → external_providers.id

external_id               TEXT          NULL
category                  TEXT          NOT NULL
title                     TEXT          NULL

price_amount              NUMERIC(12,2) NULL
price_currency            TEXT          NULL
price_scope               TEXT          NULL

structured_details        JSONB         NOT NULL
safe_provider_reference   TEXT          NULL

retrieved_at              TIMESTAMPTZ   NOT NULL
valid_until               TIMESTAMPTZ   NULL

created_at                TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(price_amount IS NULL OR price_amount >= 0)
CHECK(price_scope IS NULL OR price_scope IN ('per_person', 'group_total'))
```

`ExternalOffer` — временный provider snapshot, не confirmed state.

## proposal_external_offers

```text
proposal_id        UUID          NOT NULL FK → proposals.id
external_offer_id  UUID          NOT NULL FK → external_offers.id
position           INTEGER       NULL

PRIMARY KEY(proposal_id, external_offer_id)
CHECK(position IS NULL OR position >= 1)
```

Semantics:
- фиксирует offers, сравниваемые/показываемые в рамках Proposal;
- не означает выбор.

## trip_external_selections

```text
id                  UUID          PRIMARY KEY
trip_id             UUID          NOT NULL FK → trips.id
external_offer_id   UUID          NOT NULL FK → external_offers.id
proposal_id         UUID          NULL FK → proposals.id

selection_type      TEXT          NOT NULL
status              TEXT          NOT NULL

selected_at         TIMESTAMPTZ   NOT NULL
updated_at          TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(status IN ('active', 'stale', 'unavailable', 'replaced'))
```

Semantics:
- закрепляет подтверждённый внешний вариант в Trip;
- является traceability link;
- confirmed Trip snapshot хранит необходимые данные независимо от provider snapshot.

Transport traceability — FINAL FOR MVP:

- `TripExternalSelection` — authoritative domain-level pin выбранного provider offer;
- `trip_transport_segments` не должен хранить независимую прямую ссылку на `ExternalOffer`;
- segment при необходимости ссылается на `TripExternalSelection`;
- confirmed segment хранит собственный snapshot данных;
- provider offer может истечь/измениться, не меняя confirmed Trip;
- backend создаёт/обновляет selection и confirmed transport snapshot атомарно.

---

# 8. Features / Entitlements / Usage

## features

```text
id              UUID          PRIMARY KEY
feature_key     TEXT          NOT NULL UNIQUE
display_name    TEXT          NOT NULL
created_at      TIMESTAMPTZ   NOT NULL
updated_at      TIMESTAMPTZ   NOT NULL
```

Feature — capability, а не конкретная LLM/model.

## entitlements

```text
id              UUID          PRIMARY KEY
user_id         UUID          NOT NULL FK → users.id
feature_id      UUID          NOT NULL FK → features.id
status          TEXT          NOT NULL
starts_at       TIMESTAMPTZ   NULL
ends_at         TIMESTAMPTZ   NULL
source          TEXT          NOT NULL
created_at      TIMESTAMPTZ   NOT NULL
updated_at      TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(user_id, feature_id)
CHECK(status IN ('active', 'inactive'))
CHECK(source IN ('default', 'manual', 'subscription', 'promotion'))
CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
```

Backend всегда повторно проверяет entitlement.

## usage_counters

```text
id                UUID          PRIMARY KEY
user_id           UUID          NOT NULL FK → users.id
feature_id        UUID          NOT NULL FK → features.id

period_start      TIMESTAMPTZ   NOT NULL
period_end        TIMESTAMPTZ   NOT NULL

used_count        INTEGER       NOT NULL DEFAULT 0
reserved_count    INTEGER       NOT NULL DEFAULT 0
limit_count       INTEGER       NULL

updated_at        TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
UNIQUE(user_id, feature_id, period_start)
CHECK(used_count >= 0)
CHECK(reserved_count >= 0)
CHECK(limit_count IS NULL OR limit_count >= 0)
CHECK(period_end > period_start)
CHECK(limit_count IS NULL OR used_count + reserved_count <= limit_count)
```

Flow:

```text
check quota
→ reserve usage
→ start AIRequest
→ consume reservation OR release reservation
```

### UsageEvent

Отдельная `usage_events` таблица не входит в утверждённый ER registry.
Не добавлять её в migrations без отдельного domain/ER решения.

---

# 9. Affiliate attribution

> Эти сущности есть в утверждённой ER model. Они могут не входить в первый persistence slice, но physical design не должен их терять.

## affiliate_partners

```text
id            UUID          PRIMARY KEY
partner_key   TEXT          NOT NULL UNIQUE
display_name  TEXT          NOT NULL
is_active     BOOLEAN       NOT NULL DEFAULT TRUE
created_at    TIMESTAMPTZ   NOT NULL
updated_at    TIMESTAMPTZ   NOT NULL
```

## affiliate_campaigns

```text
id            UUID          PRIMARY KEY
partner_id    UUID          NOT NULL FK → affiliate_partners.id
campaign_key  TEXT          NOT NULL
metadata      JSONB         NOT NULL DEFAULT '{}'
created_at    TIMESTAMPTZ   NOT NULL
updated_at    TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
UNIQUE(partner_id, campaign_key)
```

## user_attributions

```text
id            UUID          PRIMARY KEY
user_id       UUID          NOT NULL FK → users.id
campaign_id   UUID          NOT NULL FK → affiliate_campaigns.id
attributed_at TIMESTAMPTZ   NOT NULL
metadata      JSONB         NOT NULL DEFAULT '{}'
```

Exact attribution uniqueness/window policy — TODO перед affiliate implementation.

## affiliate_clicks

```text
id                  UUID          PRIMARY KEY
user_id             UUID          NOT NULL FK → users.id
external_offer_id   UUID          NOT NULL FK → external_offers.id
partner_id          UUID          NOT NULL FK → affiliate_partners.id
trip_id             UUID          NULL FK → trips.id
proposal_id         UUID          NULL FK → proposals.id
created_at          TIMESTAMPTZ   NOT NULL
metadata            JSONB         NOT NULL DEFAULT '{}'
```

Flow:

```text
frontend passes external_offer_id
→ backend checks access + allowlist
→ refreshes safe URL if needed
→ creates AffiliateClick
→ redirects
```

Affiliate status must not silently affect ranking.

## affiliate_conversions — future

ER reserves this future entity. Не реализовывать в первой версии без необходимости.

---

# 10. Safety / moderation

## user_blocks

```text
id                  UUID          PRIMARY KEY
blocker_user_id     UUID          NOT NULL FK → users.id
blocked_user_id     UUID          NOT NULL FK → users.id
created_at          TIMESTAMPTZ   NOT NULL
```

Constraints:

```text
CHECK(blocker_user_id <> blocked_user_id)
UNIQUE(blocker_user_id, blocked_user_id)
```

Semantics:
- unilateral action;
- bilateral effect for new interactions;
- excludes pair from Discover;
- prevents new Like/Match/new interaction;
- hides direct Chat according to product rule;
- does not delete history.

Shared Group Chat rule:

```text
show warning to blocker
→ after confirmation blocker leaves all shared Group Chats
→ blocker leaves corresponding active Trips
→ blocked user remains
```

Trip leave uses normal flow:
- pending Proposals cancelled;
- TripBlockReview;
- budget mandatory review;
- auto-cancel if active participants < 2.

## user_reports

```text
id                  UUID          PRIMARY KEY
reporter_user_id    UUID          NOT NULL FK → users.id
target_user_id      UUID          NOT NULL FK → users.id
reason              TEXT          NOT NULL
comment             TEXT          NULL
chat_id             UUID          NULL FK → chats.id
trip_id             UUID          NULL FK → trips.id
message_id          UUID          NULL FK → messages.id
status              TEXT          NOT NULL DEFAULT 'open'
created_at          TIMESTAMPTZ   NOT NULL
reviewed_at         TIMESTAMPTZ   NULL
resolved_at         TIMESTAMPTZ   NULL
```

Constraints:

```text
CHECK(reporter_user_id <> target_user_id)
CHECK(status IN ('open', 'under_review', 'resolved', 'dismissed'))
```

One report does not trigger automatic punishment.

---

# 11. Telegram reminders / badges

Badges are computed from domain state:

- Chats: count of Chats with unread visible messages.
- Discover: aggregated unseen Like/Match signal.
- Trips: count of Trips where user action is required.

## telegram_reminders

```text
id            UUID          PRIMARY KEY
user_id       UUID          NOT NULL FK → users.id
status        TEXT          NOT NULL
categories    TEXT[]        NOT NULL DEFAULT '{}'
scheduled_at  TIMESTAMPTZ   NOT NULL
sent_at       TIMESTAMPTZ   NULL
created_at    TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(status IN ('scheduled', 'sent', 'cancelled', 'failed'))
```

Rules:
- only when no recent app activity;
- aggregates categories;
- no notification per individual event;
- no private content;
- max frequency is backend configuration.

Reminder settings in `user_settings` — TODO after exact product decision.

---

# 12. Audit

## audit_events

```text
id                  UUID          PRIMARY KEY
actor_type          TEXT          NOT NULL
actor_user_id       UUID          NULL FK → users.id

action              TEXT          NOT NULL
entity_type         TEXT          NULL
entity_id           UUID          NULL

result              TEXT          NULL
reason_code         TEXT          NULL
metadata            JSONB         NOT NULL DEFAULT '{}'

request_id          TEXT          NULL
correlation_id      TEXT          NULL

created_at          TIMESTAMPTZ   NOT NULL
```

Constraint:

```text
CHECK(actor_type IN ('user', 'system', 'admin'))
```

Append-only.

Audit at least:
- account state changes;
- blocks;
- account deletion;
- Match/Chat creation;
- Chat/Trip membership changes;
- Proposal apply;
- Entitlement grants;
- critical auth/security events;
- provider redirect/security decisions;
- affiliate conversion when implemented.

Do not audit:
- every Message;
- every Discover impression;
- every Profile view;
- every read-state update.

Never log:
- bot token;
- access/session token;
- auth header;
- provider secret;
- unrestricted raw credentials.

---

# 13. FK deletion policy — decision before migrations

Default principle: historical/domain data is not deleted by convenience cascades.

Expected direction:

```text
users
→ soft delete only

historical FK to users
→ keep reference / RESTRICT where possible

optional operational actor reference
→ SET NULL only if history remains understandable

owned ephemeral child data
→ CASCADE only when explicit domain deletion requires it
```

Before migrations produce a complete FK matrix with explicit:

```text
ON DELETE RESTRICT
ON DELETE SET NULL
ON DELETE CASCADE
```

for every FK.

Do not rely on accidental defaults.

---

# 14. Remaining decisions before Supabase migrations

## Route / transport decisions — RESOLVED FOR MVP

Final MVP physical direction:

```text
Trip
→ ordered trip_stops
→ ordered trip_transport_segments
```

Rules:

- destination block = aggregate ordered route/stops plan;
- transport block = aggregate ordered transport plan;
- Proposal concurrency remains aggregate-level;
- no stop-level or segment-level Proposal in MVP;
- `TripExternalSelection` is authoritative provider-offer pin;
- transport segment stores confirmed snapshot and may reference `TripExternalSelection`.

ER/domain documentation синхронизирована с этими physical extensions до начала migrations.

## A. TelegramReminder settings

Exact user-facing reminder settings are not yet fixed.
Do not invent notification settings columns before product decision.

## B. Affiliate physical details

Affiliate entities stay in the design because the ER includes them.
They may be postponed from the first persistence slice if not launch-critical.

## C. External providers

Concrete provider choices are intentionally postponed.
Choose them during integrations implementation by comparing capabilities, coverage, pricing, rate limits, latency, data quality, licensing/terms and affiliate opportunities.

## D. Auth session storage

Before completing `/auth/telegram`, decide:

- JWT vs opaque session;
- session storage if required;
- final Telegram initData TTL;
- replay policy.

## E. RLS / database roles

Design after the physical schema and before public persistence deployment.
Frontend must not receive privileged database access.

# 15. Suggested implementation order

Do not create every table in one migration.

```text
1. Core identity
   users
   telegram_identities
   profiles
   profile_photos
   user_settings
   user_activity_states
   travel_intents

2. Telegram Auth persistence/session

3. Discover / matching
   discover_impressions
   discover_decisions
   likes
   matches

4. Chats
   chats
   chat_participants
   messages
   chat_summaries

5. Trips lifecycle
   trips
   trip_invitations
   trip_participants

6. Group membership / lifecycle decisions

7. Route + transport persistence

8. Proposal / voting / TripBlockReview

9. AI / Usage

10. External integrations

11. Safety / moderation / reminders / audit

12. Affiliate layer when required
```

For each slice:

```text
migration
→ constraints review
→ backend integration
→ focused tests
→ next slice
```

---

# 16. Explicit non-goals

This document does not define:

- SQL migration syntax;
- RLS policies;
- exact PostgreSQL enum implementation;
- FastAPI repositories;
- OpenAPI payloads/status codes;
- realtime transport;
- concrete external API providers;
- ML deployment topology;
- home server topology;
- production backup strategy;
- final Figma/UI representation.
