# Travel Friend — AI Developer Handoff + `copilot-v1` Working Contract

**Дата:** 07.11.2026
**Назначение:** самодостаточный пакет, который можно **сразу передать AI-разработчику** и добавить в контекст его проекта.
**Продуктовые решения:** утверждены. **Технический контракт ниже:** согласованная для старта **предлагаемая базовая версия `copilot-v1`**. Она не является уже внедрённым endpoint и требует одного совместного compatibility review перед integration merge. Разработчик **не должен ждать** создания нашего Trip/Proposal backend, чтобы начать AI loops.

> **Приоритет:** решения продуктового чата 06–07.11.2026 и `docs/ai-trip-product-spec.md` старше этого handoff, а этот handoff приоритетнее устаревших описаний AI/Proposal в `docs/backend/*`. Вся существующая документация GitHub, которая ему противоречит, — historical design input. Никакие новые сущности и API из этого документа не объявляются уже реализованными.

## 1. Задача и граница двух разработчиков

**Итоговый пользовательский flow:** `Chat → AI result / AI Draft → human-created Proposal → unanimous vote → Confirmed Trip → final PDF`.

**Ваша AI-часть:** модельный adapter, prompts, обработка выданного контекста, ChatSummary suggestion, рекомендации и подробная day-by-day программа, candidate edits/proposals, model-level safety, structured output, evaluators, mock tool client, стоимость и качество. Сервис должен поддерживать один вызов, который возвращает **текстовый ответ, 0..N вариантов программы, 0..N кандидатов изменений** и (опционально) новую summary.

**Наша backend-часть:** Telegram/Bearer auth, Chat/Trip/AIRequest/Draft/Proposal persistence, participant permissions, Supabase/RLS и scoped capabilities, `scope_key` и версии, отправка голосований, сами голоса, квоты/Premium, очереди/статусы/отмена, реальный tool gateway и внешние API, bot notifications и PDF. **AI никогда не пишет в Supabase и не меняет Confirmed Trip/Draft/Proposal напрямую.** AI output — недоверенные данные, которые backend проверяет и показывает человеку.

**Ключевая независимость:** для AI используйте `run_copilot(input, tool_gateway) -> output`; fake input, deterministic fake model и mock gateway. Мы интегрируем этот интерфейс со своим backend **позже**. Разработчик может закончить AI loops раньше, чем появится наш runtime.

## 2. Что считается зафиксированным в `copilot-v1`

1. **Versioned immutable input snapshot**: `contract_version`, `request_id`, trigger, initiator/tier, Chat/Trip identity, cutoff и разрешённый `context`. Новые сообщения после cutoff не попадают в текущий AI request.
2. **Versioned output**: ответ в общий Chat, необязательные draft candidates, отдельные change candidates, summary suggestion, usage telemetry. Никаких голосов, `proposal_id` или committed Trip от модели.
3. **Tool gateway injection**: модель может запросить **только** backend-allowlisted tools в пределах budgets. Реальные API keys и provider URLs не выдаются модели.
4. **Validation + bounded execution**: ограничение входа/выхода, time budget, number of tool calls, timeout и cancellation; fail closed при нарушении лимитов.
5. **Provider-neutral inference**: стандартная облачная модель сейчас, усиленная по разрешению backend; позднее self-host/multi-model без изменения публичного Chat/Trip flow.
6. **Backend-owned lifecycle**: AIRequest queued/processing/completed/failed/cancelled, one active per Chat, personal quotas, idempotency, publication and retry/refund — не обязанность модели.

**Что намеренно НЕ frozen:** PostgreSQL-таблицы, scope-lock encoding/`scope_key`, физический HTTP/queue transport worker, deployment topology, API provider list, числовые лимиты/тарифы, и конкретный registry исполняемых Trip mutations. AI разработчик может реализовать **семантические change candidates** по схеме ниже; превращать их в реальные операции Trip будет наш backend. Не додумывать SQL/permission/booking flow самостоятельно.

