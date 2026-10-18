# Manual production deployment runbook

> **Статус:** операторский порядок для текущего MVP. Runbook не выполняет и не разрешает production rollout сам по себе. Каждый production rollout требует отдельного подтверждения оператора непосредственно перед запуском.

## Границы и источники

Production состоит из backend-контура Render, frontend Mini App на Vercel и Supabase/PostgreSQL. Реальные project/service IDs, production URLs, provider settings, health-check configuration и точные команды ручного deploy в репозитории не заданы. Оператор сверяет target и использует поддерживаемый ручной механизм в текущем provider UI/CLI; не подставляет guessed IDs, URLs, команды или настройки.

Auto-Deploy остаётся **Off**. До rollout оператор проверяет в provider settings, что выбранные production services не начнут deploy автоматически от Git события. Не включать Auto-Deploy в рамках этого workflow. Фактическое состояние frontend deployment automation должно быть проверено в provider: репозиторий его не подтверждает.

Этот документ задаёт порядок для нового изменения и не является повтором [завершённого security cutover](production-security-migrations-runbook.md). Там зафиксированы exact исторические SHA, migration suffix, grants, preconditions и failure boundary; их нельзя переносить на новое изменение или повторять как универсальные команды. Источники истины: текущие migrations в `supabase/migrations/`, grants/verifier/gate в `apps/backend/scripts/`, backend HTTP contracts и выбранный target commit.

## 1. Preflight и Git SHA

1. Получить отдельное подтверждение оператора на конкретный production rollout. Зафиксировать, какие backend/frontend изменения и DB изменения входят в него.
2. В чистом deployment checkout проверить repository, branch, commit и рабочее дерево. Зафиксировать полный target Git SHA; он должен совпадать с reviewed/approved revision. Не деплоить локальные незакоммиченные изменения.
3. Проверить GitHub Actions CI/review результата именно для этого SHA и наличие требуемых lockfiles. Текущий `.github/workflows/ci.yml` запускает frontend `npm run check` и backend tests с disposable PostgreSQL на `push`/`pull_request`; это проверка кода, не production deployment. Не считать локальный build заменой CI результата. Настроенные branch-protection/required-check rules из репозитория не подтверждаются и проверяются оператором отдельно.
4. В provider вручную выбрать подтверждённые production project/service/environment и тот же SHA. До подтверждения target ничего не запускать.
5. Проверить Auto-Deploy Off и доступность заранее согласованного способа quiesce/maintenance, если он требуется матрицей ниже. Репозиторий не задаёт универсальный maintenance toggle или его команду.

**STOP:** неизвестный target, dirty checkout, несовпадающий SHA, failed CI или незавершённый review, который обязателен по release policy, включённый или непроверенный Auto-Deploy, неподтверждённая production environment, либо отсутствие нужного quiesce/restore способа.

## 2. Проверить production schema и grants

До выбора порядка deployment сравнить фактическую production migration history и effective runtime contract с состоянием, нужным target SHA:

- определить применённый migration version и точный набор ожидаемых pending migrations; пропуски, неожиданные версии или history drift требуют остановки и отдельного разбора;
- для изменений grants/RLS подтвердить ожидаемую схему, ownership, policies, capability functions и privileges read-only verifier-ами из `apps/backend/scripts/`;
- когда изменён runtime contract, использовать production runtime gate с подтверждённой runtime identity и только после того, как DB contract/grants подготовлены;
- если DB не меняется, подтвердить, что существующая schema/grants совместимы с target backend.

Любое подключение выполняет оператор к независимо проверенному production target и с соответствующей least-privileged/provisioning identity. Не передавать DSN/keys в Git, shell history или отчёт. Имена переменных и примерный порядок из исторического cutover не означают, что его privileged команды подходят новой миграции.

**STOP:** production identity/target не подтверждены; migration history неожиданна; verifier или runtime gate не прошёл; или нужный schema/grants state невозможно проверить. Не исправлять drift через `migration repair`, ручное редактирование migration history, ad-hoc SQL или возврат broad grants.

