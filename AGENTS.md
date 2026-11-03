# Travel Friend — Codex Rules

Travel Friend — Telegram Mini App для поиска попутчиков и совместного планирования путешествий.

## Обязательные инварианты

- Работай только в scope задачи; не принимай продуктовые решения и не исправляй находки вне scope без отдельного согласования.
- Перед изменениями проверь выбранную ветку и рабочее дерево. Используй минимально необходимый контекст и проверки; жизненный цикл задачи описан в [Codex task protocol](docs/engineering-handbook/codex-task-protocol.md).
- Для `docs-only` меняй только разрешённые документы. Не трогай код приложения, `app/`, `components/`, `lib/`, migrations или package manifests.
- Не раскрывай секреты и не доверяй `initDataUnsafe` для Telegram authentication. Сервер проверяет raw Telegram `initData`.
- Устойчивые ограничения собраны в [Codex rules](docs/engineering-handbook/codex-rules.md); выбор skills — в [skills workflow](docs/engineering-handbook/codex-skills-workflow.md).

## Источники истины

| Вопрос | Источник |
|---|---|
| Что фактически реализовано | Текущий code/tests и migrations в `supabase/migrations/` |
| Продуктовые требования, MVP-границы и сценарии | [Product Vision](docs/product-vision.md), [MVP Scope](docs/mvp-scope.md), [User Flows](docs/user-flows.md) |
| Логическая архитектура, API contracts и reviewed design input | [Domain Model](docs/backend/domain-model.md) и [ER Model](docs/backend/er-diagram.md) — логическая архитектура; [Backend Contracts](docs/backend/backend-contracts.md) — API contracts; [Physical Data Design](docs/backend/physical-data-design.md) — reviewed design input, не реализованная SQL-схема |
| Текущие приоритеты | [Roadmap](docs/roadmap.md) |
| Технические риски и gates | [Technical Hardening Backlog](docs/technical-hardening-backlog.md) |
| Production procedures | Соответствующие runbooks, включая [Production Deployment Runbook](docs/backend/production-deployment-runbook.md) |
| Codex task lifecycle и checks | [Codex task protocol](docs/engineering-handbook/codex-task-protocol.md) |
| Human Git и PR process | [Workflow](docs/engineering-handbook/workflow.md) |
| Исторические записи | `CHANGELOG.md` и `docs/dev-log.md` |

При конфликте документации с текущей реализацией зафиксируй несоответствие для review; не меняй продуктовую логику автоматически. Historical records не переопределяют current state. `README.md` — обзорная точка входа; не переписывай его без явного указания.