## 3. Рекомендуемая локальная структура AI-проекта

```text
ai-service/
  src/
    contract_v1.py            # typed input/output and strict validation
    copilot.py                # async run_copilot(input, tools, model)
    model_adapter.py          # interchangeable cloud/local model adapter
    prompts/                 # explicit role and context rules
    summary.py                # ChatSummary suggestion
    itinerary.py              # structured day-by-day plan
    tool_gateway.py           # interface + offline fake implementation
  tests/
    fixtures/                # sanitized JSON, no real user data
    test_contract_v1.py
    test_safety.py
    test_planner.py
    test_summary.py
    test_tools.py
  README.md
```

Это **пример организации, не требование изменить наш repo layout**. Если у разработчика уже есть рабочая структура, сохраняйте её при соблюдении контрактов. Привязки к конкретному Python web framework для внешнего транспорта пока нет.

## 4. `CopilotInputV1`: обязательный envelope и пример fixture

В начале реализации создайте строгую типизированную Pydantic/JSON Schema модель для **этих полей**. Вложенные `confirmed_trip`, `working_draft` и `plan` — **нормализованные domain snapshots**, а не сырые строки SQL. Если не хватает специфического поля для itinerary, расширяйте его добавочным опциональным атрибутом; не меняйте envelope/семантику самостоятельно.

```json
{
  "contract_version": "copilot-v1",
  "request_id": "00000000-0000-4000-8000-000000000001",
  "trigger": {
    "kind": "mention",
    "prompt": "Предложи спокойную программу в Киото на пять дней",
    "message_sequence": 50
  },
  "actor": {
    "user_id": "00000000-0000-4000-8000-000000000004",
    "model_tier": "standard"
  },
  "conversation": {
    "chat_id": "00000000-0000-4000-8000-000000000002",
    "trip_id": "00000000-0000-4000-8000-000000000003",
    "cutoff_message_sequence": 50
  },
  "context": {
    "participants": [
      {
        "user_id": "00000000-0000-4000-8000-000000000004",
        "public_profile": {"interests": ["музеи"], "comfort_level": "moderate"},
        "travel_intent": {"destination": "Япония"}
      },
      {
        "user_id": "00000000-0000-4000-8000-000000000005",
        "public_profile": {"interests": ["природа"]},
        "travel_intent": {"destination": "Япония"}
      }
    ],
    "confirmed_trip": {
      "state_version": 8,
      "membership_version": 1,
      "route": [{"id": "stop-1", "label": "Киото"}],
      "dates": {"from": "2027-04-05", "to": "2027-04-09"},
      "budget": {"max": 150000, "currency": "RUB", "scope": "per_person"},
      "transport": [],
      "accommodation": [],
      "days": [
        {
          "day_id": "day-1", "version": 3, "date": "2027-04-05",
          "items": [
            {"item_id": "event-1", "kind": "activity", "title": "Экскурсия", "start_time": null, "end_time": null, "note": null}
          ]
        }
      ]
    },
    "working_draft": null,
    "chat_summary": {
      "version": 2,
      "processed_through_sequence": 35,
      "text": "Участники предпочитают спокойные прогулки; конкретные отели не согласованы."
    },
    "messages": [
      {
        "sequence": 50,
        "sender_user_id": "00000000-0000-4000-8000-000000000004",
        "text": "@Copilot предложи спокойную программу в Киото на пять дней"
      }
    ]
  },
  "tools": {
    "allowed_names": [],
    "max_calls": 0,
    "max_total_cost_minor_units": 0
  },
  "limits": {
    "max_output_tokens": 3500,
    "deadline_ms": 45000
  }
}
```

**Правила поля/edge cases:**