## 3. Оценить DB/API compatibility и выбрать порядок

Для каждой migration и backend/API change определить, могут ли одновременно работать текущие и целевые backend instances на старой/новой schema, и может ли текущий frontend работать с целевым backend API (и наоборот на время переключения). Проверить SQL, migration comments, backend contracts и реальные call sites; слово «additive» само по себе не доказывает совместимость.

| Класс изменения | Предпочтительный порядок | Maintenance/quiesce и условие остановки |
|---|---|---|
| Только backend/frontend или полностью backward-compatible DB/API изменение | Deploy backend, затем frontend, если frontend требует новый API; иначе frontend/backend в порядке, проверенном совместимостью. | Обычно можно без quiesce только после подтверждения overlap compatibility и provider rollout behavior. Остановиться при несовпадении SHA или несовместимом ответе/ошибке health/smoke. |
| Additive DB migration, совместимая со старым и новым backend | DB-first: применить и проверить расширенную schema, затем deploy backend и при необходимости frontend. | Quiesce не нужен только если доказано, что миграция не ломает активные старые instances и apply не требует остановки. Любая неопределённость, lock/latency concern или недоказанная совместимость требует maintenance-плана/операторского решения до apply. |
| Breaking DB contract, API contract или grants/RLS change | Не делать одноступенчатый rollout. Сначала спроектировать expand/contract либо согласованный coordinated cutover; определить совместимые промежуточные версии и точный recovery path. | Quiesce/maintenance требуется, если старый и новый runtime не могут безопасно сосуществовать или это требует migration. Если его безопасный способ не подтверждён, rollout не начинать. Grants/RLS failure означает STOP; не ослаблять ограничения как workaround. |
| Change, требующий expand/contract | Expand schema/capability backward-compatibly → deploy backend, работающий со старым и расширенным контрактом → deploy frontend/API callers → подтвердить, что старые instances/callers больше не используют legacy contract → отдельно согласовать contract migration/removal. | Contract phase — отдельный rollout с повторным preflight и явным подтверждением. Не удалять legacy overload/column/policy в том же шаге, что впервые переключает callers, если coexistence не доказана. |

**DB-first или backend-first не является постоянным правилом.** DB-first допустим лишь для проверенной additive/backward-compatible миграции. Backend-first допустим только если target backend работает на текущей production schema и rollout не направит requests на несовместимую смешанную версию. API и frontend sequencing определяется проверенным контрактом и фактическим переключением instances.

## 4. Выполнить ручной rollout

1. Непосредственно перед изменением production оператор повторно подтверждает target service/environment, Git SHA, schema/grants preconditions, порядок из decision matrix, Auto-Deploy Off и необходимость quiesce. Это отдельный approval gate; наличие этого runbook или прохождение CI не является разрешением.
2. Если требуется quiesce, применить заранее проверенный оператором механизм и подтвердить прекращение соответствующего traffic до DB/API несовместимого шага. Runbook не выдумывает provider-specific maintenance command.
3. Применить только согласованные migrations/grants в выбранном порядке по отдельной проверенной инструкции для конкретного изменения. Для migration apply сверить точный pending suffix до применения. Не использовать исторические one-off команды как общий шаблон.
4. Ручным provider механизмом развернуть backend SHA и затем frontend SHA в порядке, установленном выше. Подтвердить фактически deployed SHA после каждого service rollout. Не менять secrets, DATABASE_URL, network rules, providers или Auto-Deploy как часть этого шага без отдельного scoped approval.
5. Проверить readiness/smoke. Traffic восстанавливать только после выполнения критериев ниже.

Поскольку provider settings и deployment CLIs не подтверждены в репозитории, конкретные нажатия в UI, `render`/`vercel` команды, target URLs и env values должны быть вписаны/проверены оператором для выбранного проекта перед фактическим rollout. Не угадывать их.

## 5. Smoke и критерии остановки

### Автоматический read-only HTTP smoke

Перед запуском оператор должен:

