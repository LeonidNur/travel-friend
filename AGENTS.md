# Travel Friend — Codex Rules

Travel Friend — Telegram Mini App MVP для поиска попутчиков и совместного планирования путешествий с помощью ИИ. Реализован persisted backend-backed vertical slice: `Telegram Auth → onboarding → Profile → TravelIntent → Discover → Match → direct/group Chat → Messages → Trip creation → Trip List/Detail`.

## Как работать

Перед изменениями Codex читает `docs/engineering-handbook/codex-task-protocol.md`, `docs/engineering-handbook/codex-rules.md`, `docs/engineering-handbook/codex-skills-workflow.md` и релевантные файлы, затем показывает короткий план и перечисляет файлы, которые собирается изменить. Для docs-only задач он не меняет код приложения и не трогает `app/`, `components/`, `lib/`, `package.json` или `package-lock.json`.

Во время работы Codex держится в пределах задачи, не делает изменения «заодно», не добавляет зависимости без разрешения и не переписывает `README.md` без явного указания. При старте задачи он явно перечисляет прочитанные инструкции, выбранные skills/workflows, неиспользуемые skills и планируемые файлы. Если задача затрагивает существующий flow, он проверяет соседние сценарии; для backend-задач учитывает frontend-flow, но не принимает frontend view models за Supabase-схему. Новые несостыковки фиксируются как TODO/risk, но не исправляются без отдельного разрешения.

## Иерархия источников истины

Для implementation questions источники используются в таком порядке:

1. текущий scope задачи;
2. текущие code, tests и migrations — источник истины для фактически реализованного поведения;
3. approved domain / ER / physical-data documentation — источник истины для утверждённых архитектурных решений и инвариантов;
4. current roadmap и [technical hardening backlog](docs/technical-hardening-backlog.md);
5. engineering handbook;
6. `README.md`;
7. `CHANGELOG.md` и `docs/dev-log.md` — только historical records.

Historical documentation не переопределяет текущую реализацию или актуальные source-of-truth документы. Подробные правила процесса находятся в [engineering handbook](docs/engineering-handbook/README.md).

После изменений Codex кратко объясняет, что сделал и почему, затем запускает нужные проверки. Для frontend-задач базовая проверка - `npm run check`; для backend-задач она дополняется проверками, которые действительно нужны конкретному изменению. Если задача помечена как `docs-only`, он не меняет код приложения и ограничивается документальными проверками вроде `git diff --check`. В конце он перечисляет оставшиеся риски и TODO, если такие есть.

## Документация

Документация проекта по умолчанию ведётся на русском языке. `README.md` остаётся главным документом проекта и не должен сокращаться или переписываться радикально без явного разрешения.

## Базовые правила качества

Код и изменения должны оставаться простыми, понятными и проверяемыми. Предпочтение отдается небольшим фокусным диффам, ясным типам и отделению frontend, backend, database и AI-логики друг от друга.

## Безопасность

Нельзя раскрывать секреты на клиенте, доверять `initDataUnsafe` для аутентификации или коммитить чувствительные значения вроде API keys, bot tokens и Supabase service role key. Telegram Mini App auth должна проверяться на сервере через raw `initData`.

## Полезные навыки

- coding-standards
- frontend-patterns
- backend-patterns
- api-design
- tdd-workflow
- e2e-testing
- verification-loop
- security-review
- documentation-lookup
- nextjs-turbopack