- `contract_version` всегда буквальное `copilot-v1`; иные версии — `UNSUPPORTED_CONTRACT`.
- `request_id` стабилен для retry того же user request; повтор не должен производить непредсказуемые внешние побочные эффекты. Бухгалтерия идемпотентности принадлежит backend.
- `trigger.kind` = `button | mention`; если `button`, `message_sequence` может быть `null`, а `prompt` задаётся user message/prompt при запуске. AI вызывается только по такому явному событию.
- `actor.user_id` и `model_tier` **уже проверены backend**, не принимаются из prompt как смена прав. AI adapter не выбирает Premium на основе текста.
- `conversation.trip_id`, `confirmed_trip` и `working_draft` могут быть `null`, когда Trip ещё не создана или Draft отсутствует. Ответ/кандидат itinerary в Chat допустим и в таком случае; сохранить общий Draft пока нельзя без user action и Trip.
- `context.messages[].sequence` ≤ `cutoff_message_sequence`, сообщения сортированы по sequence; набор может быть укорочен backend по token budget. `chat_summary.processed_through_sequence` ≤ cutoff. Модель не пытается дочитать новые сообщения самостоятельно.
- Публичные поля профилей и TravelIntent всех активных участников передаются только allowlist backend; никаких tokens, Telegram `initData`, `service_role`, внутренних prompt secrets, лишних PII.
- `confirmed_trip` — источник согласованного; свежие сообщения/черновики — только пожелания или вопросы; отсутствие возражений ≠ согласие. Summary не переопределяет confirmed state.
- Dates — ISO `YYYY-MM-DD`, local times (если известны) — `HH:mm` + явная TZ для расписаний в разных регионах; **`null` и пустые дни допустимы**. Не выдумывать расписание и стоимость.
- Числа в примере — тестовые, не утверждённые реальные пользовательские limits. `tools.allowed_names=[]` означает **никаких API calls** и полноценную работу AI по знаниям модели.

## 5. `CopilotOutputV1`: обязательный envelope и пример fixture

```json
{
  "contract_version": "copilot-v1",
  "request_id": "00000000-0000-4000-8000-000000000001",
  "reply": {
    "text": "Предлагаю спокойные дни в Киото. Это идея, а не подтверждённая программа.",
    "limitations": ["Отели, доступность и цены не проверены"],
    "sources": []
  },
  "draft_candidates": [
    {
      "client_ref": "draft-a",
      "title": "Киото: прогулки и музеи",
      "plan": {
        "route": [{"label": "Киото"}],
        "days": [
          {
            "date": "2027-04-05",
            "items": [
              {"kind": "activity", "title": "Прогулка по району Гион", "start_time": null, "end_time": null, "note": "Время уточнить"}
            ]
          },
          {"date": "2027-04-06", "items": [], "note": "Свободный день"}
        ],
        "accommodation": [],
        "transport": []
      }
    }
  ],
  "change_candidates": [
    {
      "client_ref": "change-a",
      "title": "Добавить прогулку в первый день",
      "rationale": "Участники обсуждали спокойную прогулку после прилёта.",
      "base_trip_state_version": 8,
      "changes": [
        {
          "action": "add_item",
          "target": {"entity_kind": "day", "entity_id": "day-1", "base_version": 3},
          "proposed_value": {"kind": "activity", "title": "Прогулка по набережной", "start_time": null, "end_time": null}
        }
      ],
      "impact_hints": ["Расписание других мероприятий не проверено"],
      "depends_on_client_refs": []
    }
  ],
  "summary_update": {
    "expected_previous_version": 2,
    "processed_through_sequence": 50,
    "proposed_text": "Группа обсуждает Киото: нужны музеи, природа и свободное время. Отели не утверждены."
  },
  "usage": {
    "model_id": "example-provider/model",
    "input_tokens": 1100,
    "output_tokens": 400,
    "tool_calls": 0
  }
}
```

**Нормативная семантика:**