1. Убедиться, что deployment завершён для подтверждённого backend service/environment, а его фактически deployed SHA совпадает с approved SHA.
2. Проверить CI/review, Auto-Deploy Off и все применимые к изменению migration, schema, grants и runtime gates из разделов выше.
3. Независимо подтвердить backend base URL выбранного target. Не брать URL из непроверенного deployment output и не сохранять секретные значения в команде или отчёте.
4. Запустить из корня репозитория, подставив только подтверждённый backend base URL:

   ```sh
   cd apps/backend
   uv run --group dev python scripts/deployment_smoke.py --base-url "$CONFIRMED_BACKEND_BASE_URL"
   ```

`deployment_smoke.py` последовательно выполняет только `GET /health` и `GET /ready`, с timeout 5 секунд на каждый запрос и без перехода по redirects. Ожидаются HTTP 200 и точные тела `{"status":"ok"}` и `{"status":"ready"}`; при успехе команда завершается с кодом 0. Любая ошибка соединения/timeout, redirect, иной HTTP status или тело ответа даёт `FAIL` и non-zero exit code; цепочка останавливается на первой ошибке. Запросы не создают и не меняют пользовательские данные.

`/health` подтверждает только liveness процесса. `/ready` подтверждает доступность минимальной DB dependency через `SELECT 1`; этот smoke не проверяет deployed schema parity, grants/RLS, Telegram authentication или бизнес-сценарии. Schema/grants проверяются отдельными verifier-ами; HTTP health их не заменяет.

**STOP:** не запускать smoke при неподтверждённых target/base URL/SHA или незавершённых обязательных preflight gates. При любом non-zero результате, неожиданном redirect/ответе или transport error остановить rollout, оставить traffic quiesced, если он был quiesced, и расследовать причину. Не продолжать traffic restore до успешных обязательных проверок.

### Ручной Telegram E2E

Полный сценарий Telegram Auth → Profile/TravelIntent → Discover/Match → Chat/Messages → Trips остаётся отдельной ручной проверкой. Его выполняют только по отдельно согласованному сценарию, с разрешённым test account и определёнными правилами тестовых данных. Автоматический read-only smoke не аутентифицируется, не создаёт пользователей/сообщения/чаты/поездки и не заменяет Telegram E2E.

Зафиксировать observed SHA, migration version, результаты verifier/gate, HTTP smoke и решение о traffic restore в operator deployment record. Provenance самого deployment относится к №16.

Немедленно остановиться и оставить traffic quiesced, если target SHA не совпал, migration history/schema/grants не соответствуют плану, любой verifier/gate/health/readiness/smoke падает, появляются неожиданные ошибки или выясняется, что старая и новая версии несовместимы. Не переключать сервис обратно на старый backend после breaking DB/API/grants change без доказанной совместимости; использовать отдельно согласованный rollback/forward-fix procedure задачи №22. Если миграция изменила данные/схему, допустимость восстановления зависит от заранее проверенного backup/restore плана №21. Не импровизировать с ручным SQL, `migration repair`, credential changes или provider settings.

## Связанные задачи

- **№16 — provenance/environments:** фиксирует/автоматизирует доказательство environment, commit/deployed SHA и schema parity; этот runbook требует сверять их вручную.
- **№17 — deployment smoke:** read-only HTTP chain `/health` → `/ready` документирован в этом разделе и реализован скриптом `apps/backend/scripts/deployment_smoke.py`; Telegram E2E остаётся ручным.
- **№21 — backup/restore:** текущий статус — AUDIT/PLAN; см. [backup/restore audit and operator plan](backup-restore-runbook.md). Восстановимого backup пока нет, а restore не проверялся; этот deployment runbook не задаёт backup storage или recovery procedure.
- **№22 — rollback/forward-fix:** определяет recovery для backend/API/DB/grants. Старый backend не является допустимым rollback target автоматически после breaking change.

Завершение №15 как docs-ready не закрывает №16, №17, №21 или №22, не подтверждает текущие provider settings и не означает, что следующий production deployment уже одобрен.