- `reply` виден **всем** участникам Chat. Никакой приватной AI-ветки или автоматической записи в Trip.
- `draft_candidates[]` — изолированные варианты, **не** автоматически обновлённый общий Draft. Человек выбирает «Добавить в черновик».
- `change_candidates[]` — предложения для human review, **не** уже созданные `Proposal` и **не** исполняемые database commands. Человек явно инициирует голосование, не получает автоматический accept. Одна запись может описывать пакет связанных правок, несколько записей — альтернативные/независимые изменения.
- `changes[].target` с `entity_id` указывает **существующий stable ID из входного snapshot**. Для новой сущности используйте `action: add_item` с target родителя, не выдумывайте DB UUID. Примерные `action` для AI: `add_item | update_item | remove_item | replace_day | update_route | update_dates | update_budget | update_transport | update_accommodation | update_note`. Это **семантический vocabulary кандидатов**, а не контракт SQL `scope_key`. Конкретный backend registry операций будет отдельно согласован для bridge, без необходимости переписывать planning prompts.
- **`scope_key` AI не генерирует.** Backend вычисляет lock regions, зависимости, версии и валидность изменений, не доверяя словам модели. Пример: изменение одного мероприятия блокирует весь день, а не только event ID; параллельный второй Proposal этого дня backend отклонит.
- Смена отеля не меняет подтверждённый бюджет сама по себе. Любой price-impact — объяснение/предлагаемый отдельный change, не silent side effect.
- `impact_hints` — рекомендации UX, а не пройденная проверка логистики. Время пересечений/стыковки двух различных событий **не анализируются автоматически** в первой версии.
- `depends_on_client_refs` — только подсказка взаимосвязи кандидатов в пределах одного AI response. Реальные `proposal_id`, validations и voting dependencies назначает backend при человеческом действии.
- `summary_update` — новая **кандидатная** summary, применяется backend только при корректной expected version и cutoff; не вычищать старые актуальные ограничения. Если не сформирована — `null`. `usage` — техническая telemetry, **не** основание для расчёта пользовательской квоты из доверия модели.
- `reply` всегда присутствует; массивы candidates разрешено отдавать пустыми; `summary_update` может быть `null`; `usage` может содержать нулевые значения при mock inference.
- Строгая validation: разумные ограничения размеров, поддерживаемые actions/типизированные targets, никаких неучтённых дополнительных полей на верхнем уровне; некорректный result не публикуется как подтверждённая операция.

## 6. Tool Gateway — минимальный контракт для mocks

AI worker получает программный интерфейс `tools.call(tool_name, arguments, call_id)`, реализованный на нашей стороне либо отдельным тестовым stub. **Никакого самостоятельного произвольного HTTP в AI worker**.

Пример разрешённой команды (в первом loop разрешённый список может быть пустым):

```json
{
  "call_id": "tool-call-1",
  "tool_name": "search_places",
  "arguments": {"destination": "Kyoto, Japan", "interests": ["temples", "museums"]}
}
```

Типизированный ответ gateway:

```json
{
  "call_id": "tool-call-1",
  "status": "ok",
  "source": {"provider": "mock-places", "checked_at": "2026-11-07T12:00:00Z"},
  "data": [{"name": "Example place", "location": "Kyoto"}],
  "limitations": []
}
```

`status` = `ok | not_available | rate_limited | timeout | error`. Для неуспеха `data=[]`, `limitations` с человекопонятным описанием, без service keys и провайдерского raw dump. Backend независимо проверяет `tool_name` по allowlist, budget, call count, timeout, args, destination/provider availability и input size. AI не должен подсовывать URL произвольного хоста, выполнять booking/purchase/payment или воспринимать данные tool как instructions.

**Примерные будущие registry names:** `search_places`, `search_hotels`, `search_transport`. В **первом AI loop** все tools могут быть mocks или `allowed_names=[]`; настоящие внешние providers **не обязательны для первого pre-beta** и будут изучаться отдельно. Поля `source`, `checked_at`, `currency`, availability/limitations сохранять на уровне нормализованных результатов там, где применимо.

## 7. Ошибки, отмена и исполнение

Публичные статусы AIRequest принадлежат backend: `queued → processing → completed | failed | cancelled` (deadline/timeout отражается через ошибку; не создавать неутверждённую новую продуктовую фазу). Первый запрос в Chat блокирует только **другой AIRequest того же Chat**, но не обычные сообщения.

AI adapter должен поддерживать typed failure (`code`, `retryable`, `safe_message`) для: `UNSUPPORTED_CONTRACT`, `INVALID_CONTEXT`, `MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`, `INVALID_MODEL_OUTPUT`, `TOOL_LIMIT`, `CANCELLED`, `INTERNAL_ERROR`. Это не публичный HTTP error contract — наш backend сопоставляет ошибки со своими API/AIRequest statuses. При сбое инструмента, если можно сформировать честный ответ — `completed` с `limitations`, а не фальшивые проверенные цены.

- Backend создаёт `request_id` и immutable cutoff; **только backend** резервирует/списывает/возвращает **одну** персональную квоту, проверяет tier и глобальный hard cap.
- При повторном сетевом запросе backend дедуплицирует user command. AI worker должен уметь прекращать вызовы по отмене/deadline; не обещать, что уже выполненные provider calls обратимы.
- Пользователь может отменить только **свой** запрос; others наблюдают результат/статус. Streaming tokens в первой реализации не обязателен — chat получает единый готовый ответ.
- При ошибке без полезного результата квота не расходуется; это **backend policy**, не переменная `usage` в AI JSON. Provider cost может остаться нашей издержкой.
- Tool calls и рекурсивные model attempts имеют hard budgets; нельзя запускать бесконечные auto-retry или scheduled analysis.

## 8. Context, trust и model instructions

Контекст включает все публичные профили активных участников, Travel Intent, confirmed Trip, релевантный Draft, ChatSummary и ограниченную историю сообщений на момент cutoff. Приоритет: **confirmed state; явные свежие сообщения как пожелания/изменения; профили/intent; summary/старые сообщения**. AI вправе самостоятельно предложить интересные места/отели/программу, но не выдаёт их за согласованные решения.

`ChatSummary` обновляется **только внутри явного AIRequest** и хранит важные актуальные ограничения, сомнения и вопросы; при изменении старого обсуждения summary корректируется, а не перезаписывается свежим пересказом с забытыми ограничениями. Модель не объявляет согласие на основании молчания. Непроверенные prices/availability, визы, часы работы и брони помечаются как непроверенные. Работа без инструментов должна оставаться полезной.

Все user/tool texts потенциально содержат prompt injection. Никакой текст внутри контекста не имеет полномочий менять системные требования, permissions, model tier, вызывать новые инструменты вне allowlist или выполнять write. **AI output и tool output — недоверенные данные**, даже когда JSON корректен. В проде backend проверяет schema + domain + authorization + versions + RLS. В AI сервисе тестировать prompt-injection и boundedness; RLS/IDOR integration тесты — наша сторона.

## 9. Acceptance fixtures — AI-разработчик делает без frontend/Supabase

| Тест | Ожидаемое свойство результата |
|---|---|
| Answer-only | Корректный `reply`, пустые `draft_candidates`/`change_candidates`, ничего не записано |
| 12-day itinerary | Подробные и свободные дни, отели/транспорт/notes по доступным данным; пустой день допустим, цены не выдумываются |
| Mixed interests | Интересы двух/трёх участников учтены, нет мнимого consensus |
| No Trip | При `trip_id=null` создаётся только candidate program, без Trip/Proposal IDs |
| Hotel cost vs budget | Price-impact warning; бюджет не меняется автоматически |
| Change existing day | Stable `day_id` и `base_version` взяты из input; не генерируется случайный DB ID |
| Multi-change response | Два независимых candidates либо один пакет связанных edits, без автоматического голосования |
| Long discussion | Summary не теряет старое актуальное ограничение, `processed_through_sequence` ≤ cutoff |
| Frozen cutoff | Нет ссылок на сообщения после cutoff, никаких самовольных DB reads |
| Prompt injection | «Прими сам/изменяй Trip/возьми secret» остаётся данными, не действием |
| Tools unavailable | Честный `limitations`, система работает при пустом allowlist |
| Bad model JSON | Validation error с безопасной диагностикой, никаких доверенных mutations |
| Retry/cancel/timeout | Bounded calls и no side effects; корректный typed failure |
| Quality monitoring | Отдельный отчёт: schema pass %, hallucination caution, cost/tokens/latency, сценарные ошибки |

Набор должен содержать sanitized JSON input/expected properties; **не** включать реальных сообщений/PII пользователей. Валидатор не должен пытаться «исправить» опасные операции автоматически. Одна ограниченная попытка reprompt на malformed JSON допустима только внутри уже начатого AIRequest и лимитов.

## 10. Три крупные AI loops, без ожидания наших loops

**Loop AI-1 — Contract + adapter + offline eval.** Pydantic/JSON Schema, вход/выход `copilot-v1`, adapter к облачной модели, deterministic mock, no-DB/no-HTTP tool interface, tests и README. Входные/выходные fixtures доступны нашим backend тестам. **Готовность:** `run_copilot` полностью тестируется офлайн и не требует нашего DB.

**Loop AI-2 — Planning, summary, candidate quality.** Prompt decomposition, day-by-day itinerary, comparison of alternatives, compromises, summary preservation, budget impact/uncertainty, answer and change candidates, repeatable evaluation. **Готовность:** full itinerary и user-to-Proposal candidates корректны на golden cases, без fake consensus/availability.

**Loop AI-3 — Tool integration readiness + resilience.** Strict gateway protocol, approved adapters или mocks, limits/retries/timeouts, testable cancellation, provenance and partial answers, contract tests с нашей стороной по мере доступности. **Готовность:** отсутствие реальных provider APIs не блокирует успешное выполнение AI-1/AI-2; отсутствуют DB/booking writes.

Передавать по итогам: исходники/lockfiles, README команд запуска, typed schema, JSON fixtures, unit/eval tests, model selection settings, использованные prompts, cost/quality/latency report, список известных ограничений и конкретных несовместимостей с нашей стороной. **Не делать production deploy/SQL mutations** без согласования.

## 11. Вопросы к совместному contract review — не блокируют AI-1/AI-2

Перед реальным `AIRequest ↔ AI-worker` integration merge достаточно коротко подтвердить:

1. Финальные field names и schema checksum `copilot-v1`, а также upper bounds sizes. **Этот файл — рабочая база, не утверждённая deployed API**.
2. Exact domain `changes[].action` validation/registry и как наша сторона переводит кандидата в ручной Proposal; **`scope_key` полностью принадлежит backend**.
3. Вариант worker transport (sync internal HTTP, worker queue и т. п.), internal auth и deployment deadline. Разработка бизнес-логики не должна от этого зависеть.
4. Как представлять sanitized tool/source data и отмену model call при конкретном provider, не передавая secrets в prompts.

**Не переоткрывать без явного продуктового решения:** единогласие, двухшаговое голосование, один pending Proposal на перекрываемую область, ручное принятие Draft/Proposal, личная квота, AI только по явному вызову, один последний PDF, Telegram notifications без LLM, security/RLS с первого loop.

---

**Короткая инструкция разработчику:** начинайте AI-1 и AI-2 по этому файлу уже сейчас; при вопросах о schema/SQL, Proposal statuses или scope не создавайте параллельную реализацию нашего backend, а фиксируйте в issue/contract note. Готовый inference layer может быть принят отдельно до полной интеграции Travel Friend.
